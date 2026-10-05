// worktree-claim-shim.test.ts — scripts/worktree-claim.sh, the forwarding shim
// (spec 0248 R26; ledgered finding s2-F3: the spec has no scenario for it).
//
// `node` absent: one shell-authored `Error:` line, exit 1. A `node` reporting
// major 20: the floor guard's status and diagnostic, the tool not run, the
// filesystem unmodified (R25: no claim root is created). Healthy: status,
// standard output and standard error of the TypeScript tool unchanged, and
// standard input passed through.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { after, before, describe, test } from "node:test";

import { pathWithFakeNode, pathWithoutNode } from "./lib/shim-env.ts";
import {
  CLAIM_SH,
  cleanEnv,
  cleanupAll,
  makeFixture,
  SKIP_POSIX,
  which,
  type Fixture,
  type Result,
} from "./lib/worktree-fixtures.ts";

let fx: Fixture;
before(() => {
  fx = makeFixture();
});
after(cleanupAll);

const BASH = which("bash") ?? "/bin/bash";

function shim(
  args: string[],
  env: NodeJS.ProcessEnv = cleanEnv(),
  input = "",
  cwd: string = fx.wt,
): Result {
  const res = spawnSync(BASH, [CLAIM_SH, ...args], { cwd, env, input, encoding: "utf8" });
  return { status: res.status, signal: res.signal, stdout: res.stdout, stderr: res.stderr };
}

const lines = (text: string): string[] => text.split("\n").filter((line) => line !== "");

describe("a healthy node: the tool's answer, unchanged", { skip: SKIP_POSIX }, () => {
  test("take, status, a refused take, release: exit codes, streams and the claim directory", () => {
    const take = shim(["take", "--agent", "alice"]);
    assert.equal(take.status, 0, take.stderr);
    assert.match(take.stdout, /^Claimed '736' for 'alice'\./);
    assert.equal(take.stderr, "");
    assert.match(shim(["status"]).stdout, /state: claimed/);
    const refused = shim(["take", "--agent", "bob"]);
    assert.equal(refused.status, 4);
    assert.match(refused.stdout, /^Refused: '736' is already claimed by another agent\./);
    assert.equal(shim(["release", "--agent", "alice"]).status, 0);
    assert.equal(shim(["release", "--agent", "alice"]).status, 6);
  });

  test("an Error: diagnostic and exit 1 pass through", () => {
    const res = shim(["frobnicate"]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /^Error: unknown subcommand 'frobnicate'/);
  });

  test("standard input reaches the wrapped command of run", () => {
    const res = shim(["run", "--agent", "alice", "--", "cat"], cleanEnv(), "from-stdin\n");
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stdout, "from-stdin\n");
  });

  test("the wrapped command's exit code is the shim's", () => {
    assert.equal(shim(["run", "--agent", "alice", "--", "sh", "-c", "exit 42"]).status, 42);
  });
});

describe("a node absent from the search path", { skip: SKIP_POSIX }, () => {
  test("one shell-authored Error: line naming node and the floor, exit 1", () => {
    const res = shim(["take", "--agent", "alice"], pathWithoutNode());
    assert.equal(res.status, 1);
    assert.equal(res.stdout, "");
    assert.equal(lines(res.stderr).length, 1, res.stderr);
    assert.match(res.stderr, /^Error: .*node/);
    assert.match(res.stderr, /24/);
  });
});

describe("a node below the floor", { skip: SKIP_POSIX }, () => {
  test("the floor guard's status and diagnostic; the tool does not run; the filesystem is unmodified", () => {
    const other = makeFixture({ ticket: "900" });
    const res = shim(["take", "--agent", "alice"], pathWithFakeNode(), "", other.wt);
    assert.equal(res.status, 1);
    assert.equal(res.stdout, "");
    assert.equal(lines(res.stderr).length, 1, res.stderr);
    assert.match(res.stderr, /requires Node\.js >= 24/);
    assert.match(res.stderr, /v20\.11\.1/);
    assert.equal(fs.existsSync(other.claimRoot), false, "no claim root was created");
    assert.equal(fs.existsSync(other.claimDir), false);
  });
});
