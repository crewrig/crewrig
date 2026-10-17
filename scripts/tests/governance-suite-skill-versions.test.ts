// governance-suite-skill-versions.test.ts — Replaces scripts/tests/test-check-skill-versions.sh
// (cases 4-7; cases 1-3 stay in governance-check-skill-versions.test.ts, cases 8-10 live in
// governance-suite-skill-versions-base.test.ts). Case 4 fetches AFTER both commits as the Bash
// suite did, so the base is the bumped HEAD itself and the pass is trivial: the exact OK line
// pins the derived ref name. Linux/POSIX in CI; the remote is the plain repository path.

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
import { renderCommand, renderSkill } from "./lib/governance-skill-fixture.ts";

const ENTRY = path.join(REPO, "scripts", "check-skill-versions.ts");
const SKILL = "artifacts/core/skills/old-skill/SKILL.md";
const NEW_CMD = "artifacts/core/commands/new-cmd.md";
const OLD_CMD = "artifacts/core/commands/old-cmd.md";
const out = (r: { stdout: string; stderr: string }): string => r.stdout + r.stderr;

/** A repo seeded with `seedFile`, then a head commit writing `headContent`; checked against HEAD~1. */
function twoCommits(seedFile: string, seed: string, headFile: string, head: string): string {
  const dir = newRepo();
  writeRel(dir, seedFile, seed);
  commitAll(dir, "seed");
  writeRel(dir, headFile, head);
  commitAll(dir, "head");
  return dir;
}

describe("check-skill-versions (cases 4-7)", () => {
  it("Case 4 - remote probing finds crewrig (no origin) and pins the derived ref", () => {
    const dir = twoCommits(SKILL, renderSkill("1.0.0"), SKILL, renderSkill("1.0.1", "Extra line."));
    addSelfRemote(dir);
    const res = runIn(ENTRY, dir);
    assert.equal(res.status, 0, out(res));
    assert.equal(res.stdout, "OK: no existing component sources modified vs crewrig/main.\n");
  });

  it("Case 5 - new command (status A) requires no bump", () => {
    const dir = twoCommits("README.md", "seed\n", NEW_CMD, renderCommand("1.0.0"));
    const res = runIn(ENTRY, dir, {}, ["HEAD~1"]);
    assert.equal(res.status, 0, out(res));
  });

  it("Case 6 - modified command without bump fails", () => {
    const dir = twoCommits(
      OLD_CMD,
      renderCommand("1.0.0"),
      OLD_CMD,
      renderCommand("1.0.0", "Extra line."),
    );
    const res = runIn(ENTRY, dir, {}, ["HEAD~1"]);
    assert.equal(res.status, 1, out(res));
    assert.ok(res.stdout.includes(`FAIL ${OLD_CMD}`), out(res));
  });

  it("Case 7 - modified command with bump passes", () => {
    const dir = twoCommits(
      OLD_CMD,
      renderCommand("1.0.0"),
      OLD_CMD,
      renderCommand("1.0.1", "Extra line."),
    );
    const res = runIn(ENTRY, dir, {}, ["HEAD~1"]);
    assert.equal(res.status, 0, out(res));
    assert.ok(res.stdout.includes(`OK   ${OLD_CMD}`), out(res));
  });
});
