// worktree-guard-phrases.test.ts — the prohibited set and the worktree scope
// (spec 0248 R6, R7; scenarios 1, 2).
//
// Black-box: every test spawns the real entry the way a CLI does (see
// worktree-guard-decision.test.ts for the conventions). Allowed outcomes are
// asserted silent (R10), refusals exact (R9).

import { after, before, describe, test } from "node:test";

import { allowed, payload, refused } from "./lib/guard-asserts.ts";

import {
  cleanupAll,
  makeFixture,
  runGuard,
  WINDOWS,
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

describe("the prohibited set and its quirks (R7)", () => {
  const prohibited = [
    "git reset --hard",
    "git reset --hard HEAD~1",
    "git checkout -- .",
    "git checkout .",
    "git clean -fd",
    "git clean",
    "echo git clean is bad",
    "git cleanup",
    "git worktree remove --force x",
    "git worktree remove -f x",
    "git stash",
    "git stash push -m x",
    "git stash -u",
    "git stash save",
    "git stash clear",
    "git stash  list",
    "cd x && git reset --hard",
    "git reset --hard && git stash list",
    "git clean && git stash pop",
  ];
  const permitted = [
    "git status",
    "git diff",
    "git checkout main",
    "git checkout -b feature",
    "git checkout -- file.txt",
    "git reset --soft HEAD~1",
    "git reset HEAD file",
    "git worktree remove x",
    "git worktree list",
    "git stash list",
    "git stash show -p",
    "git stash pop",
    "git stash apply",
    "git stash drop",
    "git stash popular",
    "git stash push; git stash list",
    "ls -la",
  ];
  for (const command of prohibited) {
    test(`refused: ${command}`, () => {
      refused(inWorktree(payload(command, unclaimed.wt)), "771");
    });
  }
  for (const command of permitted) {
    test(`allowed: ${command}`, () => {
      allowed(inWorktree(payload(command, unclaimed.wt)));
    });
  }
});

describe("scope: where the guard enforces (R6; scenarios 1, 2)", () => {
  const outsideCases: Array<[string, string]> = [
    ["a directory outside any worktree", "/tmp/some-dir"],
    ["`.worktrees` as the last component, no id", "/x/.worktrees"],
    ["an empty id", "/x/.worktrees/"],
    ["an empty id before a further component", "/x/.worktrees//y"],
    ["a lookalike directory name", "/x/.worktreesfoo/771"],
    ["a lookalike prefix", "/x/my.worktrees/771"],
  ];
  for (const [name, cwd] of outsideCases) {
    test(`allowed without enforcement: ${name}`, () => {
      allowed(inWorktree(payload("git reset --hard", cwd)));
    });
  }

  // R6 reads a backslash as a separator "on Windows" and R38 lets no byte differ on macOS and Linux:
  // off Windows a Windows-style path is a name with no `/.worktrees/` component, as the shell guard saw it.
  test(
    "a Windows-style path is not in scope off Windows (a backslash is not a separator there)",
    { skip: WINDOWS ? "SKIP: POSIX-only leg" : false },
    () => {
      allowed(inWorktree(payload("git reset --hard", "C:\\Users\\ana\\crewrig\\.worktrees\\771")));
    },
  );

  test("the ticket id is taken after the LAST `/.worktrees/`", () => {
    refused(inWorktree(payload("git reset --hard", "/a/.worktrees/1/b/.worktrees/2/c")), "2");
  });

  test("the id ends at the next separator", () => {
    refused(inWorktree(payload("git reset --hard", "/a/.worktrees/42/deep/er")), "42");
  });

  test("the id may end the path", () => {
    refused(inWorktree(payload("git reset --hard", "/a/.worktrees/42")), "42");
  });
});
