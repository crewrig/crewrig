// antigravity-statusline.ts — the usage-capture STATUSLINE channel of setup-antigravity-interactive.sh
// (spec 0256 requirement 30, plan v2 step B3a.5; spec 0206, spec 0243): `statusLine.command` of the
// CLI's settings and the marker state file `$CREWRIG_USAGE_ROOT/state/antigravity-statusline.json`,
// a separate path from the hooks-file channel of antigravity-hooks.ts. The command line and both
// writes come from hook-statusline.ts in-process; the shim is never copied out of the repository.
// Messages are the shell's, byte for byte.

import fs from "node:fs";

import { writeJsonConfig, type JsonObject } from "../hook-config.ts";
import { installStatusline, rewriteStatusline } from "../hook-statusline.ts";
import { backupFile } from "./backup.ts";
import type { Spawner } from "./context.ts";
import { SetupExit } from "./exit.ts";
import { assertRewritable } from "./lossless.ts";
import { requireNodeFloor, type AgyCtx, type AgyPaths } from "./antigravity-hooks.ts";
import { warnIfLinkedWorktree } from "./worktree-warning.ts";

/** The marker string the statusline install records (`installedBy`); hook-statusline.ts writes it. */
export const STATUSLINE_MARKER_STRING = "crewrig-setup-antigravity-interactive";

export const USAGE_CAPTURE_DISABLED =
  "  Antigravity usage capture disabled (can enable later by re-running this script).";

const isRecord = (v: unknown): v is JsonObject =>
  typeof v === "object" && v !== null && !Array.isArray(v);

// --- the statusline channel (spec 0206, spec 0243) ---------------------------------------------

/** `jq -r '<path> // empty'` of an already parsed value: text, or the empty string. */
function jqText(value: unknown): string {
  if (value === undefined || value === null || value === false) return "";
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function readLoose(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

const commandOf = (settings: unknown): string => {
  const line = isRecord(settings) ? settings["statusLine"] : undefined;
  return isRecord(line) ? jqText(line["command"]) : "";
};

const isFile = (file: string): boolean => {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
};

/**
 * `STATUSLINE_INSTALLED_BY_US`: the current `statusLine.command` equals the marker's installed
 * command or the transitional one a rewrite leaves between its two writes (spec 0243 D5, v1-F6).
 */
export function statuslineInstalled(paths: AgyPaths): { installed: boolean; current: string } {
  if (!isFile(paths.marker)) return { installed: false, current: "" };
  const marker = readLoose(paths.marker);
  const installedCommand = isRecord(marker) ? jqText(marker["installedStatusLineCommand"]) : "";
  const previous = isRecord(marker) ? jqText(marker["previousInstalledStatusLineCommand"]) : "";
  const current = isFile(paths.settings) ? commandOf(readLoose(paths.settings)) : "";
  const installed = current !== "" && (current === installedCommand || current === previous);
  return { installed, current };
}

/** `Antigravity usage capture is installed (...)`, printed before the keep or remove question. */
export function statuslineInstalledNotice(ctx: AgyCtx, current: string): void {
  ctx.io.out(`Antigravity usage capture is installed (statusLine.command wired to ${current}).`);
}

/** The `remove` answer: restore the prior command (or delete the key), drop the marker. */
export function removeStatusline(ctx: AgyCtx, paths: AgyPaths): void {
  const marker = readLoose(paths.marker);
  const prior = isRecord(marker) ? marker["priorStatusLineCommand"] : undefined;
  if (isFile(paths.settings)) assertRewritable(ctx, paths.settings);
  backupFile(ctx, paths.settings);
  const settings = isFile(paths.settings) ? readLoose(paths.settings) : undefined;
  const line = isRecord(settings) ? settings["statusLine"] : undefined;
  if (!isRecord(settings) || (line !== undefined && line !== null && !isRecord(line))) {
    throw new SetupExit(1); // write_json_config_secure fails under `set -e`, nothing printed
  }
  if (jqText(prior) !== "") {
    writeJsonConfig(paths.settings, {
      ...settings,
      statusLine: { ...(isRecord(line) ? line : {}), command: prior },
    });
  } else if (isRecord(line)) {
    const rest = Object.fromEntries(Object.entries(line).filter(([key]) => key !== "command"));
    writeJsonConfig(paths.settings, { ...settings, statusLine: rest });
  } else {
    writeJsonConfig(paths.settings, settings);
  }
  fs.rmSync(paths.marker, { force: true });
  ctx.io.out(
    "  Antigravity usage capture removed; statusLine.command restored to its prior value.",
  );
}

/** The `keep` answer: bring a legacy `.sh` command to the direct form, below the floor change nothing. */
export function keepStatusline(ctx: AgyCtx, spawn: Spawner, paths: AgyPaths): void {
  ctx.io.out("  Antigravity usage capture kept.");
  if (requireNodeFloor(ctx, spawn, "usage capture")) {
    const target = { ...paths, repo: ctx.repoDir, platform: ctx.platform };
    if (rewriteStatusline(target, ctx.io.out) !== 0) {
      ctx.io.err("  Antigravity usage capture rewrite FAILED — setup continues.");
    }
  } else {
    ctx.io.err("  statusLine.command left as it is.");
  }
}

/** The `yes` answer to the enable question: install only over an empty `statusLine.command` (R20). */
export function enableStatusline(ctx: AgyCtx, spawn: Spawner, paths: AgyPaths): void {
  const say = ctx.io.out;
  const current = isFile(paths.settings) ? commandOf(readLoose(paths.settings)) : "";
  const notEnabled = (): void =>
    ctx.io.err("  Antigravity usage capture NOT enabled — setup continues.");
  if (current !== "") {
    say("  statusLine.command already carries a value this framework did not install:");
    say(`    ${current}`);
    say("  Leaving it untouched (R20) — per-request/per-subagent usage capture stays");
    say("  unavailable for Antigravity CLI on this installation (documented parity gap,");
    say("  R22: no field of this CLI's own session record ties to a token count, and no");
    say("  vendor-documented alternative channel exposes that granularity today).");
  } else if (requireNodeFloor(ctx, spawn, "usage capture")) {
    fs.mkdirSync(paths.agyHome, { recursive: true });
    const target = { ...paths, repo: ctx.repoDir, platform: ctx.platform };
    if (installStatusline(target, ctx.io.out) === 0) {
      warnIfLinkedWorktree(ctx, spawn, "usage capture");
      say(`  Prior statusLine.command (empty) recorded at ${paths.marker}`);
    } else {
      notEnabled();
    }
  } else {
    notEnabled();
  }
}
