// Spec 0285 R1/R2: the ratchet over the three engine-specific CI surfaces and the committed
// shrink report. The total may only go down: a PR that grows a surface past the pin updates it
// deliberately, with the reason in its body.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SURFACES = [".github/workflows/build.yml", "ci/ci-capabilities.yml", ".gitlab-ci.yml"];
const FLOOR = 8880; // spec 0280 R10, not lowered
const PIN = 8631; // the achieved total, set when the report is finalized
const COMMENT_LIMIT = 322; // spec 0285 R2: half of the 644 comment lines of a67ca65e

const lines = (rel: string): string[] => {
  const text = fs.readFileSync(path.join(REPO, rel), "utf8");
  return text.split("\n").slice(0, text.endsWith("\n") ? -1 : undefined);
};

test("R1: the total of the three CI surfaces stays at or under the pin and the floor", () => {
  const total = SURFACES.reduce((sum, rel) => sum + lines(rel).length, 0);
  assert.ok(PIN <= FLOOR, `the pin ${PIN} must not exceed the floor ${FLOOR}`);
  assert.ok(total <= PIN, `the three surfaces total ${total} lines, above the pin ${PIN}`);
});

test("R2: the capability reference keeps at most 322 comment lines", () => {
  const comments = lines("ci/ci-capabilities.yml").filter((l) => /^\s*#/.test(l)).length;
  assert.ok(comments <= COMMENT_LIMIT, `${comments} comment lines, limit ${COMMENT_LIMIT}`);
});

test("R1: the committed report lists every surface", () => {
  const report = fs.readFileSync(path.join(REPO, "docs/ci-shrink-report.md"), "utf8");
  for (const rel of [
    ...SURFACES,
    "taskfiles/ci.yml",
    "scripts/lib/build-ci",
    "scripts/lib/ci-parity",
  ]) {
    assert.ok(report.includes(rel), `docs/ci-shrink-report.md does not list ${rel}`);
  }
});
