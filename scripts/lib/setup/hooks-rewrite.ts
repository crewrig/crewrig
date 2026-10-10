// hooks-rewrite.ts — the pre-question step of the three hook-file setups and of Antigravity CLI
// (spec 0256 requirements 29 and 31; plan v2 step B3a.1): `guard_rewrite_installed`,
// `transcript_rewrite_installed` and `report_unused_transcript_copy` of scripts/lib/common.sh.
// Every run, declined or not, brings the installed guard and transcript commands to the direct
// `node "<path>/<script>.ts"` form (spec 0248 R30, spec 0247 R23) through the modules of
// `hook-wiring.ts` (hook-rewrite.ts, hook-transcript-cli.ts, hook-antigravity-write.ts). A step
// that fails prints its diagnostic and returns a status; nothing here throws for a guarded step.
// Layer 2: node built-ins and repository modules.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { rewriteAntigravityGuardFile } from "../hook-antigravity-write.ts";
import {
  backupFile,
  NotAJsonObjectError,
  readJsonObject,
  writeJsonConfig,
  type JsonObject,
} from "../hook-config.ts";
import { WORKTREE_GIT_GUARD } from "../hook-descriptor.ts";
import { rewriteConfig } from "../hook-rewrite.ts";
import { transcriptCommand } from "../hook-transcript-cli.ts";
import type { Cli, InstallCtx, Spawner } from "./context.ts";
import { createSpawner } from "./spawner.ts";

/** What the hook steps read from the setup context. */
export type HooksCtx = Pick<InstallCtx, "io" | "env" | "platform" | "home" | "repoDir">;

/** The floor guard of the checkout this module sits in (the shell's `_CREWRIG_COMMON_ROOT`). */
const FLOOR_GUARD = fileURLToPath(new URL("../node-floor-guard.js", import.meta.url));
const DOWNLOAD = "Install a supported release from https://nodejs.org/en/download";

/**
 * `require_node_floor`: run the floor guard with the `node` found on PATH. Prints the guard's
 * diagnostic (or the shell-authored line when no `node` is found) and returns `false` below it.
 */
export function requireNodeFloor(ctx: HooksCtx, spawn: Spawner, guard = FLOOR_GUARD): boolean {
  const noNode = `  ERROR: crewrig: Node.js was not found on PATH; this step requires Node.js >= 24. ${DOWNLOAD}`;
  if (!fs.existsSync(guard)) {
    const probe = spawn(["node", "--version"]);
    ctx.io.err(
      probe.status === 127 ? noNode : `  ERROR: Node.js floor guard not found at ${guard}.`,
    );
    return false;
  }
  const res = spawn(["node", guard]);
  if (res.status === 127) {
    ctx.io.err(noNode);
    return false;
  }
  if (res.status !== 0) {
    ctx.io.errRaw(res.stderr);
    return false;
  }
  return true;
}

/** `hook-wiring.ts guard rewrite <cli> --config <path>` for claude, gemini and copilot. */
function rewriteGuardConfig(ctx: HooksCtx, cli: Exclude<Cli, "antigravity">, file: string): number {
  const { out, err } = ctx.io;
  const label = "Worktree git guard";
  let current: JsonObject | null;
  try {
    current = readJsonObject(file);
  } catch (error) {
    if (error instanceof NotAJsonObjectError) {
      err(`  ERROR: ${file} is not a JSON object; ${label.toLowerCase()} left as it is.`);
      return 1;
    }
    throw error;
  }
  if (current === null) {
    out(`  No ${WORKTREE_GIT_GUARD.id} entry in ${file}; nothing to rewrite.`);
    return 0;
  }
  const result = rewriteConfig(current, {
    descriptor: WORKTREE_GIT_GUARD,
    cli,
    platform: ctx.platform,
  });
  for (const line of result.lines) {
    out(`  ${label}: ${line.kind} ${line.path} on ${line.event} (${line.detail})`);
  }
  if (!result.changed) {
    out(`  ${label}: ${result.left} command(s) left as they are in ${file}; nothing written.`);
    return 0;
  }
  const backup = backupFile(file, { warn: err });
  if (backup.status === "failed") {
    err(`  ERROR: could not back up ${file}; leaving it untouched (backup-first, R23).`);
    return 1;
  }
  if (backup.status === "made") {
    out(`  Backed up: ${path.basename(file)} -> ${path.basename(backup.path)}`);
  }
  writeJsonConfig(file, result.config);
  out(
    `  ${label}: rewrote ${result.rewrote}, left ${result.left}, dropped ${result.dropped} duplicate(s) in ${file}`,
  );
  return 0;
}

