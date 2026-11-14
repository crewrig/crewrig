// claude-profiles.test.ts — spec 0305 R13: the committed Claude Code worker and coordinator
// settings profiles are well-formed and consistent with the tree, and only the Claude setup
// deploys them.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { claudeDescriptor } from "../lib/setup/cli-claude.ts";
import { copilotDescriptor } from "../lib/setup/cli-copilot.ts";
import { geminiDescriptor } from "../lib/setup/cli-gemini.ts";
import { antigravityDescriptor } from "../lib/setup/cli-antigravity.ts";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const PROFILES = path.join(REPO, "artifacts", "core", "claude-profiles");

interface Profile {
  permissions?: { deny?: string[] };
  claudeMdExcludes?: string[];
  disableBundledSkills?: boolean;
  skillOverrides?: Record<string, string>;
  syncClaudeAiSkills?: unknown;
  enabledPlugins?: unknown;
}

const load = (name: string): Profile =>
  JSON.parse(fs.readFileSync(path.join(PROFILES, name), "utf8")) as Profile;
const worker = load("worker.settings.json");
const coordinator = load("coordinator.settings.json");
const deny = (p: Profile): string[] => p.permissions?.deny ?? [];

describe("claude profiles (spec 0305)", () => {
  it("the worker denies the three harness tools a worker never uses", () => {
    for (const tool of ["Artifact", "Workflow", "ScheduleWakeup"]) {
      assert.ok(deny(worker).includes(tool), `worker must deny ${tool}`);
    }
  });

  it("the coordinator keeps Workflow and Artifact", () => {
    assert.ok(!deny(coordinator).includes("Workflow"));
    assert.ok(!deny(coordinator).includes("Artifact"));
  });

  it("the worker excludes the five personal rules, the coordinator none", () => {
    const excludes = worker.claudeMdExcludes ?? [];
    for (const rule of ["00-soul", "10-level", "30-profile", "40-expertise", "50-team"]) {
      assert.ok(
        excludes.some((g) => g.endsWith(`${rule}.md`)),
        `worker must exclude ${rule}`,
      );
    }
    assert.equal(coordinator.claudeMdExcludes, undefined);
    assert.ok(!excludes.some((g) => /AGENTS|CLAUDE/.test(g)), "project memory stays loaded");
  });

  it("bundled skills are disabled for the worker only", () => {
    assert.equal(worker.disableBundledSkills, true);
    assert.equal(coordinator.disableBundledSkills, undefined);
  });

  it("no profile carries a user-local key", () => {
    for (const p of [worker, coordinator]) {
      assert.equal(p.syncClaudeAiSkills, undefined);
      assert.equal(p.enabledPlugins, undefined);
    }
  });

  it("every Agent(<name>) deny names an existing agent, in both profiles", () => {
    for (const p of [worker, coordinator]) {
      const names = deny(p)
        .map((d) => /^Agent\((.+)\)$/.exec(d)?.[1])
        .filter((n): n is string => n !== undefined);
      assert.equal(names.length, 11, "11 web and SEO agents");
      for (const n of names) {
        assert.ok(
          fs.existsSync(path.join(REPO, "artifacts", "core", "agents", n, "AGENT.md")),
          `agent ${n} must exist`,
        );
      }
    }
    assert.deepEqual(
      deny(coordinator).sort(),
      deny(worker)
        .filter((d) => d.startsWith("Agent("))
        .sort(),
    );
  });

  it("every skillOverrides key names an existing skill, identical in both profiles", () => {
    assert.deepEqual(worker.skillOverrides, coordinator.skillOverrides);
    for (const [name, mode] of Object.entries(worker.skillOverrides ?? {})) {
      assert.equal(mode, "off");
      assert.ok(
        fs.existsSync(path.join(REPO, "artifacts", "core", "skills", name, "SKILL.md")),
        `skill ${name} must exist`,
      );
    }
  });

  it("only the Claude setup deploys the profile directory, into the user home", () => {
    const entry = (claudeDescriptor.rules.homeDirs ?? []).find(
      (f) => f.src === "artifacts/core/claude-profiles",
    );
    assert.ok(entry, "claude descriptor deploys the profiles");
    assert.equal(entry.dest, ".crewrig/claude-profiles");
    assert.ok(
      fs.existsSync(path.join(REPO, entry.src)),
      "the deployed source exists in the repository",
    );
    for (const d of [copilotDescriptor, geminiDescriptor, antigravityDescriptor]) {
      assert.ok(
        !(d.rules.homeDirs ?? []).some((f) => f.src === "artifacts/core/claude-profiles") &&
          !d.rules.shared.some((f) => f.src === "artifacts/core/claude-profiles"),
        `${d.cli} must not deploy the Claude profiles`,
      );
    }
  });
});
