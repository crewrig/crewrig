// build-components-ci-wiring.test.ts — the CI reference (ci/ci-capabilities.yml) wires the
// TypeScript component build correctly (spec 0250 R27, delta-01: the build entry is now
// `node scripts/build-components.ts`, `scripts/build-components.sh` is a shim).
//
// The assertions live in functions over the PARSED reference, so the mutation tests below can
// run the very same functions on an in-memory mutated copy and prove each one can go red. No
// file is edited. The reference is read with `js-yaml` (the only YAML library the repo allows)
// and paths are decided by the repo glob engine, never by an invented pattern matcher.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { globToRegExp } from "../lib/glob-engine.ts";
import { REPO } from "./lib/build-fixture-tree.ts";
import { yamlLib } from "./lib/yaml-lib.ts";

interface Capability {
  readonly id: string;
  readonly trigger: readonly { readonly on?: string; readonly paths?: readonly string[] }[];
  readonly requires?: {
    readonly runtime?: string | readonly string[];
    readonly tools?: readonly string[];
  };
  readonly cache?: { readonly files?: readonly string[] };
  /** Absent on the engine-specific capabilities (they carry an `exception` instead). */
  readonly command?: readonly string[];
}

const ENTRY = "scripts/build-components.ts";
const SHIM = "scripts/build-components.sh";
const MAIN = "scripts/lib/build-components/main.ts";
const ASSEMBLY = "test-assembly-verification.sh";
const PROD_INSTALL = /^npm ci( --omit=dev --workspaces=false)?$/;
const FLOOR_GUARD = "node scripts/lib/node-floor-guard.js";
const SUITE_COMMAND = /--test /;

// A command "builds" when it runs the component build directly, or runs a script that builds.
// The script names are the ones the reference runs for the capabilities `frontmatter`,
// `model-resolution`, `agent-profile-migration`, `check-agent-profiles` and `component-drift`:
// each shell test assembles components through the build, so it needs Node.js 24 and the
// production dependencies exactly as the direct invocation does. `check-core-paths.sh` builds
// nothing here; `core-paths` is listed separately in NODE_ONLY_CAPABILITIES.
const BUILD_COMMAND = new RegExp(
  [
    "scripts/build-components\\.(ts|sh)",
    "task build-components",
    "task check-components",
    "test-assembly-verification\\.sh",
    "test-model-resolution\\.sh",
    "test-agent-profile-migration\\.sh",
    "test-check-agent-profiles\\.sh",
    "test-component-tier-resolution\\.sh",
    "test-extract-frontmatter\\.sh",
    "test-artifact-build-install-scope\\.sh",
    "test-build-components\\.sh",
    "check-core-paths\\.sh",
  ].join("|"),
);

// `core-paths` runs the core-paths checks, which are Node-only by design (no `js-yaml` at
// run time, so no production install); it still declares the Node.js 24 runtime. `repository-scan`
// (spec 0251) runs `check-core-paths.sh` too, next to two Python scans, so it declares Node.js 24
// as a secondary runtime. Named by id because "needs no install" is a property of that job's
// design, not derivable from its commands.
const NODE_ONLY_CAPABILITIES: ReadonlySet<string> = new Set(["core-paths", "repository-scan"]);

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

/** The commands of one capability; engine-specific ones have none. */
function commandsOf(cap: Capability): readonly string[] {
  return cap.command ?? [];
}

/** Every `paths:` entry of one capability's triggers. */
function pathsOf(cap: Capability): string[] {
  return (cap.trigger ?? []).flatMap((t) => [...(t.paths ?? [])]);
}

/** Capabilities whose `paths:` globs select the single changed `file`. */
function selecting(ref: Reference, file: string): Capability[] {
  return ref.capabilities.filter((cap) =>
    pathsOf(cap).some((glob) => globToRegExp(glob).test(file)),
  );
}

