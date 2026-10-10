// usage-capture-keep-plan.ts — the pure core of `usage_capture_keep` (spec 0256 requirement 30, plan
// v2 step B3a.3b): `uc_keep`, `uc_repoint_*`, `uc_add`, `uc_ps_left` and the three jq reports that
// `usage_capture_keep` prints after a write. Everything takes a parsed configuration and returns a
// new value; the configuration it is given is never modified. Layer 2.

import { isDeepStrictEqual } from "node:util";

import type { JsonObject } from "../hook-config.ts";
import type { HookCommandParse } from "../hook-recognition.ts";
import { dedupConfig, type ParseHandler, type PathLists } from "./usage-capture-rank.ts";
import { allHandlers, type CaptureEntry, type CaptureShape } from "./usage-capture-state.ts";

const isRecord = (v: unknown): v is JsonObject =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Everything `uc_keep` takes besides the configuration. */
export interface KeepPlan {
  readonly shape: CaptureShape;
  readonly r5: readonly string[];
  readonly lists: PathLists;
  /** `$abs` (the `.ts`) and `$abs_sh`: where a vanished `.ts` / `.sh` handler is re-pointed. */
  readonly abs: string;
  readonly absSh: string;
  readonly fragfp: readonly CaptureEntry[];
  /** `$target`: where a handler added to an event without one points. */
  readonly target: string;
  readonly ps: boolean;
  readonly parse: ParseHandler;
}

/** `uc_with_path`: the handler with its script path replaced, double-quoted; the others unchanged. */
function withPath(handler: unknown, parse: HookCommandParse | null, p: string): unknown {
  if (parse === null || !isRecord(handler)) return handler;
  return { ...handler, command: `${parse.pre}"${p}"${parse.post}` };
}

const ASSIGN_PREFIX = /^\s*[A-Za-z_][A-Za-z0-9_]*=/;

/** `uc_repoint_handler`. */
function repointHandler(handler: unknown, plan: KeepPlan): unknown {
  const parse = plan.parse(handler);
  if (parse === null) return handler;
  if (plan.lists.vanished.includes(parse.path)) {
    // Windows PowerShell cannot run a NAME=value prefix: the command is left as it is.
    if (plan.ps && ASSIGN_PREFIX.test(parse.pre)) return handler;
    return withPath(handler, parse, parse.ext === "ts" ? plan.abs : plan.absSh);
  }
  return !parse.quoted && /\s/.test(parse.path) ? withPath(handler, parse, parse.path) : handler;
}

/** `uc_repoint_event`. */
function repointEvent(entries: readonly unknown[], plan: KeepPlan): unknown[] {
  if (plan.shape === "flat") return entries.map((h) => repointHandler(h, plan));
  return entries.map((g) =>
    isRecord(g) && Array.isArray(g["hooks"])
      ? { ...g, hooks: (g["hooks"] as unknown[]).map((h) => repointHandler(h, plan)) }
      : g,
  );
}

/** `uc_add`: join the first group of the same selector (grouped), else append; throws as jq's `error`. */
function addEntry(config: JsonObject, shape: CaptureShape, x: CaptureEntry): void {
  if (config["hooks"] === undefined || config["hooks"] === null) config["hooks"] = {};
  const hooks = config["hooks"];
  if (!isRecord(hooks)) throw new Error("hooks is not an object");
  if (hooks[x.event] === undefined || hooks[x.event] === null) hooks[x.event] = [];
  const entries = hooks[x.event];
  if (!Array.isArray(entries)) throw new Error("hook event is not an array");
  if (shape === "flat") return void entries.push(x.handler);
  const selector = x.selector ?? {};
  const joined = (entries as unknown[]).find((g) => {
    if (!isRecord(g) || !Array.isArray(g["hooks"])) return false;
    const { hooks: _handlers, ...rest } = g;
    return isDeepStrictEqual(rest, selector);
  });
  if (isRecord(joined)) (joined["hooks"] as unknown[]).push(x.handler);
  else entries.push({ ...selector, hooks: [x.handler] });
}

