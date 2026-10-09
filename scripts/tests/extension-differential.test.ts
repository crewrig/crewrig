// extension-differential.test.ts — the unchanged shell scripts against the TypeScript entries (spec 0254 R22).
//
// Linux and macOS only: it spawns `bash`, `jq` and `yq` on purpose, and retires in PR D, which replaces
// the shell scripts by shims. Each scenario builds two identical fixture roots, runs the shell in one and
// the TypeScript entry in the other, and compares exit status, standard output, standard error
// (the root's name normalised) and every file the run left outside `scripts/`, byte for byte. An expected
// difference is declared on its scenario with the letter of requirement 28 it falls under, so an unlisted
// difference fails the suite.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import {
  contextFailTree,
  fullTree,
  invalidTree,
  legacyTree,
  minimalTree,
  mcpOnlyTree,
  realHelloWorld,
  strayTree,
  versionDriftTree,
  writeTree,
} from "./lib/extension-trees.ts";
import type { FileMap } from "./lib/extension-trees.ts";
import {
  collectFiles,
  diffFiles,
  extensionRoot,
  normalise,
  runShell,
  runTs,
  withSkeleton,
} from "./lib/extension-run.ts";
import type { FixtureTree } from "./lib/extension-run.ts";

const missing = ["bash", "jq", "yq"].filter((tool) => spawnSync(tool, ["--version"]).status !== 0);
const skip =
  process.platform === "win32"
    ? "the shell oracle needs a POSIX shell"
    : missing.length > 0
      ? `${missing.join(", ")} not available on this machine`
      : false;

/** `deviation: R28(<letter>)`: a rewrite applied to BOTH sides before comparing, so only the listed difference vanishes. */
interface Deviation {
  readonly letter: string;
  readonly pattern: RegExp;
  readonly replacement: string;
}
// R28(b): `--target` without a value; R28(i): a usage line has no script path and line prefix.
const BASH_PREFIX: Deviation = {
  letter: "i",
  pattern: /^.*\.sh: line \d+: \d+: /gm,
  replacement: "",
};
const TARGET_LAST: Deviation = {
  letter: "b",
  pattern: /^(?:.*\.sh: line \d+: 2: )?(?:Error: )?--target requires a value$/gm,
  replacement: "--target requires a value",
};

interface Scenario {
  readonly label: string;
  readonly script: string;
  readonly args: readonly string[];
  readonly subjects: Readonly<Record<string, FileMap>>;
  readonly setup?: (tree: FixtureTree) => void;
  readonly deviations?: readonly Deviation[];
}

const ALL = {
  "hello-world": realHelloWorld(),
  full: fullTree(),
  minimal: minimalTree(),
  mcponly: mcpOnlyTree(),
};
const FULL = { full: fullTree() };
const noAccepted = (): FileMap => {
  const { ["accepted-gaps.json"]: _drop, ...rest } = fullTree();
  return rest;
};

