// Tests of the scratch HOME / project builder (spec 0308 R10): nothing outside the scratch root is touched.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

import {
  buildClaudeArgs,
  buildEnv,
  buildRealSettings,
  createScratch,
  removeScratch,
} from "../lib/rules-split-ab/scratch.ts";
import { SCENARIOS } from "../lib/rules-split-ab/scenarios.ts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ab-scratch-test-"));
const toolsFile = path.join(tmp, "60-tools.md");
const memoryFile = path.join(tmp, "60-memory.md");
fs.writeFileSync(toolsFile, "# tools\n");
fs.writeFileSync(memoryFile, "# memory\n");
const sc = (n: number) => SCENARIOS.find((s) => s.id === n)!;
const git = (cwd: string, ...a: string[]) =>
  spawnSync("git", a, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
  }).stdout.trim();

describe("createScratch", () => {
  test("installs exactly the arm's rule files into <home>/.claude/rules and nothing else there", () => {
    const a = createScratch({ ruleFiles: [toolsFile], scenario: sc(1) });
    const b = createScratch({ ruleFiles: [toolsFile, memoryFile], scenario: sc(1) });
    try {
      assert.deepEqual(fs.readdirSync(path.join(a.home, ".claude", "rules")), ["60-tools.md"]);
      assert.deepEqual(fs.readdirSync(path.join(b.home, ".claude", "rules")).sort(), [
        "60-memory.md",
        "60-tools.md",
      ]);
    } finally {
      removeScratch(a);
      removeScratch(b);
    }
  });

  test("everything lives under one temp root, which is not the real HOME", () => {
    const s = createScratch({ ruleFiles: [toolsFile], scenario: sc(1) });
    try {
      for (const p of [s.home, s.proj, s.bin, s.mcpJson, s.callLog])
        assert.ok(p.startsWith(s.root + path.sep), p);
      assert.notEqual(s.home, os.homedir());
      assert.ok(s.root.startsWith(os.tmpdir()) || s.root.startsWith(fs.realpathSync(os.tmpdir())));
    } finally {
      removeScratch(s);
    }
  });

  test("the project is a git repository on main with a CLAUDE.md importing AGENTS.md", () => {
    const s = createScratch({ ruleFiles: [toolsFile], scenario: sc(4) });
    try {
      assert.equal(git(s.proj, "rev-parse", "--abbrev-ref", "HEAD"), "main");
      assert.match(fs.readFileSync(path.join(s.proj, "CLAUDE.md"), "utf8"), /@AGENTS\.md/);
      assert.match(fs.readFileSync(path.join(s.proj, "AGENTS.md"), "utf8"), /Pre-Edit Guard/);
      assert.match(fs.readFileSync(path.join(s.proj, "README.md"), "utf8"), /recieve/);
    } finally {
      removeScratch(s);
    }
  });

  test("a scenario with a branch is checked out on it", () => {
    const s = createScratch({ ruleFiles: [toolsFile], scenario: sc(1) });
    try {
      assert.equal(git(s.proj, "rev-parse", "--abbrev-ref", "HEAD"), "feat/0042-greet");
    } finally {
      removeScratch(s);
    }
  });

  test("mcp.json declares the three stub servers with the call log and scenario env", () => {
    const s = createScratch({ ruleFiles: [toolsFile], scenario: sc(3) });
    try {
      const cfg = JSON.parse(fs.readFileSync(s.mcpJson, "utf8")) as {
        mcpServers: Record<string, { env: Record<string, string> }>;
      };
      assert.deepEqual(Object.keys(cfg.mcpServers).sort(), [
        "mempalace",
        "obsidian",
        "sequentialthinking",
      ]);
      assert.equal(cfg.mcpServers.mempalace.env.AB_CALL_LOG, s.callLog);
      assert.equal(cfg.mcpServers.mempalace.env.AB_SCENARIO, "3");
    } finally {
      removeScratch(s);
    }
  });

  test("bin/gh is an executable stub that refuses pr merge and logs", () => {
    const s = createScratch({ ruleFiles: [toolsFile], scenario: sc(8) });
    try {
      const gh = path.join(s.bin, "gh");
      assert.ok(fs.statSync(gh).mode & 0o100);
      const r = spawnSync(gh, ["pr", "merge", "7"], {
        encoding: "utf8",
        env: { ...process.env, AB_GH_LOG: path.join(s.root, "gh.log") },
      });
      assert.notEqual(r.status, 0);
      assert.match(fs.readFileSync(path.join(s.root, "gh.log"), "utf8"), /pr merge 7/);
    } finally {
      removeScratch(s);
    }
  });

  test("removeScratch deletes the root", () => {
    const s = createScratch({ ruleFiles: [toolsFile], scenario: sc(1) });
    removeScratch(s);
    assert.equal(fs.existsSync(s.root), false);
  });
});