/** (a) A change to `file` selects a capability that runs the assembly verification test. */
function assemblySelectedBy(ref: Reference, file: string): string[] {
  return selecting(ref, file)
    .filter((cap) => commandsOf(cap).some((c) => c.includes(ASSEMBLY)))
    .map((cap) => cap.id);
}

/** (b) Capability ids that name the shim in `paths:`/`cache.files` without naming the entry. */
function shimWithoutEntry(ref: Reference): string[] {
  const bad: string[] = [];
  for (const cap of ref.capabilities) {
    const lists = [pathsOf(cap), [...(cap.cache?.files ?? [])]];
    for (const list of lists) {
      if (list.includes(SHIM) && !list.includes(ENTRY)) bad.push(cap.id);
    }
  }
  return bad;
}

/** Capabilities whose commands run the component build. */
function buildingCapabilities(ref: Reference): Capability[] {
  return ref.capabilities.filter((cap) => commandsOf(cap).some((c) => BUILD_COMMAND.test(c)));
}

/** (c) Per-capability wiring faults of a build-running capability. */
function buildWiringFaults(ref: Reference): string[] {
  const faults: string[] = [];
  for (const cap of buildingCapabilities(ref)) {
    const runtimes = [cap.requires?.runtime ?? []].flat();
    if (!runtimes.includes("node@24")) faults.push(`${cap.id}: runtime is not node@24`);
    if (NODE_ONLY_CAPABILITIES.has(cap.id)) continue;
    const install = commandsOf(cap).findIndex((c) => PROD_INSTALL.test(c));
    const firstBuild = commandsOf(cap).findIndex((c) => BUILD_COMMAND.test(c));
    if (install < 0) faults.push(`${cap.id}: no production install command`);
    else if (install > firstBuild) faults.push(`${cap.id}: install runs after the first build`);
  }
  return faults;
}

/** (d) Faults of `component-drift`: no `yq`, floor guard directly before `--check`. */
function componentDriftFaults(ref: Reference): string[] {
  const cap = ref.capabilities.find((c) => c.id === "component-drift");
  if (cap === undefined) return ["component-drift: capability missing"];
  const faults: string[] = [];
  if ((cap.requires?.tools ?? []).includes("yq")) faults.push("component-drift: still lists yq");
  const guard = commandsOf(cap).indexOf(FLOOR_GUARD);
  const check = commandsOf(cap).indexOf(`node ${ENTRY} --target all --check`);
  if (guard < 0) faults.push("component-drift: no floor guard command");
  if (check < 0) faults.push("component-drift: no `--target all --check` command");
  if (guard >= 0 && check >= 0 && guard > check) faults.push("component-drift: guard after check");
  return faults;
}

/** (e) Faults of the `build-components-ts` suite list. */
function suiteListFaults(ref: Reference): string[] {
  const cap = ref.capabilities.find((c) => c.id === "build-components-ts");
  if (cap === undefined) return ["build-components-ts: capability missing"];
  const runner = commandsOf(cap).find((c) => SUITE_COMMAND.test(c)) ?? "";
  const suites = runner.split(/\s+/).filter((t) => t.endsWith(".test.ts"));
  const faults: string[] = [];
  for (const name of ["shim", "ci-wiring", "references"]) {
    if (!suites.includes(`scripts/tests/build-components-${name}.test.ts`))
      faults.push(`build-components-ts: suite ${name} not listed`);
  }
  for (const suite of suites) {
    if (/build-components-differential/.test(suite))
      faults.push(`build-components-ts: retired suite ${suite} still listed`);
  }
  return faults;
}

const REF = loadReference();

describe("the CI reference wires the TypeScript component build", () => {
  test("a change to the build entry or its main module runs the assembly verification test", () => {
    for (const file of [ENTRY, MAIN]) {
      assert.notDeepEqual(
        assemblySelectedBy(REF, file),
        [],
        `${file} selects no assembly capability`,
      );
    }
  });

  test("every capability naming the shim in its paths also names the entry", () => {
    assert.deepEqual(shimWithoutEntry(REF), []);
  });

  test("every capability that builds declares node@24 and installs production dependencies first", () => {
    assert.ok(buildingCapabilities(REF).length >= 6, "the build-running set was derived");
    assert.deepEqual(buildWiringFaults(REF), []);
  });

  test("component-drift drops yq and runs the floor guard before the TypeScript check", () => {
    assert.deepEqual(componentDriftFaults(REF), []);
  });

  test("the build-components-ts capability lists the new suites and no differential suite", () => {
    assert.deepEqual(suiteListFaults(REF), []);
  });
});

