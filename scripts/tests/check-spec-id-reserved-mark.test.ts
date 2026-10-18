// check-spec-id-reserved-mark.test.ts — the unsecured-id mark (spec 0112 requirements 9 and 10)
// Replaces scripts/tests/test-check-spec-id-reserved.sh (Cases 13, 14, 15).
// POSIX-only (skipped on win32 with a stated reason, see lib/spec-id-fixture.ts). Every case runs
// against a local bare repository under one mkdtemp root; the stub gh fails on any call.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  REFERENCE_REPO,
  SKIP,
  UNSECURED_MARK,
  addSpec,
  createRoot,
  expectExit0,
  expectNonZero,
  newFixture,
  removeRoot,
  reserve,
  runCheck,
  runCheckSameRepo,
} from "./lib/spec-id-fixture.ts";

let root = "";

describe("check-spec-id-reserved-mark.test.ts", { skip: SKIP }, () => {
  before(() => {
    root = createRoot();
  });
  after(() => removeRoot(root));

  it("Case 13 - a secured id still carrying the unsecured mark fails and names the file", () => {
    // The id IS secured for this spec's own ticket (the golden path of Case 1); only the stale
    // mark makes the run fail. Removing the stale-mark enforcement fails this and nothing else.
    const fx = newFixture(root, "c13");
    reserve(fx, "refs/spec-ids/0219", "0219", "900");
    addSpec(fx, "specs/0219-stale-mark.md", "0219", "stale-mark", "900", UNSECURED_MARK);
    const r = runCheckSameRepo(fx);
    expectNonZero(r);
    assert.match(r.log, /specs\/0219-stale-mark\.md/);
  });

  it("Case 14 - an unsecured id from a fork carrying the mark reports without failing", () => {
    // Pins that mark handling stays INSIDE the blocking gate: a bare exit on the mark's presence
    // would skip origin discrimination and block a contributor who cannot secure anything.
    const fx = newFixture(root, "c14");
    addSpec(fx, "specs/0220-honest-mark.md", "0220", "honest-mark", "901", UNSECURED_MARK);
    const r = runCheck(fx, {
      CI_MERGE_REQUEST_SOURCE_PROJECT_PATH: "contributor/crewrig",
      CI_PROJECT_PATH: REFERENCE_REPO,
    });
    expectExit0(r);
  });

  it("Case 15 - the mark buys no exemption from the reference repository", () => {
    // The opposite over-correction: reading the mark as "already acknowledged" would let a
    // same-repository author opt out of the guard by pasting one line.
    const fx = newFixture(root, "c15");
    addSpec(
      fx,
      "specs/0221-marked-but-blocking.md",
      "0221",
      "marked-but-blocking",
      "902",
      UNSECURED_MARK,
    );
    expectNonZero(runCheckSameRepo(fx));
  });
});
