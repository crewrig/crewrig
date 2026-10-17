// Spec 0119 requirements 12, 13, 15, 17 on the real build and shims (ported from
// test-component-tier-resolution.sh cases 6-11, 13b, 13c; spec 0263 groups G10-G17).
// Case 13d (G18) retires against component-overlay.test.ts L131 plus
// tier-resolution-three-tiers.test.ts. Retires with scripts/lib/common.sh (row J4):
// POSIX-only, the shims run under bash.

import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, test } from "node:test";
import { reportCollision } from "../lib/component-resolve.ts";
import { reportUnresolved } from "../lib/component-roots.ts";
import {
  CLAUDE_CMD,
  COLLISION_REPORT_RE,
  GEMINI_CMD,
  UNRESOLVED_REPORT_RE,
  both,
  build,
  newRepo,
  run,
  seedCommand,
  seedPolicy,
  seedSkill,
} from "./lib/tier-fixtures.ts";

const skip = process.platform === "win32" ? "the shims are Bash scripts" : false;
const TIER_BANNER = /^--- Tier:/m;

describe("tier resolution: collisions", { skip }, () => {
  test("G10 the build refuses two overlay tiers claiming one installed target", () => {
    const t = newRepo();
    seedSkill(t, "library", "acme-review");
    seedSkill(t, "org", "acme-review");
    const o = build(t, "all");
    assert.notEqual(o.status, 0, "the build accepted the collision");
    assert.doesNotMatch(o.stdout, TIER_BANNER, "the build entered its tier loop");
    for (const s of ["acme-review", "library", "org"]) assert.ok(both(o).includes(s), s);
  });

  test("G11 GUARD: core and org sharing a name across differing landing zones is accepted", () => {
    const t = newRepo();
    seedSkill(t, "core", "developer");
    seedSkill(t, "org", "developer");
    const o = build(t, "all");
    assert.equal(o.status, 0, both(o));
    // Discrimination: the two copies must land in different roots.
    assert.ok(t.exists(".claude/skills/developer/SKILL.md"), "core did not route to the project");
    assert.ok(t.exists("dist/org/.claude/skills/developer/SKILL.md"), "org did not route to dist");
  });

  test("G12 a command and a skill sharing one installed name collide", () => {
    const t = newRepo();
    seedCommand(t, "library", "acme-review");
    seedSkill(t, "org", "acme-review");
    const o = build(t, "all");
    assert.notEqual(o.status, 0);
    assert.doesNotMatch(o.stdout, TIER_BANNER);
    assert.ok(both(o).includes("acme-review"));
  });

  test("G13 two tiers declaring one policy name collide (never-compiled arm)", () => {
    const t = newRepo();
    seedPolicy(t, "library", "acme-rules");
    seedPolicy(t, "community", "acme-rules");
    const o = build(t, "all");
    assert.notEqual(o.status, 0);
    assert.doesNotMatch(o.stdout, TIER_BANNER);
    assert.ok(both(o).includes("acme-rules"));
  });

  test("G14 a named request refuses an ambiguous name in a pre-existing compiled tree", () => {
    const t = newRepo();
    seedSkill(t, "library", "acme-review");
    assert.equal(build(t, "claude").status, 0);
    // Residue of a build that predates the guard: a second, identical copy under org.
    const lib = t.resolve("dist/library/.claude/skills/acme-review/SKILL.md");
    const org = t.resolve("dist/org/.claude/skills/acme-review/SKILL.md");
    fs.mkdirSync(t.resolve("dist/org/.claude/skills/acme-review"), { recursive: true });
    fs.copyFileSync(lib, org);
    assert.deepEqual(fs.readFileSync(org), fs.readFileSync(lib), "residue seeding failed");
    const o = run(t, CLAUDE_CMD, ["install", "claude-skills", "acme-review"]);
    assert.notEqual(o.status, 0, "the command resolved an ambiguous name");
    assert.equal(t.exists("cli-home/.claude/skills/acme-review"), false);
    for (const s of ["acme-review", "library", "org"]) assert.ok(both(o).includes(s), s);
  });

  test("G15 an unnamed request installs non-colliding siblings and refuses the colliding name", () => {
    const t = newRepo();
    seedPolicy(t, "library", "acme-rules");
    seedPolicy(t, "community", "acme-rules");
    seedPolicy(t, "library", "solo-rules");
    const o = run(t, GEMINI_CMD, ["install", "policies"]);
    assert.notEqual(o.status, 0, "exited zero despite a collision");
    assert.equal(t.exists("cli-home/.gemini/policies/acme-rules.md"), false);
    assert.ok(t.exists("cli-home/.gemini/policies/solo-rules.md"), both(o));
    assert.ok(both(o).includes("acme-rules"));
  });

  test("G16 guard liveness: both negative-guard patterns match the reporters' text", () => {
    // Unlabelled captures: nothing but the reporter writes to them (aa-name / bb-name are neutral).
    const control: string[] = [];
    const a: string[] = [];
    const b: string[] = [];
    reportCollision("aa-name", ["dist/library/aa-name", "dist/community/aa-name"], (x) =>
      a.push(x),
    );
    reportUnresolved("bb-name", "skills", ["dist/library/skills", "dist/community/skills"], (x) =>
      b.push(x),
    );
    assert.equal(control.join(""), "", "the control capture must be byte-empty");
    assert.notEqual(a.join(""), "", "reportCollision printed nothing");
    assert.notEqual(b.join(""), "", "reportUnresolved printed nothing");
    assert.match(a.join(""), COLLISION_REPORT_RE);
    assert.match(b.join(""), UNRESOLVED_REPORT_RE);
    // Stronger than the Bash case: every alternative must match on its own, so rewording
    // one phrase cannot hide behind the other.
    for (const phrase of COLLISION_REPORT_RE.source.split("|"))
      assert.match(a.join(""), new RegExp(phrase), phrase);
    for (const phrase of UNRESOLVED_REPORT_RE.source.split("|"))
      assert.match(b.join(""), new RegExp(phrase), phrase);
  });

  test("G17 a refused rebuild names every staging root it emptied and touches nothing else", () => {
    const t = newRepo();
    seedSkill(t, "library", "acme-review");
    assert.equal(build(t, "claude").status, 0);
    assert.ok(t.exists("dist/library/.claude"), "fixture did not produce dist/library/.claude");
    // Sentinel outside the pruned roots, same tier, different CLI root.
    t.write("dist/library/.gemini/skills/sentinel-keep/SKILL.md", "untouched\n");
    // The collision arrives only after the build that populated the staging root.
    seedSkill(t, "org", "acme-review");
    const o = run(t, CLAUDE_CMD, ["install", "claude-skills", "zz-absent"]);
    const text = both(o);
    assert.notEqual(o.status, 0);
    assert.equal(t.exists("dist/library/.claude"), false, "the emptied root is still present");
    for (const tier of ["library", "community", "org"])
      assert.ok(text.includes(t.resolve(`dist/${tier}/.claude`)), `emptied ${tier} root not named`);
    assert.ok(text.includes("staging roots were emptied"));
    assert.ok(text.includes("nothing outside them was touched"));
    assert.ok(t.exists("dist/library/.gemini/skills/sentinel-keep/SKILL.md"), "prune reached out");
    assert.ok(t.exists("artifacts/library/skills/acme-review/SKILL.md"), "sources were touched");
  });
});
