// gap-record.ts — the in-memory observed-gap channel (spec 0254 R13).
// Replaces the shell's fd 3 NDJSON wire (scripts/build-extension.sh:401-455): records are
// appended in emission order and written once, as the pretty JSON array
// `jq -R -s 'split("\n") | ... | map(fromjson)'` produced. `gapKey` is `GAP_KEY_FILTER`
// (scripts/build-extension.sh:530), applied to a `Gap` or to a record read back from a file.

import fs from "node:fs";
import path from "node:path";

import { jqText, obj, writeJsonText } from "./json-write.ts";
import type { Gap, JsonValue } from "./types.ts";

/** The channel one build appends to. */
export interface GapChannel {
  readonly gaps: Gap[];
  record(gap: Gap): void;
}

/** A fresh, empty channel; `gaps` stays in emission order. */
export function createGapChannel(): GapChannel {
  const gaps: Gap[] = [];
  return {
    gaps,
    record(gap: Gap): void {
      gaps.push(gap);
    },
  };
}

/** One record as a JSON object, keys in the shell emitters' order: subject, target, hook, event, part, reason. */
export function gapToJson(gap: Gap): Map<string, JsonValue> {
  const pairs: Array<readonly [string, JsonValue]> = [
    ["subject", gap.subject],
    ["target", gap.target],
  ];
  if (gap.hook !== undefined) pairs.push(["hook", gap.hook]);
  if (gap.event !== undefined) pairs.push(["event", gap.event]);
  if (gap.part !== undefined) pairs.push(["part", gap.part]);
  pairs.push(["reason", gap.reason]);
  return obj(pairs);
}

function isReadBack(
  gap: Gap | ReadonlyMap<string, JsonValue>,
): gap is ReadonlyMap<string, JsonValue> {
  return gap instanceof Map;
}

/** One member of a `Gap` as a JSON value (`undefined` when the record does not carry it). */
function gapField(gap: Gap, name: string): JsonValue | undefined {
  const members: Readonly<Record<string, string | undefined>> = { ...gap };
  return members[name];
}

/**
 * `gap_key`: `subject@target`, plus `@hook@event@part` when the record carries a `hook`.
 * A record read back from a file (a `Map`) is keyed by the same rule, `has("hook")` included;
 * a missing interpolated value prints as `null`, as jq's string interpolation does.
 */
export function gapKey(gap: Gap | ReadonlyMap<string, JsonValue>): string {
  if (isReadBack(gap)) {
    const field = (name: string): string => jqText(gap.get(name));
    const base = `${field("subject")}@${field("target")}`;
    return gap.has("hook") ? `${base}@${field("hook")}@${field("event")}@${field("part")}` : base;
  }
  const field = (name: string): string => jqText(gapField(gap, name));
  const base = `${field("subject")}@${field("target")}`;
  return gap.hook !== undefined
    ? `${base}@${field("hook")}@${field("event")}@${field("part")}`
    : base;
}

/** Write the records as a pretty JSON array (`[]` when empty), creating parent directories. */
export function writeGapFile(file: string, gaps: readonly Gap[]): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, writeJsonText(gaps.map(gapToJson)));
}
