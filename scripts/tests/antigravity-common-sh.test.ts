// antigravity-common-sh.test.ts — install_antigravity_tier_to_home of scripts/lib/common.sh, run by
// sourcing the library (spec 0263 G1-G5 and the Bash 3.2 interpreter claim of
// test-antigravity-component-install.sh). The migration half is antigravity-common-sh-migrate.test.ts.
// Retires with scripts/lib/common.sh (row J4): POSIX-only, the library is Bash.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import { runCommon, scratch, stageAgent, stageSkill } from "./lib/antigravity-fixtures.ts";
import { cleanupAll, SKIP_POSIX } from "./lib/worktree-fixtures.ts";

after(cleanupAll);

/** Run the tier install with `<root>/cli-home/{skills,agents}` as the roots. */
function install(root: string, tier = "library"): ReturnType<typeof runCommon> {
  return runCommon("install_antigravity_tier_to_home", [
    path.join(root, "repo"),
    tier,
    path.join(root, "cli-home", "skills"),
    path.join(root, "cli-home", "agents"),
  ]);
}
const staging = (root: string): string => path.join(root, "repo", "dist", "library", ".agents");

describe("install_antigravity_tier_to_home (sourced)", { skip: SKIP_POSIX }, () => {
  test("runs under the system bash and reports its interpreter", () => {
    const res = spawnSync(fs.existsSync("/bin/bash") ? "/bin/bash" : "bash", [
      "-c",
      'echo "$BASH_VERSION ${BASH_VERSINFO[0]}"',
    ]);
    assert.match(res.stdout.toString(), /^\d+\.\d+\.\d+.* \d+\n$/);
  });

  test("G1: both kinds land at the documented root in directory shape (R1/R2/R3)", () => {
    const root = scratch("agy-g1-");
    stageSkill(staging(root), "alpha-skill");
    stageSkill(staging(root), "beta-skill");
    stageAgent(staging(root), "alpha-agent");
    const res = install(root);
    assert.equal(res.status, 0);
    for (const rel of [
      "skills/alpha-skill/SKILL.md",
      "skills/beta-skill/SKILL.md",
      "agents/alpha-agent/AGENT.md",
    ])
      assert.ok(fs.existsSync(path.join(root, "cli-home", rel)), rel);
    assert.ok(!fs.existsSync(path.join(root, "cli-home", ".gemini", "antigravity-cli")));
    assert.match(res.out, /Installed skill: library\/alpha-skill/);
    assert.match(res.out, /Installed agent: library\/alpha-agent/);
  });

  test("G2: a component absent from the target is not reported as installed (R5)", () => {
    const root = scratch("agy-g2-");
    fs.mkdirSync(path.join(staging(root), "skills", "hollow-skill"), { recursive: true });
    stageSkill(staging(root), "real-skill");
    const res = install(root);
    assert.equal(res.status, 0);
    assert.doesNotMatch(res.out, /Installed skill: library\/hollow-skill/);
    assert.match(res.out, /Installed skill: library\/real-skill/);
  });

  test("G3: staged two, placed one: the shortfall is named and the tier passes (R4)", () => {
    const root = scratch("agy-g3-");
    fs.mkdirSync(path.join(staging(root), "agents", "hollow-agent"), { recursive: true });
    stageAgent(staging(root), "real-agent");
    const res = install(root);
    assert.equal(res.status, 0);
    assert.ok(res.out.includes("staged 0 skill(s) and 2 agent(s)"), res.out);
    assert.ok(res.out.includes("placed 0 and 1 at the install target"), res.out);
    assert.ok(res.out.includes("absent from the install target: agent library/hollow-agent"));
  });

  test("G4: staged some, placed none: non-zero and the discrepancy is stated (R6)", () => {
    const root = scratch("agy-g4-");
    for (const n of ["hollow-one", "hollow-two"])
      fs.mkdirSync(path.join(staging(root), "agents", n), { recursive: true });
    const res = install(root);
    assert.notEqual(res.status, 0);
    assert.ok(res.out.includes("staged 2 agent(s) and placed none"), res.out);
  });

  test("G5: a tier that stages nothing, or is not built, exits 0", () => {
    const empty = scratch("agy-g5a-");
    fs.mkdirSync(path.join(staging(empty), "agents"), { recursive: true });
    assert.equal(install(empty).status, 0);
    const neither = scratch("agy-g5b-");
    fs.mkdirSync(staging(neither), { recursive: true });
    assert.equal(install(neither).status, 0);
    assert.equal(install(scratch("agy-g5c-")).status, 0);
  });
});
