// setup-mcp-gemini-step.test.ts — the Gemini `mcp` step (mcp-gemini-step.ts): the settings.json
// merge through the real writer in a temporary home, then the daemon call site. The expected lines
// are those of the golden cells gemini/{default-answers,ensure-http-rc1,ensure-http-rc2,
// gemini-settings-merge,chroma-install-failure,mempalace-without-packaging,org-mcp-declared}.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import { SetupExit } from "../lib/setup/exit.ts";
import { run } from "../lib/setup/mcp-gemini-step.ts";
import type { Harness, HarnessOptions } from "./setup-mcp-claude-gemini-fixtures.ts";
import { CHROMA_HEADER, harness, PYTHON } from "./setup-mcp-claude-gemini-fixtures.ts";

let h: Harness | undefined;
afterEach(() => h?.cleanup());

function start(options: Partial<HarnessOptions> = {}): Harness {
  h?.cleanup();
  h = harness({ cli: "gemini", python: [PYTHON], ...options });
  return h;
}

const HEAD = ["Configuring ~/.gemini/settings.json..."];
const DETECTED = `  Detected MemPalace interpreter: ${PYTHON} (mempalace 3.6.0)`;
const CHROMA = ["", CHROMA_HEADER, "  Installed: unit"];
const MERGED =
  "  Merged: settings.json (existing content kept; mempalace registered with the detected Python + wrapper path)";
const OMITTED =
  "  Merged: settings.json (existing content kept; mempalace omitted from mcpServers)";
const exits = (status: number) => (e: unknown) => e instanceof SetupExit && e.status === status;
const settings = (t: Harness): string => path.join(t.home, ".gemini", "settings.json");
const doc = (t: Harness): Record<string, unknown> => {
  const parsed: unknown = JSON.parse(fs.readFileSync(settings(t), "utf8"));
  assert.ok(typeof parsed === "object" && parsed !== null);
  return Object.fromEntries(Object.entries(parsed));
};
const servers = (t: Harness): Record<string, unknown> => {
  const held = doc(t)["mcpServers"];
  assert.ok(typeof held === "object" && held !== null);
  return Object.fromEntries(Object.entries(held));
};

describe("Gemini mcp step", () => {
  it("rc 0: detect, Chroma, merge, the HTTP line, the closing blank line", async () => {
    const t = start();
    await run(t.env);
    assert.deepEqual(t.out, [
      ...HEAD,
      DETECTED,
      ...CHROMA,
      MERGED,
      "  MemPalace reaches shared memory through the HTTP daemon.",
      "",
    ]);
    assert.deepEqual(t.asked, []);
    const { state } = t.env;
    assert.equal(state.mempalaceInstalled, true);
    assert.equal(state.pythonBin, PYTHON);
    assert.equal(state.mempalaceVersion, "3.6.0");
    assert.equal(state.settingsTarget, settings(t));
    assert.ok("mempalace" in servers(t));
    assert.deepEqual(t.err, []);
  });

  it("rc 1: the stdio entry stays and the warning is printed", async () => {
    const t = start({ ensure: 1 });
    await run(t.env);
    assert.deepEqual(t.out.slice(HEAD.length + 1 + CHROMA.length), [
      MERGED,
      "  WARNING: mempalace stays on the stdio arrangement — no shared",
      "           daemon could be established. Sessions will contend for",
      "           the palace writer lock until the daemon is up.",
      "",
    ]);
    assert.equal(t.env.state.mempalaceInstalled, true);
    assert.ok("mempalace" in servers(t));
  });

  it("rc 2: the lockout warning", async () => {
    const t = start({ ensure: 2 });
    await run(t.env);
    assert.deepEqual(t.out.slice(HEAD.length + 1 + CHROMA.length), [
      MERGED,
      "  LOCKOUT WARNING: the daemon is verified serving but registration",
      "           could not be completed, so the stdio entry just written",
      "           will be refused by the shared writer lock (MCP error",
      "           -32001) in every session.",
      "",
    ]);
    assert.equal(t.env.state.mempalaceInstalled, true);
  });

  it("no MemPalace: mempalace omitted, no Chroma and no daemon call", async () => {
    let ensured = false;
    const t = start({
      python: [undefined],
      seams: { ensure: async () => ((ensured = true), 0) },
    });
    await run(t.env);
    assert.deepEqual(t.out.slice(0, 2), [...HEAD, "  MemPalace not found."]);
    assert.equal(t.out.at(-2), OMITTED);
    assert.equal(t.out.at(-1), "");
    assert.ok(!t.out.includes(CHROMA_HEADER));
    assert.equal(ensured, false);
    assert.equal(t.env.state.mempalaceInstalled, false);
    assert.ok(!("mempalace" in servers(t)));
  });

  it("an out-of-range version prints the two ERROR lines and exits 1 before any write", async () => {
    const t = start({ version: "3.7.0" });
    await assert.rejects(run(t.env), exits(1));
    assert.deepEqual(t.out, [
      ...HEAD,
      "  ERROR: MemPalace 3.7.0 is outside the supported range >=3.6.0,<3.7.",
      "         Install a supported version with: pipx install --force 'mempalace>=3.6.0,<3.7'",
    ]);
    assert.ok(!fs.existsSync(settings(t)));
  });

  it("a failed Chroma install exits 1 before the merge", async () => {
    const t = start({ chromaOk: false });
    await assert.rejects(run(t.env), exits(1));
    assert.deepEqual(t.out, [...HEAD, DETECTED, ...CHROMA]);
    assert.ok(!fs.existsSync(settings(t)));
  });

  it("an existing settings.json is backed up before the merge line", async () => {
    const t = start();
    fs.mkdirSync(path.dirname(settings(t)), { recursive: true });
    fs.writeFileSync(settings(t), '{"theme":"dark"}\n');
    await run(t.env);
    const at = t.out.indexOf(MERGED);
    assert.match(t.out[at - 1] ?? "", /^ {2}Backed up: settings\.json -> settings\.json\.bak\./);
    assert.equal(doc(t)["theme"], "dark");
  });

  it("org-declared servers are folded by the merge", async () => {
    const t = start();
    fs.writeFileSync(
      path.join(t.repo, "mcp-servers.org.json"),
      JSON.stringify({ mcpServers: { "acme-tools": { command: "acme" } } }),
    );
    await run(t.env);
    assert.deepEqual(servers(t)["acme-tools"], { command: "acme" });
  });

  it("an unreadable template ends with the shell's message and status 1", async () => {
    const t = start();
    fs.rmSync(path.join(t.repo, "config", "gemini", "settings.json"));
    await assert.rejects(run(t.env), exits(1));
    assert.ok(t.err.length > 0);
    assert.ok(!t.out.includes(MERGED));
  });
});
