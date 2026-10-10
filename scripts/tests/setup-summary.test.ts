// setup-summary.test.ts — the `summary` step of summary.ts (spec 0256, plan v2 step B3b.2): the
// closing report of the four setups against fake descriptor data, a temporary home and a fake
// Spawner, compared with the tail of each CLI's `default-answers` golden (shell setup 552-571,
// 507-528, 490-512, 646-671). The golden's `<HOME>`/`<REPO>` are the sandbox.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import type { Cli, Spawner } from "../lib/setup/context.ts";
import type { SetupDescriptor, StepFn, SummarySpec } from "../lib/setup/descriptor.ts";
import { globToRegExp, listMatching, mcpServerKeys } from "../lib/setup/summary.ts";
import { canon, descriptor, run, sandbox, useSandbox } from "./setup-flow-fixtures.ts";

useSandbox();

const GOLDEN = path.join(import.meta.dirname, "fixtures", "setup-golden");
const BAR = "====================================";
const RESTART = "Restart any running %s to pick up the new %s.";
const PIPX = "      Install MemPalace at the supported version, then re-run this script:";

interface Row {
  readonly rules: string;
  readonly spec: SummarySpec;
  readonly homes: { settings?: string; mcpConfig?: string };
  readonly storeGuidance: boolean;
  readonly steps: SetupDescriptor["steps"];
}

const COPILOT_EXTRA = [
  "Copilot looks for skills under .github/skills/ and agents under .github/agents/.",
  "Run 'bash scripts/build-components.sh --target copilot' to (re)generate them.",
  "",
  "Transcript hooks are installed at two levels:",
  "  - User-level (~/.copilot/hooks/copilot-transcript-hooks.json): fires for ALL projects.",
  "  - Workspace-level (.github/copilot/settings.json): fires for this repo only.",
  "",
  "Note: GitHub Copilot CLI does NOT export a $COPILOT_PROJECT_DIR — hooks",
  "read the workspace path from the stdin JSON payload (or fall back to $PWD).",
];

const ROWS: Record<Cli, Row> = {
  claude: {
    rules: ".claude/rules",
    homes: {},
    storeGuidance: false,
    steps: ["mcp", "summary"],
    spec: {
      listHeader: "Active rule files:",
      listGlob: "*.md",
      mcpHeader: "MCP servers (from 'claude mcp list'):",
      mcpSource: "claude-mcp-list",
      note: "Note: MemPalace MCP server was NOT installed during this run.",
      restartLine: RESTART.replace("%s", "Claude Code session").replace("%s", "MCP servers"),
      extraLines: [],
    },
  },
  gemini: {
    rules: ".gemini",
    homes: { settings: ".gemini/settings.json" },
    storeGuidance: true,
    steps: ["mcp", "summary"],
    spec: {
      listHeader: "Active context files:",
      listGlob: "[0-9][0-9]_*.md",
      mcpHeader: "MCP servers (from settings.json):",
      mcpSource: "settings.json",
      note: "Note: MemPalace MCP server is NOT installed in settings.json.",
      restartLine: RESTART.replace("%s", "Gemini CLI session").replace("%s", "configuration"),
      extraLines: [],
    },
  },
  copilot: {
    rules: ".copilot/instructions",
    homes: { mcpConfig: ".copilot/mcp-config.json" },
    storeGuidance: true,
    steps: ["mcp", "summary"],
    spec: {
      listHeader: "Active user-level instruction files:",
      listGlob: "*.instructions.md",
      mcpHeader: "MCP servers (from mcp-config.json):",
      mcpSource: "mcp-config.json",
      extraLines: COPILOT_EXTRA,
    },
  },
  antigravity: {
    rules: ".gemini/antigravity-cli",
    homes: { mcpConfig: ".gemini/config/mcp_config.json" },
    storeGuidance: false,
    steps: ["mcp", "system-context-file", "summary"],
    spec: {
      listHeader: "Active context files:",
      listGlob: "[0-9][0-9]_*.md",
      mcpHeader: "MCP servers (from mcp_config.json):",
      mcpSource: "mcp_config.json",
      note: "Note: MemPalace MCP server is NOT installed in mcp_config.json.",
      restartLine: RESTART.replace("%s", "Antigravity CLI session").replace("%s", "configuration"),
      extraLines: [],
    },
  },
};

