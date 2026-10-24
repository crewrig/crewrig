// check-ci-pre-push-parity.ts — parity guard of the `ci:<id>` tasks (spec 0279 R3, R4, R5).
//
// Usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-ci-pre-push-parity.ts [--root <dir>]
// `--root` points at a repository tree (default: the parent of scripts/); tests pass a mkdtemp fixture.
//
// Checks, for every `ci:<id>` task other than the closed CONTROL_TASKS set:
//   (a) a capability `<id>` exists in ci/ci-capabilities.yml;
//   (b) the normalised, expanded command lists of the task and the capability are equal (R3);
//   (c) every id of ci/pre-push-tier.json has a `ci:<id>` task;
//   plus: every `- task:` call written in taskfiles/ci.yml is colon-anchored (R2), and no
//   provisioning command (R5) is left in a ci task.
//
// Spec 0279 delta-03 R22: a capability whose `command:` is exactly the single entry `task ci:<id>`
// is *migrated* and checked by shape (its task must exist; nothing is compared); a `command:` that
// is a single `task ci:<other>` fails unconditionally (mismatched-command); every other shape keeps
// the R3/R4 comparison. Provisioning (R5) stays enforced on every ci task.
//
// Exit: 0 clean, 1 findings, 2 wiring fault (an input cannot be read or parsed: an explicit
// NOTICE is printed on stderr, nothing is skipped silently).
// Finding line format: `ci-pre-push-parity: <rule>: <where>: <message>`, one per line on stderr.
// Rules: no-capability, command-mismatch, mismatched-command, missing-task, unanchored-call, provisioning, unresolved.

import { readFileSync } from "node:fs";
import path from "node:path";
import {
  CONTROL_TASKS,
  normalizeCommand,
  CommandResolveError,
  PROVISIONING,
  loadTaskfileTree,
  resolveCapabilityCommands,
  resolveTaskCommands,
  taskCallRefs,
} from "./lib/ci-pre-push/normalize.ts";
import { readCapabilities } from "./lib/ci-parity/reference-read.ts";
import type { CapRecord } from "./lib/ci-parity/state.ts";
import { TaskfileTreeError } from "./lib/taskfile-tree.ts";
import type { TaskfileTree } from "./lib/taskfile-tree.ts";
import { parse } from "./lib/yq-accessors/index.ts";

const CI_FILE = "taskfiles/ci.yml";
const CAPABILITIES_FILE = "ci/ci-capabilities.yml";
const TIER_FILE = "ci/pre-push-tier.json";

const findings: string[] = [];
const faults: string[] = [];

function finding(rule: string, where: string, message: string): void {
  findings.push(`ci-pre-push-parity: ${rule}: ${where}: ${message}`);
}

function fault(message: string): void {
  faults.push(`ci-pre-push-parity: NOTICE ${message}`);
}

function parseRoot(argv: readonly string[]): string {
  const i = argv.indexOf("--root");
  if (i === -1) {
    return path.resolve(import.meta.dirname, "..");
  }
  const value = argv[i + 1];
  if (value === undefined || value === "") {
    process.stderr.write("ci-pre-push-parity: NOTICE --root needs a directory\n");
    process.exit(2);
  }
  return path.resolve(value);
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function readCaps(root: string): Map<string, CapRecord> | undefined {
  try {
    const doc = parse(readFileSync(path.join(root, CAPABILITIES_FILE), "utf8"));
    return new Map(readCapabilities(doc).map((c) => [c.id, c]));
  } catch (err) {
    fault(`cannot read ${CAPABILITIES_FILE}: ${errorText(err)}`);
    return undefined;
  }
}

function readTier(root: string): string[] | undefined {
  let text: string;
  try {
    text = readFileSync(path.join(root, TIER_FILE), "utf8");
  } catch (err) {
    fault(`cannot read ${TIER_FILE}: ${errorText(err)}`);
    return undefined;
  }
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      fault(`${TIER_FILE} is not a JSON object of { "<id>": seconds }`);
      return undefined;
    }
    return Object.keys(value);
  } catch (err) {
    fault(`cannot parse ${TIER_FILE}: ${errorText(err)}`);
    return undefined;
  }
}

function firstDifference(
  a: readonly string[],
  b: readonly string[],
): { index: number; left: string; right: string } | undefined {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) {
      return { index: i, left: a[i] ?? "<none>", right: b[i] ?? "<none>" };
    }
  }
  return undefined;
}

