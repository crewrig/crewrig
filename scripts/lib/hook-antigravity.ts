// hook-antigravity.ts — keep and remove one hook's commands in an Antigravity
// CLI `hooks.json` (spec 0243 delta-03 R33, R34).
//
// The file is a named-hook map (shape: hooks/antigravity-transcript-hooks.json):
//
//   { "<hookName>": { "<Event>": [ handler | { matcher, hooks: [handler] } ] } }
//
// The mechanism is parameterised by a `HookDescriptor` (R25), so rows C2
// (`worktree-git-guard`) and C3 (`mempalace-transcript`) register a descriptor
// with `guardedPrefix` and change nothing here. Nothing wires this library into
// a setup flow yet: that is C2/C3's work (delta-03 out-of-scope item).
//
//   - On Windows a command is current only when it equals, byte for byte, the
//     command hook-command.ts builds for it in the hooks entry's R32 state (as
//     hook-statusline.ts judges the status line). A bare `node <abs>`, or a
//     near-miss the shared signature accepts through its POSIX `NAME=value`
//     prefix, is never kept silently as current (R34); in a refusing state the
//     command is left with the R32 diagnostic.
//   - keep: report only, and never writes. A current command is already the
//     direct form; any other command of the descriptor, or one that names its
//     script but does not parse, is left and reported (R26).
//   - remove: on Windows delete only a current command or the exact guarded
//     form of the descriptor, elsewhere any recognised one, then prune only the
//     groups, events and hook names that the deletion emptied. Every other
//     handler stays byte-identical.
//   - A guarded command met on macOS or Linux is an unrecognised shape: the
//     module never produces it there (S4).
//
// The pure functions do no I/O; the `*File` variants back up first and write
// at 0600 through hook-config.ts (R23). Standard library only (spec 0240 R16).

import path from "node:path";

import { backupFile, readJsonObject, writeJsonConfig, type JsonObject } from "./hook-config.ts";
import { hookCommandLine, type MeasuredSurface } from "./hook-command.ts";
import type { HookDescriptor } from "./hook-descriptor.ts";
import { parseHandler } from "./hook-recognition.ts";
import type { ReportLine } from "./hook-rewrite.ts";

export interface AntigravityHooksOptions {
  readonly descriptor: HookDescriptor;
  readonly platform: NodeJS.Platform;
  /** Test seam: the measured-surface constant of hook-command.ts. */
  readonly measuredSurfaces?: readonly MeasuredSurface[];
}

