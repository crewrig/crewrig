// usage-capture.ts — the usage-capture opt-in of Claude Code, Gemini CLI and Copilot CLI (spec 0256
// requirement 30, plan v2 step B3a.2b): `usage_capture_disclose`, `usage_capture_rewrite` and
// `usage_capture_apply` of scripts/lib/usage-capture-optin.sh, and the re-export of the fragment
// (usage-capture-fragment.ts) and the writers (usage-capture-write.ts). `keep` (usage-capture-keep.ts) is injected into the apply.
// Messages are the shell's, byte for byte; every status is the shell's (0 done, 1 refused or failed).
// Layer 2: node built-ins and repository modules.

import path from "node:path";

import {
  backupFile,
  NotAJsonObjectError,
  readJsonObject,
  writeJsonConfig,
  type JsonObject,
} from "../hook-config.ts";
import { USAGE_CAPTURE, type WiredCli } from "../hook-descriptor.ts";
import { rewriteConfig } from "../hook-rewrite.ts";
import { reportIfLossy } from "./lossless.ts";
import { createSpawner } from "./spawner.ts";
import { warnIfLinkedWorktree } from "./worktree-warning.ts";
import { captureShape, unknownCliMessage } from "./usage-capture-state.ts";
import {
  fragmentEvents,
  usageCaptureAbs,
  usageCaptureFragment,
  usageCaptureRequireNodeFloor,
  type UcCtx,
  type UcDeps,
} from "./usage-capture-fragment.ts";
import { usageCaptureEnable, usageCaptureRemove } from "./usage-capture-write.ts";

export {
  usageCaptureAbs,
  usageCaptureFragment,
  usageCaptureRequireNodeFloor,
  type UcCtx,
  type UcDeps,
} from "./usage-capture-fragment.ts";
export {
  usageCaptureEnable,
  usageCaptureReinject,
  usageCaptureRemove,
  type UcWriteOptions,
} from "./usage-capture-write.ts";

export interface UcOptions {
  readonly ctx: UcCtx;
  readonly cli: string;
  /** The settings file, or the Copilot user hooks file. */
  readonly settingsPath: string;
  /** The checkout whose fragment and hook script are registered; default `ctx.repoDir`. */
  readonly repoDir?: string;
  readonly deps?: UcDeps;
}

const codePointOrder = (a: string, b: string): number =>
  Buffer.compare(Buffer.from(a), Buffer.from(b));

/** Every `command` of the commands of a rendered fragment, distinct and sorted (jq's `unique`). */
function fragmentCommands(fragment: JsonObject): string[] {
  const found: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (typeof node === "object" && node !== null) {
      const record = node as Record<string, unknown>;
      if (record["type"] === "command" && typeof record["command"] === "string") {
        found.push(record["command"]);
      }
      Object.values(record).forEach(walk);
    }
  };
  walk(fragment);
  return [...new Set(found)].sort(codePointOrder);
}

/** `usage_capture_disclose`: the pre-write disclosure (R6) on standard output; 0 shown, 1 when it cannot be rendered. */
export function usageCaptureDisclose(o: UcOptions): number {
  const { ctx, cli, settingsPath: config } = o;
  const { out } = ctx.io;
  const repoDir = o.repoDir ?? ctx.repoDir;
  // The floor guard comes first: the fragment is rendered through `node`, and a Node.js below the
  // floor must be met with the guard's diagnostic (v1-F2, spec 0243 R24).
  if (!usageCaptureRequireNodeFloor(ctx, o.deps)) return 1;
  const frag = usageCaptureFragment(ctx, cli, repoDir, o.deps);
  if (frag === null) return 1;
  const abs = usageCaptureAbs(ctx, repoDir);
  if (abs === null) return 1;
  out("Enabling usage capture will:");
  out(`  1. Register ${abs}`);
  out(`     on the ${fragmentEvents(frag)} event(s), in ${config}`);
  out(
    "     as a direct node command (no shell wrapper; needs Node.js 24 or later when the hook fires):",
  );
  for (const command of fragmentCommands(frag)) out(`       ${command}`);
  if (cli === "copilot") {
    out("     (the same file session recording uses; its entries are left as they are)");
  }
  out(`  2. Back up ${config} first when it exists, and change no other entry in it`);
  out("  The capture script is wired in place, by its in-repo absolute path; it is never copied.");
  out("  No prompt or response text is recorded: only token counts, model and timing.");
  out("  MemPalace is not required: records go to the file-system usage journal.");
  warnIfLinkedWorktree(
    { io: ctx.io, repoDir },
    o.deps?.spawn ?? createSpawner(ctx),
    "usage capture",
  );
  out("");
  return 0;
}

