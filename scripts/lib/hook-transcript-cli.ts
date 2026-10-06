// hook-transcript-cli.ts — the `transcript` subcommands of scripts/hook-wiring.ts
// (spec 0247 R20-R27; plan step 16), which the Bash setups reach through `node`.
//
//   transcript render <claude|gemini|copilot|antigravity> --manifest <path>
//       Print the manifest, compact JSON on one line, with only the transcript
//       commands rendered (hook-transcript-manifest.ts). A refusal exits 0,
//       prints `  ERROR: <diagnostic>` on stderr and leaves the transcript
//       handlers out of stdout; a missing or non-object manifest exits 1.
//   transcript rewrite <claude|gemini|copilot> --config <path>
//       The in-place rewrite run before the session-recording question
//       (transcript-hook-rewrite.ts); on Claude Code the consent of a
//       `legacy-unmarked` command is the file's own `env.MEMPALACE_TRANSCRIPT_ENABLED`.
//   transcript antigravity-merge --hooks <path> --manifest <rendered path>
//   transcript antigravity-rewrite --hooks <path>
//       Antigravity CLI's named hook (hook-antigravity-transcript.ts).
//   transcript classify --commands <path>
//       One class per line for a JSON array of command strings (corpus and
//       Bash-integration tests only).
//
// Every write is backup-first at 0600 and happens only when something changed;
// configuration content is read from files, never from argv (spec 0243 R23).
// Exit: 0 done (also "nothing to do"), 1 refused or failed, 2 usage.
// Standard library only (spec 0240 R16).

import fs from "node:fs";
import path from "node:path";

import type { Cli } from "./hook-command.ts";
import {
  backupFile,
  NotAJsonObjectError,
  readJsonObject,
  writeJsonConfig,
  type JsonObject,
} from "./hook-config.ts";
import { MEMPALACE_TRANSCRIPT, type WiredCli } from "./hook-descriptor.ts";
import {
  mergeAntigravityTranscriptFile,
  rewriteAntigravityTranscriptFile,
} from "./hook-antigravity-transcript.ts";
import { rewriteConfig } from "./hook-rewrite.ts";
import { transcriptRenderFile } from "./hook-transcript-manifest.ts";
import { classifyTranscript } from "./transcript-recognition.ts";

export interface TranscriptCliContext {
  readonly repo: string;
  readonly platform: NodeJS.Platform;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

const WIRED: readonly WiredCli[] = ["claude", "gemini", "copilot"];
const ALL: readonly Cli[] = [...WIRED, "antigravity"];

const USAGE = [
  `usage: hook-wiring.ts transcript render <${ALL.join("|")}> --manifest <path>`,
  `       hook-wiring.ts transcript rewrite <${WIRED.join("|")}> --config <path>`,
  "       hook-wiring.ts transcript antigravity-merge --hooks <path> --manifest <path>",
  "       hook-wiring.ts transcript antigravity-rewrite --hooks <path>",
  "       hook-wiring.ts transcript classify --commands <path>",
].join("\n");

function rewrite(cli: WiredCli, config: string, ctx: TranscriptCliContext): number {
  let current: JsonObject | null;
  try {
    current = readJsonObject(config);
  } catch (error) {
    if (error instanceof NotAJsonObjectError) {
      ctx.err(`  ERROR: ${config} is not a JSON object; session recording left as it is.`);
      return 1;
    }
    throw error;
  }
  if (current === null) {
    ctx.out(`  Session recording: no ${config}; nothing to rewrite.`);
    return 0;
  }
  const env = current["env"];
  const claudeEnvEnabled =
    typeof env === "object" && env !== null && !Array.isArray(env)
      ? (env as Record<string, unknown>)["MEMPALACE_TRANSCRIPT_ENABLED"] === "1"
      : false;
  const result = rewriteConfig(current, {
    descriptor: MEMPALACE_TRANSCRIPT,
    cli,
    platform: ctx.platform,
    transcript: { repo: ctx.repo, claudeEnvEnabled },
  });
  for (const line of result.lines) {
    ctx.out(`  Session recording: ${line.kind} ${line.path} on ${line.event} (${line.detail})`);
  }
  if (!result.changed) {
    ctx.out(
      `  Session recording: ${result.left} command(s) left as they are in ${config}; nothing written.`,
    );
    return 0;
  }
  const backup = backupFile(config);
  if (backup.status === "failed") {
    ctx.err(`  ERROR: could not back up ${config}; leaving it untouched (backup-first).`);
    return 1;
  }
  if (backup.status === "made")
    ctx.out(`  Backed up: ${path.basename(config)} -> ${path.basename(backup.path)}`);
  writeJsonConfig(config, result.config);
  ctx.out(
    `  Session recording: rewrote ${result.rewrote}, left ${result.left}, dropped ${result.dropped} duplicate(s) in ${config}`,
  );
  return 0;
}

function classify(file: string, ctx: TranscriptCliContext): number {
  const commands = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
  if (!Array.isArray(commands) || !commands.every((c) => typeof c === "string")) {
    ctx.err("  ERROR: --commands must name a JSON array of strings.");
    return 1;
  }
  for (const command of commands as string[]) ctx.out(classifyTranscript(command));
  return 0;
}

/** Dispatch `transcript <action> …`; `positional` starts after `transcript`. */
export function transcriptCommand(
  positional: readonly string[],
  options: ReadonlyMap<string, string>,
  ctx: TranscriptCliContext,
): number {
  const [action, cliArg] = positional;
  const io = { log: ctx.out, warn: ctx.err };
  const hooks = options.get("hooks");
  const manifest = options.get("manifest");
  const config = options.get("config");
  const cli = ALL.find((c) => c === cliArg);
  const wired = WIRED.find((c) => c === cliArg);
  if (action === "render" && cli !== undefined && manifest) {
    return transcriptRenderFile(
      { repo: ctx.repo, cli, manifest, platform: ctx.platform },
      ctx.out,
      ctx.err,
    );
  }
  if (action === "rewrite" && wired !== undefined && config) return rewrite(wired, config, ctx);
  if (action === "antigravity-merge" && hooks && manifest) {
    return mergeAntigravityTranscriptFile(hooks, manifest, io);
  }
  if (action === "antigravity-rewrite" && hooks) {
    return rewriteAntigravityTranscriptFile(hooks, { repo: ctx.repo, platform: ctx.platform }, io);
  }
  const commands = options.get("commands");
  if (action === "classify" && commands) return classify(commands, ctx);
  ctx.err(USAGE);
  return 2;
}
