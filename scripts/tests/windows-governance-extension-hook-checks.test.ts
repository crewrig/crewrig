// windows-governance-extension-hook-checks.test.ts — the cross-system proof of the
// extension-hook-checks group (spec 0259 R26-R28): check-extension-manifest-version,
// check-extension-hook-map and check-extension-hook-tokens run from PowerShell on Windows (the default
// shell elsewhere), against a clean tree and against a fixture that makes each of them fail.
// Interpreters are resolved from the PARENT PATH before the child PATH is narrowed.
// check-extension-hook-tokens writes build/** and dist-*: it only ever runs in a temp tree holding a
// copy of scripts/ and one fixture extension, never in the real checkout. manifest-version and hook-map
// only read, so their clean leg runs against the real repository.
// The `windows-governance-checks` job runs every `windows-governance-*.test.ts` file.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { defaultIsFile, resolveOnPath } from "../lib/worktree-claim/launch-windows.ts";
import {
  expectStatus,
  resolveInterpreters,
  spawnEntry,
  WIN,
  why,
} from "./lib/windows-proof-support.ts";
import type { Run } from "./lib/windows-proof-support.ts";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * `git` must stay reachable once spawnEntry narrows the child PATH to node, System32 and the stubs:
 * on Windows its directory (found on the PARENT PATH) is prepended to the stub directory.
 */
function withGitDir(bin: string): string {
  if (!WIN) return bin;
  const git = resolveOnPath("git", {
    platform: process.platform,
    env: process.env,
    isFile: defaultIsFile,
  });
  return git === undefined ? bin : [path.win32.dirname(git), bin].join(path.delimiter);
}