/** `hook-wiring.ts rewrite <cli> --config <path>` for the usage-capture hook. */
function rewriteConfigFile(o: UcOptions & { readonly repoDir: string }): number {
  const { ctx, cli, settingsPath: config } = o;
  const { out, err } = ctx.io;
  const label = "Usage capture";
  let current: JsonObject | null;
  try {
    current = readJsonObject(config);
  } catch (error) {
    if (error instanceof NotAJsonObjectError) {
      err(`  ERROR: ${config} is not a JSON object; ${label.toLowerCase()} left as it is.`);
      return 1;
    }
    throw error;
  }
  if (current === null) {
    out(`  No ${USAGE_CAPTURE.id} entry in ${config}; nothing to rewrite.`);
    return 0;
  }
  const fragFile = path.join(o.repoDir, "hooks", `${cli}-${USAGE_CAPTURE.id}-hooks.json`);
  const fragment = readJsonObject(fragFile);
  if (fragment === null) throw new Error(`capture fragment not found at ${fragFile}.`);
  const events = fragment["hooks"];
  const dedupEvents = typeof events === "object" && events !== null ? Object.keys(events) : [];
  const result = rewriteConfig(current, {
    descriptor: USAGE_CAPTURE,
    cli: cli as WiredCli,
    platform: ctx.platform,
    dedupEvents,
  });
  for (const line of result.lines) {
    out(`  ${label}: ${line.kind} ${line.path} on ${line.event} (${line.detail})`);
  }
  if (!result.changed) {
    out(`  ${label}: ${result.left} command(s) left as they are in ${config}; nothing written.`);
    return 0;
  }
  if (!reportIfLossy(ctx, config)) return 1;
  const backup = backupFile(config, { warn: err });
  if (backup.status === "failed") {
    err(`  ERROR: could not back up ${config}; leaving it untouched (backup-first, R23).`);
    return 1;
  }
  if (backup.status === "made") {
    out(`  Backed up: ${path.basename(config)} -> ${path.basename(backup.path)}`);
  }
  writeJsonConfig(config, result.config);
  out(
    `  ${label}: rewrote ${result.rewrote}, left ${result.left}, dropped ${result.dropped} duplicate(s) in ${config}`,
  );
  return 0;
}

/**
 * `usage_capture_rewrite`: every legacy capture command of the configuration rewritten to the direct
 * form, one command per event (spec 0243 R19, R21, R22). Below the Node.js floor it prints the guard's
 * diagnostic and changes nothing (R24). A second run writes nothing.
 */
export function usageCaptureRewrite(o: UcOptions): number {
  if (captureShape(o.cli) === undefined) {
    o.ctx.io.err(unknownCliMessage(o.cli));
    return 1;
  }
  if (!usageCaptureRequireNodeFloor(o.ctx, o.deps)) return 1;
  try {
    return rewriteConfigFile({ ...o, repoDir: o.repoDir ?? o.ctx.repoDir });
  } catch (error) {
    o.ctx.io.err(`  ERROR: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

/** `usage_capture_keep` (usage-capture-keep.ts), injected: 0 done, non-zero failed. */
export type UsageCaptureKeep = (options: UcOptions) => number;

export interface UcApplyOptions extends UcOptions {
  /** `absent` or `installed` (`usageCaptureState`); any other value is rejected. */
  readonly state: string;
  /** The raw prompt answer: `yes`/`no` when absent, `keep`/`remove` when installed, empty included. */
  readonly answer: string;
  readonly keep?: UsageCaptureKeep;
}

/**
 * `usage_capture_apply`, the mapping of a raw answer (R4, R10): absent + yes enables, any other answer
 * writes nothing; installed + remove removes, any other answer keeps then rewrites every legacy command.
 * Every path that writes the direct form first meets the Node.js floor (spec 0243 R24, D3); `remove`
 * never depends on Node.js. Any other state is rejected with status 1 and nothing written.
 */
export function usageCaptureApply(o: UcApplyOptions): number {
  const { ctx, cli, state, answer } = o;
  if (captureShape(cli) === undefined) {
    ctx.io.err(unknownCliMessage(cli));
    return 1;
  }
  if (state === "absent") {
    if (answer === "yes") {
      if (!usageCaptureRequireNodeFloor(ctx, o.deps)) return 1;
      return usageCaptureEnable(o);
    }
    ctx.io.out(
      `Usage capture not enabled (re-run scripts/setup-${cli}-interactive.sh to enable it).`,
    );
    return 0;
  }
  if (state === "installed") {
    if (answer === "remove") return usageCaptureRemove(o);
    if (!usageCaptureRequireNodeFloor(ctx, o.deps)) return 1;
    if (o.keep === undefined) throw new Error("usageCaptureApply: no keep step was injected");
    if (o.keep(o) !== 0) return 1;
    return usageCaptureRewrite(o);
  }
  ctx.io.err(`  ERROR: unknown usage-capture state '${state}'; nothing written.`);
  return 1;
}
