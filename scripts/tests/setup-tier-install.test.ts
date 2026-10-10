// setup-tier-install.test.ts — installTierToHome, runOverlayTiers and runTierInstall of
// scripts/lib/setup/tier-install.ts against temporary directories (never the real home).

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import type { Question } from "../lib/setup/prompt.ts";
import type { PromptSession } from "../lib/setup/prompt.ts";
import { installTierToHome, runOverlayTiers, runTierInstall } from "../lib/setup/tier-install.ts";
import type { TierCtx } from "../lib/setup/tier-install.ts";

let base: string;
let home: string;
let repo: string;
let out: string[];
let err: string[];

beforeEach(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "setup-tier-install-")));
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

/** A session that answers each question from `answers` (by id) and records what was asked. */
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

function stage(tier: string, root: string, files: Record<string, string>): void {
  for (const [rel, text] of Object.entries(files))
    put(path.join(repo, "dist", tier, root, rel), text);
}

describe("installTierToHome, Claude", () => {
  it("installs skills as directories and agents as flat <name>.md, with the shell's lines", () => {
    stage("library", ".claude", {
      "skills/alpha/SKILL.md": "alpha\n",
      "skills/alpha/ref/note.md": "note\n",
      "skills/beta/SKILL.md": "beta\n",
      "agents/dev.md": "dev\n",
    });
    installTierToHome({ ctx: ctxOf(), cli: "claude", tier: "library" });
    assert.deepEqual(out, [
      "  Installed skill: library/alpha -> ~/.claude/skills/alpha",
      "  Installed skill: library/beta -> ~/.claude/skills/beta",
      "  Installed agent: library/dev -> ~/.claude/agents/dev.md",
    ]);
    assert.equal(
      fs.readFileSync(path.join(home, ".claude/skills/alpha/ref/note.md"), "utf8"),
      "note\n",
    );
    assert.equal(fs.readFileSync(path.join(home, ".claude/agents/dev.md"), "utf8"), "dev\n");
  });

  it("replaces a skill directory (rm -rf then copy) and a directory sitting where an agent goes", () => {
    stage("library", ".claude", { "skills/alpha/SKILL.md": "new\n", "agents/dev.md": "new\n" });
    put(path.join(home, ".claude/skills/alpha/stale.md"));
    put(path.join(home, ".claude/agents/dev/leftover.md"));
    installTierToHome({ ctx: ctxOf(), cli: "claude", tier: "library" });
    assert.equal(fs.existsSync(path.join(home, ".claude/skills/alpha/stale.md")), false);
    assert.equal(
      fs.readFileSync(path.join(home, ".claude/skills/alpha/SKILL.md"), "utf8"),
      "new\n",
    );
    assert.equal(fs.statSync(path.join(home, ".claude/agents/dev.md")).isFile(), true);
    assert.equal(fs.existsSync(path.join(home, ".claude/agents/dev")), false);
  });

  it("prints the not-built line and installs nothing when the tier has no staging", () => {
    installTierToHome({ ctx: ctxOf(), cli: "claude", tier: "library" });
    assert.deepEqual(out, [
      `  Tier 'library' not built (no ${path.join(repo, "dist/library/.claude")}) — run 'bash scripts/build-components.sh' first.`,
    ]);
    assert.equal(fs.existsSync(path.join(home, ".claude")), false);
  });

  it("skips files that are not skills or agents (hidden names, non-md, loose files)", () => {
    stage("library", ".claude", {
      "skills/.hidden/SKILL.md": "h\n",
      "skills/loose.txt": "l\n",
      "agents/readme.txt": "r\n",
      "agents/.dot.md": "d\n",
    });
    installTierToHome({ ctx: ctxOf(), cli: "claude", tier: "library" });
    assert.deepEqual(out, []);
    assert.deepEqual(fs.readdirSync(path.join(home, ".claude/skills")), []);
  });
});

describe("installTierToHome, Gemini", () => {
  it("installs from .gemini with flat agent files named <file>.md", () => {
    stage("org", ".gemini", { "skills/s/SKILL.md": "s\n", "agents/a.md": "a\n" });
    installTierToHome({ ctx: ctxOf(), cli: "gemini", tier: "org" });
    assert.deepEqual(out, [
      "  Installed skill: org/s -> ~/.gemini/skills/s",
      "  Installed agent: org/a.md -> ~/.gemini/agents/a.md",
    ]);
    assert.equal(fs.readFileSync(path.join(home, ".gemini/agents/a.md"), "utf8"), "a\n");
  });
});