/** `ci:<id>` when the capability's `command:` is exactly the single entry `task ci:<id>`. */
type CapClass = { kind: "migrated" } | { kind: "mismatched"; text: string } | { kind: "raw" };

function classify(cap: CapRecord): CapClass {
  if (cap.ncmd !== 1 || cap.cmds.length !== 1) {
    return { kind: "raw" };
  }
  const text = normalizeCommand(cap.cmds[0] ?? "");
  if (text === `task ci:${cap.id}`) {
    return { kind: "migrated" };
  }
  if (/^task ci:\S+$/.test(text)) {
    return { kind: "mismatched", text };
  }
  return { kind: "raw" };
}

function checkTask(tree: TaskfileTree, caps: Map<string, CapRecord>, name: string): void {
  const id = name.slice("ci:".length);
  const cap = caps.get(id);
  if (cap === undefined) {
    finding("no-capability", name, `no capability '${id}' exists in ${CAPABILITIES_FILE}`);
    return;
  }
  try {
    const task = resolveTaskCommands(tree, name);
    for (const cmd of task.provisioning) {
      finding(
        "provisioning",
        name,
        `provisioning command '${cmd}' (${PROVISIONING.source}) must be a precondition, not a command`,
      );
    }
    if (cap.engine !== "") {
      return; // a `specific` capability carries no command list in the reference (spec 0284)
    }
    if (classify(cap).kind !== "raw") {
      return; // migrated: the task is the authority; mismatched: reported by checkCapabilities
    }
    const reference = resolveCapabilityCommands(tree, cap.cmds);
    const diff = firstDifference(reference.commands, task.commands);
    if (diff !== undefined) {
      finding(
        "command-mismatch",
        name,
        `capability '${id}' command #${diff.index + 1} differs; capability: ${diff.left} | task: ${diff.right}`,
      );
    }
  } catch (err) {
    if (err instanceof CommandResolveError) {
      finding("unresolved", name, err.message);
      return;
    }
    throw err;
  }
}

/** R22(b) and (d): the shape rules of a migrated or mismatched `command:`. */
function checkCapabilities(tree: TaskfileTree, caps: Map<string, CapRecord>): void {
  for (const cap of caps.values()) {
    const cls = classify(cap);
    if (cls.kind === "mismatched") {
      finding(
        "mismatched-command",
        cap.id,
        `capability '${cap.id}' command '${cls.text}' names another capability's task; expected 'task ci:${cap.id}'`,
      );
    } else if (cls.kind === "migrated" && !tree.byName.has(`ci:${cap.id}`)) {
      finding("missing-task", cap.id, `migrated capability '${cap.id}' has no 'ci:${cap.id}' task`);
    }
  }
}

function main(): number {
  const root = parseRoot(process.argv.slice(2));
  let tree: TaskfileTree | undefined;
  try {
    tree = loadTaskfileTree(root);
  } catch (err) {
    if (!(err instanceof TaskfileTreeError)) {
      throw err;
    }
    fault(`cannot load the Taskfile tree: ${err.message}`);
  }
  const caps = readCaps(root);
  const tier = readTier(root);

  if (tree !== undefined) {
    const ciTasks = tree.tasks.filter((t) => t.name.startsWith("ci:"));
    for (const task of ciTasks) {
      if (task.file !== CI_FILE) {
        continue;
      }
      for (const ref of taskCallRefs(task.definition)) {
        if (!ref.startsWith(":")) {
          finding(
            "unanchored-call",
            task.name,
            `'- task: ${ref}' must be written colon-anchored ('- task: :${ref}')`,
          );
        }
      }
    }
    if (caps !== undefined) {
      checkCapabilities(tree, caps);
      for (const task of ciTasks) {
        if (!CONTROL_TASKS.includes(task.name)) {
          checkTask(tree, caps, task.name);
        }
      }
    }
    if (tier !== undefined) {
      for (const id of tier) {
        if (!tree.byName.has(`ci:${id}`)) {
          finding("missing-task", id, `tier id '${id}' has no 'ci:${id}' task`);
        }
      }
    }
  }

  for (const line of faults) {
    process.stderr.write(`${line}\n`);
  }
  for (const line of findings) {
    process.stderr.write(`${line}\n`);
  }
  if (faults.length > 0) {
    return 2;
  }
  if (findings.length > 0) {
    return 1;
  }
  process.stdout.write("ci-pre-push-parity: OK\n");
  return 0;
}

process.exitCode = main();
