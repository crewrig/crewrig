// governance-suite-extension-version-bump.test.ts — Replaces scripts/tests/test-check-extension-version-bump.sh
// (cases 1, 2, 3, 6; cases 4 and 5 stay in governance-check-extension-version-bump.test.ts, cases
// 7-9 are in governance-suite-extension-version-bump-base.test.ts). Spec 0044 R2/R3/R4: each case
// is a throwaway repo (base commit, head commit) checked with `HEAD~1` as the base argument and
// BASE_REF removed from the child env. Platform: git only; Linux/POSIX in CI.

import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { commitAll, newRepo, runIn, writeRel } from "./lib/governance-git-fixture.ts";
import { render } from "./lib/governance-ext-skill.ts";
import { REPO } from "./lib/governance-sandbox.ts";

const ENTRY = path.join(REPO, "scripts", "check-extension-version-bump.ts");
const SKILL = "extensions/core/skills/example/SKILL.md";

function check(base: string, head: string | null) {
  const dir = newRepo();
  if (head === null) {
    writeRel(dir, "README.md", "seed\n");
    commitAll(dir, "seed");
    writeRel(dir, SKILL, base);
  } else {
    writeRel(dir, SKILL, base);
    commitAll(dir, "seed");
    writeRel(dir, SKILL, head);
  }
  commitAll(dir, "head");
  return runIn(ENTRY, dir, {}, ["HEAD~1"]);
}

describe("check-extension-version-bump (cases 1, 2, 3, 6)", () => {
  it("Case 1 - new component (status A) requires no bump", () => {
    const res = check(render("1.0.0"), null);
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /OK: no existing extension skill\/agent sources modified vs HEAD~1\./);
  });

  it("Case 2 - modified without bump fails", () => {
    const res = check(render("1.0.0"), render("1.0.0", "Extra line."));
    assert.equal(res.status, 1, res.stdout + res.stderr);
    assert.ok(res.stdout.includes(`  FAIL ${SKILL} — version not bumped (still '1.0.0')`));
  });

  it("Case 3 - modified with bump passes", () => {
    const res = check(render("1.0.0"), render("1.0.1", "Extra line."));
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.ok(res.stdout.includes(`  OK   ${SKILL} (1.0.0 → 1.0.1)`));
  });

  it("Case 6 - NEW carrier with empty version fails", () => {
    const res = check(render("1.0.0"), render(""));
    assert.equal(res.status, 1, res.stdout + res.stderr);
    assert.ok(res.stdout.includes(`  FAIL ${SKILL} — no (or empty) crewrig-provenance version`));
  });
});
