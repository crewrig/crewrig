// Replaces scripts/tests/test-check-ci-parity.sh (GitHub path filters FX1-FX17, spec 0049 delta-01
// R12-R18). One shared run of the mutated GHA-only matrix (lib/ci-parity-matrix.ts); expected lists
// of FX12/FX13/FX14/FX17 are derived from the REAL reference, never hard-coded.

import assert from "node:assert/strict";
import { before, test } from "node:test";

import { expectNBlocks, expectSide, needBlock } from "./lib/ci-parity-blocks.ts";
import { matrixRun } from "./lib/ci-parity-matrix.ts";
import { refPaths } from "./lib/ci-parity-fixture.ts";

let err = "";
before(() => {
  const run = matrixRun();
  err = run.stderr;
  assert.equal(run.status, 1, `PF matrix: the mutated tree fails closed\n${run.stderr}`);
});

const block = (cap: string, frag: string, label: string) => needBlock(err, cap, frag, label);
const nb = (cap: string, n: number, label: string) => expectNBlocks(err, cap, n, label);
const has = (b: string, s: string, label: string) =>
  assert.ok(b.includes(s), `${label}: '${s}'\n${b}`);

test("FX3: dedicated pull_request gains an entry the workflow lacks", () => {
  const b = block(
    "usage-storage",
    "event 'pull_request'",
    "FX3: dedicated workflow, pull_request block",
  );
  has(b, "reference trigger 'pull-request'", "FX3: names the reference trigger compared");
  expectSide(b, "ref", "FX3: reference-only entry", ["zz/d/**"]);
  expectSide(b, "gh", "FX3: GitHub-only list is empty", []);
  nb("usage-storage", 1, "FX3: event-specific, no block for push");
});

test("FX4: dedicated push gains an entry the reference lacks", () => {
  const b = block("usage-capture", "event 'push'", "FX4: dedicated workflow, push block");
  has(b, "reference trigger 'push'", "FX4: names the reference trigger compared");
  expectSide(b, "gh", "FX4: GitHub-only entry", ["zz/e/**"]);
  expectSide(b, "ref", "FX4: reference-only list is empty", []);
  nb("usage-capture", 1, "FX4: event-specific, no block for pull_request");
});

test("FX6: a different spelling of the same glob (dedicated, R13)", () => {
  const b = block(
    "release-notes",
    "event 'pull_request'",
    "FX6: dedicated workflow, pull_request block",
  );
  expectSide(b, "ref", "FX6: reference-only spelling", ["scripts/lib/release-notes/**"]);
  expectSide(b, "gh", "FX6: GitHub-only spelling", ["scripts/lib/release-notes/**/*"]);
  nb("release-notes", 1, "FX6: push is unchanged, no block for it");
});

test("FX8: negated entry in a dedicated workflow is reported (R16)", () => {
  const b = block("usage-attribution", "negated entries", "FX8: dedicated negation reported");
  has(b, "event 'pull_request'", "FX8: names the event");
  has(b, "- !zz/neg/**", "FX8: names the negated entry");
  nb(
    "usage-attribution",
    0,
    "FX8: the rest of the event is still compared (equal, one defect = one message)",
  );
});

test("FX9: paths-ignore in a dedicated workflow is reported (R16)", () => {
  const b = block("usage-dashboard", "declares paths-ignore", "FX9: paths-ignore reported");
  has(b, "event 'push'", "FX9: names the event");
  has(b, "- docs/**", "FX9: names the ignored entry");
  nb("usage-dashboard", 0, "FX9: no set divergence besides the exclusion");
});

test("FX13: filtered reference vs deleted filter step", () => {
  const pr = block(
    "check-description-length",
    "event 'pull_request'",
    "FX13: filtered reference vs unfiltered job (pull_request)",
  );
  expectSide(
    pr,
    "ref",
    "FX13: pull_request block lists the reference paths",
    refPaths("check-description-length", "pull-request"),
  );
  expectSide(pr, "gh", "FX13: pull_request block GitHub-only list is empty", []);
  const push = block(
    "check-description-length",
    "event 'push'",
    "FX13: filtered reference vs unfiltered job (push)",
  );
  expectSide(
    push,
    "ref",
    "FX13: push block lists the reference paths",
    refPaths("check-description-length", "push"),
  );
});

test("FX14: unfiltered reference vs filtered workflow", () => {
  const pr = block(
    "windows-hook-probe",
    "event 'pull_request'",
    "FX14: unfiltered reference vs filtered workflow (pull_request)",
  );
  expectSide(
    pr,
    "gh",
    "FX14: pull_request block lists the workflow paths",
    refPaths("windows-hook-probe", "pull-request"),
  );
  expectSide(pr, "ref", "FX14: pull_request block reference-only list is empty", []);
  block(
    "windows-hook-probe",
    "event 'push'",
    "FX14: unfiltered reference vs filtered workflow (push)",
  );
  nb("windows-hook-probe", 2, "FX14: one block per event");
});

test("FX15: workflow filters push, the reference has no push trigger", () => {
  const b = block(
    "grep-anti-patterns",
    "event 'push'",
    "FX15: workflow filters push, reference has no push trigger",
  );
  has(b, "no reference 'push' trigger", "FX15: says the reference has no push trigger");
  expectSide(b, "gh", "FX15: GitHub-only entry", ["zz/f/**"]);
  expectSide(b, "ref", "FX15: reference-only list is empty", []);
  nb("grep-anti-patterns", 1, "FX15: pull_request agrees");
});

test("FX16: reference push trigger with paths, workflow without push", () => {
  const b = block(
    "audit",
    "event 'push'",
    "FX16: reference push trigger with paths, workflow without push",
  );
  has(b, "reference trigger 'push'", "FX16: names the reference trigger");
  expectSide(b, "ref", "FX16: reference-only entry", ["zz/g/**"]);
  expectSide(b, "gh", "FX16: GitHub-only list is empty", []);
  nb("audit", 1, "FX16: pull_request agrees");
});

test("DF1: a dorny/paths-filter step re-added to a job is rejected (spec 0285 R4)", () => {
  const b = block("figure-labels", "dorny/paths-filter step", "DF1: dorny step reported");
  has(b, "job 'figure-labels'", "DF1: names the job");
  nb("figure-labels", 0, "DF1: the capability is compared no further (no set divergence)");
});