describe("installTierToHome, Copilot", () => {
  it("installs SKILL.md only and never an agent", () => {
    stage("library", ".github", {
      "skills/s/SKILL.md": "s\n",
      "skills/s/extra.md": "e\n",
      "agents/a.md": "a\n",
    });
    installTierToHome({ ctx: ctxOf(), cli: "copilot", tier: "library" });
    assert.deepEqual(out, ["  Copied: library/s/SKILL.md -> ~/.copilot/skills/s/SKILL.md"]);
    assert.deepEqual(fs.readdirSync(path.join(home, ".copilot/skills/s")), ["SKILL.md"]);
    assert.equal(fs.existsSync(path.join(home, ".copilot/agents")), false);
  });

  it("prints the no-built-skills line for an absent or empty skills staging", () => {
    const staging = path.join(repo, "dist/library/.github/skills");
    const line = `  Tier 'library' has no built skills (no ${staging}) — run 'bash scripts/build-components.sh --target copilot' first.`;
    installTierToHome({ ctx: ctxOf(), cli: "copilot", tier: "library" });
    fs.mkdirSync(staging, { recursive: true });
    installTierToHome({ ctx: ctxOf(), cli: "copilot", tier: "library" });
    assert.deepEqual(out, [line, line]);
  });
});

describe("runOverlayTiers", () => {
  it("asks only for the tiers whose built directory exists, and installs on yes", async () => {
    stage("community", ".claude", { "skills/c/SKILL.md": "c\n" });
    stage("org", ".claude", { "skills/o/SKILL.md": "o\n" });
    const asked: Question[] = [];
    const session = sessionOf({ "overlay.community": "yes", "overlay.org": "no" }, asked);
    await runOverlayTiers({ ctx: ctxOf(), session, cli: "claude" });
    assert.deepEqual(
      asked.map((q) => q.id),
      ["overlay.community", "overlay.org"],
    );
    assert.deepEqual(asked[0], {
      id: "overlay.community",
      header: "Install 'community' components to ~/.claude/skills? (opt-in)",
      options: ["no", "yes"],
      cancel: "abort",
    });
    assert.deepEqual(out, [
      "  Installed skill: community/c -> ~/.claude/skills/c",
      "",
      "  'org' install skipped.",
      "",
    ]);
    assert.equal(fs.existsSync(path.join(home, ".claude/skills/o")), false);
  });

  it("asks nothing and prints nothing when no overlay tier is built", async () => {
    const asked: Question[] = [];
    await runOverlayTiers({ ctx: ctxOf(), session: sessionOf({}, asked), cli: "gemini" });
    assert.deepEqual(asked, []);
    assert.deepEqual(out, []);
  });

  it("gates Copilot on .github/skills and words its header and skip line for skills", async () => {
    stage("community", ".github", { "agents/a.md": "a\n" });
    const asked: Question[] = [];
    await runOverlayTiers({ ctx: ctxOf(), session: sessionOf({}, asked), cli: "copilot" });
    assert.equal(asked.length, 0);
    stage("community", ".github", { "skills/s/SKILL.md": "s\n" });
    const second: Question[] = [];
    await runOverlayTiers({
      ctx: ctxOf(),
      session: sessionOf({ "overlay.community": "no" }, second),
      cli: "copilot",
    });
    assert.equal(
      second[0]?.header,
      `Install 'community' skills to ${path.join(home, ".copilot", "skills")}? (opt-in)`,
    );
    assert.deepEqual(out, ["  'community' skills install skipped.", ""]);
  });

  it("treats a cancelled (undefined) answer as a decline of the install", async () => {
    stage("org", ".gemini", { "skills/o/SKILL.md": "o\n" });
    await runOverlayTiers({ ctx: ctxOf(), session: sessionOf({}, []), cli: "gemini" });
    assert.deepEqual(out, ["  'org' install skipped.", ""]);
  });
});

describe("runTierInstall", () => {
  it("prints the announcement, builds when absent, installs library, then offers overlays", async () => {
    stage("org", ".claude", { "skills/o/SKILL.md": "o\n" });
    const built: string[][] = [];
    const deps = {
      build: async (input: { argv: readonly string[] }) => {
        built.push([...input.argv]);
        stage("library", ".claude", { "skills/l/SKILL.md": "l\n" });
        return 0;
      },
    };
    const session = sessionOf({ "overlay.org": "no" }, []);
    await runTierInstall({ ctx: ctxOf(), session, cli: "claude", deps });
    assert.deepEqual(built, [["--target", "claude"]]);
    const lib = path.join(repo, "dist/library/.claude");
    assert.deepEqual(out, [
      "",
      `Installing library components to ${path.join(home, ".claude/skills")} (automatic)...`,
      `Tier not built (no ${lib}) — building automatically via 'bash scripts/build-components.sh --target claude'...`,
      "  Installed skill: library/l -> ~/.claude/skills/l",
      "",
      "  'org' install skipped.",
      "",
    ]);
  });

  it("opens the Copilot block without a leading blank line", async () => {
    stage("library", ".github", { "skills/s/SKILL.md": "s\n" });
    await runTierInstall({ ctx: ctxOf(), session: sessionOf({}, []), cli: "copilot" });
    assert.equal(
      out[0],
      `Installing library skills to ${path.join(home, ".copilot", "skills")} (automatic)...`,
    );
  });
});
