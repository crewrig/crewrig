// antigravity-tier-twin.test.ts — the agent rows of the G1-G5 table of
// test-antigravity-component-install.sh run against installAntigravityTier
// (scripts/lib/setup/antigravity-tier.ts): the four messages that
// setup-antigravity-tier.test.ts asserts only in their skill variants (spec 0263 gap).

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { installAntigravityTier } from "../lib/setup/antigravity-tier.ts";
import type { TierCtx } from "../lib/setup/tier-install.ts";
import { stageAgent, stageSkill } from "./lib/antigravity-fixtures.ts";

let base: string;
let out: string[];
let err: string[];

beforeEach(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "agy-tier-twin-")));
  out = [];
  err = [];
});
afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

const ctx = (): TierCtx => ({
  io: { out: (l) => out.push(l), err: (l) => err.push(l), errRaw: () => {} },
  env: {},
  platform: process.platform,
  link: false,
  home: path.join(base, "home"),
  repoDir: path.join(base, "repo"),
});
const staging = (): string => path.join(base, "repo", "dist", "library", ".agents");
const hollow = (kind: string, name: string): string =>
  fs.mkdirSync(path.join(staging(), kind, name), { recursive: true }) as string;

describe("installAntigravityTier agent rows", () => {
  it("names a hollow agent next to a real one: staged 0 skill(s) and 2 agent(s), placed 0 and 1", () => {
    hollow("agents", "hollow-agent");
    stageAgent(staging(), "real-agent");
    assert.equal(installAntigravityTier(ctx(), "library"), 0);
    const all = [...out, ...err].join("\n");
    assert.ok(all.includes("staged 0 skill(s) and 2 agent(s)"), all);
    assert.ok(all.includes("placed 0 and 1 at the install target"), all);
    assert.ok(all.includes("absent from the install target: agent library/hollow-agent"), all);
    assert.ok(out.some((l) => l.startsWith("  Installed agent: library/real-agent")));
    assert.ok(!all.includes("Installed agent: library/hollow-agent"));
  });

  it("fails with staged 2 agent(s) and placed none when no agent lands", () => {
    hollow("agents", "hollow-one");
    hollow("agents", "hollow-two");
    assert.equal(installAntigravityTier(ctx(), "library"), 1);
    const agents = path.join(base, "home", ".gemini", "config", "agents");
    assert.ok(
      err.includes(`  ERROR: tier 'library' staged 2 agent(s) and placed none at ${agents}.`),
    );
  });

  it("reports a marker-less skill directory beside a real one without a skill ERROR", () => {
    hollow("skills", "hollow-skill");
    stageSkill(staging(), "real-skill");
    assert.equal(installAntigravityTier(ctx(), "library"), 0);
    assert.ok(!out.join("\n").includes("Installed skill: library/hollow-skill"));
    assert.ok(out.some((l) => l.startsWith("  Installed skill: library/real-skill")));
  });
});