function withBox<T>(body: (home: string, bin: string) => T): T {
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "windows-governance-eh-")),
  );
  try {
    const bin = path.join(root, "bin");
    fs.mkdirSync(bin);
    return body(root, bin);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/** Run `<tree>/scripts/<entry>.ts` with `tree` as the working directory for the synchronous spawn. */
function run(entry: string, tree: string, home: string, bin: string): Run {
  // Resolved from the parent environment, before spawnEntry narrows the child PATH.
  const interpreters = resolveInterpreters({
    platform: process.platform,
    env: process.env,
    isFile: defaultIsFile,
  });
  console.log(
    `windows-governance-extension-hook-checks: ${entry}: ${interpreters.notes.join("; ")}`,
  );
  const before = process.cwd();
  process.chdir(tree);
  try {
    return spawnEntry({
      entry,
      script: path.join(tree, "scripts", `${entry}.ts`),
      args: [],
      shell: "pwsh",
      env: {
        GIT_CONFIG_NOSYSTEM: "1",
        NODE_OPTIONS: "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
      },
      home,
      bin: withGitDir(bin),
      interpreters,
    });
  } finally {
    process.chdir(before);
  }
}

const out = (r: Run): string => r.out.replaceAll("\r\n", "\n");
const err = (r: Run): string => r.err.replaceAll("\r\n", "\n");

/** Collect every failed assertion of a group and report them together. */
function aggregate(r: Run, checks: ReadonlyArray<[string, () => void]>): void {
  const failures: string[] = [];
  for (const [what, check] of checks) {
    try {
      check();
    } catch (e) {
      failures.push(`${what}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  assert.equal(failures.length, 0, `${why(r, "assertions")}\n${failures.join("\n")}`);
}

function write(root: string, rel: string, content: string): void {
  const file = path.join(root, ...rel.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

/** A temp tree holding a copy of scripts/ (the checks locate their libraries from their own path). */
function scriptsTree(root: string, name: string): string {
  const tree = path.join(root, name);
  fs.cpSync(path.join(repo, "scripts"), path.join(tree, "scripts"), { recursive: true });
  return tree;
}

/** scripts/ plus the render inputs: `.git`, package.json and the js-yaml closure, as the Bash suite stages. */
function renderTree(root: string): string {
  const tree = scriptsTree(root, "tokens");
  fs.mkdirSync(path.join(tree, ".git"));
  fs.copyFileSync(path.join(repo, "package.json"), path.join(tree, "package.json"));
  for (const pkg of ["js-yaml", "argparse"]) {
    fs.cpSync(path.join(repo, "node_modules", pkg), path.join(tree, "node_modules", pkg), {
      recursive: true,
      dereference: true,
    });
  }
  return tree;
}

const fixture = (command: string): string =>
  JSON.stringify({
    name: "tokenfix",
    version: "0.0.1",
    description: "fixture",
    provenance: { canonical: "https://example.test/upstream" },
    hooks: [{ id: "probe", event: "PreToolUse", command }],
  });

function manifestTree(root: string, extVersion: string): string {
  const tree = path.join(root, "versions");
  write(tree, "extensions/core/demo/package.json", '{"name":"demo","version":"0.1.0"}\n');
  write(tree, "extensions/core/demo/extension.json", `{"name":"demo","version":"${extVersion}"}\n`);
  return tree;
}

describe("windows governance extension-hook-checks: clean trees", () => {
  it("check-extension-manifest-version accepts the real repository (read-only)", () => {
    withBox((home, bin) => {
      const r = run("check-extension-manifest-version", repo, home, bin);
      aggregate(r, [
        ["exit status", () => expectStatus(r, 0)],
        ["no failure line", () => assert.ok(!/^ {2}FAIL /m.test(out(r)), out(r))],
        ["no diagnostic", () => assert.equal(err(r), "")],
      ]);
    });
  });

  it("check-extension-hook-map accepts the real repository (read-only)", () => {
    withBox((home, bin) => {
      const r = run("check-extension-hook-map", repo, home, bin);
      aggregate(r, [
        ["exit status", () => expectStatus(r, 0)],
        ["verdict line", () => assert.match(out(r), /^OK: /m)],
        ["no diagnostic", () => assert.equal(err(r), "")],
      ]);
    });
  });

  // The real checkout is never used: the check writes build/** and dist-*. Only the OK verdict is
  // asserted on a minimal tree with one correctly substituted fixture extension.
  it("check-extension-hook-tokens accepts a correctly substituted fixture (temp tree)", () => {
    withBox((home, bin) => {
      const tree = renderTree(home);
      write(tree, "extensions/core/tokenfix/extension.json", fixture("bash ${extensionRoot}/h.sh"));
      write(
        tree,
        "extensions/core/tokenfix/package.json",
        '{"name":"tokenfix","version":"0.0.1"}\n',
      );
      const r = run("check-extension-hook-tokens", tree, home, bin);
      aggregate(r, [
        ["exit status", () => expectStatus(r, 0)],
        [
          "verdict line",
          () => assert.match(out(r), /^OK: no emitted hook file carries an unresolved neutral/m),
        ],
      ]);
    });
  });
});

describe("windows governance extension-hook-checks: failing fixtures", () => {
  it("check-extension-manifest-version rejects a package.json/extension.json mismatch", () => {
    withBox((home, bin) => {
      const tree = manifestTree(home, "0.2.0");
      fs.cpSync(path.join(repo, "scripts"), path.join(tree, "scripts"), { recursive: true });
      const r = run("check-extension-manifest-version", tree, home, bin);
      aggregate(r, [
        ["exit status", () => expectStatus(r, 1)],
        [
          "FAIL line names the offender",
          () => assert.match(out(r), /^ {2}FAIL extensions\/core\/demo\/extension\.json — /m),
        ],
        ["summary", () => assert.match(out(r), /^FAILED: /m)],
      ]);
    });
  });

  it("check-extension-hook-map rejects an altered table row", () => {
    withBox((home, bin) => {
      const tree = scriptsTree(home, "map");
      const doc = path.join(tree, "docs", "extension-hook-events.md");
      fs.mkdirSync(path.dirname(doc));
      const original = fs.readFileSync(path.join(repo, "docs", "extension-hook-events.md"), "utf8");
      const row = "| `PreToolUse` | `PreToolUse` |";
      assert.ok(original.includes(row), "the real doc carries the PreToolUse row");
      fs.writeFileSync(doc, original.replace(row, "| `PreToolUse` | `WrongEvent` |"));
      const r = run("check-extension-hook-map", tree, home, bin);
      aggregate(r, [
        ["exit status", () => expectStatus(r, 1)],
        ["names the event", () => assert.match(out(r), /PreToolUse/)],
        ["summary", () => assert.match(out(r), /^FAILED: \d+ disagreement\(s\)/m)],
      ]);
    });
  });

  it("check-extension-hook-tokens rejects a translator that leaves the neutral token", () => {
    withBox((home, bin) => {
      const tree = renderTree(home);
      write(tree, "extensions/core/tokenfix/extension.json", fixture("bash ${extensionRoot}/h.sh"));
      write(
        tree,
        "extensions/core/tokenfix/package.json",
        '{"name":"tokenfix","version":"0.0.1"}\n',
      );
      const file = path.join(tree, "scripts", "lib", "extension", "hooks-resolve.ts");
      const text = fs.readFileSync(file, "utf8");
      fs.writeFileSync(file, text.split("${extensionRoot}").join("${extensionRootX}"));
      const r = run("check-extension-hook-tokens", tree, home, bin);
      aggregate(r, [
        ["exit status", () => expectStatus(r, 1)],
        [
          "FAIL line",
          () =>
            assert.match(out(r), /FAIL .*hooks\.json — surviving neutral token occurrence 1\/1/),
        ],
        ["summary", () => assert.match(out(r), /^FAILED: \d+ emitted hook file\(s\)/m)],
      ]);
    });
  });
});
