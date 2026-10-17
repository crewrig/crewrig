// Spec 0119 requirements 7-11 and 19 on the real shims (ported from
// test-component-tier-resolution.sh cases 1-5 and 12; spec 0263 groups G1-G8).
// Retires with scripts/lib/common.sh (row J4): POSIX-only, the shims run under bash.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  AGY_CMD,
  CLAUDE_CMD,
  COLLISION_REPORT_RE,
  GEMINI_CMD,
  UNRESOLVED_REPORT_RE,
  both,
  build,
  homeDir,
  newRepo,
  run,
  seedAgent,
  seedCommand,
  seedEmptyType,
  seedHook,
  seedJson,
  seedPolicy,
  seedSkill,
} from "./lib/tier-fixtures.ts";

const skip = process.platform === "win32" ? "the shims are Bash scripts" : false;

describe("tier resolution: install", { skip }, () => {
  test("G1 stale dist: a library skill added after the last build installs by name", () => {
    const t = newRepo();
    seedSkill(t, "community", "com-skill");
    assert.equal(build(t, "claude").status, 0);
    seedSkill(t, "library", "late-skill");
    const o = run(t, CLAUDE_CMD, ["install", "claude-skills", "late-skill"]);
    assert.equal(o.status, 0, both(o));
    assert.ok(t.exists("cli-home/.claude/skills/late-skill/SKILL.md"));
  });

  test("G2 residue: a component removed from artifacts/ is not installed from dist", () => {
    const t = newRepo();
    seedSkill(t, "community", "keeper-skill");
    seedSkill(t, "community", "doomed-skill");
    assert.equal(build(t, "claude").status, 0);
    t.remove("artifacts/community/skills/doomed-skill");
    const o = run(t, CLAUDE_CMD, ["install", "claude-skills"]);
    assert.equal(t.exists("cli-home/.claude/skills/doomed-skill"), false);
    assert.ok(t.exists("cli-home/.claude/skills/keeper-skill/SKILL.md"), both(o));
    assert.doesNotMatch(both(o), COLLISION_REPORT_RE, "phantom collision against residue");
  });

  test("G3 and G4 named org skill installs, and an unnamed request serves three tiers", () => {
    const t = newRepo();
    seedSkill(t, "library", "lib-skill");
    seedSkill(t, "community", "com-skill");
    seedSkill(t, "org", "org-skill");
    assert.equal(build(t, "claude").status, 0);
    const named = run(t, CLAUDE_CMD, ["install", "claude-skills", "org-skill"], {
      home: homeDir(t, "cli-home-named"),
    });
    assert.equal(named.status, 0, both(named));
    assert.ok(t.exists("cli-home-named/.claude/skills/org-skill/SKILL.md"));
    const all = run(t, CLAUDE_CMD, ["install", "claude-skills"], {
      home: homeDir(t, "cli-home-unnamed"),
    });
    assert.equal(all.status, 0, both(all));
    for (const s of ["lib-skill", "com-skill", "org-skill"]) {
      assert.ok(t.exists(`cli-home-unnamed/.claude/skills/${s}/SKILL.md`), s);
    }
  });

  test("G5 an unnamed install places each component under its own name", () => {
    const t = newRepo();
    seedSkill(t, "community", "alpha-skill");
    seedSkill(t, "community", "beta-skill");
    assert.equal(build(t, "all").status, 0);
    const c = run(t, CLAUDE_CMD, ["install", "claude-skills"], {
      home: homeDir(t, "cli-home-claude"),
    });
    assert.equal(c.status, 0, both(c));
    for (const s of ["alpha-skill", "beta-skill"]) {
      assert.ok(t.exists(`cli-home-claude/.claude/skills/${s}/SKILL.md`), `claude ${s}`);
    }
    assert.equal(
      t.exists("cli-home-claude/.claude/skills/SKILL.md"),
      false,
      "flattened into the root",
    );
    const a = run(t, AGY_CMD, ["install", "antigravity-skills"], {
      home: homeDir(t, "cli-home-agy"),
    });
    assert.equal(a.status, 0, both(a));
    for (const s of ["alpha-skill", "beta-skill"]) {
      assert.ok(t.exists(`cli-home-agy/.gemini/config/skills/${s}/SKILL.md`), `antigravity ${s}`);
    }
  });

  test("G6 org agents install as flat .md files, named and unnamed", () => {
    const t = newRepo();
    seedAgent(t, "library", "lib-agent");
    seedAgent(t, "community", "com-agent");
    seedAgent(t, "org", "org-agent");
    assert.equal(build(t, "gemini").status, 0);
    const named = run(t, GEMINI_CMD, ["install", "agents", "org-agent"], {
      home: homeDir(t, "cli-home-named"),
    });
    assert.equal(named.status, 0, both(named));
    assert.ok(t.exists("cli-home-named/.gemini/agents/org-agent.md"));
    const all = run(t, GEMINI_CMD, ["install", "agents"], { home: homeDir(t, "cli-home-unnamed") });
    assert.equal(all.status, 0, both(all));
    for (const a of ["lib-agent", "com-agent", "org-agent"]) {
      assert.ok(t.exists(`cli-home-unnamed/.gemini/agents/${a}.md`), a);
    }
  });

  test("G7 present-but-empty library and community types do not mask org", () => {
    const t = newRepo();
    seedEmptyType(t, "library", "skills");
    seedEmptyType(t, "community", "skills");
    seedSkill(t, "org", "acme-review");
    assert.equal(build(t, "gemini").status, 0);
    const o = run(t, GEMINI_CMD, ["install", "skills", "acme-review"]);
    assert.equal(o.status, 0, both(o));
    assert.ok(t.exists("cli-home/.gemini/skills/acme-review"));
  });

  test("G8 install-workspace runs every type even when one fails", () => {
    const t = newRepo();
    seedSkill(t, "library", "lib-skill");
    seedSkill(t, "community", "keeper-skill");
    seedSkill(t, "community", "acme-review");
    seedSkill(t, "org", "acme-review");
    seedAgent(t, "community", "com-agent");
    seedCommand(t, "community", "com-command");
    seedHook(t, "library", "lib-hook");
    seedPolicy(t, "community", "com-policy");
    seedJson(t, "community", "mcp-servers", "acme-mcp");
    seedJson(t, "community", "themes", "acme-theme");
    const o = run(t, "scripts/install-workspace.sh", ["install"]);
    assert.notEqual(o.status, 0, "the wrapper must report the failed type");
    assert.equal(t.exists("cli-home/.gemini/skills/acme-review"), false);
    assert.ok(t.exists("cli-home/.gemini/hooks/lib-hook.sh"), "hooks (position 3)");
    assert.ok(t.exists("cli-home/.gemini/policies/com-policy.md"), "policies (after the failure)");
    // `agents` is deliberately not asserted: the Bash suite excluded it for the same reason.
    const settings = JSON.parse(t.read("cli-home/.gemini/settings.json")) as {
      mcpServers?: Record<string, unknown>;
      themes?: Record<string, unknown>;
    };
    assert.ok(settings.mcpServers?.["acme-mcp"] !== undefined, "mcp-servers ran");
    assert.ok(settings.themes?.["acme-theme"] !== undefined, "themes ran");
  });

  test("G9 a refused rebuild is reported as itself, not as an unresolved name", () => {
    const t = newRepo();
    seedSkill(t, "library", "acme-review");
    seedSkill(t, "org", "acme-review");
    const o = run(t, CLAUDE_CMD, ["install", "claude-skills", "zz-absent"]);
    assert.notEqual(o.status, 0);
    assert.match(both(o), /acme-review/);
    assert.doesNotMatch(both(o), UNRESOLVED_REPORT_RE);
  });
});
