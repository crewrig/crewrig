// usage-capture-rank.ts — the deduplication of the usage-capture opt-in's `keep` (spec 0256
// requirement 30, plan v2 step B3a.3a): `uc_rank`, `uc_event_handlers`, `uc_dedup_event` and
// `uc_keep_dedup` of scripts/lib/usage-capture-optin.sh, and the path classification loop of
// `usage_capture_keep` that feeds them. Pure: every function returns a new value and reads nothing
// but its arguments (the file probe is injected).
//
// The survivor of one event is the first handler whose registered path is live; failing that the
// first one that cannot be judged (a `$…`, `~…` or relative path); failing that the first one
// (#1174 i1-F6: a live command is never dropped in favour of a dead one). Layer 2.

import type { JsonObject } from "../hook-config.ts";
import type { HookCommandParse } from "../hook-recognition.ts";
import { isUnresolvablePath, isUnsafePath, type CaptureShape } from "./usage-capture-state.ts";

/** The paths `keep` judged: live (an existing file) and vanished (absolute, expansion-free, missing). */
export interface PathLists {
  readonly live: readonly string[];
  readonly vanished: readonly string[];
}

/** `uc_parse` of one handler under the legacy-ok list of its configuration. */
export type ParseHandler = (handler: unknown) => HookCommandParse | null;

/** 0 live, 1 cannot be judged, 2 vanished: `uc_rank`, by membership in the two lists. */
export function rankOf(p: string, lists: PathLists): 0 | 1 | 2 {
  if (lists.live.includes(p)) return 0;
  return lists.vanished.includes(p) ? 2 : 1;
}

const isRecord = (v: unknown): v is JsonObject =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** `uc_event_handlers`: every handler of an event's array, whatever the shape. */
export function eventHandlers(shape: CaptureShape, entries: readonly unknown[]): unknown[] {
  if (shape === "flat") return [...entries];
  return entries.flatMap((g) =>
    isRecord(g) && Array.isArray(g["hooks"]) ? (g["hooks"] as unknown[]) : [],
  );
}

/** `uc_dedup_event`: exactly one capture handler of the event, the best ranked and first of its rank. */
export function dedupEvent(
  shape: CaptureShape,
  entries: readonly unknown[],
  lists: PathLists,
  parse: ParseHandler,
): unknown[] {
  const rankHandler = (h: unknown): number | null => {
    const p = parse(h)?.path;
    return p === undefined ? null : rankOf(p, lists);
  };
  const ranks = eventHandlers(shape, entries)
    .map(rankHandler)
    .filter((r): r is 0 | 1 | 2 => r !== null);
  if (ranks.length === 0) return [...entries];
  const best = Math.min(...ranks);
  let done = false;
  // The survivor test, shared by both shapes: the first capture handler of the best rank.
  const keepHandler = (h: unknown): boolean => {
    const r = rankHandler(h);
    if (r === null) return true;
    if (!done && r === best) {
      done = true;
      return true;
    }
    return false;
  };
  if (shape === "flat") return entries.filter(keepHandler);
  const kept: unknown[] = [];
  for (const g of entries) {
    if (!isRecord(g) || !Array.isArray(g["hooks"])) {
      kept.push(g);
      continue;
    }
    const before = g["hooks"] as unknown[];
    const hooks = before.filter(keepHandler);
    // A group is dropped only when this deletion alone emptied it (R12).
    if (before.length > 0 && hooks.length === 0) continue;
    kept.push({ ...g, hooks });
  }
  return kept;
}

/**
 * `uc_keep_dedup`: `dedupEvent` on each of the `r5` events whose array exists; every other event
 * and every other key of `config` is left as it is. Returns a new configuration object.
 */
export function dedupConfig(
  shape: CaptureShape,
  config: JsonObject,
  r5: readonly string[],
  lists: PathLists,
  parse: ParseHandler,
): JsonObject {
  const hooks = config["hooks"];
  if (!isRecord(hooks)) return config;
  const next: JsonObject = { ...hooks };
  for (const event of r5) {
    const entries = next[event];
    if (Array.isArray(entries)) next[event] = dedupEvent(shape, entries as unknown[], lists, parse);
  }
  return { ...config, hooks: next };
}

/** What the classification loop of `usage_capture_keep` decided. */
export interface ClassifiedPaths extends PathLists {
  /** The first live path that can be spliced into a command, or `""` when none. */
  readonly target: string;
}

/**
 * The paths registered on the R5 events, in order, each on its own line (a path holding a newline
 * splits into fragments that match nothing, as in the shell), judged one by one: an unresolvable
 * one is skipped, an existing file is live, any other is vanished.
 */
export function classifyPaths(
  paths: readonly string[],
  isFile: (p: string) => boolean,
): ClassifiedPaths {
  const live: string[] = [];
  const vanished: string[] = [];
  let target = "";
  for (const p of paths.flatMap((x) => x.split("\n"))) {
    if (p === "" || isUnresolvablePath(p)) continue;
    if (isFile(p)) {
      live.push(p);
      if (target === "" && !isUnsafePath(p)) target = p;
    } else {
      vanished.push(p);
    }
  }
  return { live, vanished, target };
}