function build(cli: Cli): SetupDescriptor {
  const row = ROWS[cli];
  const base = descriptor(row.steps, cli);
  return {
    ...base,
    homes: { ...base.homes, rulesDir: row.rules, ...row.homes },
    storeGuidance: row.storeGuidance,
    summary: row.spec,
  };
}

/** The golden's closing block: from the `====` line above `  Setup complete` to the end. */
function goldenTail(cli: Cli): string[] {
  const text = fs.readFileSync(path.join(GOLDEN, cli, "default-answers", "stdout.golden"), "utf8");
  const lines = text.replaceAll("<HOME>", sandbox.tmp).replaceAll("<REPO>", sandbox.tmp);
  const all = lines.split("\n");
  return all.slice(all.indexOf("  Setup complete") - 1);
}

/** The lines of the golden between `header` and the next blank line. */
function section(tail: readonly string[], header: string): string[] {
  const from = tail.indexOf(header) + 1;
  const rest = tail.slice(from);
  const end = rest.indexOf("");
  return end < 0 ? rest : rest.slice(0, end);
}

function populate(cli: Cli, tail: readonly string[]): { spawn: Spawner } {
  const row = ROWS[cli];
  const dir = path.join(sandbox.tmp, row.rules);
  fs.mkdirSync(dir, { recursive: true });
  const listed = section(tail, row.spec.listHeader).map((line) => line.trim());
  for (const file of listed) fs.writeFileSync(path.join(dir, path.basename(file)), "x\n");
  fs.writeFileSync(path.join(dir, "notes.txt"), "ignored\n");
  const config = row.homes.settings ?? row.homes.mcpConfig;
  if (config !== undefined) {
    const file = path.join(sandbox.tmp, config);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({ mcpServers: { sequentialthinking: {}, mempalace: {} }, other: 1 }),
    );
  }
  const mcp = section(tail, row.spec.mcpHeader).map((line) => line.slice(2));
  const spawn: Spawner = (argv) => {
    assert.deepEqual(argv, ["claude", "mcp", "list"]);
    return { status: 0, stdout: `${mcp.join("\n")}\n`, stderr: "" };
  };
  return { spawn };
}

function pin(): void {
  const file = path.join(sandbox.tmp, "scripts", "lib", "common.sh");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'MEMPALACE_MIN_VERSION="3.6.0"\nMEMPALACE_MAX_VERSION_EXCLUSIVE="3.7"\n');
}

function setup(installed: boolean, lines = 0): Record<string, StepFn> {
  const mark: StepFn = async ({ state }) => {
    state.mempalaceInstalled = installed;
  };
  const agents: StepFn = async ({ state }) => {
    state.agentsMdLines = lines;
  };
  return { mcp: mark, "system-context-file": agents };
}

