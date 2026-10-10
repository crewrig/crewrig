// steps-usage.ts — the `usage-capture` step of Claude Code, Gemini CLI and Copilot CLI (spec 0256
// requirement 30, plan v2 step B3b.1). Shell: scripts/setup-claude-interactive.sh 527-547, gemini
// 473-493, copilot 465-485; the pure parts live in usage-capture*.ts, the questions are asked here
// (the modules never prompt). The statusline channel of Antigravity CLI (`agy-json`) is
// `agyUsageCapture` of steps-agy.ts, to which this entry delegates.
//
// A failure never stops the run: an unreadable file skips the step with the shell's WARNING, a
// failed apply prints `Usage-capture step FAILED — setup continues.`

import type { Cli } from "./context.ts";
import type { StepFn, StepRegistry } from "./descriptor.ts";
import { hooksFile, wiredCli } from "./steps-hooks.ts";
import { agyUsageCapture } from "./steps-agy.ts";
import {
  usageCaptureApply,
  usageCaptureDisclose,
  type UcOptions,
  type UsageCaptureKeep,
} from "./usage-capture.ts";
import { usageCaptureKeep } from "./usage-capture-keep.ts";
import {
  capturePaths,
  captureState,
  NotAnObjectConfigError,
  notAnObjectMessage,
  readCaptureConfig,
} from "./usage-capture-state.ts";

const LABEL = { claude: "Claude Code", gemini: "Gemini CLI", copilot: "Copilot CLI" } as const;

const usageCapture: StepFn = async (env) => {
  const { descriptor, ctx, state, session, spawn } = env;
  const cli = wiredCli(descriptor.cli);
  if (descriptor.hooks.channel === "agy-json" || cli === undefined) {
    return agyUsageCapture(env);
  }
  const { out, err } = ctx.io;
  const file = hooksFile(env);
  const label = LABEL[cli];
  out("");
  let config;
  try {
    config = readCaptureConfig(file);
  } catch (error) {
    if (!(error instanceof NotAnObjectConfigError)) throw error;
    err(notAnObjectMessage(file));
    err(`  WARNING: cannot read ${file} as JSON; usage-capture step skipped.`);
    return;
  }
  const deps = { spawn };
  const options: UcOptions = { ctx, cli, settingsPath: file, repoDir: ctx.repoDir, deps };
  const ucState = captureState(cli, config);
  state.ucState = ucState;
  let answer: string | undefined;
  if (ucState === "absent") {
    usageCaptureDisclose(options);
    answer = await session.choose({
      id: "usage-capture",
      header: `Capture token usage for ${label}? (opt-in, MemPalace not required)`,
      options: ["no", "yes"],
      cancel: "decline",
    });
  } else {
    out(`Usage capture is registered in ${file}, at:`);
    const paths = capturePaths(cli, config);
    for (const p of paths.length === 0 ? [""] : paths) out(`  ${p}`);
    answer = await session.choose({
      id: "usage-capture-keep",
      header: `Usage capture is registered for ${label}. Keep it or remove it?`,
      options: ["keep", "remove"],
      cancel: "decline",
    });
  }
  // `|| true` at the shell site: a cancelled question reads as the empty answer.
  state.ucAnswer = answer ?? "";
  // `usage_capture_keep` takes its own option shape: the adapter the apply injects.
  const keep: UsageCaptureKeep = (o) =>
    usageCaptureKeep({
      ctx: o.ctx,
      cli: o.cli as Cli,
      settingsPath: o.settingsPath,
      repoDir: o.repoDir ?? ctx.repoDir,
      ...(o.deps === undefined ? {} : { deps: o.deps }),
    });
  let status = 1;
  try {
    status = usageCaptureApply({ ...options, state: ucState, answer: state.ucAnswer, keep });
  } catch (error) {
    err(`  ERROR: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (status !== 0) err("  Usage-capture step FAILED — setup continues.");
};

export const usageSteps: StepRegistry = { "usage-capture": usageCapture };
