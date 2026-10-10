// mcp-gemini-step.ts — the `mcp` step of the Gemini setup (spec 0256 requirements 26-28 and 31;
// shell lines 167-266 of scripts/setup-gemini-interactive.sh). The `~/.gemini/settings.json` merge
// (`geminiSettingsWrite`) writes the stdio-shaped reserved entries and folds the org servers; the
// shared-daemon registration runs AFTER it and never touches the entry just written. No Sequential
// Thinking question: the merge writes that reserved entry itself.

import path from "node:path";

import type { StepEnv } from "./descriptor.ts";
import { explainGeminiRc, geminiSettingsWrite } from "./gemini-settings.ts";
import { runMempalaceStep } from "./mempalace-callsite.ts";
import {
  chromaStep,
  detectMempalace,
  makeEnsure,
  mcpSeams,
  orgNativeFor,
  prepareTrustWrapper,
} from "./steps-mcp-common.ts";

export async function run(env: StepEnv): Promise<void> {
  const { ctx, state } = env;
  const { io } = ctx;
  const target = path.join(ctx.home, ".gemini", "settings.json");
  state.settingsTarget = target;
  io.out("Configuring ~/.gemini/settings.json...");
  prepareTrustWrapper(env);

  const python = await detectMempalace(env, { detected: "Detected MemPalace interpreter" });
  state.mempalaceInstalled = python !== undefined;
  if (python !== undefined) await chromaStep(env);

  const now = mcpSeams(env).now;
  explainGeminiRc(
    geminiSettingsWrite({
      ctx,
      settingsTarget: target,
      settingsSrc: path.join(ctx.repoDir, "config", "gemini", "settings.json"),
      python: python ?? "",
      orgNative: orgNativeFor(env),
      ...(now === undefined ? {} : { env: { now } }),
    }),
    io,
  );
  io.out(
    state.mempalaceInstalled
      ? "  Merged: settings.json (existing content kept; mempalace registered with the detected Python + wrapper path)"
      : "  Merged: settings.json (existing content kept; mempalace omitted from mcpServers)",
  );

  // The stdio entry is already in the file: `registerStdio` only reports whether it was written.
  const result = await runMempalaceStep({
    ctx,
    cli: "gemini",
    ensure: makeEnsure(env),
    registerStdio: () => state.mempalaceInstalled,
    removeUserScope: () => undefined,
    isRegistered: () => false,
  });
  state.mempalaceInstalled = result.installed;
  io.out("");
}