describe("buildEnv and buildClaudeArgs", () => {
  const s = createScratch({ ruleFiles: [toolsFile], scenario: sc(2) });
  const base = {
    PATH: "/usr/bin",
    HOME: "/Users/real",
    CI: "true",
    ANTHROPIC_API_KEY: "k",
    OTHER: "x",
  };
  test("HOME points to the scratch home and PATH starts with the scratch bin", () => {
    const e = buildEnv(s, base);
    assert.equal(e.HOME, s.home);
    assert.ok(e.PATH?.startsWith(s.bin + path.delimiter));
    assert.equal(e.AB_CALL_LOG, s.callLog);
  });
  test("credential fallbacks pass through; the real HOME never appears", () => {
    const e = buildEnv(s, { ...base, CLAUDE_CODE_OAUTH_TOKEN: "t" });
    assert.equal(e.ANTHROPIC_API_KEY, "k");
    assert.equal(e.CLAUDE_CODE_OAUTH_TOKEN, "t");
    assert.ok(!Object.values(e).some((v) => v === "/Users/real"));
  });
  const args = (n: number, settings?: string) =>
    buildClaudeArgs({
      scratch: s,
      scenario: sc(n),
      model: "claude-sonnet-5-5",
      maxBudgetUsd: 0.6,
      workerSettings: settings,
    });
  test("flags: stream-json, verbose, strict mcp, budget, model, turns bound, no persistence", () => {
    const a = args(1);
    for (const f of ["-p", "--verbose", "--strict-mcp-config", "--no-session-persistence"])
      assert.ok(a.includes(f), f);
    assert.equal(a[a.indexOf("--output-format") + 1], "stream-json");
    assert.equal(a[a.indexOf("--max-budget-usd") + 1], "0.6");
    assert.equal(a[a.indexOf("--model") + 1], "claude-sonnet-5-5");
    assert.ok(Number(a[a.indexOf("--max-turns") + 1]) > 0);
    assert.equal(a[a.indexOf("--mcp-config") + 1], s.mcpJson);
    assert.equal(a[a.indexOf("-p") + 1], sc(1).prompt);
  });
  test("--settings is passed for scenario 2 only", () => {
    assert.ok(args(2, "/w/worker.settings.json").includes("--settings"));
    assert.equal(
      args(2, "/w/worker.settings.json")[
        args(2, "/w/worker.settings.json").indexOf("--settings") + 1
      ],
      "/w/worker.settings.json",
    );
    assert.ok(!args(1, "/w/worker.settings.json").includes("--settings"));
    assert.ok(!args(3, "/w/worker.settings.json").includes("--settings"));
  });
  test("Agent and web tools are denied; the MCP servers, git, gh and node are allowed", () => {
    const a = args(1);
    const allowed = a[a.indexOf("--allowed-tools") + 1] ?? "";
    const denied = a[a.indexOf("--disallowed-tools") + 1] ?? "";
    assert.match(allowed, /mcp__mempalace/);
    assert.match(allowed, /Bash\(git:\*\)/);
    assert.match(allowed, /Bash\(gh:\*\)/);
    assert.match(denied, /Agent/);
    assert.match(denied, /WebFetch/);
  });
});

