// worktree-guard-antigravity.test.ts — the guard's allow answer on Antigravity CLI
// (spec 0248 delta-01 R39-R42; issue #1489). An empty stdout from an `agy`
// PreToolUse handler is a fail-closed denial, so every allow outcome for an
// Antigravity payload answers `{"decision": "ask"}`; every other payload stays
// silent, and a refusal prints nothing on stdout for every shape.
// The file name joins the `worktree-*.test.ts` CI glob.

import path from "node:path";
import { after, before, describe, test } from "node:test";

import { applyMutation, copyTracked } from "./lib/mutation-copy.ts";
import { agyPayload, allowed, askAnswer, payload, refused } from "./lib/guard-asserts.ts";
import {
  cleanupAll,
  makeFixture,
  REPO,
  runGuard,
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

describe("one working directory and command, both payload shapes (R42)", () => {
  for (const command of ["git status", "git reset --hard"]) {
    const fx = (): Fixture => (command === "git status" ? unclaimed : claimed);
    test(`${command}: toolCall envelope -> ask line, tool_input -> silent`, () => {
      const f = fx();
      askAnswer(runGuard(agyPayload(command, f.wt), { cwd: f.wt }));
      allowed(runGuard(payload(command, f.wt), { cwd: f.wt }));
    });
  }
});

describe("every allow outcome answers ask for Antigravity (R40, R41)", () => {
  test("working directory outside a ticket worktree", () => {
    askAnswer(runGuard(agyPayload("git reset --hard", "/elsewhere/dir"), { cwd: unclaimed.main }));
  });

  test("empty ticket segment", () => {
    askAnswer(runGuard(agyPayload("git reset --hard", "/x/.worktrees/"), { cwd: unclaimed.main }));
  });

  test("a command that is not prohibited", () => {
    askAnswer(runGuard(agyPayload("git status", unclaimed.wt), { cwd: unclaimed.wt }));
  });

  test("a prohibited command under a held claim", () => {
    askAnswer(runGuard(agyPayload("git reset --hard", claimed.wt), { cwd: claimed.wt }));
  });

  test('an unparsable payload carrying "toolCall"', () => {
    askAnswer(runGuard('{"toolCall": {"args": ', { cwd: unclaimed.wt }));
  });

  test("a toolCall that is not an object is not Antigravity's: silent", () => {
    for (const toolCall of [null, [1], "x", 5]) {
      allowed(
        runGuard(JSON.stringify({ toolCall, cwd: unclaimed.wt, command: "git status" }), {
          cwd: unclaimed.wt,
        }),
      );
    }
  });
});

describe("no payload, no answer (R39 accepted gap)", () => {
  test("empty stdin is silent", () => {
    allowed(runGuard("", { cwd: unclaimed.wt }));
  });
  test("closed stdin is silent", () => {
    allowed(runGuard(null, { cwd: unclaimed.wt }));
  });
  test('an unparsable payload without "toolCall" is silent', () => {
    allowed(runGuard("not json", { cwd: unclaimed.wt }));
  });
});

describe("a refusal prints no decision on either shape (R42)", () => {
  test("Antigravity", () => {
    refused(runGuard(agyPayload("git reset --hard", unclaimed.wt), { cwd: unclaimed.wt }), "771");
  });
  test("tool_input", () => {
    refused(runGuard(payload("git reset --hard", unclaimed.wt), { cwd: unclaimed.wt }), "771");
  });
});

describe("an internal error after the read still answers per the shape (R39, R41)", () => {
  // No payload makes the guard throw from outside, so a fault is planted in a
  // copy of the entry, right after the Antigravity recognition.
  test("Antigravity -> ask line; tool_input -> silent", () => {
    const copy = copyTracked(REPO, ["package.json", "hooks/worktree-git-guard.ts"]);
    try {
      applyMutation(
        copy,
        "hooks/worktree-git-guard.ts",
        "const step = (value: unknown, segment: string | number): unknown => {",
        'throw new Error("injected"); const step = (value: unknown, segment: string | number): unknown => {',
      );
      const entry = path.join(copy.root, "hooks", "worktree-git-guard.ts");
      const opts = { cwd: unclaimed.wt, entry };
      askAnswer(runGuard(agyPayload("git reset --hard", unclaimed.wt), opts));
      allowed(runGuard(payload("git reset --hard", unclaimed.wt), opts));
    } finally {
      copy.dispose();
    }
  });
});
