// setup-steps-mcp.test.ts — the `mcp` registry entry (steps-mcp.ts) and the shared helpers of
// steps-mcp-common.ts: strategy dispatch by dynamic import, the seam narrowing, and the
// detect / Chroma / ensure helpers on their own.

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import type { SetupDescriptor } from "../lib/setup/descriptor.ts";
import { SetupExit } from "../lib/setup/exit.ts";
import { mcpSteps } from "../lib/setup/steps-mcp.ts";
import {
  chromaStep,
  detectMempalace,
  makeEnsure,
  mcpSeams,
} from "../lib/setup/steps-mcp-common.ts";
import type { Harness, HarnessOptions } from "./setup-mcp-claude-gemini-fixtures.ts";
import { harness, PYTHON } from "./setup-mcp-claude-gemini-fixtures.ts";

let h: Harness | undefined;
afterEach(() => h?.cleanup());

function start(options: Partial<HarnessOptions> = {}): Harness {
  h?.cleanup();
  h = harness({ cli: "claude", python: [PYTHON], ...options });
  return h;
}

describe("mcp registry entry", () => {
  it("registers the `mcp` step and not `mcp-prepare`", () => {
    assert.deepEqual(Object.keys(mcpSteps), ["mcp"]);
  });

  it("dispatches claudeMcp to the Claude strategy", async () => {
    const t = start();
    await mcpSteps["mcp"]?.(t.env);
    assert.equal(t.out[0], "Configuring MCP servers via 'claude mcp add --scope user'...");
  });

  it("dispatches geminiMcp to the Gemini strategy", async () => {
    const t = harness({ cli: "gemini", python: [PYTHON] });
    h = t;
    await mcpSteps["mcp"]?.(t.env);
    assert.equal(t.out[0], "Configuring ~/.gemini/settings.json...");
  });

  it("refuses an unknown strategy key", async () => {
    const t = start();
    const bad = {
      ...t.env.descriptor,
      strategies: { ...t.env.descriptor.strategies, mcp: "nope" },
    } as unknown as SetupDescriptor;
    await assert.rejects(
      mcpSteps["mcp"]?.({ ...t.env, descriptor: bad }) ?? Promise.resolve(),
      /nope/,
    );
  });
});

describe("mcp common helpers", () => {
  it("mcpSeams keeps only the typed keys that are present", () => {
    const t = start({ seams: {} });
    const seams = mcpSeams(t.env);
    assert.deepEqual(Object.keys(seams).sort(), [
      "detect",
      "ensure",
      "installChroma",
      "now",
      "offer",
    ]);
    const bare = { ...t.env, deps: { ...t.env.deps, seams: undefined } };
    assert.deepEqual(mcpSeams(bare), {});
  });

  it("detectMempalace prints the caller's text and records the interpreter", async () => {
    const t = start();
    assert.equal(await detectMempalace(t.env, { detected: "Detected X" }), PYTHON);
    assert.deepEqual(t.out, [`  Detected X: ${PYTHON} (mempalace 3.6.0)`]);
    assert.equal(t.env.state.pythonBin, PYTHON);
  });

  it("detectMempalace returns undefined and sets nothing when none is found", async () => {
    const t = start({ python: [undefined] });
    assert.equal(await detectMempalace(t.env, { detected: "Detected X" }), undefined);
    assert.equal(t.env.state.pythonBin, undefined);
    assert.equal(t.out[0], "  MemPalace not found.");
  });

  it("detectMempalace treats an unreadable version as out of range, shown as (unknown)", async () => {
    const t = start();
    const silent = { ...t.env, spawn: () => ({ status: 1, stdout: "", stderr: "" }) };
    await assert.rejects(
      detectMempalace(silent, { detected: "Detected X" }),
      (e: unknown) => e instanceof SetupExit && e.status === 1,
    );
    assert.match(t.out[0] ?? "", /MemPalace \(unknown\) is outside the supported range/);
  });

  it("chromaStep throws SetupExit(1) on ok:false and returns on ok:true", async () => {
    await chromaStep(start().env);
    await assert.rejects(
      chromaStep(start({ chromaOk: false }).env),
      (e: unknown) => e instanceof SetupExit && e.status === 1,
    );
  });

  it("makeEnsure builds the daemon call from the injected seam bag and the CLI", async () => {
    const t = start({
      seams: {
        ensure: undefined,
        ensureHttp: {
          readToken: () => "T",
          probeAccepts: async () => true,
          installDaemon: async () => ({ ok: true, lines: [] }),
          backup: () => undefined,
          register: () => undefined,
          arrangement: () => "http",
          present: () => true,
        },
      },
    });
    assert.equal(await makeEnsure(t.env)(), 0);
    assert.ok(
      t.out.includes("Shared memory daemon (spec 0113 delta-02): defaulting claude to HTTP."),
    );
  });
});
