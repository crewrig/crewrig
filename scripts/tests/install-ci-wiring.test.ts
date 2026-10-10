// install-ci-wiring.test.ts — the CI reference (ci/ci-capabilities.yml) wires the TypeScript
// install, manage and link entries correctly (spec 0255 R29, R32; the thirteen `.sh` files are now
// forwarding shims).
//
// The assertions live in functions over the PARSED reference, so the mutation tests below can run
// the very same functions on an in-memory mutated copy and prove each one can go red. No file is
// edited. The reference is read with `js-yaml` and paths are decided by the repo glob engine,
// never by an invented pattern matcher. Model: build-components-ci-wiring.test.ts.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { globToRegExp } from "../lib/glob-engine.ts";
import { REPO } from "./lib/build-fixture-tree.ts";
import { yamlLib } from "./lib/yaml-lib.ts";

interface Trigger {
  readonly on?: string;
  readonly paths?: readonly string[];
}
interface Capability {
  readonly id: string;
  readonly trigger?: readonly Trigger[];
  readonly requires?: { readonly runtime?: string | readonly string[] };
  readonly command?: readonly string[];
}

const NAMES = [
  "install-extension",
  "install-extension-all",
  "install-claude-plugin",
  "install-copilot-plugin",
  "install-antigravity-extension",
  "install-workspace",
  "manage-claude-component",
  "manage-copilot-component",
  "manage-antigravity-component",
  "manage-workspace-component",
  "link-extensions",
  "unlink-extensions",
  "unlink-component",
];

// One real file under each library the shims' entries share; a `paths:` list "names" a library
// when the repo glob engine says one of its entries selects that file.
const LINK_OR_COPY = "scripts/lib/link-or-copy.ts";
const MANAGE_LIB = "scripts/lib/manage/entry.ts";
const INSTALL_LIB = "scripts/lib/install/extension.ts";

// The Bash suites that drive the shims (the plan names these four), and the node:test suites that
// do. A capability runs a shim when a command runs one of the shims or one of these suites.
const SHIM_SUITES: readonly string[] = [
  "scripts/tests/test-install-extension-all.sh",
  "scripts/tests/test-install-claude-plugin-marketplace.sh",
  "scripts/tests/test-antigravity-component-install.sh",
  "scripts/tests/test-component-tier-resolution.sh",
  "scripts/tests/install-shim.test.ts",
];
const SHIM_COMMAND = new RegExp(`\\b(${NAMES.join("|")})\\.sh\\b`);
const PROD_INSTALL = /^npm ci( --omit=dev --workspaces=false)?$/;

function loadReference(): { readonly capabilities: Capability[] } {
  const text = fs.readFileSync(path.join(REPO, "ci", "ci-capabilities.yml"), "utf8");
  const doc: unknown = yamlLib.load(text);
  const caps = (doc as { capabilities?: unknown } | null)?.capabilities;
  assert.ok(Array.isArray(caps), "ci/ci-capabilities.yml has a capabilities list");
  return { capabilities: caps as Capability[] };
}

type Reference = ReturnType<typeof loadReference>;

function mutableCopy(ref: Reference): { capabilities: Record<string, unknown>[] } {
  return structuredClone(ref) as unknown as { capabilities: Record<string, unknown>[] };
}

function commandsOf(cap: Capability): readonly string[] {
  return cap.command ?? [];
}

/** True when some entry of `list` selects `file`. */
function names(list: readonly string[], file: string): boolean {
  return list.some((glob) => globToRegExp(glob).test(file));
}

/** Per-trigger faults: a `paths:` list naming a shim `.sh` must name its entry and the libraries. */
function pathFaults(ref: Reference): string[] {
  const faults: string[] = [];
  for (const cap of ref.capabilities) {
    (cap.trigger ?? []).forEach((trigger, index) => {
      const list = trigger.paths ?? [];
      for (const name of NAMES) {
        if (!list.includes(`scripts/${name}.sh`)) continue;
        const where = `${cap.id}[${index}] ${name}`;
        if (!names(list, `scripts/${name}.ts`)) faults.push(`${where}: entry .ts not named`);
        if (!names(list, LINK_OR_COPY)) faults.push(`${where}: scripts/lib/link-or-copy*.ts`);
        if (name.startsWith("manage-") && !names(list, MANAGE_LIB))
          faults.push(`${where}: scripts/lib/manage/**`);
        if (name.startsWith("install-") && !names(list, INSTALL_LIB))
          faults.push(`${where}: scripts/lib/install/**`);
      }
    });
  }
  return faults;
}

