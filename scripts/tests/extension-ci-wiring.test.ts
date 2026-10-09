// extension-ci-wiring.test.ts — the CI reference (ci/ci-capabilities.yml) wires the extension and
// plugin builders correctly after the switch (spec 0254 R27): every capability that runs one of
// the five shell scripts, directly or through a script or Bash suite it names, needs Node.js 24
// and the production dependencies before its first such call, and every `paths:` list that names
// a shell script also names its TypeScript entry. The assertions are functions over the parsed
// reference so the mutation tests can run the same functions on an in-memory mutated copy.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { REPO } from "./lib/build-fixture-tree.ts";
import { yamlLib } from "./lib/yaml-lib.ts";

interface Capability {
  readonly id: string;
  readonly trigger?: readonly { readonly paths?: readonly string[] }[];
  readonly requires?: { readonly runtime?: string };
  readonly command?: readonly string[];
}
interface Reference {
  readonly capabilities: Capability[];
}

const SCRIPTS = [
  "build-extension",
  "build-claude-plugin",
  "build-copilot-plugin",
  "build-antigravity-extension",
  "migrate-extension",
];

// Traced by hand (spec 0254 R27): each runs a script or a Bash suite that reaches one of the five
// scripts. `extension-manifest`, `extension-provenance`'s sibling checks, `release-notes` and the
// version-bump check only mention the scripts in comments or run the engine in dry run, so they
// are deliberately absent. `extension-render` also runs the five directly.
const TRACED: readonly string[] = [
  "extension-builders-ts",
  "extension-render",
  "extension-install",
  "extension-provenance",
  "release",
  "release-rehearsal",
  "release-tests",
];

// `npm install --include=dev` installs a superset of the production closure (the release jobs
// need the dev dependencies of the release engine as well).
const PROD_INSTALL = /^npm (ci --omit=dev --workspaces=false|install --include=dev)$/;
const DIRECT = new RegExp(`scripts/(${SCRIPTS.join("|")})\\.(sh|ts)`);
const REACHING = new RegExp(
  [
    DIRECT.source,
    "test-build-extension\\.sh",
    "test-migrate-extension\\.sh",
    "test-create-extension",
    "test-release-package",
    "test-install-claude-plugin-marketplace\\.sh",
    "test-build-claude-plugin-agents-glob\\.sh",
    "test-install-extension-all\\.sh",
    "test-check-extension-provenance\\.sh",
    "test-monorepo-release",
    "monorepo-release\\.sh",
    "check-extension-pivot\\.sh",
  ].join("|"),
);

function loadReference(): Reference {
  const text = fs.readFileSync(path.join(REPO, "ci", "ci-capabilities.yml"), "utf8");
  const doc: unknown = yamlLib.load(text);
  const caps = (doc as { capabilities?: unknown } | null)?.capabilities;
  assert.ok(Array.isArray(caps), "ci/ci-capabilities.yml has a capabilities list");
  return { capabilities: caps as Capability[] };
}

const commandsOf = (cap: Capability): readonly string[] => cap.command ?? [];
const pathLists = (cap: Capability): string[][] =>
  (cap.trigger ?? []).map((t) => [...(t.paths ?? [])]);

/** Wiring faults of the traced capabilities: missing runtime, missing or late production install. */
function wiringFaults(ref: Reference): string[] {
  const faults: string[] = [];
  for (const id of TRACED) {
    const cap = ref.capabilities.find((c) => c.id === id);
    if (cap === undefined) {
      faults.push(`${id}: capability missing`);
      continue;
    }
    if (cap.requires?.runtime !== "node@24") faults.push(`${id}: runtime is not node@24`);
    const cmds = commandsOf(cap);
    const install = cmds.findIndex((c) => PROD_INSTALL.test(c));
    const first = cmds.findIndex((c) => REACHING.test(c));
    if (first < 0) faults.push(`${id}: no command reaches a builder`);
    else if (install < 0) faults.push(`${id}: no production install`);
    else if (install > first) faults.push(`${id}: install runs after the first builder call`);
  }
  return faults;
}

/** Capabilities that run a builder directly but are not traced (a new one must be added by hand). */
function untraced(ref: Reference): string[] {
  return ref.capabilities
    .filter((c) => commandsOf(c).some((x) => DIRECT.test(x)) && !TRACED.includes(c.id))
    .map((c) => c.id);
}

/** Ids whose `paths:` list names a shell script of the five without its `.ts`. */
function shellWithoutTs(ref: Reference): string[] {
  const bad: string[] = [];
  for (const cap of ref.capabilities) {
    for (const list of pathLists(cap)) {
      for (const n of SCRIPTS) {
        if (list.includes(`scripts/${n}.sh`) && !list.includes(`scripts/${n}.ts`))
          bad.push(`${cap.id}: scripts/${n}.sh`);
      }
    }
  }
  return bad;
}

describe("the extension builders in the CI reference", () => {
  const ref = loadReference();

  test("every traced capability has Node.js 24 and the install before its first builder call", () => {
    assert.deepEqual(wiringFaults(ref), []);
  });

  test("no capability runs a builder directly without being traced", () => {
    assert.deepEqual(untraced(ref), []);
  });

  test("a paths list that names a shell script also names its TypeScript entry", () => {
    assert.deepEqual(shellWithoutTs(ref), []);
  });

  test("scripts/lib/render-context.sh is named nowhere", () => {
    const text = fs.readFileSync(path.join(REPO, "ci", "ci-capabilities.yml"), "utf8");
    assert.ok(!text.includes("render-context.sh"));
  });
});

describe("the assertions can go red", () => {
  const mutated = (edit: (cap: Record<string, unknown>) => void, id: string): Reference => {
    const copy = structuredClone(loadReference()) as unknown as { capabilities: Capability[] };
    const cap = copy.capabilities.find((c) => c.id === id);
    assert.ok(cap !== undefined);
    edit(cap as unknown as Record<string, unknown>);
    return copy;
  };

  test("a lowered runtime is reported", () => {
    const ref = mutated((c) => (c["requires"] = { runtime: "node@22" }), "extension-render");
    assert.match(wiringFaults(ref).join("\n"), /extension-render: runtime is not node@24/);
  });

  test("a removed install is reported", () => {
    const ref = mutated(
      (c) => (c["command"] = (c["command"] as string[]).filter((x) => !x.startsWith("npm"))),
      "extension-install",
    );
    assert.match(wiringFaults(ref).join("\n"), /extension-install: no production install/);
  });

  test("a shell path without its entry is reported", () => {
    const ref = mutated((c) => {
      const t = (c["trigger"] as { paths?: string[] }[])[0];
      if (t?.paths !== undefined)
        t.paths = t.paths.filter((p) => p !== "scripts/build-extension.ts");
    }, "extension-render");
    assert.match(shellWithoutTs(ref).join("\n"), /extension-render: scripts\/build-extension\.sh/);
  });
});
