// Spec 0119 requirements 3, 6, 16-18 (ported from test-component-tier-resolution.sh cases 14-17).
// Retires with retired scripts/lib/common.sh (row J4): POSIX-only, the shims run under bash.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { before, describe, test } from "node:test";
import { taskfilePaths } from "../lib/taskfile-tree.ts";
import {
  AGY_CMD,
  CLAUDE_CMD,
  COPILOT_CMD,
  GEMINI_CMD,
  both,
  build,
  newRepo,
  reportView,
  run,
  seedSkill,
} from "./lib/tier-fixtures.ts";

const skip = process.platform === "win32" ? "the shims are Bash scripts" : false;

describe("tier resolution: landing zones and reports", { skip }, () => {
  test("R3: a non-core per-component install leaves the committed checkout clean", () => {
    const t = newRepo();
    seedSkill(t, "community", "acme-review");
    const git = (...a: string[]) =>
      spawnSync(
        "git",
        [
          "-C",
          t.root,
          "-c",
          "user.name=t",
          "-c",
          "user.email=t@example.invalid",
          "-c",
          "commit.gpgsign=false",
          ...a,
        ],
        { encoding: "utf8" },
      );
    git("init");
    git("add", "scripts", ...taskfilePaths(t.root), ".gitignore", "artifacts");
    if (t.exists("crewrig.config.toml")) git("add", "crewrig.config.toml");
    assert.equal(git("commit", "-m", "fixture").status, 0);
    assert.equal(build(t, "copilot").status, 0);

    const o = run(t, COPILOT_CMD, ["install", "skills", "acme-review"]);
    const porcelain = git("status", "--porcelain").stdout;
    assert.equal(porcelain, "", `a non-core install modified the committed tree:\n${porcelain}`);
    // Non-vacuity: something really landed.
    assert.ok(t.exists("cli-home/.copilot/skills/acme-review"), both(o));
  });

  test("R6: the core tier is unreachable from all four per-component commands", () => {
    const t = newRepo();
    seedSkill(t, "core", "core-only");
    seedSkill(t, "community", "com-skill");
    // Only claude is built: .github/skills is absent beforehand, which makes the Copilot arm decisive.
    assert.equal(build(t, "claude").status, 0);
    const claude = run(t, CLAUDE_CMD, ["install", "claude-skills", "core-only"]);
    assert.notEqual(claude.status, 0, "claude: exited zero for a core-only component");
    assert.equal(t.exists("cli-home/.claude/skills/core-only"), false, "claude installed core");

    const gemini = run(t, GEMINI_CMD, ["install", "skills", "core-only"]);
    assert.notEqual(gemini.status, 0, "gemini: exited zero for a core-only component");
    assert.equal(t.exists("cli-home/.gemini/skills/core-only"), false, "gemini installed core");

    const agy = run(t, AGY_CMD, ["install", "antigravity-skills", "core-only"]);
    assert.notEqual(agy.status, 0, "antigravity: exited zero for a core-only component");
    assert.equal(t.exists("cli-home/.gemini/config/skills/core-only"), false, "agy installed core");

    run(t, COPILOT_CMD, ["install", "skills", "core-only"]);
    assert.equal(
      t.exists(".github/skills/core-only"),
      false,
      "copilot wrote core into the project tree",
    );
    assert.equal(
      t.exists("cli-home/.copilot/skills/core-only"),
      false,
      "copilot installed core in home",
    );
  });

  describe("R16-R18: an unresolvable name is reported with every searched tier", () => {
    const t = newRepo();
    before(() => {
      seedSkill(t, "library", "lib-skill");
      seedSkill(t, "community", "com-skill");
      seedSkill(t, "org", "org-skill");
      assert.equal(build(t, "all").status, 0);
    });

    for (const [label, cmd, args] of [
      ["Copilot", COPILOT_CMD, ["install", "skills", "no-such-component"]],
      ["Claude", CLAUDE_CMD, ["install", "claude-skills", "no-such-component"]],
    ] as const) {
      test(`the ${label} command names the subject and every searched tier`, () => {
        const o = run(t, cmd, args);
        assert.notEqual(o.status, 0, "the command exited zero on an unresolvable name");
        const view = reportView(o);
        assert.ok(view.trim() !== "", "the report is empty (the miss is silent)");
        assert.ok(view.includes("no-such-component"), "the requested name is not the subject");
        for (const tier of ["library", "community", "org"])
          assert.ok(view.includes(tier), `the report does not name the ${tier} tier`);
        assert.doesNotMatch(
          view,
          /build-components\.sh|run a build|missing build/,
          "the miss is blamed on a missing build step",
        );
      });
    }
  });
});