/** The capabilities one of whose commands executes a shim or a suite that runs one. */
function shimRunners(ref: Reference): Capability[] {
  return ref.capabilities.filter((cap) =>
    commandsOf(cap).some(
      (cmd) => SHIM_COMMAND.test(cmd) || SHIM_SUITES.some((suite) => cmd.includes(suite)),
    ),
  );
}

function runtimes(cap: Capability): readonly string[] {
  const runtime = cap.requires?.runtime;
  return runtime === undefined ? [] : typeof runtime === "string" ? [runtime] : runtime;
}

/** Per-capability faults of a shim-running capability: node@24 and the production install first. */
function runnerFaults(ref: Reference): string[] {
  const faults: string[] = [];
  for (const cap of shimRunners(ref)) {
    if (!runtimes(cap).includes("node@24")) faults.push(`${cap.id}: runtime lacks node@24`);
    const install = commandsOf(cap).findIndex((c) => PROD_INSTALL.test(c));
    const first = commandsOf(cap).findIndex(
      (c) => SHIM_COMMAND.test(c) || SHIM_SUITES.some((suite) => c.includes(suite)),
    );
    if (install < 0) faults.push(`${cap.id}: no production install command`);
    else if (install > first) faults.push(`${cap.id}: install runs after the first shim call`);
  }
  return faults;
}

const REF = loadReference();

describe("the CI reference wires the TypeScript install, manage and link entries", () => {
  test("every paths list naming a shim also names its entry and the shared libraries", () => {
    const listing = REF.capabilities.flatMap((cap) =>
      (cap.trigger ?? []).flatMap((t) => t.paths ?? []),
    );
    assert.ok(
      NAMES.every((name) => listing.includes(`scripts/${name}.sh`)),
      "every shim is named by some paths list",
    );
    assert.deepEqual(pathFaults(REF), []);
  });

  test("every capability that runs a shim or a suite driving one declares node@24 and installs first", () => {
    const ids = shimRunners(REF).map((cap) => cap.id);
    for (const id of ["extension-install", "mempalace", "frontmatter"]) {
      assert.ok(ids.includes(id), `${id} was derived as a shim runner (got ${ids.join(", ")})`);
    }
    assert.deepEqual(runnerFaults(REF), []);
  });
});

describe("mutation check: each assertion goes red on a broken reference", () => {
  test("dropping an entry from the list that names its shim is reported", () => {
    const copy = mutableCopy(REF);
    const cap = copy.capabilities.find((c) => c.id === "extension-install") as {
      trigger: { paths?: string[] }[];
    };
    for (const t of cap.trigger)
      if (t.paths) t.paths = t.paths.filter((p) => p !== "scripts/unlink-component.ts");
    const faults = pathFaults(copy as unknown as Reference);
    assert.deepEqual(faults, [
      "extension-install[0] unlink-component: entry .ts not named",
      "extension-install[1] unlink-component: entry .ts not named",
    ]);
  });

  test("dropping the shared libraries from a list that names a manage shim is reported", () => {
    const copy = mutableCopy(REF);
    const cap = copy.capabilities.find((c) => c.id === "extension-install") as {
      trigger: { paths?: string[] }[];
    };
    for (const t of cap.trigger)
      if (t.paths)
        t.paths = t.paths.filter(
          (p) => p !== "scripts/lib/manage/**" && p !== "scripts/lib/install/**",
        );
    const faults = pathFaults(copy as unknown as Reference);
    assert.ok(
      faults.includes("extension-install[0] manage-claude-component: scripts/lib/manage/**"),
    );
    assert.ok(faults.includes("extension-install[1] install-workspace: scripts/lib/install/**"));
    assert.ok(!faults.some((f) => f.includes("link-extensions")), faults.join("\n"));
  });

  test("dropping the production install or the runtime from a shim runner is reported", () => {
    const copy = mutableCopy(REF);
    const cap = copy.capabilities.find((c) => c.id === "frontmatter") as {
      command: string[];
      requires: { runtime?: string };
    };
    cap.command = cap.command.filter((c) => !c.startsWith("npm ci"));
    delete cap.requires.runtime;
    assert.deepEqual(runnerFaults(copy as unknown as Reference), [
      "frontmatter: runtime lacks node@24",
      "frontmatter: no production install command",
    ]);
  });

  test("moving the install after the first shim call is reported", () => {
    const copy = mutableCopy(REF);
    const cap = copy.capabilities.find((c) => c.id === "frontmatter") as { command: string[] };
    cap.command = [...cap.command.filter((c) => !c.startsWith("npm ci")), "npm ci"];
    assert.deepEqual(runnerFaults(copy as unknown as Reference), [
      "frontmatter: install runs after the first shim call",
    ]);
  });
});
