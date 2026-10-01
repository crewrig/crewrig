// ticket-ownership.test.ts — the pure ownership model of the spec 0244 pickup
// check (scripts/lib/ticket-ownership.ts): grouping of recorded items into
// changes, creation seeding (PLAN v2 step 1 with review edit v2-F1), replay
// from the empty set (R1), ties and inconsistent records (R4, R13), and the
// R11 verdict for the contributor running the pickup.
//
// Run: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test scripts/tests/ticket-ownership.test.ts

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AssignmentItem, AssignmentRecord, Determination } from "../lib/ticket-ownership.ts";
import {
  MAX_ORDERINGS,
  addCount,
  determine,
  groupChanges,
  recordKey,
  verdictFor,
} from "../lib/ticket-ownership.ts";

const T0 = Date.parse("2026-09-01T09:00:00Z");
const s = (n: number): number => T0 + n * 1000;

/** `+a@3/b` = at second 3 actor b adds a; `-a@3` = a removes a at second 3; `#g` sets a group id. */
function items(spec: string): AssignmentItem[] {
  return spec
    .split(/\s+/)
    .filter((x) => x !== "")
    .map((tok) => {
      const m = /^([+-])([\w-]+)@(\d+)(?:\/([\w-]+))?(?:#(\w+))?$/.exec(tok);
      if (m === null) throw new Error(`bad item '${tok}'`);
      const [, sign = "+", user = "", at = "0", actor, group] = m;
      const it: AssignmentItem = {
        at: s(Number(at)),
        actor: actor ?? user,
        user,
        op: sign === "+" ? "add" : "remove",
      };
      return group === undefined ? it : { ...it, group };
    });
}

function rec(current: string[], spec: string, creation = true): AssignmentRecord {
  return {
    current,
    items: items(spec),
    createdAt: T0,
    author: "author",
    recordsCreationAssignees: creation,
  };
}

function kind(d: Determination): string {
  return d.kind === "owned" ? `owned:${d.owner}` : d.kind;
}

describe("groupChanges", () => {
  test("items sharing instant and actor form one change; a different actor starts another", () => {
    const cs = groupChanges(items("-a@5/b +b@5/b +c@5/c"));
    assert.deepEqual(
      cs.map((c) => [c.actor, c.items.map((i) => `${i.op}:${i.user}`)]),
      [
        ["b", ["remove:a", "add:b"]],
        ["c", ["add:c"]],
      ],
    );
  });

  test("a forge change id (GitLab note) groups by id, not by instant", () => {
    assert.equal(groupChanges(items("+a@5/x#1 +b@5/x#2")).length, 2);
    assert.equal(groupChanges(items("+a@5/x#1 +b@6/x#1")).length, 1);
  });

  test("logins are compared case-insensitively", () => {
    const cs = groupChanges([
      { at: s(1), actor: "Alice", user: "Alice", op: "add" },
      { at: s(1), actor: "alice", user: "BOB", op: "add" },
    ]);
    assert.equal(cs.length, 1);
    assert.deepEqual(
      cs[0]?.items.map((i) => i.user),
      ["alice", "bob"],
    );
  });
});

describe("determine: replay since last free (R1)", () => {
  const rows: [string, string[], string, string][] = [
    ["no history and no assignee → free", [], "", "free"],
    ["a sole taker owns the issue", ["a"], "+a@1", "owned:a"],
    ["release, then another take → the new taker owns it", ["b"], "+a@1 -a@9 +b@20", "owned:b"],
    [
      "a one-change replacement (same actor, same instant) does not free the issue",
      ["b"],
      "+a@1 -a@5/b +b@5/b",
      "owned:a",
    ],
    [
      "split displacement (add intruder, later remove owner) never frees the issue",
      ["b"],
      "+a@1 +b@5 -a@6/b",
      "owned:a",
    ],
    [
      "a replacement split across two seconds reads as release then take (v2-F5, intended)",
      ["b"],
      "+a@1 -a@5/b +b@6/b",
      "owned:b",
    ],
    [
      "an owner no longer assigned is still the owner (v1-F1)",
      ["b"],
      "+a@1 +b@3 -a@4/b",
      "owned:a",
    ],
    ["released ticket with nobody assigned → free", [], "+a@1 -a@9", "free"],
    [
      "same-instant changes by different actors whose order does not matter are decidable",
      ["a", "b", "c"],
      "+a@1 +b@5 +c@5",
      "owned:a",
    ],
    ["the first change adding two users is a tie (v1-F6a)", ["a", "b"], "+a@1/x +b@1/x", "tie"],
    ["two actors taking a free issue in the same second is a tie", ["a", "b"], "+a@1 +b@1", "tie"],
    [
      "same-second take after a release by another actor is a tie when the order decides",
      ["b"],
      "+a@1 -a@5 +b@5",
      "tie",
    ],
    ["a removal of a user never assigned is inconsistent", [], "-a@1", "inconsistent"],
    [
      "a replay that differs from the current list is inconsistent (R13)",
      ["a", "b"],
      "+a@1",
      "inconsistent",
    ],
    ["a current list the history cannot explain is inconsistent", ["c"], "", "inconsistent"],
  ];
  for (const [name, current, spec, want] of rows)
    test(name, () => assert.equal(kind(determine(rec(current, spec))), want));

  test("the owner's `since` is the instant of the first change after last free", () => {
    assert.deepEqual(determine(rec(["b"], "+a@1 -a@9 +b@20 +c@21 -c@22")), {
      kind: "owned",
      owner: "b",
      since: s(20),
    });
  });

  test("the free determination reports when the issue last became free (R14 dedup window)", () => {
    assert.deepEqual(determine(rec([], "+a@1 -a@9")), { kind: "free", lastFreeAt: s(9) });
  });

  test(`more than ${MAX_ORDERINGS} orderings of same-instant changes fails closed as a tie`, () => {
    // Every ordering would name a, but 7! orderings exceed the bound: undecidable, not a hang.
    const users = ["b", "c", "d", "e", "f", "g", "h"];
    const spec = `+a@1 ${users.map((u) => `+${u}@3`).join(" ")}`;
    assert.equal(kind(determine(rec(["a", ...users], spec))), "tie");
    assert.equal(
      kind(determine(rec(["a", ...users.slice(1)], spec.replace("+b@3", "")))),
      "owned:a",
    );
  });
});

describe("determine: creation seeding on a forge that records no creation item (v1-F3, v2-F1)", () => {
  test("an issue created pre-assigned, with no item at all, is owned by that assignee", () => {
    assert.deepEqual(determine(rec(["a"], "", false)), { kind: "owned", owner: "a", since: T0 });
  });

  test("a user whose first item is a removal was a creation assignee", () => {
    assert.equal(kind(determine(rec([], "-a@4", false))), "free");
    assert.equal(kind(determine(rec(["b"], "-a@4/x#1 +b@4/x#1", false))), "owned:a");
  });

  test("a two-user creation seed is a tie", () => {
    assert.equal(kind(determine(rec(["a", "b"], "", false))), "tie");
  });

  test("v2-F1: a missed intruder note is inconsistent, never a seeded owner", () => {
    const r = rec(["a", "b"], "+a@1#1", false);
    assert.equal(kind(determine(r)), "inconsistent");
    // The real owner's agent must not be told to withdraw.
    assert.equal(verdictFor(determine(r), r.current, "a").kind, "cannot-determine");
  });

  test("the pickup's own user is never seeded after its own write: a lagging read is inconsistent", () => {
    const r = rec(["me"], "", false);
    assert.equal(kind(determine(r)), "owned:me");
    assert.equal(kind(determine(r, "me")), "inconsistent");
  });

  test("a forge that records creation items never seeds: an unexplained assignee is inconsistent", () => {
    assert.equal(kind(determine(rec(["a"], "", true))), "inconsistent");
  });
});

describe("verdictFor: the R11 branch for the contributor running the pickup", () => {
  const owned = (owner: string): Determination => ({ kind: "owned", owner, since: T0 });
  const rows: [string, Determination, string[], string, unknown][] = [
    ["free → assign self", { kind: "free", lastFreeAt: T0 }, [], "me", { kind: "assign-self" }],
    [
      "owner is self and assigned → proceed",
      owned("me"),
      ["me"],
      "me",
      { kind: "proceed", owner: "me" },
    ],
    [
      "owner is self but displaced → restore self (R11 second branch)",
      owned("me"),
      ["x"],
      "me",
      { kind: "restore-self", owner: "me" },
    ],
    [
      "self is an intruder next to the owner → withdraw, owner kept",
      owned("a"),
      ["a", "me"],
      "me",
      { kind: "withdraw", owner: "a", restoreOwner: false },
    ],
    [
      "self displaced the owner → restore owner, then withdraw (R4)",
      owned("a"),
      ["me"],
      "me",
      { kind: "withdraw", owner: "a", restoreOwner: true },
    ],
    [
      "third party facing an absent owner → owned by other, no write (v1-F1)",
      owned("a"),
      ["x"],
      "me",
      { kind: "owned-by-other", owner: "a" },
    ],
    [
      "tie → undecidable",
      { kind: "tie", reason: "r" },
      ["a", "me"],
      "me",
      { kind: "undecidable", reason: "r" },
    ],
  ];
  for (const [name, det, current, self, want] of rows)
    test(name, () => assert.deepEqual(verdictFor(det, current, self), want));

  test("inconsistent → cannot determine (R13), and self is compared case-insensitively", () => {
    assert.equal(
      verdictFor({ kind: "inconsistent", reason: "r" }, [], "me").kind,
      "cannot-determine",
    );
    assert.deepEqual(verdictFor(owned("me"), ["me"], "ME"), { kind: "proceed", owner: "me" });
  });
});

describe("confirming-read helpers", () => {
  test("recordKey ignores assignee order and login case but not the history", () => {
    const a = rec(["a", "b"], "+a@1 +b@2");
    assert.equal(recordKey(a), recordKey({ ...a, current: ["B", "a"] }));
    assert.notEqual(recordKey(a), recordKey(rec(["a", "b"], "+a@1 +b@3")));
  });

  test("addCount counts the recorded additions of one user", () => {
    assert.equal(addCount(rec(["a"], "+a@1 -a@2 +a@3"), "A"), 2);
  });
});
