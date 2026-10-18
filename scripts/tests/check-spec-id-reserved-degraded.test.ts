// check-spec-id-reserved-degraded.test.ts — degradations that report without failing (PLAN step 10)
// Replaces scripts/tests/test-check-spec-id-reserved.sh (Cases 12, 12b, 12c).
// POSIX-only (skipped on win32 with a stated reason, see lib/spec-id-fixture.ts). Every case runs
// against a local bare repository under one mkdtemp root; the stub gh fails on any call.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  SKIP,
  addSpec,
  breakRemote,
  commitObject,
  createRoot,
  dangleReservation,
  expectExit0,
  newFixture,
  removeRoot,
  runCheckSameRepo,
} from "./lib/spec-id-fixture.ts";

let root = "";

describe("check-spec-id-reserved-degraded.test.ts", { skip: SKIP }, () => {
  before(() => {
    root = createRoot();
  });
  after(() => removeRoot(root));

  it("Case 12 - an unreadable reserved set reports without failing", () => {
    const fx = newFixture(root, "c12");
    addSpec(fx, "specs/0212-unreadable.md", "0212", "unreadable", "890");
    breakRemote(fx);
    const r = runCheckSameRepo(fx);
    expectExit0(r);
    // "Reports without failing" is two claims and an exit 0 proves only the second: a bare
    // `exit 0` in place of this branch survives on the verdict alone, so the text is pinned.
    assert.match(r.log, /\[REPORT\].*could not be read/);
    assert.match(r.log, /indistinguishable from an empty/);
    assert.doesNotMatch(r.log, /specs\/0212-unreadable[.]md/);
  });

  it("Case 12b - an unfetchable reservation object reports without failing", () => {
    const fx = newFixture(root, "c12b");
    dangleReservation(fx, "refs/spec-ids/0400");
    addSpec(fx, "specs/0400-unreadable-record.md", "0400", "unreadable-record", "910");
    const r = runCheckSameRepo(fx);
    expectExit0(r);
    // Asserted by channel, not sentence: the spec path separates this per-spec branch from the
    // namespace-unreadable report, which names no spec. If that report ever names the specs it
    // could not verify, this discriminator must be replaced, not assumed to still hold.
    assert.match(r.log, /specs\/0400-unreadable-record[.]md/);
    assert.match(r.log, /\[REPORT\]/);
  });

  it("Case 12c - a fetchable reservation lacking a ticket reports without failing", () => {
    // The second route to an empty recorded issue: the object is fetchable but names no ticket.
    const fx = newFixture(root, "c12c");
    commitObject(fx, "refs/spec-ids/0401", "no ticket here");
    addSpec(fx, "specs/0401-no-ticket.md", "0401", "no-ticket", "911");
    const r = runCheckSameRepo(fx);
    expectExit0(r);
    assert.match(r.log, /\[REPORT\]/);
  });
});
