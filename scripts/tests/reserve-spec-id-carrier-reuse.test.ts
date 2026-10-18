// reserve-spec-id-carrier-reuse.test.ts — the carrier setting (Cases 18-23) and per-issue
// reservation reuse (Cases 28-31) of scripts/reserve-spec-id.ts.
// Replaces scripts/tests/test-reserve-spec-id.sh (this half).

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import {
  dropCarrier,
  git,
  makeRoot,
  newFixture,
  POSIX_ONLY,
  remoteCount,
  removeRoot,
  runTool,
  serverRefs,
  setCarrier,
  useSingleRemote,
} from "./lib/reserve-spec-id-fixture.ts";

const root = makeRoot();
after(() => removeRoot(root));

const SPEC1 = ["specs/0001-a.md"];

describe("reserve-spec-id carrier and reuse", { skip: POSIX_ONLY }, () => {
  it("Case 18 — the tag carrier secures an id", () => {
    const fx = newFixture(root, "c18", SPEC1);
    setCarrier(fx, "refs/tags/spec-id/");
    assert.equal(runTool(fx, ["--issue", "990"]).status, 0);
    assert.equal(remoteCount(fx, "refs/tags/spec-id/*"), 1);
    assert.equal(remoteCount(fx, "refs/spec-ids/*"), 0);
  });

  it("Case 19 — an org reservation under the tag carrier is a sibling namespace", () => {
    const fx = newFixture(root, "c19", SPEC1);
    setCarrier(fx, "refs/tags/spec-id/");
    assert.equal(runTool(fx, ["--corpus", "org", "--id", "ORG-0009", "--issue", "991"]).status, 0);
    assert.equal(remoteCount(fx, "refs/tags/spec-id-org/*"), 1);
    assert.equal(remoteCount(fx, "refs/tags/spec-id/*"), 0);
  });

  it("Case 20 — an absent carrier file falls back to the shipped namespace", () => {
    const fx = newFixture(root, "c20", SPEC1);
    dropCarrier(fx);
    assert.equal(runTool(fx, ["--issue", "992"]).status, 0);
    assert.equal(remoteCount(fx, "refs/spec-ids/*"), 1);
  });

  it("Case 21 — a hidden namespace degrades to exit 3 with no carrier switch", () => {
    const fx = newFixture(root, "c21", SPEC1);
    // hideRefs blinds ls-remote: only serverRefs (unfiltered) can prove nothing was pushed.
    git(fx.bare, ["config", "transfer.hideRefs", "refs/spec-ids"], { HOME: fx.home });
    const r = runTool(fx, ["--issue", "993"]);
    assert.equal(r.status, 3);
    assert.equal(r.stdout.replace(/\n$/, "").split("\n")[1], "unsecured-id: true");
    assert.deepEqual(
      serverRefs(fx).filter((x) => /^refs\/tags\/spec-id/.test(x)),
      [],
    );
    assert.deepEqual(
      serverRefs(fx).filter((x) => /^refs\/(spec-ids|spec-ids-org|tags\/spec-id)/.test(x)),
      [],
    );
  });

  it("Case 22 — an invalid CREWRIG_SPEC_ID_CARRIER override is validated like the file", () => {
    const fx = newFixture(root, "c22", SPEC1);
    const r = runTool(fx, ["--issue", "994"], {
      env: { CREWRIG_SPEC_ID_CARRIER: "refs/spec-id/" },
    });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /refs\/spec-id\//);
    assert.deepEqual(
      serverRefs(fx).filter((x) => /^refs\/spec-id/.test(x)),
      [],
    );
  });

  it("Case 23 — a remote named neither crewrig nor origin still secures an id", () => {
    const fx = newFixture(root, "c23", SPEC1);
    useSingleRemote(fx, "upstream");
    assert.equal(runTool(fx, ["--issue", "995"]).status, 0);
    assert.equal(remoteCount(fx, "refs/spec-ids/*"), 1);
  });

  it("Case 28 — an --issue-only call reuses an id pre-secured with --id", () => {
    const fx = newFixture(root, "c28", SPEC1);
    assert.equal(runTool(fx, ["--id", "0500", "--issue", "970"]).status, 0);
    const r = runTool(fx, ["--issue", "970"]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), "0500");
    assert.equal(remoteCount(fx, "refs/spec-ids/*"), 1);
  });

  it("Case 29 — an idempotent retry returns the same id and no orphan", () => {
    const fx = newFixture(root, "c29", SPEC1);
    const first = runTool(fx, ["--issue", "971"]).stdout.trim();
    const r = runTool(fx, ["--issue", "971"]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), first);
    assert.equal(remoteCount(fx, "refs/spec-ids/*"), 1);
  });

  it("Case 30 — the reuse check reads both carriers", () => {
    const fx = newFixture(root, "c30", SPEC1);
    setCarrier(fx, "refs/tags/spec-id/");
    assert.equal(runTool(fx, ["--id", "0500", "--issue", "972"]).status, 0);
    dropCarrier(fx);
    const r = runTool(fx, ["--issue", "972"], {
      env: { CREWRIG_SPEC_ID_CARRIER: "refs/spec-ids/" },
    });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), "0500");
    assert.deepEqual(
      serverRefs(fx).filter((x) => x.includes("refs/spec-ids/0500")),
      [],
    );
  });

  it("Case 31 — an unrelated issue gets a freshly computed next id", () => {
    const fx = newFixture(root, "c31", ["specs/0001-a.md", "specs/0002-b.md", "specs/0003-c.md"]);
    runTool(fx, ["--issue", "973"]);
    const r = runTool(fx, ["--issue", "974"]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), "0005");
    assert.equal(remoteCount(fx, "refs/spec-ids/*"), 2);
  });
});
