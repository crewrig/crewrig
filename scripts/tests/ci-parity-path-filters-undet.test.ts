// Replaces scripts/tests/test-check-ci-parity.sh (malformed reference paths UX8, passing verdicts
// PF1a-PF4, run-level count). Runs the same matrix as ci-parity-path-filters.test.ts through the
// shared lib/ci-parity-matrix.ts (one harness run per test file, spec 0049 delta-01 R22 bound).

import assert from "node:assert/strict";
import { before, test } from "node:test";

import { needBlock, expectNBlocks } from "./lib/ci-parity-blocks.ts";
import { matrixRun, WANT_DRIFT } from "./lib/ci-parity-matrix.ts";

let err = "";
before(() => {
  const run = matrixRun();
  err = run.stderr;
  assert.equal(run.status, 1, `PF matrix: the mutated tree fails closed\n${run.stderr}`);
});

test("UX8: malformed reference paths are reported and attributed to the reference", () => {
  const b = needBlock(err, "e2e", "not a list", "UX8: malformed reference paths reported");
  assert.ok(b.includes("(reference)"), `UX8: attributed to the reference\n${b}`);
  expectNBlocks(err, "e2e", 0, "UX8: not compared afterwards");
});

const PASSING: ReadonlyArray<readonly [string, string, string]> = [
  ["PF1a", "release", "absent push event vs reference push trigger without paths agrees"],
  ["PF1b", "release-rehearsal", "events declared without a filter vs no reference trigger agree"],
  ["PF2", "release-tests", "reordered, repeated, requoted workflow entries agree (dedicated)"],
  ["PF4", "usage-pricing", "differing branches are not compared (R19)"],
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