describe("mutation check: each assertion goes red on a broken reference", () => {
  test("dropping the entry from every paths list leaves the entry change unselected", () => {
    const copy = mutableCopy(REF);
    for (const cap of copy.capabilities) {
      for (const t of (cap.trigger as { paths?: string[] }[]) ?? []) {
        if (t.paths !== undefined)
          t.paths = t.paths.filter((p) => p !== ENTRY && p !== "scripts/build-components.*");
      }
    }
    assert.deepEqual(assemblySelectedBy(copy as unknown as Reference, ENTRY), []);
  });

  test("dropping the entry from one capability that names the shim is reported", () => {
    const copy = mutableCopy(REF);
    const cap = copy.capabilities.find((c) => c.id === "component-drift") as {
      trigger: { paths?: string[] }[];
    };
    for (const t of cap.trigger) if (t.paths) t.paths = t.paths.filter((p) => p !== ENTRY);
    assert.deepEqual(shimWithoutEntry(copy as unknown as Reference), ["component-drift"]);
  });

  test("dropping the install command from a building capability is reported", () => {
    const copy = mutableCopy(REF);
    const cap = copy.capabilities.find((c) => c.id === "component-drift") as { command: string[] };
    cap.command = cap.command.filter((c) => !c.startsWith("npm ci"));
    assert.deepEqual(buildWiringFaults(copy as unknown as Reference), [
      "component-drift: no production install command",
    ]);
  });

  test("moving the install after the build is reported", () => {
    const copy = mutableCopy(REF);
    const cap = copy.capabilities.find((c) => c.id === "component-drift") as { command: string[] };
    cap.command = [...cap.command.filter((c) => !c.startsWith("npm ci")), "npm ci"];
    assert.deepEqual(buildWiringFaults(copy as unknown as Reference), [
      "component-drift: install runs after the first build",
    ]);
  });

  test("dropping the runtime from a building capability is reported", () => {
    const copy = mutableCopy(REF);
    const cap = copy.capabilities.find((c) => c.id === "component-drift") as {
      requires: { runtime?: string };
    };
    delete cap.requires.runtime;
    assert.deepEqual(buildWiringFaults(copy as unknown as Reference), [
      "component-drift: runtime is not node@24",
    ]);
  });

  test("restoring yq or dropping the floor guard on component-drift is reported", () => {
    const copy = mutableCopy(REF);
    const cap = copy.capabilities.find((c) => c.id === "component-drift") as {
      requires: { tools?: string[] };
      command: string[];
    };
    cap.requires.tools = ["yq"];
    cap.command = cap.command.filter((c) => c !== FLOOR_GUARD);
    assert.deepEqual(componentDriftFaults(copy as unknown as Reference), [
      "component-drift: still lists yq",
      "component-drift: no floor guard command",
    ]);
  });

  test("a missing new suite or a retained differential suite is reported", () => {
    const copy = mutableCopy(REF);
    const cap = copy.capabilities.find((c) => c.id === "build-components-ts") as {
      command: string[];
    };
    cap.command = cap.command.map((c) =>
      SUITE_COMMAND.test(c)
        ? c.replace(" scripts/tests/build-components-references.test.ts", "") +
          " scripts/tests/build-components-differential.test.ts"
        : c,
    );
    assert.deepEqual(suiteListFaults(copy as unknown as Reference), [
      "build-components-ts: suite references not listed",
      "build-components-ts: retired suite scripts/tests/build-components-differential.test.ts still listed",
    ]);
  });
});
