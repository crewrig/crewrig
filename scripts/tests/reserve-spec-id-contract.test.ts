// reserve-spec-id-contract.test.ts — exit contract, allocated set, maintainer mode and the
// requirement-12 refusals of scripts/reserve-spec-id.ts: Cases 1-6, 11-17 and 24-27.
// Replaces scripts/tests/test-reserve-spec-id.sh (this half).
//
// What CI proves about the tool: only that this suite ran. The tool is run by a human or by
// `spec-author` at pickup time, so no pipeline exercises it; a green node:test job says the suite
// executed. Namespace reads use `git ls-remote` (see lib/reserve-spec-id-fixture.ts header): its
// `*` crosses `/`, which is what makes Case 14 meaningful.
//
// Stderr assertions match the IDENTIFYING content a caller must act on (offending value, missing
// flag, command to run), never the sentence around it.

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import {
  assertRemotesUnderScratch,
  git,
  makeReservation,
  makeRoot,
  newFixture,
  POSIX_ONLY,
  remoteCount,
  removeRoot,
  reservationMessage,
  runTool,
  serverRefs,
  setCarrier,
  useAbsentRemote,
  writeCarrierRaw,
} from "./lib/reserve-spec-id-fixture.ts";
import type { Fixture } from "./lib/reserve-spec-id-fixture.ts";

const root = makeRoot();
after(() => removeRoot(root));

const RESERVATION_REFS = /^refs\/(spec-ids|tags\/spec-id)/;
const lines = (out: string): string[] => out.replace(/\n$/, "").split("\n");
const nothingPushed = (fx: Fixture, re: RegExp): void =>
  assert.deepEqual(
    serverRefs(fx).filter((r) => re.test(r)),
    [],
  );