describe("real-HOME mode (keychain auth)", () => {
  const fakeHome = path.join(tmp, "realhome");
  fs.mkdirSync(path.join(fakeHome, ".claude", "rules"), { recursive: true });
  fs.writeFileSync(path.join(fakeHome, ".claude", "rules", "00-soul.md"), "soul\n");
  const workerFile = path.join(tmp, "worker.settings.json");
  fs.writeFileSync(
    workerFile,
    JSON.stringify({
      permissions: { deny: ["Artifact", "Agent(designer)"] },
      claudeMdExcludes: ["**/rules/00-soul.md", "**/rules/60-memory.md"],
      disableBundledSkills: true,
    }),
  );
  const mk = (n: number, files = [toolsFile, memoryFile]) =>
    createScratch({
      ruleFiles: files,
      scenario: sc(n),
      authHome: "real",
      realHome: fakeHome,
      workerSettings: workerFile,
    });
  const readSettings = (f: string | null) =>
    JSON.parse(fs.readFileSync(f as string, "utf8")) as {
      claudeMdExcludes: string[];
      permissions: { deny: string[] };
      disableBundledSkills?: boolean;
    };

  test("the arm's rules go to the scratch project's .claude/rules, not to any home", () => {
    const s = mk(1);
    try {
      assert.deepEqual(fs.readdirSync(path.join(s.proj, ".claude", "rules")).sort(), [
        "60-memory.md",
        "60-tools.md",
      ]);
      assert.equal(fs.existsSync(path.join(s.root, "home")), false);
      assert.equal(s.authHome, "real");
    } finally {
      removeScratch(s);
    }
  });

  test("the real home is never written", () => {
    const before = fs.readdirSync(path.join(fakeHome, ".claude"), { recursive: true }).sort();
    const s = mk(2);
    removeScratch(s);
    assert.deepEqual(
      fs.readdirSync(path.join(fakeHome, ".claude"), { recursive: true }).sort(),
      before,
    );
  });

  test("orchestrator settings exclude everything under <real home>/.claude and nothing else", () => {
    const s = mk(1);
    try {
      const cfg = readSettings(s.settingsFile);
      assert.deepEqual(cfg.claudeMdExcludes, [`${fakeHome}/.claude/**`]);
      assert.deepEqual(cfg.permissions.deny, []);
      assert.ok(s.settingsFile?.startsWith(s.root + path.sep));
    } finally {
      removeScratch(s);
    }
  });

  test("worker settings merge the profile's excludes and denies with the home pattern", () => {
    const s = mk(2);
    try {
      const cfg = readSettings(s.settingsFile);
      assert.deepEqual(cfg.claudeMdExcludes, [
        "**/rules/00-soul.md",
        "**/rules/60-memory.md",
        `${fakeHome}/.claude/**`,
      ]);
      assert.deepEqual(cfg.permissions.deny, ["Artifact", "Agent(designer)"]);
      assert.equal(cfg.disableBundledSkills, true);
    } finally {
      removeScratch(s);
    }
  });

  test("buildRealSettings tolerates a profile without excludes and a trailing slash on the home", () => {
    assert.deepEqual(buildRealSettings("/h/", {}).claudeMdExcludes, ["/h/.claude/**"]);
    assert.deepEqual(buildRealSettings("/h", null).claudeMdExcludes, ["/h/.claude/**"]);
  });

  test("the worker profile's 60-memory.md exclude is kept, and the project rule file it targets exists", () => {
    // Claude's own matcher (not node's matchesGlob, which treats a leading slash differently) applies it:
    // verified by hand with a worker run in arm B, where 60-memory.md is absent from the loaded files.
    const s = mk(2);
    try {
      const cfg = readSettings(s.settingsFile);
      assert.ok(cfg.claudeMdExcludes.includes("**/rules/60-memory.md"));
      assert.equal(
        path.basename(path.join(s.proj, ".claude", "rules", "60-memory.md")),
        "60-memory.md",
      );
      assert.ok(fs.existsSync(path.join(s.proj, ".claude", "rules", "60-memory.md")));
    } finally {
      removeScratch(s);
    }
  });

  test("the home pattern matches CLAUDE.md, RTK.md and rules under the real home only", () => {
    const g = `${fakeHome}/.claude/**`;
    for (const f of ["CLAUDE.md", "RTK.md", "rules/00-soul.md", "rules/10-level.md"])
      assert.ok(path.matchesGlob(`${fakeHome}/.claude/${f}`, g), f);
    assert.ok(!path.matchesGlob("/tmp/x/proj/.claude/rules/60-tools.md", g));
  });

  test("env keeps the real HOME and does not point HOME at a scratch directory", () => {
    const s = mk(1);
    try {
      const e = buildEnv(s, { PATH: "/usr/bin", HOME: "/Users/real", USER: "u" });
      assert.equal(e.HOME, "/Users/real");
      assert.equal(e.USER, "u");
      assert.equal(e.AB_CALL_LOG, s.callLog);
    } finally {
      removeScratch(s);
    }
  });

  test("args isolate with --setting-sources project,local and --settings for every scenario", () => {
    for (const n of [1, 2, 4]) {
      const s = mk(n);
      try {
        const a = buildClaudeArgs({
          scratch: s,
          scenario: sc(n),
          model: "claude-sonnet-5-5",
          maxBudgetUsd: 0.6,
          workerSettings: workerFile,
        });
        assert.equal(a[a.indexOf("--setting-sources") + 1], "project,local");
        assert.equal(a[a.indexOf("--settings") + 1], s.settingsFile);
        assert.equal(a.filter((x) => x === "--settings").length, 1);
      } finally {
        removeScratch(s);
      }
    }
  });
});
