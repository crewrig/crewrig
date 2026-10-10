// setup-shim.test.ts — the four forwarding shims of the setup entry points (spec 0256 R33): the
// shell scripts that remain so callers of `bash scripts/setup-<cli>-interactive.sh` reach the
// TypeScript entries. POSIX-only (the shims are Bash; the suite skips where no `bash` exists).
// Model: install-shim.test.ts.
//
// `node` absent: one `Error:` line naming node and 24, exit 1. A `node` reporting v20: the floor
// guard's diagnostic, the entry not run. In both cases nothing is written: a throwaway HOME and
// the sandbox repository are listed before and after. A healthy node: the arguments, the exit
// status and standard input reach the entry (`--answer bogus` is refused by the entry with its
// one-line usage error and exit 2; a piped `n` answers the one-key `--link` question, which the
// entry turns into exit 1; Copilot has no such question, so its piped `n` is refused as the first
// question's answer, exit 2). The shell allowlist keeps the four, and each shim stays executable.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { REPO } from "./lib/build-fixture-tree.ts";
import { listTree } from "./lib/install-sandbox.ts";
import { pathWithFakeNode, pathWithoutNode } from "./lib/shim-env.ts";
import { createSetupSandbox } from "./lib/setup-sandbox.ts";
import type { SetupSandbox } from "./lib/setup-sandbox.ts";
import { which } from "./lib/worktree-fixtures.ts";

const BASH = which("bash");
const SKIP =
  process.platform === "win32"
    ? "SKIP: POSIX-only suite (the shims are Bash)"
    : BASH === null
      ? "SKIP: bash is not installed"
      : false;

const NAMES = [
  "setup-claude-interactive",
  "setup-gemini-interactive",
  "setup-copilot-interactive",
  "setup-antigravity-interactive",
];

interface Outcome {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Run the sandbox repository's copy of the shim `name` under `env` (PATH included). */
function run(
  box: SetupSandbox,
  name: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  input = "",
): Outcome {
  const res = spawnSync(BASH ?? "bash", [`scripts/${name}.sh`, ...args], {
    env: { ...env, HOME: box.home, USERPROFILE: box.home, LC_ALL: "C" },
    cwd: box.repo,
    encoding: "utf8",
    input,
    timeout: 60_000,
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

/** Everything a shim could write: the sandbox repository and the home, as sorted listings. */
function snapshot(box: SetupSandbox): { repo: string[]; home: string[] } {
  return { repo: listTree(box.repo), home: listTree(box.home) };
}

/** A sandbox whose PATH also holds an `agy` stub, which the Antigravity setup requires. */
function sandboxFor(name: string): SetupSandbox {
  const box = createSetupSandbox();
  if (name.includes("antigravity")) box.stub("agy", "exit 0");
  return box;
}

for (const name of NAMES) {
  describe(`${name}.sh`, { skip: SKIP }, () => {
    test("no node: one Error: line naming node and 24, exit 1, nothing written", () => {
      const box = sandboxFor(name);
      const before = snapshot(box);
      const res = run(box, name, [], pathWithoutNode());
      assert.equal(res.status, 1);
      assert.equal(res.stdout, "");
      assert.equal(res.stderr.split("\n").filter((l) => l !== "").length, 1, res.stderr);
      assert.match(res.stderr, /^Error: .*\bnode\b.*\b24\b/);
      assert.deepEqual(snapshot(box), before);
    });

    test("node v20: the floor guard's diagnostic, the entry does not run, nothing written", () => {
      const box = sandboxFor(name);
      const before = snapshot(box);
      const res = run(box, name, ["--link"], pathWithFakeNode("v20.11.1"), "y\n");
      assert.notEqual(res.status, 0);
      assert.equal(res.stdout, "");
      assert.match(res.stderr, /requires Node\.js >= 24/);
      assert.match(res.stderr, /v20\.11\.1/);
      assert.deepEqual(snapshot(box), before);
    });

    test("arguments reach the entry: --answer bogus is its one-line usage error, exit 2", () => {
      const box = sandboxFor(name);
      const before = snapshot(box);
      const res = run(box, name, ["--answer", "bogus"], box.env);
      assert.equal(res.status, 2, res.stderr);
      assert.equal(res.stdout, "");
      assert.equal(res.stderr.split("\n").filter((l) => l !== "").length, 1, res.stderr);
      assert.match(res.stderr, /^Error: /);
      assert.deepEqual(snapshot(box), before);
    });

    test("standard input reaches the entry and the status comes back", () => {
      const box = sandboxFor(name);
      const before = snapshot(box);
      const res = run(box, name, ["--link"], box.env, "n\n");
      if (name.includes("copilot")) {
        // No one-key link question on Copilot: the piped `n` is the first question's answer, asked
        // after the rules were already linked (the entry's own writes, in the sandbox home).
        assert.equal(res.status, 2, res.stderr);
        assert.match(res.stderr, /invalid answer for 'validation\.backend'/);
      } else {
        // The one-key `--link` question, answered `n`: the entry aborts with exit 1.
        assert.equal(res.status, 1, res.stderr);
        assert.match(res.stdout, /symlink mode/i);
      }
      if (!name.includes("copilot")) assert.deepEqual(snapshot(box), before);
    });

    test("the shim is executable and keeps its place on the shell allowlist", () => {
      const file = path.join(REPO, "scripts", `${name}.sh`);
      assert.ok((fs.statSync(file).mode & 0o111) !== 0, `${file} is not executable`);
      const lines = fs
        .readFileSync(path.join(REPO, "ci", "shell-allowlist.txt"), "utf8")
        .split("\n");
      assert.equal(lines.filter((l) => l === `scripts/${name}.sh`).length, 1);
    });
  });
}
