// hooks-emit.ts — the four native hook-file envelopes (spec 0254 R10).
// Twin of `ext_hooks_render` (scripts/lib/extension-hooks.sh:314-375). Pure: it returns the
// value and the file name; the caller serialises with `writeJsonText` and writes `<out>/<file>`.

import { jqText, obj } from "./json-write.ts";
import { resolvedEntries, type ResolvedEntry } from "./hooks-resolve.ts";
import { stripTrailingLf } from "./hooks-vocab.ts";
import type { JsonValue, Target, TargetTable } from "./types.ts";

export interface HookFile {
  readonly file: string;
  readonly value: JsonValue;
}

/** `reduce ... (.[$e.event] += [item])`: events in first-seen order, items appended. */
function groupByEvent(
  entries: readonly ResolvedEntry[],
  item: (e: ResolvedEntry) => JsonValue,
): Map<string, JsonValue> {
  const grouped = new Map<string, JsonValue[]>();
  for (const e of entries) {
    const list = grouped.get(e.event) ?? [];
    list.push(item(e));
    grouped.set(e.event, list);
  }
  return new Map<string, JsonValue>(grouped);
}

const handler = (command: string): JsonValue => [
  obj([
    ["type", "command"],
    ["command", command],
  ]),
];

/** Grouped shape of claude and gemini: `{hooks: [...]}` plus a `matcher` when the event has one. */
function claudeGeminiItem(e: ResolvedEntry): JsonValue {
  const pairs: Array<readonly [string, JsonValue]> = [["hooks", handler(e.command)]];
  if (e.hasMatcher) pairs.push(["matcher", e.matcher]);
  return obj(pairs);
}

/** Flat shape of copilot: `type`, an optional inline `matcher`, then `command`. */
function copilotItem(e: ResolvedEntry): JsonValue {
  const pairs: Array<readonly [string, JsonValue]> = [["type", "command"]];
  if (e.hasMatcher) pairs.push(["matcher", e.matcher]);
  pairs.push(["command", e.command]);
  return obj(pairs);
}

/** The target's hook file, or null when no declared hook maps onto the target. */
export function renderHookFile(
  target: Target,
  manifest: Map<string, JsonValue>,
  table: TargetTable,
): HookFile | null {
  const entries = resolvedEntries(target, manifest, table);
  if (entries.length === 0) return null;
  const file = table[target].hookFile;

  switch (target) {
    case "claude":
    case "gemini":
      return { file, value: obj([["hooks", groupByEvent(entries, claudeGeminiItem)]]) };
    case "antigravity": {
      const id = `${stripTrailingLf(jqText(manifest.get("name")))}-hooks`;
      const grouped = groupByEvent(entries, (e) =>
        obj([
          ["matcher", e.matcher],
          ["hooks", handler(e.command)],
        ]),
      );
      return { file, value: obj([[id, grouped]]) };
    }
    case "copilot":
      return {
        file,
        value: obj([
          ["version", 1],
          ["disableAllHooks", false],
          ["hooks", groupByEvent(entries, copilotItem)],
        ]),
      };
  }
}
