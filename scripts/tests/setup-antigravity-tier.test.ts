// setup-antigravity-tier.test.ts — installAntigravityTier, runAntigravityTiers and
// migrateSupersededPlacement of scripts/lib/setup/antigravity-tier.ts against temporary directories.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  installAntigravityTier,
  migrateSupersededPlacement,
  runAntigravityTiers,
} from "../lib/setup/antigravity-tier.ts";
import { SetupExit } from "../lib/setup/exit.ts";
import type { PromptSession, Question } from "../lib/setup/prompt.ts";
import type { TierCtx } from "../lib/setup/tier-install.ts";

let base: string;
let home: string;
let repo: string;
let out: string[];
let err: string[];

beforeEach(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "setup-agy-tier-")));
  home = path.join(base, "home");
  repo = path.join(base, "repo");
  fs.mkdirSync(home);
  fs.mkdirSync(repo);
  out = [];
  err = [];
});
afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

function ctxOf(): TierCtx {
  const io = { out: (l: string) => out.push(l), err: (l: string) => err.push(l), errRaw: () => {} };
  return { io, env: {}, platform: process.platform, link: false, home, repoDir: repo };
}

function put(file: string, text = "x\n"): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function stage(tier: string, files: Record<string, string>): void {
  for (const [rel, text] of Object.entries(files))
    put(path.join(repo, "dist", tier, ".agents", rel), text);
}

function sessionOf(answers: Record<string, string | undefined>, asked: Question[]): PromptSession {
  return {
    choose: async (q) => {
      asked.push(q);
      return answers[q.id];
    },
    confirm: async () => undefined,
    close: () => {},
  };
}

const skills = (): string => path.join(home, ".gemini/config/skills");
const agents = (): string => path.join(home, ".gemini/config/agents");

describe("installAntigravityTier", () => {
  it("installs directory-shaped skills and agents under ~/.gemini/config, verified before the line", () => {
    stage("library", {
      "skills/s/SKILL.md": "s\n",
      "agents/a/AGENT.md": "a\n",
      "agents/a/extra.md": "e\n",
    });
    assert.equal(installAntigravityTier(ctxOf(), "library"), 0);
    assert.deepEqual(out, [
      `  Installed skill: library/s -> ${path.join(skills(), "s")}`,
      `  Installed agent: library/a -> ${path.join(agents(), "a")}`,
    ]);
    assert.equal(fs.readFileSync(path.join(agents(), "a/extra.md"), "utf8"), "e\n");
    assert.deepEqual(err, []);
  });

  it("replaces an installed skill directory", () => {
    stage("library", { "skills/s/SKILL.md": "new\n" });
    put(path.join(skills(), "s/stale.md"));
    assert.equal(installAntigravityTier(ctxOf(), "library"), 0);
    assert.equal(fs.existsSync(path.join(skills(), "s/stale.md")), false);
  });

  it("prints the not-built line and returns 0 for a tier with no staging", () => {
    assert.equal(installAntigravityTier(ctxOf(), "org"), 0);
    assert.deepEqual(out, [
      `  Tier 'org' not built (no ${path.join(repo, "dist/org/.agents")}) — run 'bash scripts/build-components.sh' first.`,
    ]);
  });

  it("returns 0 for a built tier that stages nothing", () => {
    fs.mkdirSync(path.join(repo, "dist/library/.agents/agents"), { recursive: true });
    assert.equal(installAntigravityTier(ctxOf(), "library"), 0);
    assert.deepEqual([out, err], [[], []]);
  });

  it("returns 1 with the WARNING and ERROR lines when a kind stages components and places none", () => {
    stage("library", { "skills/broken/NOTES.md": "no marker\n" });
    assert.equal(installAntigravityTier(ctxOf(), "library"), 1);
    assert.deepEqual(out, []);
    assert.deepEqual(err, [
      "  WARNING: tier 'library' staged 1 skill(s) and 0 agent(s)",
      "           but placed 0 and 0 at the install target.",
      "           absent from the install target: skill library/broken",
      `  ERROR: tier 'library' staged 1 skill(s) and placed none at ${skills()}.`,
    ]);
  });

  it("warns on a partial shortfall but still returns 0", () => {
    stage("library", { "skills/good/SKILL.md": "g\n", "skills/bad/NOTES.md": "b\n" });
    assert.equal(installAntigravityTier(ctxOf(), "library"), 0);
    assert.equal(err.length, 3);
    assert.match(err[0] ?? "", /staged 2 skill\(s\) and 0 agent\(s\)/);
  });
});

