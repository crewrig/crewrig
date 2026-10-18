// check-spec-id-reserved-base-ref.test.ts — base-ref resolution ladder (explicit, target branch, refusal, default)
// Replaces scripts/tests/test-check-spec-id-reserved.sh (Cases 16, 17, 18, 18b, 18c, 19).
// POSIX-only (skipped on win32 with a stated reason, see lib/spec-id-fixture.ts). Every case runs
// against a local bare repository under one mkdtemp root; the stub gh fails on any call.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  REFERENCE_REPO,
  SKIP,
  addSpec,
  createRoot,
  expectExit0,
  newFixture,
  removeRoot,
  reserve,
  runCheckBased,
} from "./lib/spec-id-fixture.ts";

let root = "";

describe("check-spec-id-reserved-base-ref.test.ts", { skip: SKIP }, () => {
  before(() => {
    root = createRoot();
  });
  after(() => removeRoot(root));

  const pair = {
    CI_MERGE_REQUEST_SOURCE_PROJECT_PATH: REFERENCE_REPO,
    CI_PROJECT_PATH: REFERENCE_REPO,
  };
  const hotfix = /0300-someone-elses-hotfix/;
  const baseMain = /Base ref: (crewrig|origin)\/main/;

  it("Case 16 - a merge request onto release/1.x resolves its base from the target branch", () => {
    // Resolved against main the change would hold a second spec, issue #700's: a contributor
    // blocked by a finding naming a file they never touched.
    const fx = newFixture(root, "c16", "release");
    reserve(fx, "refs/spec-ids/0301", "0301", "701");
    addSpec(fx, "specs/0301-mine.md", "0301", "mine", "701");
    const r = runCheckBased(fx, "", {
      GITLAB_CI: "true",
      CI_MERGE_REQUEST_TARGET_BRANCH_NAME: "release/1.x",
      ...pair,
    });
    expectExit0(r);
    assert.doesNotMatch(r.log, hotfix);
  });

  it("Case 17 - inside CI with no base and no target branch, the check refuses to guess", () => {
    // Exit 2 EXACTLY: under the defect (fall through to <remote>/main) this fixture also exits
    // non-zero by blocking on #700's spec, and `!= 0` cannot tell a refusal from a crash.
    const fx = newFixture(root, "c17", "release");
    reserve(fx, "refs/spec-ids/0302", "0302", "702");
    addSpec(fx, "specs/0302-mine.md", "0302", "mine", "702");
    const r = runCheckBased(fx, "", { GITLAB_CI: "true", ...pair });
    assert.equal(r.status, 2, `expected exit 2 (wiring fault)\n${r.log}`);
    assert.match(r.log, /CI_MERGE_REQUEST_TARGET_BRANCH_NAME/);
    assert.doesNotMatch(r.log, hotfix);
  });

  it("Case 18 - outside CI the base defaults to <remote>/main", () => {
    const fx = newFixture(root, "c18");
    reserve(fx, "refs/spec-ids/0303", "0303", "703");
    addSpec(fx, "specs/0303-mine.md", "0303", "mine", "703");
    const r = runCheckBased(fx, "", { CREWRIG_SPEC_ID_ORIGIN: "same" });
    expectExit0(r);
    assert.match(r.log, baseMain);
  });

  it("Case 18b - a trailing-slash BASE_REF is normalized to unset (issue #1214)", () => {
    const fx = newFixture(root, "c18b");
    reserve(fx, "refs/spec-ids/0305", "0305", "705");
    addSpec(fx, "specs/0305-mine.md", "0305", "mine", "705");
    const r = runCheckBased(fx, "crewrig/", { CREWRIG_SPEC_ID_ORIGIN: "same" });
    expectExit0(r);
    assert.match(r.log, baseMain);
  });

  it("Case 18c - a repository with no main branch falls back to develop (issue #1214)", () => {
    const fx = newFixture(root, "c18c", "develop");
    reserve(fx, "refs/spec-ids/0306", "0306", "706");
    addSpec(fx, "specs/0306-mine.md", "0306", "mine", "706");
    const r = runCheckBased(fx, "", { CREWRIG_SPEC_ID_ORIGIN: "same" });
    expectExit0(r);
    assert.match(r.log, /Base ref: (crewrig|origin)\/develop/);
  });

  it("Case 19 - an explicit base outranks the target-branch variable", () => {
    const fx = newFixture(root, "c19", "release");
    reserve(fx, "refs/spec-ids/0304", "0304", "704");
    addSpec(fx, "specs/0304-mine.md", "0304", "mine", "704");
    const r = runCheckBased(fx, "origin/release/1.x", {
      GITLAB_CI: "true",
      CI_MERGE_REQUEST_TARGET_BRANCH_NAME: "main",
      ...pair,
    });
    assert.match(r.log, /Base ref: origin\/release\/1\.x/);
  });
});