export interface AntigravityRemoveResult {
  readonly config: JsonObject;
  readonly lines: readonly ReportLine[];
  readonly removed: number;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const ESCAPE = /[.*+?^${}()|[\]\\]/g;

type Verdict =
  | {
      readonly kind: "ours";
      readonly path: string;
      /** Already the current direct form: kept by keep. */
      readonly current: boolean;
      /** May be deleted by remove. */
      readonly removable: boolean;
      /** Why a non-current command is left. */
      readonly detail: string;
    }
  | { readonly kind: "foreign" };

const UNRECOGNISED = "unrecognised shape";

/** Whether one handler is the descriptor's current command, another of its commands, or another hook's. */
function judge(handler: unknown, options: AntigravityHooksOptions): Verdict {
  const command = isRecord(handler) ? handler["command"] : undefined;
  const parse = parseHandler(handler, options.descriptor);
  if (parse !== null && typeof command === "string") {
    if (options.platform !== "win32") {
      // S4: the module never produces the guarded form off Windows.
      return parse.guarded
        ? { kind: "ours", path: parse.path, current: false, removable: false, detail: UNRECOGNISED }
        : { kind: "ours", path: parse.path, current: true, removable: true, detail: "" };
    }
    // R34 on Windows: rebuild and compare bytes, as hook-statusline.ts does.
    const request = {
      cli: "antigravity",
      surface: "hooks",
      platform: "win32",
      scriptPath: parse.path,
      args: parse.post.split(/\s+/).filter((word) => word !== ""),
    } as const;
    const built =
      options.measuredSurfaces === undefined
        ? hookCommandLine(request)
        : hookCommandLine(request, options.measuredSurfaces);
    if (built.ok && built.command === command) {
      return { kind: "ours", path: parse.path, current: true, removable: true, detail: "" };
    }
    // The exact guarded form is the framework's own even where the entry now
    // refuses it, so remove may still take it; nothing else is.
    return {
      kind: "ours",
      path: parse.path,
      current: false,
      removable: parse.guarded,
      detail: built.ok ? UNRECOGNISED : built.refusal,
    };
  }
  if (typeof command !== "string") return { kind: "foreign" };
  const name = options.descriptor.basename.replace(ESCAPE, "\\$&");
  const named = new RegExp(`[^\\s"']*/hooks/${name}\\.(?:sh|ts)`).exec(command);
  return named === null
    ? { kind: "foreign" }
    : { kind: "ours", path: named[0], current: false, removable: false, detail: UNRECOGNISED };
}

/** Every handler of the file with where it sits, in document order. */
function* handlers(config: JsonObject): Generator<{ event: string; handler: unknown }> {
  for (const [hookName, events] of Object.entries(config)) {
    if (!isRecord(events)) continue;
    for (const [event, entries] of Object.entries(events)) {
      if (!Array.isArray(entries)) continue;
      const label = `${hookName}/${event}`;
      for (const entry of entries) {
        if (isRecord(entry) && Array.isArray(entry["hooks"])) {
          for (const handler of entry["hooks"]) yield { event: label, handler };
        } else {
          yield { event: label, handler: entry };
        }
      }
    }
  }
}

/** Report each command of `descriptor` in `config`; never changes it. */
export function keepAntigravityHooks(
  config: JsonObject,
  options: AntigravityHooksOptions,
): ReportLine[] {
  const lines: ReportLine[] = [];
  for (const { event, handler } of handlers(config)) {
    const verdict = judge(handler, options);
    if (verdict.kind === "foreign") continue;
    lines.push({
      kind: "left",
      event,
      path: verdict.path,
      detail: verdict.current ? "already the direct form" : verdict.detail,
    });
  }
  return lines;
}

/** `config` without the recognised commands of `descriptor`; the input is not mutated. */
export function removeAntigravityHooks(
  config: JsonObject,
  options: AntigravityHooksOptions,
): AntigravityRemoveResult {
  const lines: ReportLine[] = [];
  let removed = 0;
  /** Keep a handler, or drop it and report why. */
  const keeps = (event: string, handler: unknown): boolean => {
    const verdict = judge(handler, options);
    if (verdict.kind === "foreign") return true;
    if (verdict.removable) {
      lines.push({ kind: "dropped", event, path: verdict.path, detail: "removed" });
      removed++;
      return false;
    }
    lines.push({ kind: "left", event, path: verdict.path, detail: verdict.detail });
    return true;
  };

  const out: JsonObject = {};
  for (const [hookName, events] of Object.entries(config)) {
    if (!isRecord(events)) {
      out[hookName] = events;
      continue;
    }
    const keptEvents: Record<string, unknown> = {};
    let emptiedEvents = 0;
    for (const [event, entries] of Object.entries(events)) {
      if (!Array.isArray(entries)) {
        keptEvents[event] = entries;
        continue;
      }
      const label = `${hookName}/${event}`;
      const keptEntries: unknown[] = [];
      let emptiedEntries = 0;
      for (const entry of entries) {
        if (isRecord(entry) && Array.isArray(entry["hooks"])) {
          const inner = entry["hooks"] as unknown[];
          const keptInner = inner.filter((handler) => keeps(label, handler));
          if (keptInner.length === inner.length) keptEntries.push(entry);
          else if (keptInner.length > 0) keptEntries.push({ ...entry, hooks: keptInner });
          else emptiedEntries++;
        } else if (keeps(label, entry)) {
          keptEntries.push(entry);
        } else {
          emptiedEntries++;
        }
      }
      // Prune an event only when the deletion emptied it, never one that was already empty.
      if (keptEntries.length === 0 && emptiedEntries > 0) emptiedEvents++;
      else keptEvents[event] = keptEntries;
    }
    // Likewise prune a hook name only when the deletion emptied all its events.
    if (Object.keys(keptEvents).length > 0 || emptiedEvents === 0) out[hookName] = keptEvents;
  }
  return { config: removed === 0 ? config : out, lines, removed };
}

/** Keep over a file: read it and report; never writes, never backs up. */
export function keepAntigravityHooksFile(
  file: string,
  options: AntigravityHooksOptions,
): ReportLine[] {
  const config = readJsonObject(file);
  return config === null ? [] : keepAntigravityHooks(config, options);
}

/**
 * Remove over a file: back up first (0600), then write at 0600 (R23). Nothing
 * is written, and no backup made, when nothing is recognised. Returns the exit
 * status and the report.
 */
export function removeAntigravityHooksFile(
  file: string,
  options: AntigravityHooksOptions,
  log: (line: string) => void,
): { readonly status: number; readonly lines: readonly ReportLine[] } {
  const config = readJsonObject(file);
  if (config === null) return { status: 0, lines: [] };
  const result = removeAntigravityHooks(config, options);
  if (result.removed === 0) return { status: 0, lines: result.lines };
  const made = backupFile(file);
  if (made.status === "failed") {
    log(`  ERROR: could not back up ${file}; leaving it untouched (backup-first, R23).`);
    return { status: 1, lines: result.lines };
  }
  if (made.status === "made") {
    log(`  Backed up: ${path.basename(file)} -> ${path.basename(made.path)}`);
  }
  writeJsonConfig(file, result.config);
  return { status: 0, lines: result.lines };
}
