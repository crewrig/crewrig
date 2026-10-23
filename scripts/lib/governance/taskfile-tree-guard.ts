// taskfile-tree-guard.ts — layout guard of the Taskfile tree (spec 0278 R13, R14).
//
// Usage: checkTaskfileTree(repoDir, { compareWithTask }) -> { findings, notices, taskCount, fileCount }
// Checks (a)-(g):
//   (a) every taskfiles/*.yml is reachable from the root includes
//   (b) no file under scripts/ outside ALLOW reads the root Taskfile directly
//   (c) the root defines no task other than `default`
//   (d) every Taskfile of the tree declares the uniform `version` string
//   (e) an included file does not use TASKFILE_DIR
//   (f) every `deps:` entry and `- task:` call resolves from the namespace of its file (R20)
//   (g) no include carries `dir:`, `excludes:` or `aliases:` (R7, R9)
// R14: the loader's effective names must equal `task --list-all --json`; when the `task` binary is
// absent the comparison is skipped with an explicit notice, never silently.
// Throws TaskfileTreeError when the tree cannot be loaded (the CLI maps it to exit 2).

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { loadTaskfileTree } from "../taskfile-tree.ts";
import type { TaskEntry, TaskfileTree } from "../taskfile-tree.ts";

/** The uniform floor string of spec 0278 R8. */
export const TASKFILE_VERSION = "3.39";

/** Files under scripts/ that may name the root Taskfile literally, each with its reason (check b). */
export const ROOT_READER_ALLOW: ReadonlyMap<string, string> = new Map([
  [
    "scripts/lib/taskfile-tree-parse.ts",
    "the parser names the root file a directory include resolves to",
  ],
  ["scripts/lib/governance/taskfile-tree-guard.ts", "the guard names the root file it checks"],
  [
    "scripts/tests/check-taskfile-commands.test.ts",
    "writes its own root Taskfile into a mkdtemp fixture tree",
  ],
  ["scripts/tests/taskfile-tree.test.ts", "builds fixture roots for the loader"],
  [
    "scripts/tests/check-taskfile-tree-layout.test.ts",
    "builds split-shaped fixture roots for the guard",
  ],
  [
    "scripts/tests/taskfile-tree-references.test.ts",
    "stages a root Taskfile in a mkdtemp tree and runs it through task",
  ],
]);

export interface GuardOptions {
  /** Run the R14 comparison against `task --list-all --json` (default true). */
  compareWithTask?: boolean;
}

export interface GuardResult {
  findings: string[];
  notices: string[];
  taskCount: number;
  fileCount: number;
}

const ROOT_LITERAL = /["'`]Taskfile\.yml["'`]/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function listFiles(dir: string, out: string[], rel: string): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) {
      continue;
    }
    const childRel = `${rel}/${entry.name}`;
    if (entry.isDirectory()) {
      listFiles(path.join(dir, entry.name), out, childRel);
    } else if (/\.(?:ts|js)$/.test(entry.name)) {
      out.push(childRel);
    }
  }
}

function checkUnreachable(repoDir: string, tree: TaskfileTree, findings: string[]): void {
  let names: string[];
  try {
    names = readdirSync(path.join(repoDir, "taskfiles"));
  } catch {
    return;
  }
  const reachable = new Set(tree.files);
  for (const name of names.filter((n) => n.endsWith(".yml")).sort()) {
    const rel = `taskfiles/${name}`;
    if (!reachable.has(rel)) {
      findings.push(`${rel} is not reachable from the root includes`);
    }
  }
}

function checkRootReaders(repoDir: string, findings: string[]): void {
  const files: string[] = [];
  listFiles(path.join(repoDir, "scripts"), files, "scripts");
  for (const file of files.sort()) {
    if (ROOT_READER_ALLOW.has(file)) {
      continue;
    }
    let text: string;
    try {
      text = readFileSync(path.join(repoDir, file), "utf8");
    } catch {
      continue;
    }
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) {
        continue;
      }
      if (ROOT_LITERAL.test(line)) {
        findings.push(
          `${file}:${i + 1}: reads the root Taskfile directly; use scripts/lib/taskfile-tree.ts or add it to ROOT_READER_ALLOW with a reason`,
        );
        break;
      }
    }
  }
}

function describeVersion(version: unknown): string {
  return typeof version === "string"
    ? `'${version}'`
    : `${JSON.stringify(version) ?? "undefined"} (${typeof version})`;
}

