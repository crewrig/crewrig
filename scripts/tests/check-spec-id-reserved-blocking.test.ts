// check-spec-id-reserved-blocking.test.ts — the blocking check of check-spec-id-reserved.ts (spec 0112 requirement 7)
// Replaces scripts/tests/test-check-spec-id-reserved.sh (Cases 1-9, 6b).
// POSIX-only (skipped on win32 with a stated reason, see lib/spec-id-fixture.ts). Every case runs
// against a local bare repository under one mkdtemp root; the stub gh fails on any call.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import {
  SKIP,
  CLEARED_VARS,
  addSpec,
  addToBase,
  assertRemotesUnderScratch,
  childEnv,
  deleteWorkFile,
  gitIn,
  createRoot,
  newFixture,
  removeRoot,
  renameSpec,
  reserve,
  runCheckSameRepo,
} from "./lib/spec-id-fixture.ts";

let root = "";

describe("check-spec-id-reserved-blocking.test.ts", { skip: SKIP }, () => {
  before(() => {
    root = createRoot();
  });
  after(() => removeRoot(root));

  const ok = (status: number | null, log: string) =>
    assert.equal(status, 0, `expected exit 0, got ${status}\n${log}`);
  const bad = (status: number | null, log: string) =>
    assert.notEqual(status, 0, `expected a non-zero exit, got 0\n${log}`);

  it("helper: the cleared list is the ten-variable set and ambient values do not leak", () => {
    assert.deepEqual([...CLEARED_VARS].sort(), [
      "BASE_REF",
      "CI",
      "CI_MERGE_REQUEST_SOURCE_PROJECT_PATH",
      "CI_MERGE_REQUEST_TARGET_BRANCH_NAME",
      "CI_PROJECT_PATH",
      "CREWRIG_PR_BASE_REPO",
      "CREWRIG_PR_HEAD_REPO",
      "CREWRIG_SPEC_ID_ORIGIN",
      "GITHUB_ACTIONS",
      "GITLAB_CI",
    ]);
    const fx = newFixture(root, "h1");
    const ambient = Object.fromEntries(CLEARED_VARS.map((k) => [k, "leak"]));
    const env = childEnv(fx, { CI: "true" }, { ...ambient, NODE_TEST_CONTEXT: "child-v8" });
    for (const k of CLEARED_VARS) assert.equal(env[k], k === "CI" ? "true" : undefined, k);
    assert.equal(env.NODE_TEST_CONTEXT, undefined);
    assert.equal(env.LC_ALL, "C");
    assert.equal(env.GIT_CONFIG_NOSYSTEM, "1");
  });

  it("helper: the remote guard throws on a remote outside the scratch root", () => {
    const fx = newFixture(root, "h2");
    assertRemotesUnderScratch(fx.work, root);
    gitIn(fx, ["remote", "set-url", "origin", path.join(os.tmpdir(), "outside-the-root.git")]);
    assert.throws(() => assertRemotesUnderScratch(fx.work, root), /escapes the scratch/);
  });

  it("Case 1 - a spec whose id was secured for its own ticket passes", () => {
    const fx = newFixture(root, "c1");
    reserve(fx, "refs/spec-ids/0200", "0200", "800");
    addSpec(fx, "specs/0200-a-thing.md", "0200", "a-thing", "800");
    const r = runCheckSameRepo(fx);
    ok(r.status, r.log);
  });

  it("Case 2 - an unsecured id from the reference repository fails and names file and command", () => {
    const fx = newFixture(root, "c2");
    addSpec(fx, "specs/0201-unsecured.md", "0201", "unsecured", "801");
    const r = runCheckSameRepo(fx);
    bad(r.status, r.log);
    assert.match(r.log, /specs\/0201-unsecured\.md/);
    assert.match(r.log, /reserve-spec-id/);
  });

  it("Case 3 - an id secured by another ticket fails and names both tickets", () => {
    const fx = newFixture(root, "c3");
    reserve(fx, "refs/spec-ids/0202", "0202", "800");
    addSpec(fx, "specs/0202-taken.md", "0202", "taken", "801");
    const r = runCheckSameRepo(fx);
    bad(r.status, r.log);
    assert.match(r.log, /#?800/);
    assert.match(r.log, /#?801/);
  });

  it("Case 4 - one upstream id in both carriers for two tickets fails naming both holders", () => {
    const fx = newFixture(root, "c4");
    reserve(fx, "refs/spec-ids/0203", "0203", "810");
    reserve(fx, "refs/tags/spec-id/0203", "0203", "811");
    addSpec(fx, "specs/0203-two-records.md", "0203", "two-records", "810");
    const r = runCheckSameRepo(fx);
    bad(r.status, r.log);
    assert.match(r.log, /#?810/);
    assert.match(r.log, /#?811/);
  });

  it("Case 5 - an upstream id and an org id whose strings coincide are not a collision", () => {
    // One harness rule: namespace reads use `git ls-remote`, never `for-each-ref`. On git 2.55
    // ls-remote returns refs/spec-ids/org/ORG-0001 for `refs/spec-ids/*` (the `*` crosses `/`)
    // while for-each-ref does not. The org record therefore lives in the SIBLING namespace
    // refs/spec-ids-org, never in a nested refs/spec-ids/org/: a nested one would land inside the
    // upstream read and report a collision that does not exist.
    const fx = newFixture(root, "c5");
    reserve(fx, "refs/spec-ids/0204", "0204", "820");
    reserve(fx, "refs/spec-ids-org/0204", "0204", "821");
    addSpec(fx, "specs/0204-coincidence.md", "0204", "coincidence", "820");
    const r = runCheckSameRepo(fx);
    ok(r.status, r.log);
  });

  it("Case 6 - a spec under specs/org/ does not fail the check", () => {
    const fx = newFixture(root, "c6");
    addSpec(fx, "specs/org/0205-org-owned.md", "0205", "org-owned", "830");
    const r = runCheckSameRepo(fx);
    ok(r.status, r.log);
  });

  it("Case 6b - specs/org/ stays exempt when the sync manifest is unreadable", () => {
    const fx = newFixture(root, "c6b");
    deleteWorkFile(fx, ".crewrig/core-paths.txt");
    addSpec(fx, "specs/org/0213-org-owned.md", "0213", "org-owned", "831");
    assert.equal(fs.existsSync(path.join(fx.work, ".crewrig/core-paths.txt")), false);
    const r = runCheckSameRepo(fx);
    ok(r.status, r.log);
  });

  it("Case 7 - a delta-spec is exempt even with an unsecured id", () => {
    const fx = newFixture(root, "c7");
    addSpec(fx, "specs/0206-parent.delta-01.md", "0206", "parent", "840");
    const r = runCheckSameRepo(fx);
    ok(r.status, r.log);
  });

  it("Case 8 - an unsecured spec already merged on the base is not re-checked", () => {
    const fx = newFixture(root, "c8");
    addToBase(fx, "specs/0100-legacy.md", "0100", "legacy", "700");
    reserve(fx, "refs/spec-ids/0207", "0207", "850");
    addSpec(fx, "specs/0207-new.md", "0207", "new", "850");
    const r = runCheckSameRepo(fx);
    ok(r.status, r.log);
  });

  it("Case 9 - a rename onto an unsecured id fails", () => {
    const fx = newFixture(root, "c9");
    addToBase(fx, "specs/0208-old-slug.md", "0208", "old-slug", "860");
    reserve(fx, "refs/spec-ids/0208", "0208", "860");
    renameSpec(fx, "specs/0208-old-slug.md", "specs/0209-new-id.md", "0209", "new-id", "860");
    const r = runCheckSameRepo(fx);
    bad(r.status, r.log);
  });
});
