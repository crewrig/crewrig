// extension-shim.test.ts — the five forwarding shims (spec 0254 R24, delta-01): the shell scripts
// that remain so callers of `bash scripts/<name>.sh` reach the TypeScript entries. POSIX-only
// (the shims are Bash; the suite skips where no `bash` exists). Model: build-components-shim.test.ts.
//
// `node` absent: one `Error:` line naming node and 24, exit 1, no file written. A `node` reporting
// v20: the floor guard's diagnostic, the entry not run. A healthy node: arguments and the exit
// status reach the entry. The shell allowlist keeps the five and no longer lists render-context.sh.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import { REPO } from "./lib/build-fixture-tree.ts";
import { pathWithFakeNode, pathWithoutNode } from "./lib/shim-env.ts";
import { cleanEnv, cleanupAll, makePathDir, realTmp, which } from "./lib/worktree-fixtures.ts";

after(cleanupAll);

const BASH = which("bash");
const SKIP =
  process.platform === "win32"
    ? "SKIP: POSIX-only suite (the shims are Bash)"
    : BASH === null
      ? "SKIP: bash is not installed"
      : false;
const NAMES = [
  "build-extension",
  "build-claude-plugin",
  "build-copilot-plugin",
  "build-antigravity-extension",
  "migrate-extension",
];

function run(name: string, args: readonly string[], env: NodeJS.ProcessEnv, cwd: string) {
  const shim = path.join(REPO, "scripts", `${name}.sh`);
  const res = spawnSync(BASH ?? "bash", [shim, ...args], { env, cwd, encoding: "utf8" });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

/** A PATH whose `node` records its argv, runs the real floor guard, and exits with STUB_EXIT. */
function recordingNode(): NodeJS.ProcessEnv {
  const links: Record<string, string> = {};
  for (const n of ["dirname", "cat", "env"]) links[n] = which(n) ?? n;
  const bin = makePathDir({
    links,
    scripts: {
      node: [
        `case "$1" in *node-floor-guard.js) exec "${process.execPath}" "$@";; esac`,
        `printf 'argv:%s\\n' "$@"`,
        `exit "\${STUB_EXIT:-0}"`,
      ].join("\n"),
    },
  });
  return cleanEnv({ PATH: bin });
}

for (const name of NAMES) {
  describe(`${name}.sh`, { skip: SKIP }, () => {
    const outFile = "must-not-exist";

    test("no node: one Error: line naming node and 24, exit 1, nothing written", () => {
      const cwd = realTmp("crewrig-shim-");
      const res = run(name, ["--out", outFile], pathWithoutNode(), cwd);
      assert.equal(res.status, 1);
      assert.equal(res.stdout, "");
      assert.equal(res.stderr.split("\n").filter((l) => l !== "").length, 1, res.stderr);
      assert.match(res.stderr, /^Error: .*\bnode\b.*\b24\b/);
      assert.deepEqual(fs.readdirSync(cwd), []);
    });

    test("node v20: the floor guard's diagnostic, the entry does not run, nothing written", () => {
      const cwd = realTmp("crewrig-shim-");
      const res = run(name, ["--out", outFile], pathWithFakeNode("v20.11.1"), cwd);
      assert.notEqual(res.status, 0);
      assert.equal(res.stdout, "");
      assert.match(res.stderr, /requires Node\.js >= 24/);
      assert.match(res.stderr, /v20\.11\.1/);
      assert.deepEqual(fs.readdirSync(cwd), []);
    });

    test("arguments reach the TypeScript entry in order and the exit status comes back", () => {
      const args = ["--target", "claude", "with space", "", "$HOME"];
      const res = run(name, args, { ...recordingNode(), STUB_EXIT: "7" }, realTmp("crewrig-shim-"));
      assert.equal(res.status, 7);
      const lines = res.stdout.split("\n");
      assert.match(lines[0] ?? "", new RegExp(`^argv:.*scripts/${name}\\.ts$`));
      assert.deepEqual(
        lines.slice(1, 1 + args.length),
        args.map((a) => `argv:${a}`),
      );
    });
  });
}

describe("the shell allowlist", () => {
  const lines = fs.readFileSync(path.join(REPO, "ci", "shell-allowlist.txt"), "utf8").split("\n");

  test("still lists the five shims", () => {
    for (const n of NAMES) assert.ok(lines.includes(`scripts/${n}.sh`), n);
  });

  test("no longer lists render-context.sh, which is deleted", () => {
    assert.ok(!lines.includes("scripts/lib/render-context.sh"));
    assert.ok(!fs.existsSync(path.join(REPO, "scripts", "lib", "render-context.sh")));
  });
});
