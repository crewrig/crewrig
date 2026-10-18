// check-spec-id-reserved-origin.test.ts — origin discrimination (spec 0112 requirement 10, PLAN step 10)
// Replaces scripts/tests/test-check-spec-id-reserved.sh (Cases 10, 10b, 10c, 11, 11b, 11c, 11d).
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
  expectNonZero,
  newFixture,
  removeRoot,
  reserve,
  runCheck,
} from "./lib/spec-id-fixture.ts";

let root = "";

describe("check-spec-id-reserved-origin.test.ts", { skip: SKIP }, () => {
  before(() => {
    root = createRoot();
  });
  after(() => removeRoot(root));

  const unsecured = (name: string, id: string, slug: string, issue: string) => {
    const fx = newFixture(root, name);
    addSpec(fx, `specs/${id}-${slug}.md`, id, slug, issue);
    return fx;
  };
  const forkGitLab = {
    CI_MERGE_REQUEST_SOURCE_PROJECT_PATH: "contributor/crewrig",
    CI_PROJECT_PATH: REFERENCE_REPO,
  };

  it("Case 10 - an unsecured id from a fork (GitLab pair) reports without failing", () => {
    const r = runCheck(unsecured("c10", "0210", "from-a-fork", "870"), forkGitLab);
    expectExit0(r);
    assert.match(r.log, /0210/);
  });

  it("Case 10b - GitHub pair, same repository: an unsecured id blocks", () => {
    // The GitHub arm is the one that runs on this repository's own CI; every other case drives
    // the GitLab pair, so a typo in the variable names would otherwise surface only in production.
    const fx = unsecured("c10b", "0214", "github-same-repo", "871");
    expectNonZero(
      runCheck(fx, { CREWRIG_PR_HEAD_REPO: REFERENCE_REPO, CREWRIG_PR_BASE_REPO: REFERENCE_REPO }),
    );
  });

  it("Case 10c - GitHub pair, forked repository: an unsecured id reports without failing", () => {
    const fx = unsecured("c10c", "0215", "github-fork", "872");
    const r = runCheck(fx, {
      CREWRIG_PR_HEAD_REPO: "contributor/crewrig",
      CREWRIG_PR_BASE_REPO: REFERENCE_REPO,
    });
    expectExit0(r);
    assert.match(r.log, /0215/);
  });

  it("Case 11 - an undeterminable origin fails even when the id is properly secured", () => {
    const fx = newFixture(root, "c11");
    reserve(fx, "refs/spec-ids/0211", "0211", "880");
    addSpec(fx, "specs/0211-good-spec.md", "0211", "good-spec", "880");
    expectNonZero(runCheck(fx));
  });

  it("Case 11b - inside CI the origin override does not rescue an unresolvable pair", () => {
    // A guard an environment variable can switch off is not a guard: the override's standing is
    // gated on the CI marker.
    const fx = unsecured("c11b", "0216", "override-in-ci", "881");
    expectNonZero(runCheck(fx, { CI: "true", CREWRIG_SPEC_ID_ORIGIN: "fork" }));
  });

  it("Case 11c - outside CI the override resolves the origin and the run proceeds", () => {
    const fx = unsecured("c11c", "0217", "override-locally", "882");
    const r = runCheck(fx, { CREWRIG_SPEC_ID_ORIGIN: "fork" });
    expectExit0(r);
    assert.match(r.log, /0217/);
  });

  it("Case 11d - a present platform pair outranks the origin override", () => {
    const fx = unsecured("c11d", "0218", "precedence", "883");
    expectNonZero(
      runCheck(fx, {
        CREWRIG_PR_HEAD_REPO: REFERENCE_REPO,
        CREWRIG_PR_BASE_REPO: REFERENCE_REPO,
        CREWRIG_SPEC_ID_ORIGIN: "fork",
      }),
    );
  });
});