describe("reserve-spec-id contract", { skip: POSIX_ONLY }, () => {
  it("guard: a remote outside the scratch root makes assertRemotesUnderScratch throw", () => {
    const fx = newFixture(root, "guard", ["specs/0001-a.md"]);
    git(fx.work, ["remote", "set-url", "origin", "/nonexistent-outside-scratch/x.git"], {
      HOME: fx.home,
    });
    assert.throws(() => assertRemotesUnderScratch(fx.work, fx.root), /escapes the scratch/);
  });

  it("Case 1 — allocation on a clean remote exits 0 and prints the id", () => {
    const fx = newFixture(root, "c1", ["specs/0001-a.md", "specs/0002-b.md", "specs/0003-c.md"]);
    const r = runTool(fx, ["--issue", "900"]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), "0004");
    assert.equal(remoteCount(fx, "refs/spec-ids/*"), 1);
    assert.equal(reservationMessage(fx, "refs/spec-ids/0004"), "reserve 0004 for issue #900");
  });

  it("Case 2 — --offline exits 3 with the two-line payload and the remediation, pushes nothing", () => {
    const fx = newFixture(root, "c2", ["specs/0001-a.md"]);
    const r = runTool(fx, ["--issue", "901", "--offline"]);
    assert.equal(r.status, 3);
    assert.equal(lines(r.stdout)[0], "0002");
    assert.equal(lines(r.stdout)[1], "unsecured-id: true");
    assert.match(r.stderr, /[-][-]offline/);
    // J4: the twin still prints the shell command name; change together with the shim.
    assert.match(r.stderr, /reserve-spec-id[.]sh --id 0002/);
    nothingPushed(fx, RESERVATION_REFS);
  });

  it("Case 3 — an unreachable remote is exit 3 with the id and the marker", () => {
    const fx = newFixture(root, "c3", ["specs/0001-a.md"]);
    useAbsentRemote(fx);
    const r = runTool(fx, ["--issue", "902"]);
    assert.equal(r.status, 3);
    assert.equal(lines(r.stdout)[0], "0002");
    assert.equal(lines(r.stdout)[1], "unsecured-id: true");
  });

  it("Case 4 — a carrier outside the closed pair exits 1 before any push", () => {
    const fx = newFixture(root, "c4", ["specs/0001-a.md"]);
    setCarrier(fx, "refs/spec-id/");
    const r = runTool(fx, ["--issue", "903"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /refs\/spec-id\//);
    nothingPushed(fx, /^refs\/spec-id/);
    assert.equal(r.stdout, "");
  });

  it("Case 5 — allocation unions both upstream carriers and excludes the org namespace", () => {
    const fx = newFixture(
      root,
      "c5",
      ["a", "b", "c", "d", "e"].map((s, i) => `specs/000${i + 1}-${s}.md`),
    );
    makeReservation(fx, "refs/spec-ids/0006", "0006", 700);
    makeReservation(fx, "refs/tags/spec-id/0007", "0007", 701);
    makeReservation(fx, "refs/spec-ids-org/0008", "0008", 702);
    const r = runTool(fx, ["--issue", "904"]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), "0008");
  });

  it("Case 6 — a merged specs/org/ spec consumes no upstream id", () => {
    const fx = newFixture(root, "c6", [
      "specs/0001-a.md",
      "specs/0002-b.md",
      "specs/0003-c.md",
      "specs/org/0004-org-thing.md",
    ]);
    assert.equal(runTool(fx, ["--issue", "905"]).stdout.trim(), "0004");
  });

  it("Case 11 — --id/--issue secures the named identifier", () => {
    const fx = newFixture(root, "c11", ["specs/0001-a.md"]);
    const r = runTool(fx, ["--id", "0700", "--issue", "950"]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(reservationMessage(fx, "refs/spec-ids/0700"), "reserve 0700 for issue #950");
  });

  it("Case 12 — an org identifier of an unseen form is secured once", () => {
    const fx = newFixture(root, "c12", ["specs/0001-a.md"]);
    const first = runTool(fx, ["--corpus", "org", "--id", "RFC_2026_07", "--issue", "960"]);
    assert.equal(first.status, 0, first.stderr);
    assert.equal(remoteCount(fx, "refs/spec-ids-org/*"), 1);
    assert.equal(remoteCount(fx, "refs/spec-ids/*"), 0);
    const second = runTool(fx, ["--corpus", "org", "--id", "RFC_2026_07", "--issue", "961"]);
    assert.notEqual(second.status, 0);
    assert.match(second.stderr, /#960/);
    assert.equal(
      reservationMessage(fx, "refs/spec-ids-org/RFC_2026_07"),
      "reserve RFC_2026_07 for issue #960",
    );
  });

  it("Case 13/14 — the same id in two namespaces is no collision; reads stay separate", () => {
    const fx = newFixture(root, "c13", ["specs/0001-a.md"]);
    assert.equal(runTool(fx, ["--id", "0042", "--issue", "970"]).status, 0);
    assert.equal(runTool(fx, ["--corpus", "org", "--id", "0042", "--issue", "971"]).status, 0);
    // ls-remote, NOT for-each-ref: a nested refs/spec-ids/org/<ID> would make this 2.
    assert.equal(remoteCount(fx, "refs/spec-ids/*"), 1);
    assert.equal(remoteCount(fx, "refs/spec-ids-org/*"), 1);
  });

  it("Case 15 — --corpus org without --id exits 1 and names the flag", () => {
    const fx = newFixture(root, "c15", ["specs/0001-a.md"]);
    const r = runTool(fx, ["--corpus", "org", "--issue", "980"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /[-][-]id/);
    nothingPushed(fx, RESERVATION_REFS);
  });

  it("Case 16 — an identifier containing a space exits 1 before any push", () => {
    const fx = newFixture(root, "c16", ["specs/0001-a.md"]);
    const r = runTool(fx, ["--corpus", "org", "--id", "ORG 0001", "--issue", "981"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /ORG 0001/);
    nothingPushed(fx, RESERVATION_REFS);
  });

  it("Case 17 — an identifier ending in .lock exits 1 before any push", () => {
    const fx = newFixture(root, "c17", ["specs/0001-a.md"]);
    const r = runTool(fx, ["--corpus", "org", "--id", "ORG-0001.lock", "--issue", "982"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /ORG-0001[.]lock/);
    nothingPushed(fx, RESERVATION_REFS);
  });

  it("Case 24 — a missing --issue exits 1 and names the flag", () => {
    const r = runTool(newFixture(root, "c24", ["specs/0001-a.md"]), []);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /[-][-]issue/);
  });

  it("Case 25 — an unknown argument exits 1 and names the token", () => {
    const r = runTool(newFixture(root, "c25", ["specs/0001-a.md"]), ["--isue", "900"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /[-][-]isue/);
  });

  it("Case 26 — a non-integer --issue exits 1 and names the value", () => {
    const r = runTool(newFixture(root, "c26", ["specs/0001-a.md"]), ["--issue", "not-a-number"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /not-a-number/);
  });

  it("Case 27 — a carrier file naming no namespace exits 1 and names the file", () => {
    const fx = newFixture(root, "c27", ["specs/0001-a.md"]);
    writeCarrierRaw(fx, "# every line commented out\n# carrier=refs/tags/spec-id/\n");
    const r = runTool(fx, ["--issue", "900"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /spec-id-carrier/);
  });
});
