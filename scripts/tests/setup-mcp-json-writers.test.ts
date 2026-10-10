// setup-mcp-json-writers.test.ts — the Copilot and Antigravity MCP files (spec 0256 requirement 27):
// capture before the overwrite, framework content, merge back. The expected bytes come from the
// shell's own `jq` programs run on the same inputs, so the test is skipped where `jq` is absent.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import type { JsonValue } from "../lib/extension/types.ts";
import {
  backupAndCapture,
  writeAntigravityMcpConfig,
  writeCopilotMcpConfig,
} from "../lib/setup/mcp-json-writers.ts";
import { JQ, OPERATOR, box, PY, TEMPLATE, jq, seed, writeJson } from "./lib/mcp-writers-box.ts";
import type { Box } from "./lib/mcp-writers-box.ts";

/** The shell's Copilot sequence: template patch, Sequential Thinking wrap, merge (common.sh). */
function shellCopilot(b: Box, pre: string, withMempalace: boolean): string {
  const tlsexec = `${b.repo}/scripts/lib/tls-exec.sh`;
  const template = fs.readFileSync(TEMPLATE, "utf8");
  const patched = withMempalace
    ? jq(template, [
        "--arg",
        "tlsexec",
        tlsexec,
        "--arg",
        "py",
        PY,
        "--arg",
        "repo",
        b.repo,
        '.mcpServers.mempalace.command = "bash" | .mcpServers.mempalace.args = ([$tlsexec, $py] + (.mcpServers.mempalace.args | map(gsub("__CREWRIG_REPO_DIR__"; $repo))))',
      ])
    : jq(template, ["del(.mcpServers.mempalace)"]);
  const wrapped = jq(patched, [
    "--arg",
    "tlsexec",
    tlsexec,
    'if .mcpServers.sequentialthinking then .mcpServers.sequentialthinking.args = ([$tlsexec, .mcpServers.sequentialthinking.command] + .mcpServers.sequentialthinking.args) | .mcpServers.sequentialthinking.command = "bash" else . end',
  ]);
  fs.writeFileSync(path.join(b.root, "pre.json"), pre);
  return jq(wrapped, [
    "--slurpfile",
    "pre",
    path.join(b.root, "pre.json"),
    "--argjson",
    "reserved",
    '["mempalace","sequentialthinking"]',
    "def preserved: reduce $reserved[] as $r ($pre[0]; del(.[$r])); .mcpServers = ((.mcpServers // {}) + preserved)",
  ]);
}

test(
  "copilot: the operator server is captured before the overwrite and merged back",
  { skip: !JQ },
  () => {
    const b = box();
    try {
      seed(b.target, OPERATOR);
      const captured = backupAndCapture(b.ctx, b.target);
      assert.match(b.out[0] ?? "", /^ {2}Backed up: mcp-config\.json -> mcp-config\.json\.bak\./);
      assert.notEqual(captured.backup, "");
      const result = writeCopilotMcpConfig({
        ctx: b.ctx,
        entries: b.entries,
        writeJson,
        target: b.target,
        captured,
      });
      const text = fs.readFileSync(b.target, "utf8");
      assert.equal(text, shellCopilot(b, JSON.stringify(OPERATOR.mcpServers), true));
      assert.deepEqual(
        [...(result.config.get("mcpServers") as Map<string, JsonValue>).keys()],
        ["mempalace", "sequentialthinking", "operator-tool"],
      );
      assert.ok(
        text.includes('"__CREWRIG_REPO_DIR__/op.js"'),
        "the operator's placeholder stays literal",
      );
      assert.equal(
        b.out.at(-1),
        "  Installed: mcp-config.json (mempalace patched with detected Python + wrapper path)",
      );
      if (process.platform !== "win32") assert.equal(fs.statSync(b.target).mode & 0o777, 0o600);
    } finally {
      fs.rmSync(b.root, { recursive: true, force: true });
    }
  },
);

test("copilot: no MemPalace removes mcpServers.mempalace and says so", { skip: !JQ }, () => {
  const b = box();
  try {
    const captured = backupAndCapture(b.ctx, b.target);
    assert.equal(captured.backup, "");
    writeCopilotMcpConfig({
      ctx: b.ctx,
      entries: { ...b.entries, mempalace: undefined },
      writeJson,
      target: b.target,
      captured,
    });
    assert.equal(fs.readFileSync(b.target, "utf8"), shellCopilot(b, "{}", false));
    assert.ok(!fs.readFileSync(b.target, "utf8").includes('"mempalace"'));
    assert.deepEqual(b.out, ["  Installed: mcp-config.json (mempalace omitted from mcpServers)"]);
  } finally {
    fs.rmSync(b.root, { recursive: true, force: true });
  }
});

test("copilot: a re-run keeps the operator server and warns about the framework names", () => {
  const b = box();
  try {
    seed(b.target, OPERATOR);
    for (const run of [1, 2]) {
      b.out.length = 0;
      const captured = backupAndCapture(b.ctx, b.target);
      writeCopilotMcpConfig({
        ctx: b.ctx,
        entries: b.entries,
        writeJson,
        target: b.target,
        captured,
      });
      const servers = (
        JSON.parse(fs.readFileSync(b.target, "utf8")) as { mcpServers: Record<string, unknown> }
      ).mcpServers;
      assert.deepEqual(Object.keys(servers), ["mempalace", "sequentialthinking", "operator-tool"]);
      const warned = b.out.filter((l) => l.includes("framework-managed"));
      assert.equal(warned.length, run === 1 ? 0 : 2);
      if (run === 2) {
        assert.equal(
          warned[0],
          "  WARNING: 'mempalace' is a framework-managed MCP server — your prior 'mempalace' entry was replaced (framework wins).",
        );
        assert.match(
          b.out.join("\n"),
          /^ {11}The prior entry is preserved in the timestamped backup: .*\.bak\./m,
        );
      }
    }
  } finally {
    fs.rmSync(b.root, { recursive: true, force: true });
  }
});

test(
  "antigravity: the base, the optional servers and the merge, byte for byte with jq",
  { skip: !JQ },
  () => {
    const b = box();
    try {
      seed(b.target, OPERATOR);
      const captured = backupAndCapture(b.ctx, b.target);
      const e = {
        mempalace: { command: "bash", args: ["t", PY, "w"] },
        sequentialThinking: { command: "bash", args: ["t", "npx", "-y", "p"] },
      };
      b.out.length = 0;
      writeAntigravityMcpConfig({ ctx: b.ctx, entries: e, writeJson, target: b.target, captured });
      const base =
        '{"mcpServers":{"mempalace":{"command":"bash","args":["t","/venv/bin/python","w"]},"sequentialthinking":{"command":"bash","args":["t","npx","-y","p"]}}}';
      fs.writeFileSync(path.join(b.root, "pre.json"), JSON.stringify(OPERATOR.mcpServers));
      const expected = jq(base, [
        "--slurpfile",
        "pre",
        path.join(b.root, "pre.json"),
        "--argjson",
        "reserved",
        '["mempalace","sequentialthinking"]',
        "def preserved: reduce $reserved[] as $r ($pre[0]; del(.[$r])); .mcpServers = ((.mcpServers // {}) + preserved)",
      ]);
      assert.equal(fs.readFileSync(b.target, "utf8"), expected);
      assert.deepEqual(b.out, [
        "  mempalace MCP server configured.",
        "  sequentialthinking MCP server configured.",
      ]);
    } finally {
      fs.rmSync(b.root, { recursive: true, force: true });
    }
  },
);
