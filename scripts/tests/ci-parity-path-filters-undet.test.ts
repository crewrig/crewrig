// Replaces scripts/tests/test-check-ci-parity.sh (undeterminable filters UX1-UX9, passing verdicts
// PF1a-PF5, run-level count). Runs the same matrix as ci-parity-path-filters.test.ts through the
// shared lib/ci-parity-matrix.ts (one harness run per test file, spec 0049 delta-01 R22 bound).
// UX9 asserts a diagnostic fragment of the twin (the js-yaml message), not of `yq`.

import assert from "node:assert/strict";
import { before, test } from "node:test";

import { expectUndet, needBlock, expectNBlocks } from "./lib/ci-parity-blocks.ts";
import { matrixRun, WANT_DRIFT } from "./lib/ci-parity-matrix.ts";

let err = "";
before(() => {
  const run = matrixRun();
  err = run.stderr;
  assert.equal(run.status, 1, `PF matrix: the mutated tree fails closed\n${run.stderr}`);
});

const UNDET: ReadonlyArray<readonly [string, string, string]> = [
  ["UX1", "setup", "carries 2 path-filter steps"],
  ["UX2", "check-agent-profiles", "2 named filters"],
  ["UX3", "check-metadata-keys", "defines only the filter 'other-name'"],
  ["UX4", "check-claude-agent-layout", "not a list of strings"],
  ["UX5", "core-paths", "not a list of strings"],
  ["UX6", "extension-provenance", "not a mapping of named lists"],
  ["UX7", "usage-record-schema", "also declares paths under 'pull_request'"],
  ["UX9", "test-wiring", "filters text is not valid YAML"],
];
for (const [label, cap, cause] of UNDET) {
  test(`${label}: ${cap} filter cannot be determined (R17)`, () => {
    expectUndet(err, cap, cause, label);
  });
}

test("UX8: malformed reference paths are reported and attributed to the reference", () => {
  const b = needBlock(err, "e2e", "not a list", "UX8: malformed reference paths reported");
  assert.ok(b.includes("(reference)"), `UX8: attributed to the reference\n${b}`);
  expectNBlocks(err, "e2e", 0, "UX8: not compared afterwards");
});

const PASSING: ReadonlyArray<readonly [string, string, string]> = [
  ["PF1a", "release", "absent push event vs reference push trigger without paths agrees"],
  ["PF1b", "release-rehearsal", "events declared without a filter vs no reference trigger agree"],
  ["PF2", "release-tests", "reordered, repeated, requoted workflow entries agree (dedicated)"],
  ["PF3", "extension-install", "reordered, repeated, requoted filter entries agree (in-job)"],
  ["PF4", "usage-pricing", "differing branches are not compared (R19)"],
  ["PF5", "ci-parity", "in-job filter vs a capability with no push trigger agrees (s2-F1)"],
];
for (const [label, cap, what] of PASSING) {
  test(`${label}: ${what}`, () => {
    assert.ok(
      !err.includes(`capability '${cap}' `),
      `${label}: '${cap}' must print nothing\n${err}`,
    );
  });
}

test("PF matrix: exactly the expected failures, every DRIFT block counted", () => {
  assert.ok(
    err.includes(`FAILED: ${WANT_DRIFT} CI parity violation(s)`),
    `exactly the ${WANT_DRIFT} expected failures, no other\n${err}`,
  );
  const drift = err.split("\n").filter((l) => l.startsWith("  DRIFT: ")).length;
  assert.equal(
    drift,
    WANT_DRIFT,
    `${WANT_DRIFT} DRIFT blocks printed (pass rows printed none)\n${err}`,
  );
});
