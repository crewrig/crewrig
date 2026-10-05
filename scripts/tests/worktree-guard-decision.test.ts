// worktree-guard-decision.test.ts — the guard's decision: refusal, claim, undetermined state
// (spec 0248 R3, R4, R8, R9; scenarios 3, 4, 8; v1-F6).
//
// Black-box: every test spawns the real entry the way a CLI does (see
// worktree-guard-decision.test.ts for the conventions). Allowed outcomes are
// asserted silent (R10), refusals exact (R9).

import assert from "node:assert/strict";
import fs from "node:fs";
import { after, before, describe, test } from "node:test";

import { allowed, payload, refused } from "./lib/guard-asserts.ts";
import { makeGuardTree } from "./lib/guard-tree.ts";

import {
  cleanEnv,
  cleanupAll,
  CLAIM_TS,
  GUARD_TS,
  makeFixture,
  makePathDir,
  realTmp,
  runClaim,
  runGuard,
  SKIP_POSIX,
  writeClaim,
  type Fixture,
} from "./lib/worktree-fixtures.ts";

let unclaimed: Fixture;
let claimed: Fixture;

before(() => {
  unclaimed = makeFixture({ ticket: "771" });
  claimed = makeFixture({ ticket: "771" });
  writeClaim(claimed, { holder: "alice" });
});
after(cleanupAll);

/** Run the guard in the unclaimed fixture worktree, with `payload` on standard input. */
const inWorktree = (input: string, extra: { args?: string[]; env?: NodeJS.ProcessEnv } = {}) =>
  runGuard(input, { cwd: unclaimed.wt, ...extra });

describe("refusal contract (R8, R9; scenario 3)", () => {
  for (const command of ["git reset --hard", "git clean -fd", "git stash"]) {
    test(`${command}: one message, empty stdout, exit 1, hint names the TypeScript tool`, () => {
      refused(inWorktree(payload(command, unclaimed.wt)), "771");
    });
  }

  test("the message names the ticket of the path, not of the process directory", () => {
    const res = runGuard(payload("git reset --hard", "/elsewhere/.worktrees/9001/sub"), {
      cwd: unclaimed.wt,
    });
    refused(res, "9001");
  });
});

describe("a claim allows, whoever holds it (R8; scenario 4)", () => {
  test("a claim written by any agent allows git reset --hard, silently", () => {
    allowed(runGuard(payload("git reset --hard", claimed.wt), { cwd: claimed.wt }));
  });

  test("an empty claim directory counts as claimed, as `[ -d ]` read it", () => {
    const fx = makeFixture({ ticket: "771" });
    fs.mkdirSync(fx.claimDir, { recursive: true });
    allowed(runGuard(payload("git reset --hard", fx.wt), { cwd: fx.wt }));
  });

  test("a claim taken by `take` allows", { skip: !fs.existsSync(CLAIM_TS) }, () => {
    const fx = makeFixture({ ticket: "771" });
    const take = runClaim(["take", "--agent", "alice"], { cwd: fx.wt });
    assert.equal(take.status, 0, take.stderr);
    allowed(runGuard(payload("git reset --hard", fx.wt), { cwd: fx.wt }));
  });

  test("a claim held by an in-flight `run` allows the wrapped guard", () => {
    const fx = makeFixture({ ticket: "771" });
    const res = runClaim(["run", "--agent", "alice", "--", process.execPath, GUARD_TS], {
      cwd: fx.wt,
      input: payload("git reset --hard", fx.wt),
    });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stderr, "", "neither the guard nor run writes anything");
  });

  test("the claim is read from the repository of the process directory, not of the payload (R8)", () => {
    // Process in the claimed repository, payload naming the unclaimed one: allowed.
    allowed(runGuard(payload("git reset --hard", unclaimed.wt), { cwd: claimed.wt }));
    // And the other way round: refused.
    refused(runGuard(payload("git reset --hard", claimed.wt), { cwd: unclaimed.wt }), "771");
  });

  test("CREWRIG_REPO_DIR names the repository the claim lookup inspects (R4, R14)", () => {
    const outside = realTmp("crewrig-outside-");
    const env = cleanEnv({ CREWRIG_REPO_DIR: claimed.wt });
    allowed(runGuard(payload("git reset --hard", unclaimed.wt), { cwd: outside, env }));
    const envUnclaimed = cleanEnv({ CREWRIG_REPO_DIR: unclaimed.wt });
    refused(
      runGuard(payload("git reset --hard", unclaimed.wt), { cwd: outside, env: envUnclaimed }),
      "771",
    );
  });

  for (const command of [
    "git stash list",
    "git stash show",
    "git stash pop",
    "git stash apply",
    "git stash drop",
  ]) {
    test(`${command} is exempt and needs no claim`, () => {
      allowed(inWorktree(payload(command, unclaimed.wt)));
    });
  }
});

