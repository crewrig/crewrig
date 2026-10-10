// usage-capture-write.ts — the three writers of the usage-capture opt-in (spec 0256 requirement 30,
// plan v2 step B3a.2b): `usage_capture_enable`, `usage_capture_remove` and `usage_capture_reinject` of
// scripts/lib/usage-capture-optin.sh. Messages are the shell's, byte for byte. Every write is atomic and
// ends at 0600 (`writeJsonConfig`); a failed write leaves the file as it was. The strip and the add are
// the jq definitions `uc_strip_by` and `uc_add` already ported in session-recording-merge.ts. Layer 2.

import fs from "node:fs";
import path from "node:path";

import { writeJsonConfig, type JsonObject } from "../hook-config.ts";
import type { WiredCli } from "../hook-descriptor.ts";
import { backupFile } from "./backup.ts";
import { add, allHandlers, flatOf, isCapture, isObj, stripBy } from "./session-recording-merge.ts";
import type { Json, Located } from "./session-recording-merge.ts";
import {
  fragmentEvents,
  isRegularFile,
  usageCaptureFragment,
  type UcCtx,
  type UcDeps,
} from "./usage-capture-fragment.ts";
import { captureShape, readCaptureConfig, unknownCliMessage } from "./usage-capture-state.ts";

/** One `{event, selector, handler}` of a footprint as `uc_add` reads it; throws where jq's `error` would. */
function locatedOf(value: unknown): Located {
  if (!isObj(value) || typeof value["event"] !== "string")
    throw new Error("invalid footprint entry");
  const selector = value["selector"];
  if (selector !== undefined && selector !== null && selector !== false && !isObj(selector)) {
    throw new Error("invalid footprint selector");
  }
  return {
    event: value["event"],
    selector: isObj(selector) ? selector : null,
    handler: value["handler"] ?? null,
  };
}

/** `uc_reinject($fp)`: strip every capture handler, then add each footprint entry back. */
function reinjectInto(doc: Json, footprint: readonly unknown[], flat: boolean): Json {
  const next = stripBy(structuredClone(doc), flat, isCapture);
  for (const entry of footprint) add(next, locatedOf(entry), flat);
  return next;
}

export interface UcWriteOptions {
  readonly ctx: UcCtx;
  readonly cli: string;
  readonly settingsPath: string;
  /** The checkout whose fragment and hook script are registered; default `ctx.repoDir`. */
  readonly repoDir?: string;
  readonly deps?: UcDeps;
}

/** `usage_capture_enable`: 0 done, 1 refused or failed (nothing written on a refusal). */
export function usageCaptureEnable(o: UcWriteOptions): number {
  const { ctx, cli, settingsPath: config } = o;
  const { out, err } = ctx.io;
  if (captureShape(cli) === undefined) {
    err(unknownCliMessage(cli));
    return 1;
  }
  const flat = flatOf(cli as WiredCli);
  const frag = usageCaptureFragment(ctx, cli, o.repoDir ?? ctx.repoDir, o.deps);
  if (frag === null) return 1;
  const events = fragmentEvents(frag);
  if (isRegularFile(config)) {
    let current: JsonObject | null;
    try {
      current = readCaptureConfig(config);
    } catch {
      err(`  ERROR: ${config} is not a JSON object; usage capture not enabled.`);
      return 1;
    }
    backupFile(ctx, config);
    try {
      const footprint = allHandlers(frag, flat).filter((x) => isCapture(x.handler));
      writeJsonConfig(config, reinjectInto(current ?? {}, footprint, flat));
    } catch {
      err(`  ERROR: could not write ${config}.`);
      return 1;
    }
  } else {
    try {
      fs.mkdirSync(path.dirname(config), { recursive: true });
      fs.writeFileSync(config, "{}\n", { mode: 0o600 });
      fs.chmodSync(config, 0o600);
    } catch {
      err(`  ERROR: could not create ${config}.`);
      return 1;
    }
    try {
      writeJsonConfig(config, frag);
    } catch {
      fs.rmSync(config, { force: true });
      err(`  ERROR: could not write ${config}.`);
      return 1;
    }
  }
  out(`  Usage capture enabled on ${events} in ${config}`);
  return 0;
}

/** `usage_capture_remove`: every capture handler deleted, pruning only what that emptied (R12). */
export function usageCaptureRemove(o: Omit<UcWriteOptions, "repoDir" | "deps">): number {
  const { ctx, cli, settingsPath: config } = o;
  const { out, err } = ctx.io;
  if (captureShape(cli) === undefined) {
    err(unknownCliMessage(cli));
    return 1;
  }
  if (!isRegularFile(config)) {
    out(`  No usage-capture entry to remove (${config} does not exist).`);
    return 0;
  }
  let current: JsonObject | null;
  try {
    current = readCaptureConfig(config);
  } catch {
    err(`  ERROR: ${config} is not a JSON object; usage capture not removed.`);
    return 1;
  }
  backupFile(ctx, config);
  try {
    writeJsonConfig(
      config,
      stripBy(structuredClone(current ?? {}), flatOf(cli as WiredCli), isCapture),
    );
  } catch {
    err(`  ERROR: could not write ${config}.`);
    return 1;
  }
  out(`  Usage capture removed from ${config} (every other entry left as it was)`);
  return 0;
}

/** `usage_capture_reinject`: one secure write, no backup (its callers own backups); 1 with no message when the write fails. */
export function usageCaptureReinject(
  o: Omit<UcWriteOptions, "repoDir" | "deps"> & { readonly footprint: unknown },
): number {
  const { ctx, cli, settingsPath: config } = o;
  const { err } = ctx.io;
  if (captureShape(cli) === undefined) {
    err(unknownCliMessage(cli));
    return 1;
  }
  let current: JsonObject | null = null;
  try {
    current = isRegularFile(config) ? readCaptureConfig(config) : null;
  } catch {
    current = null;
  }
  if (current === null) {
    err(`  ERROR: ${config} is absent or not a JSON object; usage capture not re-injected.`);
    return 1;
  }
  if (!Array.isArray(o.footprint)) {
    err("  ERROR: invalid usage-capture footprint.");
    return 1;
  }
  try {
    writeJsonConfig(
      config,
      reinjectInto(current, o.footprint as unknown[], flatOf(cli as WiredCli)),
    );
  } catch {
    return 1;
  }
  return 0;
}
