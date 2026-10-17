// governance-suite-skill-versions-base.test.ts — Replaces scripts/tests/test-check-skill-versions.sh
// (cases 8, 9, 10: issue #1214 base-ref normalisation and trunk fallback). The remote `crewrig`
// points at the repository itself and is fetched BEFORE the bump commit, otherwise an empty diff
// would exit 0 (the false-negative shape). BASE_REF is deleted from the child env (never set to
// an empty string) except in case 8. Linux/POSIX in CI; the remote is the plain path.

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
import { REPO } from "./lib/governance-sandbox.ts";
import { renderSkill } from "./lib/governance-skill-fixture.ts";

const ENTRY = path.join(REPO, "scripts", "check-skill-versions.ts");
const SKILL = "artifacts/core/skills/old-skill/SKILL.md";
const out = (r: { stdout: string; stderr: string }): string => r.stdout + r.stderr;

function fixture(trunk: string, headVersion: string): string {
  const dir = newRepo(trunk);
  writeRel(dir, SKILL, renderSkill("1.0.0"));
  commitAll(dir, "seed old-skill at 1.0.0");
  addSelfRemote(dir);
  writeRel(dir, SKILL, renderSkill(headVersion, "Extra line."));
  commitAll(dir, "head");
  return dir;
}

describe("check-skill-versions base-ref handling (cases 8, 9, 10)", () => {
  it("Case 8 - trailing-slash BASE_REF is normalized to unset, diff genuinely ran", () => {
    const res = runIn(ENTRY, fixture("main", "1.0.1"), { BASE_REF: "crewrig/" });
    assert.equal(res.status, 0, out(res));
    assert.ok(res.stdout.includes(`OK   ${SKILL}`), out(res));
    assert.ok(!out(res).includes("no existing component sources modified"), out(res));
  });

  it("Case 9 - no main branch falls back to develop, bump recognized", () => {
    const res = runIn(ENTRY, fixture("develop", "1.0.1"));
    assert.equal(res.status, 0, out(res));
  });

  it("Case 10 - develop fallback negative control: missing bump still fails", () => {
    const res = runIn(ENTRY, fixture("develop", "1.0.0"));
    assert.equal(res.status, 1, out(res));
  });
});
