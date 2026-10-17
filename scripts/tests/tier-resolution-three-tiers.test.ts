// Spec 0263 annex GAP for G18 (case 13d of test-component-tier-resolution.sh): the
// `core` tier is rejected BEFORE any of the earlier tiers is pruned. component-overlay.test.ts
// L131 covers only ["library","core"] with one sentinel; here `core` comes LAST after two
// valid tiers, and a sentinel in each of dist/library and dist/community must survive.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { ensureOverlayTiersFresh, type SpawnFn } from "../lib/component-overlay.ts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tier-three-tiers-"));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test("core passed last is rejected before library and community are pruned", () => {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(tmp, "r")));
  const sentinels = ["library", "community"].map((tier) => {
    const file = `${repo}/dist/${tier}/.claude/skills/sentinel-${tier}/SKILL.md`;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "untouched\n");
    return file;
  });
  const chunks: string[] = [];
  let spawned = false;
  const spawn: SpawnFn = () => {
    spawned = true;
    return { status: 0, output: "" };
  };
  const status = ensureOverlayTiersFresh("claude", ["library", "community", "core"], {
    repoDir: repo,
    stderr: (t) => chunks.push(t),
    spawn,
  });
  assert.equal(status, 2);
  assert.equal(
    chunks.join(""),
    "Internal error: the 'core' tier is never pruned by an install command.\n",
  );
  assert.equal(spawned, false, "no rebuild may start");
  for (const file of sentinels) assert.ok(fs.existsSync(file), `${file} was pruned before core`);
});
