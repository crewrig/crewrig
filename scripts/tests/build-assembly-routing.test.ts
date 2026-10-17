// build-assembly-routing.test.ts — assembly verification of the build (spec 0265, J2).
// Replaces scripts/tests/test-assembly-verification.sh.
//
// A root holding only the real `developer` skill and agent (a slice, issue #1432), the real
// `crewrig.config.toml` and the fixture community overlay is built once. Core lands in the
// committed project tree, every other tier in the gitignored dist/<tier>/ staging tree
// (ADR-0011, spec 0019). Component identity is the frontmatter `name`, not the fixture
// directory name (test-overlay-skill / test-overlay-agent).

import assert from "node:assert/strict";
import fs from "node:fs";
import { before, describe, test } from "node:test";

import { createFixtureTree, REPO, type FixtureTree } from "./lib/build-fixture-tree.ts";
import { baseEnv, copyFromWorktree } from "./lib/build-sandbox.ts";

const CORE_SKILL = "developer";
const CORE_AGENT = "developer";
const OVERLAY_SKILL = "crewrig-assembly-test-skill";
const OVERLAY_AGENT = "crewrig-assembly-test-agent";
const OVERLAY_STAGING = "dist/community";
const OVERLAY_SRC = "tests/fixtures/overlay/artifacts/community";

let tree: FixtureTree;
let status: number | null = null;
let output = "";

before(() => {
  tree = createFixtureTree();
  copyFromWorktree(tree, [
    `artifacts/core/skills/${CORE_SKILL}`,
    `artifacts/core/agents/${CORE_AGENT}`,
  ]);
  tree.config(fs.readFileSync(`${REPO}/crewrig.config.toml`, "utf8"));
  for (const rel of copyFromWorktree(tree, [OVERLAY_SRC], REPO)) {
    // The overlay is staged as the community zone of the synthetic root.
    tree.write(`artifacts/community/${rel.slice(OVERLAY_SRC.length + 1)}`, tree.read(rel));
    tree.remove(rel);
  }
  // No --check: the suite is itself run from inside the check block.
  const res = tree.run([], { env: baseEnv() });
  status = res.status;
  output = res.stderr + res.stdout;
});

describe("assembly: the build itself", () => {
  test("the build exits 0 (build success)", () => {
    assert.equal(status, 0, output);
  });
});

describe("assembly: per CLI directory", () => {
  for (const cli of [".claude", ".gemini", ".github"]) {
    test(`core skill lands in the project tree, ${cli}`, () => {
      assert.ok(
        tree.exists(`${cli}/skills/${CORE_SKILL}/SKILL.md`),
        `core skill in ${cli}/skills/`,
      );
    });
    test(`overlay skill staged under dist/community, ${cli}`, () => {
      assert.ok(
        tree.exists(`${OVERLAY_STAGING}/${cli}/skills/${OVERLAY_SKILL}/SKILL.md`),
        `overlay skill '${OVERLAY_SKILL}' in dist/community/${cli}/skills/`,
      );
    });
    test(`overlay agent flat file, ${cli}`, () => {
      assert.ok(
        tree.exists(`${OVERLAY_STAGING}/${cli}/agents/${OVERLAY_AGENT}.md`),
        `overlay agent '${OVERLAY_AGENT}' in dist/community/${cli}/agents/`,
      );
    });
  }
});

describe("assembly: Antigravity (spec 0053)", () => {
  test("antigravity core skill", () => {
    assert.ok(tree.exists(`.agents/skills/${CORE_SKILL}/SKILL.md`));
  });
  test("antigravity core agent directory", () => {
    assert.ok(tree.exists(`.agents/agents/${CORE_AGENT}/AGENT.md`));
  });
  test("antigravity overlay skill staged", () => {
    assert.ok(tree.exists(`${OVERLAY_STAGING}/.agents/skills/${OVERLAY_SKILL}/SKILL.md`));
  });
  test("antigravity overlay agent directory (strengthening, V5)", () => {
    assert.ok(tree.exists(`${OVERLAY_STAGING}/.agents/agents/${OVERLAY_AGENT}/AGENT.md`));
  });
});