describe("summary step", () => {
  for (const cli of ["claude", "gemini", "copilot", "antigravity"] as const) {
    test(`${cli}: reproduces the default-answers golden tail`, async () => {
      const tail = goldenTail(cli);
      const { spawn } = populate(cli, tail);
      const result = await run(build(cli), setup(true, 1049), { spawn });
      assert.equal(result.status, 0);
      // The leading blank is this step's, except after Antigravity's system-context-file step.
      const lead = cli === "antigravity" ? "" : "\n";
      assert.equal(canon(result.out), canon(`${lead}${tail.join("\n")}`));
      assert.equal(result.err, "");
    });
  }

  test("MemPalace missing: the note and the pin lines, except for Copilot", async () => {
    pin();
    for (const cli of ["claude", "gemini", "antigravity"] as const) {
      const { spawn } = populate(cli, goldenTail(cli));
      const result = await run(build(cli), setup(false), { spawn });
      const note = ROWS[cli].spec.note ?? "";
      assert.ok(
        result.out.includes(`${note}\n${PIPX}\n      pipx install 'mempalace>=3.6.0,<3.7'\n\n`),
        cli,
      );
    }
    const { spawn } = populate("copilot", goldenTail("copilot"));
    const copilot = await run(build("copilot"), setup(false), { spawn });
    assert.ok(!copilot.out.includes("NOT installed"));
  });

  test("an unreadable pin exits 1 with one Error line", async () => {
    const { spawn } = populate("claude", goldenTail("claude"));
    const result = await run(build("claude"), setup(false), { spawn });
    assert.equal(result.status, 1);
    assert.match(result.err, /^Error: cannot read the MemPalace pin: .+\n$/);
  });

  test("--link prints the install mode link", async () => {
    const { spawn } = populate("claude", goldenTail("claude"));
    const result = await run(build("claude"), setup(true), { spawn, argv: ["--link"] });
    assert.match(result.out, /\nInstall mode: link\n/);
  });

  test("Antigravity prints '(not generated)' when no AGENTS.md was written", async () => {
    const { spawn } = populate("antigravity", goldenTail("antigravity"));
    const result = await run(build("antigravity"), setup(true, 0), { spawn });
    assert.match(
      result.out,
      /System context file \(Antigravity runtime\):\n {2}\(not generated\)\n\n/,
    );
  });

  test("no rule file: '  (none)' for the bare ls lists, nothing for the indented ones", async () => {
    const claude = await run(build("claude"), setup(true), {
      spawn: () => ({ status: 1, stdout: "", stderr: "boom" }),
    });
    assert.match(
      claude.out,
      /Active rule files:\n {2}\(none\)\n\nMCP servers \(from 'claude mcp list'\):\n\n/,
    );
    const gemini = await run(build("gemini"), setup(true));
    assert.match(gemini.out, /Active context files:\n\nMCP servers \(from settings.json\):\n\n/);
  });
});

describe("summary helpers", () => {
  test("globToRegExp covers the three globs of the setups", () => {
    assert.ok(globToRegExp("*.md").test("a.md"));
    assert.ok(!globToRegExp("*.md").test("a.mdx"));
    assert.ok(globToRegExp("[0-9][0-9]_*.md").test("00_SOUL.md"));
    assert.ok(!globToRegExp("[0-9][0-9]_*.md").test("0_SOUL.md"));
    assert.ok(globToRegExp("*.instructions.md").test("00-soul.instructions.md"));
    assert.ok(!globToRegExp("*.instructions.md").test("00-soulxinstructions.md"));
  });

  test("listMatching sorts, skips dotfiles and tolerates a missing directory", () => {
    const dir = path.join(sandbox.tmp, "d");
    fs.mkdirSync(dir);
    for (const name of ["b.md", "a.md", ".h.md", "c.txt"])
      fs.writeFileSync(path.join(dir, name), "");
    assert.deepEqual(listMatching(dir, "*.md"), [path.join(dir, "a.md"), path.join(dir, "b.md")]);
    assert.deepEqual(listMatching(path.join(dir, "nope"), "*.md"), []);
  });

  test("mcpServerKeys is jq '.mcpServers // {} | keys[]': sorted keys, nothing on bad input", () => {
    const file = path.join(sandbox.tmp, "c.json");
    fs.writeFileSync(file, JSON.stringify({ mcpServers: { z: 1, a: 2 } }));
    assert.deepEqual(mcpServerKeys(file), ["a", "z"]);
    for (const body of ["{", "[]", '{"mcpServers":null}', '{"mcpServers":[1]}', '{"x":1}']) {
      fs.writeFileSync(file, body);
      assert.deepEqual(mcpServerKeys(file), [], body);
    }
    assert.deepEqual(mcpServerKeys(path.join(sandbox.tmp, "missing.json")), []);
    assert.deepEqual(mcpServerKeys(undefined), []);
  });
});