/** Run one guarded step; an unexpected error becomes the diagnostic of `hook-wiring.ts` and status 1. */
function guarded(ctx: HooksCtx, step: () => number): number {
  try {
    return step();
  } catch (error) {
    ctx.io.err(`  ERROR: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

export interface RewriteStepOptions {
  readonly ctx: HooksCtx;
  readonly cli: Cli;
  /** The settings file, the Copilot user hooks file, or `hooks.json` for Antigravity CLI. */
  readonly settingsPath: string;
  readonly spawn?: Spawner;
  /** The checkout whose hooks the commands name (the shell's `<repo_dir>`); default `ctx.repoDir`. */
  readonly repoDir?: string;
  /** Floor guard script; tests only. */
  readonly floorGuard?: string;
}

/** `guard_rewrite_installed`: 0 done (also nothing to do), 1 below the floor or failed. */
export function rewriteInstalledGuard(options: RewriteStepOptions): number {
  const { ctx, cli, settingsPath } = options;
  if (!fs.existsSync(settingsPath) || !fs.statSync(settingsPath).isFile()) return 0;
  if (!fs.readFileSync(settingsPath, "latin1").includes("worktree-git-guard")) return 0;
  const spawn = options.spawn ?? createSpawner(ctx);
  if (!requireNodeFloor(ctx, spawn, options.floorGuard)) {
    ctx.io.err("  Installed worktree git guard command left as it is.");
    return 1;
  }
  const { out, err } = ctx.io;
  return guarded(ctx, () =>
    cli === "antigravity"
      ? rewriteAntigravityGuardFile(settingsPath, { platform: ctx.platform }, out, err)
      : rewriteGuardConfig(ctx, cli, settingsPath),
  );
}

/** `transcript_rewrite_installed`: 0 done (also nothing to do), 1 below the floor or failed. */
export function rewriteInstalledTranscript(options: RewriteStepOptions): number {
  const { ctx, cli, settingsPath } = options;
  if (!fs.existsSync(settingsPath) || !fs.statSync(settingsPath).isFile()) return 0;
  if (!fs.readFileSync(settingsPath, "latin1").includes("mempalace-transcript")) return 0;
  const spawn = options.spawn ?? createSpawner(ctx);
  if (!requireNodeFloor(ctx, spawn, options.floorGuard)) {
    ctx.io.err("  Installed session-recording commands left as they are.");
    return 1;
  }
  const action = cli === "antigravity" ? "antigravity-rewrite" : "rewrite";
  const flag = cli === "antigravity" ? "hooks" : "config";
  const repo = options.repoDir ?? ctx.repoDir;
  return guarded(ctx, () =>
    transcriptCommand([action, cli], new Map([[flag, settingsPath]]), {
      repo,
      platform: ctx.platform,
      out: ctx.io.out,
      err: ctx.io.err,
    }),
  );
}

/** `report_unused_transcript_copy`: the copy of the shell hook an earlier setup installed is left on disk. */
export function reportUnusedTranscriptCopy(ctx: HooksCtx, copy: string): void {
  if (!fs.existsSync(copy) || !fs.statSync(copy).isFile()) return;
  ctx.io.out(`  No longer used (left on disk): ${copy} — session recording now runs the`);
  ctx.io.out("  hook from this checkout.");
}

/** The directory of each CLI's own home, where an earlier setup installed its `hooks/` copy. */
export function cliHome(ctx: Pick<HooksCtx, "home">, cli: Cli): string {
  const dirs = { claude: ".claude", gemini: ".gemini", copilot: ".copilot" } as const;
  return cli === "antigravity"
    ? path.join(ctx.home, ".gemini", "antigravity-cli")
    : path.join(ctx.home, dirs[cli]);
}

export interface RewriteInstalledResult {
  readonly guard: number;
  readonly transcript: number;
}

/**
 * The three steps in the shell's order, run on every setup run before the session-recording
 * question. Neither status aborts setup (the callers' `|| true`).
 */
export function rewriteInstalledHooks(
  options: RewriteStepOptions & { readonly unusedCopy?: string },
): RewriteInstalledResult {
  const guard = rewriteInstalledGuard(options);
  const transcript = rewriteInstalledTranscript(options);
  const copy =
    options.unusedCopy ??
    path.join(cliHome(options.ctx, options.cli), "hooks", "mempalace-transcript.sh");
  reportUnusedTranscriptCopy(options.ctx, copy);
  return { guard, transcript };
}
