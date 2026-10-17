// build-install-scope-build.test.ts — build half of the artifact install scope (spec 0265, J2).
// Replaces scripts/tests/test-artifact-build-install-scope.sh (part): S2, S1b, CORE, S3b, S4.
// The overlay-tiers and claude-install-mechanics groups live in setup-retarget-entry-behaviour.test.ts.
// Everything runs in mkdtemp trees from createFixtureTree(); the checkout (dist/ included) is never touched.

import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { before, describe, test } from "node:test";

import { createFixtureTree, type FixtureTree } from "./lib/build-fixture-tree.ts";
import { baseEnv, copyFromWorktree, seedAgent, seedSkill } from "./lib/build-sandbox.ts";
import { CONFIG } from "./fixtures/build-components/entry-kit.ts";

const NOVEL_TIER = `experimental-${randomUUID().slice(0, 8)}`;
const SURFACE = ["scripts/build-components.ts", "scripts/lib/build-components"];

function surfaceHash(tree: FixtureTree): string {
  const hash = createHash("sha256");
  const walk = (rel: string): void => {
    const abs = tree.resolve(rel);
    if (fs.statSync(abs).isDirectory()) {
      for (const name of fs.readdirSync(abs).sort()) walk(`${rel}/${name}`);
    } else {
      hash.update(rel).update(fs.readFileSync(abs));
    }
  };
  for (const rel of SURFACE) walk(rel);
  return hash.digest("hex");
}

describe("scope: skills routed by tier on a seeded root", () => {
  let tree: FixtureTree;
  let hashBefore = "";
  let hashAfter = "";
  let status: number | null = null;
  let log = "";

  before(() => {
    tree = createFixtureTree();
    tree.config(CONFIG);
    seedSkill(tree, NOVEL_TIER, "demo-novel-skill");
    seedSkill(tree, "org", "demo-org-skill");
    seedSkill(tree, "community", "demo-community-skill");
    seedSkill(tree, "core", "demo-core-skill");
    seedAgent(tree, "org", "demo-org-agent");
    hashBefore = surfaceHash(tree);
    const res = tree.run(["--target", "claude"], { env: baseEnv() });
    status = res.status;
    log = res.stderr + res.stdout;
    hashAfter = surfaceHash(tree);
  });

  test("Scenario 2: novel tier compiles with no build-script edit", () => {
    assert.equal(status, 0, log);
    assert.equal(hashAfter, hashBefore, "build script changed during build");
    const out = `dist/${NOVEL_TIER}/.claude/skills/demo-novel-skill/SKILL.md`;
    assert.ok(tree.exists(out), `novel-tier component not compiled at ${out}`);
  });

  test("Scenario 1 (build): org component compiles into dist/org/", () => {
    assert.ok(tree.exists("dist/org/.claude/skills/demo-org-skill/SKILL.md"));
  });

  test("core routes to project tree, not dist/", () => {
    assert.ok(tree.exists(".claude/skills/demo-core-skill/SKILL.md"), "core not in project tree");
    assert.ok(
      !tree.exists("dist/core/.claude/skills/demo-core-skill/SKILL.md"),
      "core component leaked into dist/core/",
    );
  });

  test("Scenario 3 (build): community compiles into dist/, not the project tree", () => {
    assert.ok(tree.exists("dist/community/.claude/skills/demo-community-skill/SKILL.md"));
    assert.ok(
      !tree.exists(".claude/skills/demo-community-skill/SKILL.md"),
      "community component leaked into the project tree",
    );
  });
});

describe("scope: --check with no pre-existing dist/", () => {
  test("Scenario 4: --check passes with no pre-existing dist/ (CI condition)", () => {
    const tree = createFixtureTree();
    copyFromWorktree(tree, [
      "artifacts",
      "model-mappings",
      "crewrig.config.toml",
      ".claude",
      ".gemini",
      ".github",
      ".agents",
    ]);
    assert.ok(!tree.exists("dist"), "fixture must start without dist/");
    const res = tree.run(["--target", "all", "--check"], { env: baseEnv() });
    assert.equal(
      res.status,
      0,
      `--check exited non-zero with no dist/: ${res.stderr}${res.stdout}`,
    );
    assert.ok(!tree.exists("dist"), "--check created a stray dist/");
    tree.dispose();
  });
});
