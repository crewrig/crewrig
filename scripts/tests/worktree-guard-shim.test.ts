// worktree-guard-shim.test.ts — hooks/worktree-git-guard.sh, the forwarding
// shim (spec 0248 R13, scenario "An installed legacy command keeps guarding
// through the shim").
//
// Three branches, each run through `bash <shim>` the way a legacy command line
// runs it: `node` absent (one shell-authored line, exit 0), a `node` reporting
// major 20 (the floor guard's diagnostic, exit 0, the guard not run), and a
// healthy `node` (the TypeScript guard's status and streams forwarded
// unchanged). Both failure branches exit 0 on purpose: a guard that cannot
// start must not refuse every tool call (Copilot CLI's preToolUse is
// fail-closed).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { after, before, describe, test } from "node:test";

import { allowed, payload, refused } from "./lib/guard-asserts.ts";
import { pathWithFakeNode, pathWithoutNode } from "./lib/shim-env.ts";
import {
  cleanEnv,
  cleanupAll,
  GUARD_SH,
  makeFixture,
  SKIP_POSIX,
  which,
  writeClaim,
  type Fixture,
  type Result,
} from "./lib/worktree-fixtures.ts";

let unclaimed: Fixture;
let claimed: Fixture;

before(() => {
  unclaimed = makeFixture({ ticket: "771" });
  claimed = makeFixture({ ticket: "771" });
  writeClaim(claimed, { holder: "alice" });
});
after(cleanupAll);

const BASH = which("bash") ?? "/bin/bash";

function shim(
  input: string,
  cwd: string,
  env: NodeJS.ProcessEnv = cleanEnv(),
  args: string[] = [],
): Result {
  const res = spawnSync(BASH, [GUARD_SH, ...args], { cwd, env, input, encoding: "utf8" });
  return { status: res.status, signal: res.signal, stdout: res.stdout, stderr: res.stderr };
}

const lines = (text: string): string[] => text.split("\n").filter((line) => line !== "");

describe(
  "the shim with a healthy node forwards the TypeScript guard unchanged",
  { skip: SKIP_POSIX },
  () => {
    test("a prohibited command with no claim: status 1, the guard's message, empty stdout", () => {
      refused(shim(payload("git reset --hard", unclaimed.wt), unclaimed.wt), "771");
    });

    test("with a claim, and for a safe command: silent, status 0", () => {
      allowed(shim(payload("git reset --hard", claimed.wt), claimed.wt));
      allowed(shim(payload("git status", unclaimed.wt), unclaimed.wt));
    });

    test("the first positional argument is forwarded", () => {
      refused(shim("", unclaimed.wt, cleanEnv(), ["git reset --hard"]), "771");
    });
  },
);

describe("a node absent from the search path", { skip: SKIP_POSIX }, () => {
  test("one shell-authored line naming node and the floor, exit 0, nothing on stdout", () => {
    const res = shim(payload("git reset --hard", unclaimed.wt), unclaimed.wt, pathWithoutNode());
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stdout, "");
    assert.equal(lines(res.stderr).length, 1, res.stderr);
    assert.match(res.stderr, /node/);
    assert.match(res.stderr, /24/);
  });
});

describe("a node below the floor", { skip: SKIP_POSIX }, () => {
  test("the floor guard's own diagnostic, exit 0, the guard not run", () => {
    const res = shim(payload("git reset --hard", unclaimed.wt), unclaimed.wt, pathWithFakeNode());
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stdout, "");
    assert.equal(lines(res.stderr).length, 1, res.stderr);
    assert.match(res.stderr, /v20\.11\.1/);
    assert.match(res.stderr, /requires Node\.js >= 24/);
    assert.doesNotMatch(res.stderr, /mempalace-git-guard/, "the guard did not run");
  });
});