const scenarios: Scenario[] = [
  ...Object.entries(ALL).map(([name, files]): Scenario => ({
    label: `build all targets: ${name}`,
    script: "build-extension",
    args: ["--target", "all", name],
    subjects: { [name]: files },
  })),
  ...(["gemini", "claude", "copilot", "antigravity"] as const).map((target): Scenario => ({
    label: `build one target: ${target}`,
    script: "build-extension",
    args: ["--target", target, "full"],
    subjects: FULL,
  })),
  {
    label: "build every extension, no argument",
    script: "build-extension",
    args: [],
    subjects: ALL,
  },
  {
    label: "build, a path argument",
    script: "build-extension",
    args: ["--target", "gemini", "extensions/core/minimal"],
    subjects: { minimal: minimalTree() },
  },
  { label: "check every extension", script: "build-extension", args: ["--check"], subjects: ALL },
  {
    label: "check: committed output and name axis",
    script: "build-extension",
    args: ["--check"],
    subjects: { stray: strayTree() },
  },
  {
    label: "check: version drift",
    script: "build-extension",
    args: ["--check"],
    subjects: { drift: versionDriftTree() },
  },
  {
    label: "check: gaps not accepted",
    script: "build-extension",
    args: ["--check"],
    subjects: { full: noAccepted() },
  },
  {
    label: "check: render failure",
    script: "build-extension",
    args: ["--check"],
    subjects: { ctxfail: contextFailTree() },
  },
  {
    label: "check: invalid manifest",
    script: "build-extension",
    args: ["--check"],
    subjects: { invalid: invalidTree() },
  },
  {
    label: "build: context failure",
    script: "build-extension",
    args: ["--target", "all", "ctxfail"],
    subjects: { ctxfail: contextFailTree() },
  },
  {
    label: "build: invalid manifest stops the run",
    script: "build-extension",
    args: ["--target", "all"],
    subjects: { aaa: invalidTree(), bbb: minimalTree() },
  },
  { label: "build: unknown extension", script: "build-extension", args: ["nope"], subjects: {} },
  {
    label: "build: unknown flag is an extension",
    script: "build-extension",
    args: ["--nope"],
    subjects: {},
  },
  {
    label: "build: bad target",
    script: "build-extension",
    args: ["--target", "nope"],
    subjects: {},
  },
  {
    label: "build: target last",
    script: "build-extension",
    args: ["--target"],
    subjects: {},
    deviations: [TARGET_LAST, BASH_PREFIX],
  },
  {
    label: "build: a name in two tiers",
    script: "build-extension",
    args: ["minimal"],
    subjects: { minimal: minimalTree() },
    setup: (tree) =>
      writeTree(path.join(tree.root, "extensions", "library", "minimal"), minimalTree()),
  },
  ...(["claude-plugin", "copilot-plugin", "antigravity-extension"] as const).flatMap(
    (script): Scenario[] => [
      {
        label: `${script}: default output`,
        script: `build-${script}`,
        args: ["full"],
        subjects: FULL,
      },
      {
        label: `${script}: explicit output`,
        script: `build-${script}`,
        args: ["full", "out/plugin"],
        subjects: FULL,
      },
      {
        label: `${script}: context failure`,
        script: `build-${script}`,
        args: ["ctxfail"],
        subjects: { ctxfail: contextFailTree() },
      },
      {
        label: `${script}: unknown extension`,
        script: `build-${script}`,
        args: ["nope"],
        subjects: {},
      },
      {
        label: `${script}: no manifest`,
        script: `build-${script}`,
        args: ["extensions/core/empty"],
        subjects: { empty: { "README.md": "x\n" } },
      },
      {
        label: `${script}: legacy shape`,
        script: `build-${script}`,
        args: ["legacy"],
        subjects: { legacy: legacyTree() },
      },
      {
        label: `${script}: no argument`,
        script: `build-${script}`,
        args: [],
        subjects: {},
        deviations: [BASH_PREFIX],
      },
    ],
  ),
  {
    label: "migrate: legacy tree",
    script: "migrate-extension",
    args: ["legacy"],
    subjects: { legacy: legacyTree() },
  },
  { label: "migrate: current tree", script: "migrate-extension", args: ["full"], subjects: FULL },
  {
    label: "migrate: unknown extension",
    script: "migrate-extension",
    args: ["nope"],
    subjects: {},
  },
  {
    label: "migrate: no argument",
    script: "migrate-extension",
    args: [],
    subjects: {},
    deviations: [BASH_PREFIX],
  },
];

function apply(text: string, deviations: readonly Deviation[] | undefined): string {
  let out = text;
  for (const d of deviations ?? []) out = out.replace(d.pattern, d.replacement);
  return out;
}

/** Every file the run left, minus the copied scripts and the staged dependencies. */
function leftovers(tree: FixtureTree): Map<string, Buffer> {
  const all = collectFiles(tree.root);
  for (const rel of [...all.keys()]) {
    if (/^(scripts|node_modules|\.git)\//.test(rel) || rel === "package.json") all.delete(rel);
  }
  return all;
}

function once(
  s: Scenario,
  runner: typeof runShell,
): { out: string; err: string; status: number | null; files: Map<string, Buffer> } {
  const tree = extensionRoot(s.subjects);
  withSkeleton(tree);
  s.setup?.(tree);
  const res = runner(tree, s.script, s.args);
  const files = leftovers(tree);
  const result = {
    out: normalise(res.stdout, tree),
    err: normalise(res.stderr, tree),
    status: res.status,
    files,
  };
  tree.dispose();
  return result;
}

describe("the TypeScript entries behave as the shell scripts", { skip }, () => {
  for (const s of scenarios) {
    test(s.label, () => {
      const shell = once(s, runShell);
      const ts = once(s, runTs);
      assert.equal(ts.status, shell.status, "exit status");
      assert.equal(apply(ts.out, s.deviations), apply(shell.out, s.deviations), "standard output");
      assert.equal(apply(ts.err, s.deviations), apply(shell.err, s.deviations), "standard error");
      assert.deepEqual(diffFiles(shell.files, ts.files), [], "files left behind");
    });
  }
});

test("the scenario labels are unique", () => {
  assert.equal(new Set(scenarios.map((s) => s.label)).size, scenarios.length);
  assert.ok(fs.existsSync(path.join(import.meta.dirname, "lib", "extension-trees.ts")));
});
