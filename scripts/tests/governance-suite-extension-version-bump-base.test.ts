// governance-suite-extension-version-bump-base.test.ts — Replaces scripts/tests/test-check-extension-version-bump.sh
// (cases 7, 8, 9: issue #1214 base-ref normalisation and trunk fallback). The remote `crewrig`
// points at the repository itself and is fetched BEFORE the bump commit, otherwise an empty
// diff would exit 0 (the false-negative shape). Linux/POSIX in CI; the remote is the plain path.

import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import {
  addSelfRemote,
  commitAll,
  newRepo,
  runIn,
  writeRel,
} from "./lib/governance-git-fixture.ts";
import { render } from "./lib/governance-ext-skill.ts";
import { REPO } from "./lib/governance-sandbox.ts";

const ENTRY = path.join(REPO, "scripts", "check-extension-version-bump.ts");
const SKILL = "extensions/core/skills/example/SKILL.md";

function fixture(trunk: string, headVersion: string): string {
  const dir = newRepo(trunk);
  writeRel(dir, SKILL, render("1.0.0"));
  commitAll(dir, "seed at 1.0.0");
  addSelfRemote(dir);
  writeRel(dir, SKILL, render(headVersion, "Extra line."));
  commitAll(dir, "head");
  return dir;
}

describe("check-extension-version-bump base-ref handling (cases 7, 8, 9)", () => {
  it("Case 7 - trailing-slash BASE_REF is normalized to unset, diff genuinely ran", () => {
    const res = runIn(ENTRY, fixture("main", "1.0.1"), { BASE_REF: "crewrig/" });
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.ok(res.stdout.includes(`OK   ${SKILL}`), res.stdout);
    assert.ok(!res.stdout.includes("no existing extension skill/agent sources modified"));
  });

  it("Case 8 - no main branch falls back to develop, bump recognized", () => {
    const res = runIn(ENTRY, fixture("develop", "1.0.1"));
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.ok(res.stdout.includes(`OK   ${SKILL}`), res.stdout);
  });

  it("Case 9 - develop fallback negative control: missing bump still fails", () => {
    const res = runIn(ENTRY, fixture("develop", "1.0.0"));
    assert.equal(res.status, 1, res.stdout + res.stderr);
    assert.ok(res.stdout.includes(`  FAIL ${SKILL} — version not bumped`));
  });
});