describe("runAntigravityTiers", () => {
  it("builds the library tier, installs it, then asks for the built overlay tiers", async () => {
    stage("org", { "skills/o/SKILL.md": "o\n" });
    const asked: Question[] = [];
    const deps = {
      build: async (input: { argv: readonly string[] }) => {
        assert.deepEqual(input.argv, ["--target", "antigravity"]);
        stage("library", { "skills/l/SKILL.md": "l\n" });
        return 0;
      },
    };
    await runAntigravityTiers({
      ctx: ctxOf(),
      session: sessionOf({ "overlay.org": "yes" }, asked),
      deps,
    });
    assert.equal(asked[0]?.header, "Install 'org' components to ~/.gemini/config/skills? (opt-in)");
    assert.equal(out[0], "");
    assert.equal(out[1], `Installing library components to ${skills()} (automatic)...`);
    assert.match(
      out[2] ?? "",
      /^Tier not built \(no .*\.agents\) — building automatically via 'bash scripts\/build-components\.sh --target antigravity'\.\.\.$/,
    );
    assert.deepEqual(out.slice(3), [
      `  Installed skill: library/l -> ${path.join(skills(), "l")}`,
      "",
      `  Installed skill: org/o -> ${path.join(skills(), "o")}`,
      "",
    ]);
  });

  it("prints the skip line for a declined overlay tier", async () => {
    stage("library", { "skills/l/SKILL.md": "l\n" });
    stage("community", { "skills/c/SKILL.md": "c\n" });
    await runAntigravityTiers({
      ctx: ctxOf(),
      session: sessionOf({ "overlay.community": "no" }, []),
    });
    assert.deepEqual(out.slice(-2), ["  'community' install skipped.", ""]);
    assert.equal(fs.existsSync(path.join(skills(), "c")), false);
  });

  it("throws SetupExit(1) when the library install fails, before any overlay question", async () => {
    stage("library", { "skills/broken/NOTES.md": "x\n" });
    stage("org", { "skills/o/SKILL.md": "o\n" });
    const asked: Question[] = [];
    await assert.rejects(
      runAntigravityTiers({ ctx: ctxOf(), session: sessionOf({}, asked) }),
      (error: unknown) => error instanceof SetupExit && error.status === 1,
    );
    assert.deepEqual(asked, []);
  });

  it("throws SetupExit(1) when an accepted overlay install fails", async () => {
    stage("library", { "skills/l/SKILL.md": "l\n" });
    stage("org", { "skills/broken/NOTES.md": "x\n" });
    await assert.rejects(
      runAntigravityTiers({ ctx: ctxOf(), session: sessionOf({ "overlay.org": "yes" }, []) }),
      (error: unknown) => error instanceof SetupExit && error.status === 1,
    );
  });
});

describe("migrateSupersededPlacement", () => {
  const frontmatter = (name: string, provenance: boolean): string =>
    `---\nname: ${name}\n${provenance ? "metadata:\n  provenance:\n    canonical: x\n" : ""}---\nbody\n`;

  it("removes a served, provenance-bearing component at the superseded placement and keeps the rest", () => {
    put(path.join(repo, "artifacts/library/skills/served/SKILL.md"), frontmatter("served", true));
    const old = path.join(home, ".gemini/antigravity-cli");
    put(path.join(old, "skills/served/SKILL.md"), frontmatter("served", true));
    put(path.join(old, "skills/mine/SKILL.md"), frontmatter("mine", false));
    migrateSupersededPlacement(ctxOf());
    assert.equal(fs.existsSync(path.join(old, "skills/served")), false);
    assert.equal(fs.existsSync(path.join(old, "skills/mine/SKILL.md")), true);
    assert.deepEqual(out, [
      "Migrating components left at the superseded placement...",
      `  Migrated away: ${path.join(old, "skills/served")} (superseded placement)`,
      `  Removed 1 framework component(s) from the superseded placement at ${old}.`,
      "",
    ]);
  });

  it("throws SetupExit(1) when served sources yield no name (the empty-name-set error)", () => {
    put(path.join(repo, "artifacts/library/skills/nameless/SKILL.md"), "no frontmatter\n");
    assert.throws(
      () => migrateSupersededPlacement(ctxOf()),
      (error: unknown) => error instanceof SetupExit && error.status === 1,
    );
    assert.match(err[0] ?? "", /ERROR: read no skills name from 1 source director\(ies\) under/);
  });
});
