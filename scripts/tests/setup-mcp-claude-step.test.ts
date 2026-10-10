// setup-mcp-claude-step.test.ts — the Claude `mcp` step (mcp-claude-step.ts) over a fake `claude mcp`
// Spawner: print order, the rc 0/1/2 arms, the Chroma failure and the org fold. The expected lines
// are those of the golden cells claude/{default-answers,ensure-http-rc1,ensure-http-rc2,
// chroma-install-failure,org-mcp-declared,mempalace-without-packaging}; the Chroma installer and
// the daemon contract are replaced by seams (their own tests cover them).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import { SetupExit } from "../lib/setup/exit.ts";
import { run } from "../lib/setup/mcp-claude-step.ts";
import type { Harness, HarnessOptions } from "./setup-mcp-claude-gemini-fixtures.ts";
import { CHROMA_HEADER, harness, PYTHON } from "./setup-mcp-claude-gemini-fixtures.ts";

let h: Harness | undefined;
afterEach(() => h?.cleanup());

function start(options: Partial<HarnessOptions> = {}): Harness {
  h?.cleanup();
  h = harness({ cli: "claude", python: [PYTHON], ...options });
  return h;
}

const HEAD = [
  "Configuring MCP servers via 'claude mcp add --scope user'...",
  "",
  "Sequential Thinking MCP server (working memory):",
  "  Command: npx -y @modelcontextprotocol/server-sequential-thinking",
  "  sequentialthinking: registered (scope=user)",
  "",
  "MemPalace MCP server (persistent agent memory):",
];
const DETECTED = `  Detected interpreter: ${PYTHON} (mempalace 3.6.0)`;
/** The offer's output when `pipx` is not on the (empty) PATH of the test context. */
const NO_PIPX = [
  "  pipx not found — install MemPalace manually:",
  "    pipx install 'mempalace>=3.6.0,<3.7'",
  "  Install pipx: brew install pipx (macOS) or python3 -m pip install --user pipx",
];
const CHROMA = ["", CHROMA_HEADER, "  Installed: unit"];
const SETTINGS = ["", "  Installed: settings.json", ""];
const exits = (status: number) => (e: unknown) => e instanceof SetupExit && e.status === status;