/** `uc_event_has_capture`. */
const hasCapture = (config: JsonObject, event: string, plan: KeepPlan): boolean =>
  allHandlers(plan.shape, config).some((x) => x.event === event && plan.parse(x.handler) !== null);

/** `uc_keep`: the configuration after dedup, re-point, quoting and the added handlers. `input` is not modified. */
export function keepConfig(input: JsonObject, plan: KeepPlan): JsonObject {
  const config = structuredClone(dedupConfig(plan.shape, input, plan.r5, plan.lists, plan.parse));
  const hooks = config["hooks"];
  if (isRecord(hooks)) {
    for (const event of plan.r5) {
      const entries = hooks[event];
      if (Array.isArray(entries)) hooks[event] = repointEvent(entries as unknown[], plan);
    }
  }
  for (const x of plan.fragfp) {
    if (hasCapture(config, x.event, plan)) continue;
    const handler = withPath(x.handler, plan.parse(x.handler), plan.target);
    addEntry(config, plan.shape, { ...x, handler });
  }
  return config;
}

/** `@tsv` escapes a backslash, a tab, a line feed and a carriage return in a field. */
const TSV: Readonly<Record<string, string>> = {
  "\\": "\\\\",
  "\t": "\\t",
  "\n": "\\n",
  "\r": "\\r",
};
const tsvField = (s: string): string => s.replace(/[\\\t\n\r]/g, (c) => TSV[c] ?? c);

const distinct = (items: readonly string[]): string[] => [...new Set(items)];

/** The capture handlers of the R5 events, in registration order (`uc_footprint` restricted to `$r5`). */
function r5Handlers(plan: KeepPlan, config: JsonObject): { parse: HookCommandParse }[] {
  return allHandlers(plan.shape, config).flatMap((x) => {
    const parse = plan.parse(x.handler);
    return parse !== null && plan.r5.includes(x.event) ? [{ parse }] : [];
  });
}

/** `uc_event_has_capture` over every event: the R5 events of `plan` that hold no capture handler. */
export function missingEvents(plan: KeepPlan, config: JsonObject): number {
  const held = (event: string): boolean =>
    allHandlers(plan.shape, config).some(
      (x) => x.event === event && plan.parse(x.handler) !== null,
    );
  return plan.r5.filter((event) => !held(event)).length;
}

const ASSIGNED_NAME = /(?:^|\s)([A-Za-z_][A-Za-z0-9_]*)=/g;

export interface KeepReport {
  /** `uc_ps_left` as `path<TAB>NAME=..., NAME=...` lines (names only, never values). */
  readonly left: readonly string[];
  /** The vanished paths a kept handler really carried and that were re-pointed. */
  readonly repointed: readonly string[];
  /** The kept, still-live spaced paths that gained their quotes. */
  readonly requoted: readonly string[];
}

/** What `usage_capture_keep` reports on the configuration as it was, after the deduplication. */
export function keepReport(plan: KeepPlan, input: JsonObject): KeepReport {
  const deduped = dedupConfig(plan.shape, input, plan.r5, plan.lists, plan.parse);
  const handlers = r5Handlers(plan, deduped);
  const left = !plan.ps
    ? []
    : distinct(
        handlers
          .filter(
            (h) => ASSIGN_PREFIX.test(h.parse.pre) && plan.lists.vanished.includes(h.parse.path),
          )
          .map(({ parse }) => {
            const names = [...parse.pre.matchAll(ASSIGNED_NAME)].map((m) => `${m[1] ?? ""}=...`);
            return `${tsvField(parse.path)}\t${tsvField(names.join(", "))}`;
          }),
      );
  const leftPaths = left.map((line) => line.split("\t")[0]);
  const now = distinct(handlers.map((h) => h.parse.path));
  const repointed = plan.lists.vanished.filter((v) => now.includes(v) && !leftPaths.includes(v));
  const requoted = distinct(
    handlers
      .filter((h) => !h.parse.quoted && /\s/.test(h.parse.path))
      .map((h) => h.parse.path)
      .filter((p) => !plan.lists.vanished.includes(p)),
  );
  return { left, repointed, requoted };
}
