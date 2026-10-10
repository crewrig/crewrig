// install-shim.test.ts — the thirteen forwarding shims of the install, manage and link entry
// points (spec 0255 R25, R29, R32): the shell scripts that remain so callers of
// `bash scripts/<name>.sh` reach the TypeScript entries. POSIX-only (the shims are Bash; the
// suite skips where no `bash` exists). Model: extension-shim.test.ts.
//
// `node` absent: one `Error:` line naming node and 24, exit 1. A `node` reporting v20: the floor
// guard's diagnostic, the entry not run. In both cases nothing is written: a throwaway HOME and a
// repository copy (the install sandbox's tree) are listed before and after. A healthy node: the
// arguments, the exit status and standard input reach the entry; the link-mode prompt of
// manage-claude-component.sh answered `n` through standard input exits 1 and leaves the
// destination as it was. The shell allowlist keeps the thirteen.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { REPO } from "./lib/build-fixture-tree.ts";
import { createInstallSandbox, listTree } from "./lib/install-sandbox.ts";
import type { InstallSandbox } from "./lib/install-sandbox.ts";
import { pathWithFakeNode, pathWithoutNode } from "./lib/shim-env.ts";
import { cleanEnv, makePathDir, which } from "./lib/worktree-fixtures.ts";

const BASH = which("bash");
const SKIP =
  process.platform === "win32"
    ? "SKIP: POSIX-only suite (the shims are Bash)"
    : BASH === null
      ? "SKIP: bash is not installed"
      : false;

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

interface Outcome {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** `env` with HOME and USERPROFILE pointing at the sandbox's throwaway home. */
function withHome(box: InstallSandbox, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...env, HOME: box.home, USERPROFILE: box.home, LC_ALL: "C" };
}

/** Run the sandbox tree's copy of the shim `name` under `env`; `input` is the standard input. */
function run(
  box: InstallSandbox,
  name: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  input = "",
): Outcome {
  const shim = box.tree.resolve(`scripts/${name}.sh`);
  const res = spawnSync(BASH ?? "bash", [shim, ...args], {
    env: withHome(box, env),
    cwd: box.tree.root,
    encoding: "utf8",
    input,
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

/** Everything a shim could write: the repository copy and the home, as sorted listings. */
function snapshot(box: InstallSandbox): { tree: string[]; home: string[] } {
  return { tree: listTree(box.tree.root), home: listTree(box.home) };
}

/** A PATH whose `node` records its argv and stdin, runs the real floor guard, exits STUB_EXIT. */
function recordingNode(): NodeJS.ProcessEnv {
  const links: Record<string, string> = {};
  for (const n of ["dirname", "cat", "env"]) links[n] = which(n) ?? n;
  const bin = makePathDir({
    links,
    scripts: {
      node: [
        `case "$1" in *node-floor-guard.js) exec "${process.execPath}" "$@";; esac`,
        `printf 'argv:%s\\n' "$@"`,
        `printf 'stdin:%s\\n' "$(cat)"`,
        `exit "\${STUB_EXIT:-0}"`,
      ].join("\n"),
    },
  });
  return cleanEnv({ PATH: bin });
}

for (const name of NAMES) {
  describe(`${name}.sh`, { skip: SKIP }, () => {
    test("no node: one Error: line naming node and 24, exit 1, nothing written", () => {
      const box = createInstallSandbox({ deps: "none" });
      const before = snapshot(box);
      const res = run(box, name, ["install"], pathWithoutNode());
      assert.equal(res.status, 1);
      assert.equal(res.stdout, "");
      assert.equal(res.stderr.split("\n").filter((l) => l !== "").length, 1, res.stderr);
      assert.match(res.stderr, /^Error: .*\bnode\b.*\b24\b/);
      assert.deepEqual(snapshot(box), before);
    });

    test("node v20: the floor guard's diagnostic, the entry does not run, nothing written", () => {
      const box = createInstallSandbox({ deps: "none" });
      const before = snapshot(box);
      const res = run(box, name, ["install"], pathWithFakeNode("v20.11.1"));
      assert.notEqual(res.status, 0);
      assert.equal(res.stdout, "");
      assert.match(res.stderr, /requires Node\.js >= 24/);
      assert.match(res.stderr, /v20\.11\.1/);
      assert.deepEqual(snapshot(box), before);
    });

    test("arguments reach the entry in order, standard input is untouched, the status comes back", () => {
      const box = createInstallSandbox({ deps: "none" });
      const args = ["--target", "claude", "with space", "", "$HOME"];
      const env = { ...recordingNode(), STUB_EXIT: "7" };
      const res = run(box, name, args, env, "payload\n");
      assert.equal(res.status, 7);
      const lines = res.stdout.split("\n");
      assert.match(lines[0] ?? "", new RegExp(`^argv:.*scripts/${name}\\.ts$`));
      assert.deepEqual(
        lines.slice(1, 1 + args.length),
        args.map((a) => `argv:${a}`),
      );
      assert.equal(lines[1 + args.length], "stdin:payload");
    });
  });
}

describe("a link-mode prompt answered through the shim's standard input", { skip: SKIP }, () => {
  test("manage-claude-component.sh link answered n exits 1 and leaves the destination as it was", () => {
    const box = createInstallSandbox({ deps: "none" });
    box.tree.artifact("library/policies/demo.md", "demo\n");
    // The sandbox's one-directory PATH already holds the real node next to the coreutils.
    const env = box.hermetic.env;
    const dest = path.join(box.home, ".claude/rules/demo.md");

    const installed = run(box, "manage-claude-component", ["install", "policies", "demo"], env);
    assert.equal(installed.status, 0, installed.stderr);
    assert.equal(fs.readFileSync(dest, "utf8"), "demo\n");
    const before = listTree(box.home);

    const declined = run(box, "manage-claude-component", ["link", "policies", "demo"], env, "n\n");
    assert.equal(declined.status, 1);
    assert.match(declined.stdout, /^WARNING: Symlink mode/);
    assert.equal(fs.lstatSync(dest).isSymbolicLink(), false);
    assert.equal(fs.readFileSync(dest, "utf8"), "demo\n");
    assert.deepEqual(listTree(box.home), before);

    const linked = run(box, "manage-claude-component", ["link", "policies", "demo"], env, "y\n");
    assert.equal(linked.status, 0, linked.stderr);
    assert.ok(fs.lstatSync(dest).isSymbolicLink());
  });
});

describe("the shell allowlist", () => {
  const lines = fs.readFileSync(path.join(REPO, "ci", "shell-allowlist.txt"), "utf8").split("\n");

  test("still lists the thirteen shims", () => {
    assert.equal(NAMES.length, 13);
    for (const n of NAMES) assert.ok(lines.includes(`scripts/${n}.sh`), n);
  });

  test("lists each shim once", () => {
    for (const n of NAMES) assert.equal(lines.filter((l) => l === `scripts/${n}.sh`).length, 1, n);
  });
});