describe("Claude mcp step", () => {
  it("rc 0: header, seqthink, MemPalace, Chroma, no stdio entry, settings", async () => {
    const t = start();
    await run(t.env);
    assert.deepEqual(t.out, [...HEAD, DETECTED, ...CHROMA, ...SETTINGS]);
    assert.deepEqual(t.asked, ["install-seqthink", "install-settings"]);
    const { state } = t.env;
    assert.equal(state.mempalaceInstalled, true);
    assert.equal(state.pythonBin, PYTHON);
    assert.equal(state.mempalaceVersion, "3.6.0");
    assert.equal(state.settingsTarget, path.join(t.home, ".claude", "settings.json"));
    assert.deepEqual([...t.servers.keys()], ["sequentialthinking"]);
    assert.ok(fs.existsSync(path.join(t.home, ".claude", "settings.json")));
  });

  it("declining Sequential Thinking prints the skip line", async () => {
    const t = start({ answers: { "install-seqthink": "no" } });
    await run(t.env);
    assert.deepEqual(t.out.slice(2, 6), [
      "Sequential Thinking MCP server (working memory):",
      "  Command: npx -y @modelcontextprotocol/server-sequential-thinking",
      "  Sequential Thinking install skipped.",
      "",
    ]);
    assert.equal(t.servers.size, 0);
  });

  it("rc 1: removes the user-scope entry, then registers the stdio wrapper", async () => {
    const t = start({ ensure: 1, preRegistered: ["mempalace"] });
    await run(t.env);
    assert.deepEqual(t.out, [
      ...HEAD,
      DETECTED,
      ...CHROMA,
      "  mempalace: registered (scope=user)",
      "  Converged mempalace to the stdio http-wrapper entry (no serving daemon available).",
      ...SETTINGS,
    ]);
    assert.match(t.servers.get("mempalace") ?? "", /mempalace-http-wrapper\.py$/);
    assert.equal(t.env.state.mempalaceInstalled, true);
    const writes = t.calls.filter((c) => c[2] === "remove" || c[2] === "add").map((c) => c[2]);
    assert.deepEqual(writes, ["add", "remove", "add"]);
  });

  it("rc 1 with a failing stdio add: the FAILED and ERROR lines, not installed", async () => {
    const t = start({ ensure: 1, addFails: ["mempalace"] });
    await run(t.env);
    const at = t.out.indexOf("  Installed: unit") + 1;
    assert.match(
      t.out[at] ?? "",
      /^ {2}mempalace: FAILED to register — re-run manually: claude mcp add/,
    );
    assert.equal(
      t.out[at + 1],
      "  ERROR: could not register even the stdio fallback for mempalace.",
    );
    assert.equal(t.env.state.mempalaceInstalled, false);
  });

  it("rc 2 keeps an existing registration", async () => {
    const t = start({ ensure: 2, preRegistered: ["mempalace"] });
    await run(t.env);
    assert.deepEqual(t.out.slice(HEAD.length + 1 + CHROMA.length, -SETTINGS.length), [
      "  Existing mempalace registration kept (the daemon is verified serving).",
    ]);
    assert.equal(t.env.state.mempalaceInstalled, true);
    assert.equal(t.calls.filter((c) => c[2] === "remove").length, 0);
  });

  it("rc 2 without an entry warns and writes nothing", async () => {
    const t = start({ ensure: 2 });
    await run(t.env);
    assert.deepEqual(t.out.slice(HEAD.length + 1 + CHROMA.length, -SETTINGS.length), [
      "  WARNING: no mempalace registration could be written although the daemon is verified serving.",
    ]);
    assert.equal(t.env.state.mempalaceInstalled, false);
    assert.deepEqual([...t.servers.keys()], ["sequentialthinking"]);
  });

  it("no MemPalace: prints the note, registers nothing, skips Chroma and the daemon", async () => {
    const t = start({ python: [undefined] });
    await run(t.env);
    assert.deepEqual(t.out, [...HEAD, "  MemPalace not found.", ...NO_PIPX, ...SETTINGS]);
    assert.equal(t.env.state.mempalaceInstalled, false);
    assert.equal(t.env.state.pythonBin, undefined);
  });

  it("MemPalace installed by the offer is detected on the second look", async () => {
    const t = start({ python: [undefined, PYTHON] });
    await run(t.env);
    assert.deepEqual(t.out.slice(HEAD.length, HEAD.length + 5), [
      "  MemPalace not found.",
      ...NO_PIPX,
      DETECTED,
    ]);
    assert.equal(t.env.state.mempalaceInstalled, true);
  });

  it("an out-of-range version prints the two ERROR lines and exits 1 before Chroma", async () => {
    const t = start({ version: "3.7.0" });
    await assert.rejects(run(t.env), exits(1));
    assert.deepEqual(t.out.slice(HEAD.length), [
      "  ERROR: MemPalace 3.7.0 is outside the supported range >=3.6.0,<3.7.",
      "         Install a supported version with: pipx install --force 'mempalace>=3.6.0,<3.7'",
    ]);
  });

  it("a failed Chroma install exits 1 before any MemPalace registration", async () => {
    const t = start({ chromaOk: false });
    await assert.rejects(run(t.env), exits(1));
    assert.deepEqual(t.out, [...HEAD, DETECTED, ...CHROMA]);
    assert.deepEqual([...t.servers.keys()], ["sequentialthinking"]);
  });

  it("org manifest: registers, refuses reserved names, replaces an operator entry", async () => {
    const t = start({ preRegistered: ["acme-old"] });
    fs.writeFileSync(
      path.join(t.repo, "mcp-servers.org.json"),
      JSON.stringify({
        mcpServers: {
          "acme-old": { command: "old-cmd" },
          "acme-tools": { command: "acme" },
          mempalace: { command: "x" },
        },
      }),
    );
    await run(t.env);
    const at = t.out.indexOf(CHROMA[2] ?? "") + 1;
    assert.deepEqual(t.out.slice(at), [
      "Registering org-declared MCP servers from mcp-servers.org.json (spec 0091)...",
      "  WARNING: org-declared MCP server 'acme-old' overrides your pre-existing 'acme-old' entry (org declaration wins).",
      "  acme-old: org declaration registered (replaced prior entry)",
      "  acme-tools: org declaration registered",
      "  WARNING: 'mempalace' is a framework-managed MCP server — the org declaration for 'mempalace' was NOT applied (framework wins).",
      "",
      ...SETTINGS,
    ]);
    assert.equal(t.servers.get("acme-old"), "old-cmd");
  });

  it("a failed org replacement restores the operator's entry in ~/.claude.json", async () => {
    const t = start({ preRegistered: ["acme-old"], addFails: ["acme-old"] });
    fs.writeFileSync(
      path.join(t.repo, "mcp-servers.org.json"),
      JSON.stringify({ mcpServers: { "acme-old": { command: "new" } } }),
    );
    const config = path.join(t.home, ".claude.json");
    fs.writeFileSync(config, JSON.stringify({ mcpServers: { "acme-old": { command: "mine" } } }));
    await run(t.env);
    assert.ok(
      t.out.includes(
        "  acme-old: FAILED to register org declaration — restoring your prior entry.",
      ),
    );
    assert.ok(t.out.includes("  acme-old: prior entry restored from ~/.claude.json."));
    assert.deepEqual(JSON.parse(fs.readFileSync(config, "utf8")), {
      mcpServers: { "acme-old": { command: "mine" } },
    });
  });

  it("the legacy mcp.json question and an existing settings.json follow the shell", async () => {
    const t = start({ answers: { "legacy-mcp-removal": "yes" } });
    fs.writeFileSync(path.join(t.home, ".claude", "mcp.json"), "{}");
    fs.writeFileSync(path.join(t.home, ".claude", "settings.json"), "{}");
    await run(t.env);
    const legacy = path.join(t.home, ".claude", "mcp.json");
    const tail = t.out.slice(HEAD.length + 1 + CHROMA.length);
    assert.match(tail[3] ?? "", /^ {2}Backed up: mcp\.json -> mcp\.json\.bak\./);
    tail.splice(3, 1);
    assert.deepEqual(tail, [
      "",
      `Note: ${legacy} is a legacy file and is NOT read by Claude Code.`,
      "      Active MCP config lives in ~/.claude.json.",
      "  Legacy mcp.json removed.",
      "",
      "  settings.json already exists, skipping.",
      "",
    ]);
    assert.deepEqual(t.asked, ["install-seqthink", "legacy-mcp-removal"]);
    assert.ok(!fs.existsSync(legacy));
  });
});
