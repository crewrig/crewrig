// Replaces scripts/tests/test-build-ci.sh (group S, cases M and N: write atomicity and manual
// trigger rules; G-L and the hunk proof live in build-ci-synthetic.test.ts).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  MANUAL_REFERENCE,
  newRoot,
  runBuildCi,
  UNKNOWN_TOOL_REFERENCE,
  VALID_REFERENCE,
} from "./lib/ci-reference-fixtures.ts";

describe("build-ci synthetic write and manual rules (cases M, N)", () => {
  it("M0-M3: a rejected capability leaves the existing file byte-identical and no temp file", () => {
    const root = newRoot(VALID_REFERENCE);
    const out = path.join(root, ".gitlab-ci.yml");
    assert.equal(runBuildCi(root).status, 0, "M0 initial valid generation succeeds");
    const initial = fs.readFileSync(out);
    fs.writeFileSync(path.join(root, "ci", "ci-capabilities.yml"), UNKNOWN_TOOL_REFERENCE);
    assert.equal(runBuildCi(root).status, 1, "M1 generation fails on invalid capability");
    assert.ok(fs.readFileSync(out).equals(initial), "M2 byte-identical after failure");
    const left = fs.readdirSync(root).filter((n) => n.startsWith(".gitlab-ci.yml.tmp."));
    assert.deepEqual(left, [], "M3 temporary files cleaned up on failure");
  });

  it("N0-N3: manual capability jobs emit valid rule syntax without an empty if", () => {
    const root = newRoot(MANUAL_REFERENCE);
    const res = runBuildCi(root);
    assert.equal(res.status, 0, "N0 manual capability generation succeeds");
    assert.equal(res.stderr, "");
    const out = fs.readFileSync(path.join(root, ".gitlab-ci.yml"), "utf8");
    assert.ok(out.includes("- when: manual"), "N1 manual trigger without condition");
    assert.ok(out.includes("CI_COMMIT_BRANCH =~ /^main$/"), "N2 branch condition retained");
    assert.doesNotMatch(out, /if: *['"]{2}/, "N3 no empty if expressions");
  });
});