function taskRefs(definition: unknown): string[] {
  if (!isRecord(definition)) {
    return [];
  }
  const refs: string[] = [];
  const fromCall = (item: unknown): void => {
    if (isRecord(item)) {
      if (typeof item["task"] === "string") {
        refs.push(item["task"]);
      }
      const deferred = item["defer"];
      if (isRecord(deferred) && typeof deferred["task"] === "string") {
        refs.push(deferred["task"]);
      }
    }
  };
  const deps = definition["deps"];
  if (Array.isArray(deps)) {
    for (const dep of deps) {
      if (typeof dep === "string") {
        refs.push(dep);
      } else {
        fromCall(dep);
      }
    }
  }
  fromCall(definition["cmd"]);
  const cmds = definition["cmds"];
  if (Array.isArray(cmds)) {
    cmds.forEach(fromCall);
  }
  return refs;
}

function resolvedName(entry: TaskEntry, ref: string): string {
  if (ref.startsWith(":")) {
    return ref.slice(1);
  }
  return entry.namespace === "" ? ref : `${entry.namespace}:${ref}`;
}

function checkReferences(tree: TaskfileTree, findings: string[]): void {
  for (const entry of tree.tasks) {
    for (const ref of taskRefs(entry.definition)) {
      if (ref.includes("{{")) {
        continue;
      }
      const resolved = resolvedName(entry, ref);
      if (!tree.byName.has(resolved)) {
        findings.push(
          `${entry.file}: task '${entry.name}' references '${ref}' which resolves to '${resolved}' (no such task)`,
        );
      }
    }
  }
}

function compareWithTaskBinary(
  repoDir: string,
  tree: TaskfileTree,
  findings: string[],
  notices: string[],
): void {
  const run = spawnSync("task", ["--list-all", "--json"], {
    cwd: repoDir,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (run.error !== undefined) {
    const code = (run.error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      notices.push("task binary not found; loader-vs-Task name comparison (spec 0278 R14) SKIPPED");
    } else {
      findings.push(`cannot run 'task --list-all --json': ${run.error.message}`);
    }
    return;
  }
  if (run.status !== 0) {
    findings.push(
      `'task --list-all --json' exited ${run.status}: ${(run.stderr ?? "").trim().split("\n")[0] ?? ""}`,
    );
    return;
  }
  let listed: Set<string>;
  try {
    const parsed: unknown = JSON.parse(run.stdout);
    const tasks = isRecord(parsed) ? parsed["tasks"] : undefined;
    if (!Array.isArray(tasks)) {
      throw new Error("no `tasks` array");
    }
    listed = new Set(
      tasks.flatMap((t) => (isRecord(t) && typeof t["name"] === "string" ? [t["name"]] : [])),
    );
  } catch (err) {
    findings.push(
      `cannot parse 'task --list-all --json': ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }
  const loaded = new Set(tree.tasks.map((t) => t.name));
  if (!listed.has("default")) {
    // A Task version that omits an undescribed `default` is compared without it on both sides.
    loaded.delete("default");
  }
  for (const name of [...loaded].sort()) {
    if (!listed.has(name)) {
      findings.push(`task '${name}' is loaded from the tree but not listed by Task (R14)`);
    }
  }
  for (const name of [...listed].sort()) {
    if (!loaded.has(name)) {
      findings.push(`task '${name}' is listed by Task but not loaded from the tree (R14)`);
    }
  }
}

/** Run every check against the tree under `repoDir`. */
export function checkTaskfileTree(repoDir: string, options: GuardOptions = {}): GuardResult {
  const tree = loadTaskfileTree(repoDir);
  const findings: string[] = [];
  const notices: string[] = [];

  checkUnreachable(repoDir, tree, findings);
  checkRootReaders(repoDir, findings);

  for (const entry of tree.tasks.filter((t) => t.file === tree.root && t.localName !== "default")) {
    findings.push(`${tree.root} defines task '${entry.name}'; the root may only define 'default'`);
  }

  for (const node of tree.nodes) {
    if (node.version !== TASKFILE_VERSION) {
      findings.push(
        `${node.file}: version ${describeVersion(node.version)} differs from '${TASKFILE_VERSION}'`,
      );
    }
    if (node.file !== tree.root) {
      const uses = node.text
        .split("\n")
        .some((line) => !line.trimStart().startsWith("#") && line.includes("TASKFILE_DIR"));
      if (uses) {
        findings.push(`${node.file}: uses TASKFILE_DIR; build repository paths from REPO_DIR`);
      }
    }
    for (const include of node.includes) {
      for (const key of include.extraKeys.filter((k) =>
        ["dir", "excludes", "aliases"].includes(k),
      )) {
        findings.push(`${node.file}: include '${include.key}' uses '${key}:' (not allowed, R7/R9)`);
      }
    }
  }

  checkReferences(tree, findings);

  if (options.compareWithTask !== false) {
    compareWithTaskBinary(repoDir, tree, findings, notices);
  }

  return { findings, notices, taskCount: tree.tasks.length, fileCount: tree.files.length };
}
