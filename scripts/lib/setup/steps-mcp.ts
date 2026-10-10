// steps-mcp.ts — the `mcp` step of the setup flow (spec 0256 requirements 3 and 6; plan v2 step
// B3b.3). One registered step, whose body is chosen by `descriptor.strategies.mcp`: the strategy
// file is loaded on demand with a dynamic import, so a run loads only its own CLI's code and this
// registry does not depend on a strategy that is not written yet. `mcp-prepare` (Antigravity only)
// is registered by steps-agy.ts, not here.

import type { SetupDescriptor, StepEnv, StepRegistry } from "./descriptor.ts";

type Strategy = SetupDescriptor["strategies"]["mcp"];

/** The strategy file of each key, relative to this module. */
const STRATEGY_FILES: Readonly<Record<Strategy, string>> = {
  claudeMcp: "./mcp-claude-step.ts",
  geminiMcp: "./mcp-gemini-step.ts",
  copilotMcp: "./mcp-copilot-step.ts",
  antigravityMcp: "./mcp-agy-step.ts",
};

async function loadStrategy(strategy: Strategy): Promise<(env: StepEnv) => Promise<void>> {
  const file: unknown = STRATEGY_FILES[strategy];
  if (typeof file !== "string") throw new Error(`unknown MCP strategy '${String(strategy)}'`);
  const loaded: unknown = await import(file);
  const run: unknown =
    typeof loaded === "object" && loaded !== null ? (loaded as { run?: unknown }).run : undefined;
  if (typeof run !== "function") throw new Error(`${file} does not export run(env)`);
  return run as (env: StepEnv) => Promise<void>;
}

export const mcpSteps: StepRegistry = {
  mcp: async (env) => {
    const run = await loadStrategy(env.descriptor.strategies.mcp);
    await run(env);
  },
};