describe("an undetermined state refuses, never reads as claimed (R8; scenario 8)", () => {
  test("a process directory that is in no git repository", () => {
    const outside = realTmp("crewrig-outside-");
    refused(runGuard(payload("git reset --hard", claimed.wt), { cwd: outside }), "771");
  });

  test("git failing", { skip: SKIP_POSIX }, () => {
    const bin = makePathDir({ scripts: { git: "exit 128" } });
    const res = runGuard(payload("git reset --hard", claimed.wt), {
      cwd: claimed.wt,
      env: cleanEnv({ PATH: bin }),
    });
    refused(res, "771", "a claimed ticket the guard could not read is not claimed");
  });

  test("git absent from the search path", { skip: SKIP_POSIX }, () => {
    const res = runGuard(payload("git reset --hard", claimed.wt), {
      cwd: claimed.wt,
      env: cleanEnv({ PATH: makePathDir({}) }),
    });
    refused(res, "771");
  });

  test("the claim module cannot load (R38(d): an unloadable module refuses)", () => {
    const tree = makeGuardTree({ claimState: null });
    try {
      refused(
        runGuard(payload("git reset --hard", claimed.wt), { cwd: claimed.wt, entry: tree.entry }),
        "771",
      );
    } finally {
      tree.cleanup();
    }
  });

  test("a claim module that throws on load refuses", () => {
    const tree = makeGuardTree({ claimState: 'throw new Error("boom");\nexport {};\n' });
    try {
      refused(
        runGuard(payload("git reset --hard", claimed.wt), { cwd: claimed.wt, entry: tree.entry }),
        "771",
      );
    } finally {
      tree.cleanup();
    }
  });
});

describe("a ticket id cannot leave the claim root (v1-F6)", () => {
  // A claim of 771 makes `<common>/crewrig/worktree-claims/` and `<common>/crewrig/` exist, so an
  // id that resolved outside the claim root would read as a claimed directory.
  for (const [id, cwd] of [
    ["..", "/x/.worktrees/.."],
    ["..", "/x/.worktrees/../y"],
    [".", "/x/.worktrees/."],
    [".", "/x/.worktrees/./y"],
  ] as const) {
    test(`id ${JSON.stringify(id)} from ${cwd} is refused even where the claim root exists`, () => {
      const res = runGuard(payload("git reset --hard", cwd), { cwd: claimed.wt });
      refused(res, id);
    });
  }
});

describe(
  "R3: the decision equals the `state:` line of `status`",
  { skip: !fs.existsSync(CLAIM_TS) },
  () => {
    function stateOf(cwd: string, ticket: string): string | null {
      const res = runClaim(["status", "--ticket", ticket], { cwd });
      return /^state: (claimed|unclaimed)$/m.exec(res.stdout)?.[1] ?? null;
    }

    test("claimed", () => {
      assert.equal(stateOf(claimed.wt, "771"), "claimed");
      allowed(runGuard(payload("git reset --hard", claimed.wt), { cwd: claimed.wt }));
    });

    test("unclaimed", () => {
      assert.equal(stateOf(unclaimed.wt, "771"), "unclaimed");
      refused(runGuard(payload("git reset --hard", unclaimed.wt), { cwd: unclaimed.wt }), "771");
    });

    test("unreadable: status prints no state, the guard refuses", () => {
      const outside = realTmp("crewrig-outside-");
      assert.equal(stateOf(outside, "771"), null);
      refused(runGuard(payload("git reset --hard", unclaimed.wt), { cwd: outside }), "771");
    });
  },
);
