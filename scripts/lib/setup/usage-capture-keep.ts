// usage-capture-keep.ts — `usage_capture_keep` of scripts/lib/usage-capture-optin.sh (spec 0256
// requirement 30, plan v2 step B3a.3b): on the R5 events of the CLI's capture fragment, keep one
// capture handler per event (usage-capture-rank.ts), re-point in place a kept handler whose path
// vanished, quote a spaced path, add the fragment's handler to an event that has none. Writes
// nothing, and backs nothing up, when the result equals the input. The PowerShell notice is decided
// from `ctx.platform`, not `uname`. The rewrite to the direct form that `usage_capture_apply` runs
// after `keep` is hooks-rewrite.ts / hook-rewrite.ts, not this module. Layer 3.
// The fragment, the capture script paths and the Node.js floor guard are usage-capture-fragment.ts.

import { writeJsonConfig, type JsonObject } from "../hook-config.ts";
import { USAGE_CAPTURE } from "../hook-descriptor.ts";
import { parseHandler } from "../hook-recognition.ts";
import { backupFile } from "./backup.ts";
import type { Cli } from "./context.ts";
import { createSpawner } from "./spawner.ts";
import {
  isRegularFile,
  usageCaptureAbs,
  usageCaptureFragment,
  type UcCtx,
  type UcDeps,
} from "./usage-capture-fragment.ts";
import { keepConfig, keepReport, missingEvents, type KeepPlan } from "./usage-capture-keep-plan.ts";
import { classifyPaths } from "./usage-capture-rank.ts";
import {
  allHandlers,
  captureShape,
  isUnsafePath,
  legacyOk,
  parseCapture,
  readCaptureConfig,
  unknownCliMessage,
} from "./usage-capture-state.ts";
import { warnIfLinkedWorktree } from "./worktree-warning.ts";

export interface KeepOptions {
  readonly ctx: UcCtx;
  readonly cli: Cli;
  /** The CLI's settings file, or the Copilot user hooks file. */
  readonly settingsPath: string;
  /** The checkout whose capture script and fragment are registered (the shell's `<repo_dir>`). */
  readonly repoDir: string;
  /** Machine seams (the process starter, used for the floor guard and `git`; the floor guard script). */
  readonly deps?: UcDeps;
}

/** Read the configuration; `undefined` after the shell's ERROR when it is not one JSON object. */
function readConfig(ctx: Pick<UcCtx, "io">, file: string): JsonObject | null | undefined {
  try {
    return readCaptureConfig(file);
  } catch {
    return void ctx.io.err(`  ERROR: ${file} is not a JSON object; usage capture left as it is.`);
  }
}

/** The directory-less `${target%.*}.ts` of a live registered path, when it exists and can be spliced. */
function targetTs(abs: string, target: string): string {
  const sibling = `${target.slice(0, target.lastIndexOf("."))}.ts`;
  return target !== abs && isRegularFile(sibling) && !isUnsafePath(sibling) ? sibling : abs;
}

/** `usage_capture_keep`: 0 done (also nothing to do), 1 on an error already printed. */
export function usageCaptureKeep(options: KeepOptions): number {
  const { ctx, cli, settingsPath: config, repoDir } = options;
  const { out, err } = ctx.io;
  const shape = captureShape(cli);
  if (shape === undefined) return (err(unknownCliMessage(cli)), 1);
  const ps = (cli === "gemini" || cli === "copilot") && ctx.platform === "win32";
  if (!isRegularFile(config)) {
    out(`  No usage-capture entry in ${config}; nothing to keep.`);
    return 0;
  }
  const input = readConfig(ctx, config);
  if (input === undefined || input === null) return input === null ? 0 : 1;
  const fragment = usageCaptureFragment(ctx, cli, repoDir, options.deps);
  const abs = fragment === null ? null : usageCaptureAbs(ctx, repoDir, "ts");
  const absSh = abs === null ? null : usageCaptureAbs(ctx, repoDir, "sh");
  const frHooks = fragment?.["hooks"];
  if (fragment === null || abs === null || absSh === null) return 1;
  if (typeof frHooks !== "object" || frHooks === null) return 1;
  const r5 = Object.keys(frHooks);
  const lg = legacyOk(shape, input);
  const parse = (h: unknown) => parseCapture(h, lg);
  const fragfp = allHandlers(shape, fragment).filter(
    (x) => parseHandler(x.handler, USAGE_CAPTURE) !== null,
  );
  const registered = allHandlers(shape, input).flatMap((x) => {
    const path = parse(x.handler)?.path;
    return path !== undefined && r5.includes(x.event) ? [path] : [];
  });
  const lists = classifyPaths([...new Set(registered)], isRegularFile);
  const target = lists.target === "" ? abs : lists.target;
  const plan: KeepPlan = {
    shape,
    r5,
    lists,
    abs,
    absSh,
    fragfp,
    ps,
    parse,
    target: targetTs(abs, target),
  };
  let after: JsonObject;
  try {
    after = keepConfig(input, plan);
  } catch (error) {
    err(`  ERROR: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  const report = keepReport(plan, input);
  for (const line of report.left) {
    const [lp = "", ln = ""] = line.split("\t");
    out(
      `  Usage capture left ${lp}: keeps an environment prefix (${ln}) that PowerShell on Windows cannot run; left as it is.`,
    );
  }
  if (JSON.stringify(input) === JSON.stringify(after)) {
    out(`  Usage capture kept unchanged in ${config}`);
    return 0;
  }
  backupFile(ctx, config);
  try {
    writeJsonConfig(config, after);
  } catch {
    err(`  ERROR: could not write ${config}.`);
    return 1;
  }
  let wroteAbs = false;
  for (const p of report.repointed) {
    out(`  Usage capture re-pointed ${p} -> ${abs}`);
    wroteAbs = true;
  }
  for (const p of report.requoted) out(`  Usage capture path quoted (it holds a space): ${p}`);
  const missing = missingEvents(plan, input);
  if (missing !== 0) {
    out(`  Usage capture re-registered on ${missing} event(s) at ${plan.target}`);
    if (plan.target === abs) wroteAbs = true;
  }
  out(`  Usage capture kept in ${config} (one entry per event)`);
  if (wroteAbs)
    warnIfLinkedWorktree(
      { io: ctx.io, repoDir },
      options.deps?.spawn ?? createSpawner(ctx),
      "usage capture",
    );
  return 0;
}
