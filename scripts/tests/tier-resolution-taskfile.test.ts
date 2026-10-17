// Spec 0119 R19 (ported from test-component-tier-resolution.sh case 20 and the hygiene case):
// the twelve documented task entry points, plus install-workspace reached directly.
// DEVIATION from the Bash case: the entries are `cmds:` lists driving the TypeScript entries
// (the Bash form expected a single `cmd:` running the shell shim and was red at the base commit).
// Retires with scripts/lib/common.sh (row J4): POSIX-only.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, test } from "node:test";
import { REPO } from "./lib/build-fixture-tree.ts";
import {
  both,
  build,
  newRepo,
  seedAgent,
  seedCommand,
  seedHook,
  seedJson,
  seedPolicy,
  seedSkill,
} from "./lib/tier-fixtures.ts";
import { runIn } from "./lib/tier-landing.ts";
import { driveTask, taskfileCmds } from "./lib/tier-taskfile.ts";

const skip =
  process.platform === "win32" ? "the entries run Bash-era scripts and POSIX paths" : false;

const porcelain = (): string => {
  const r = spawnSync("git", ["-C", REPO, "status", "--porcelain"], { encoding: "utf8" });
  // Sibling work under scripts/tests/ legitimately changes while suites run.
  return r.stdout
    .split("\n")
    .filter((l) => !l.includes("scripts/tests/"))
    .join("\n");
};
const before = porcelain();

interface Entry {
  readonly task: string;
  readonly script: string;
  readonly stdin: string;
  readonly vars: { TYPE?: string; NAME?: string };
  readonly delivers: readonly string[];
}
const ORG = { TYPE: "skills", NAME: "org-skill" };
const CLAUDE_ORG = { TYPE: "claude-skills", NAME: "org-skill" };
const AGY_ORG = { TYPE: "antigravity-skills", NAME: "org-skill" };
const ENTRIES: readonly Entry[] = [
  {
    task: "install-workspace",
    script: "install-workspace",
    stdin: "",
    vars: {},
    delivers: [".gemini/skills/com-skill"],
  },
  {
    task: "install-component",
    script: "manage-workspace-component",
    stdin: "",
    vars: ORG,
    delivers: [".gemini/skills/org-skill"],
  },
  {
    task: "link-component",
    script: "manage-workspace-component",
    stdin: "",
    vars: ORG,
    delivers: [".gemini/skills/org-skill"],
  },
  {
    task: "link-workspace",
    script: "install-workspace",
    stdin: "",
    vars: {},
    delivers: [".gemini/skills/com-skill"],
  },
  {
    task: "install-copilot-component",
    script: "manage-copilot-component",
    stdin: "",
    vars: ORG,
    delivers: [".copilot/skills/org-skill"],
  },
  {
    task: "link-copilot-component",
    script: "manage-copilot-component",
    stdin: "y",
    vars: ORG,
    delivers: [".copilot/skills/org-skill"],
  },
  {
    task: "install-claude-workspace",
    script: "manage-claude-component",
    stdin: "",
    vars: {},
    delivers: [".claude/skills/lib-skill", ".claude/skills/org-skill"],
  },
  {
    task: "link-claude-workspace",
    script: "manage-claude-component",
    stdin: "y",
    vars: {},
    delivers: [".claude/skills/com-skill"],
  },
  {
    task: "install-claude-component",
    script: "manage-claude-component",
    stdin: "",
    vars: CLAUDE_ORG,
    delivers: [".claude/skills/org-skill"],
  },
  {
    task: "link-claude-component",
    script: "manage-claude-component",
    stdin: "y",
    vars: CLAUDE_ORG,
    delivers: [".claude/skills/org-skill"],
  },
  {
    task: "install-antigravity-component",
    script: "manage-antigravity-component",
    stdin: "",
    vars: AGY_ORG,
    delivers: [".gemini/config/skills/org-skill"],
  },
  {
    task: "link-antigravity-component",
    script: "manage-antigravity-component",
    stdin: "y",
    vars: AGY_ORG,
    delivers: [".gemini/config/skills/org-skill"],
  },
];

describe("tier resolution: task entry points (R19)", { skip }, () => {
  const t = newRepo();
  seedSkill(t, "library", "lib-skill");
  seedSkill(t, "community", "com-skill");
  seedSkill(t, "org", "org-skill");
  seedAgent(t, "community", "com-agent");
  seedCommand(t, "community", "com-command");
  seedHook(t, "community", "com-hook");
  seedPolicy(t, "community", "com-policy");
  seedJson(t, "community", "mcp-servers", "acme-mcp");
  seedJson(t, "community", "themes", "acme-theme");
  const built = build(t, "all");

  test("the fixture build succeeds", () => {
    assert.equal(built.status, 0, both(built));
  });

  for (const e of ENTRIES) {
    test(`${e.task} drives ${e.script} and delivers`, () => {
      const cmds = taskfileCmds(t.resolve("Taskfile.yml"), e.task);
      assert.ok(cmds.length > 0, `${e.task}: no such entry point (or it declares no command)`);
      assert.ok(
        cmds.some((c) => c.includes(`${e.script}.sh`) || c.includes(`${e.script}.ts`)),
        `${e.task}: no longer drives ${e.script} (${cmds.join("; ")})`,
      );
      // A fresh home per entry keeps one entry's delivery from satisfying another's.
      const h = t.resolve(`cli-home-${e.task}`);
      runIn(t, "mkdir", ["-p", h], t.resolve("cli-home"));
      const o = driveTask(t, e.task, e.vars, h, e.stdin);
      assert.equal(o.status, 0, `${e.task}: ${both(o).slice(0, 300)}`);
      for (const d of e.delivers)
        assert.ok(t.exists(`cli-home-${e.task}/${d}`), `${e.task}: no ${d}`);
    });
  }

  test("scripts/install-workspace reached directly delivers the policy", () => {
    const h = t.resolve("cli-home-direct");
    runIn(t, "mkdir", ["-p", h], t.resolve("cli-home"));
    const o = runIn(t, process.execPath, [t.resolve("scripts/install-workspace.ts"), "install"], h);
    assert.equal(o.status, 0, both(o).slice(0, 300));
    assert.ok(t.exists("cli-home-direct/.gemini/policies/com-policy.md"));
  });
});

test("hygiene: the suite leaves the real repository unchanged", () => {
  assert.equal(porcelain(), before);
});
