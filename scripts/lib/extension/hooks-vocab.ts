// hooks-vocab.ts — the closed neutral hook vocabulary and its per-target mapping (spec 0254 R10).
// Twin of scripts/lib/extension-hooks.sh:50-125 (`EXT_HOOKS_KNOWN_EVENTS`, the matcher classes,
// `_ext_hooks_target_event`, `_ext_hooks_matcher_accepting`, `_ext_hooks_matcher_tool`) plus the
// per-entry field readers the shell repeats at :140-150, :197-203 and :277-283.

import { jqText } from "./json-write.ts";
import type { JsonValue, Target, TargetTable } from "./types.ts";

export const EXT_HOOKS_KNOWN_EVENTS: readonly string[] = ["PreToolUse", "UserPromptSubmit"];
export const EXT_HOOKS_KNOWN_MATCHER_CLASSES: readonly string[] = ["shell"];

/** `ext_hooks_known_events`: the closed event set, in declaration order. */
export function knownEvents(): string[] {
  return [...EXT_HOOKS_KNOWN_EVENTS];
}

export function isKnownEvent(event: string): boolean {
  return EXT_HOOKS_KNOWN_EVENTS.includes(event);
}

export function isKnownMatcherClass(matcherClass: string): boolean {
  return EXT_HOOKS_KNOWN_MATCHER_CLASSES.includes(matcherClass);
}

/** Does at least one target accept a matcher on this neutral event at all? */
export function matcherAccepting(event: string): boolean {
  return event === "PreToolUse";
}

const TARGET_EVENTS: Readonly<Record<Target, Readonly<Record<string, string>>>> = {
  claude: { PreToolUse: "PreToolUse", UserPromptSubmit: "UserPromptSubmit" },
  gemini: { PreToolUse: "BeforeTool", UserPromptSubmit: "BeforeAgent" },
  copilot: { PreToolUse: "preToolUse", UserPromptSubmit: "userPromptSubmitted" },
  antigravity: { PreToolUse: "PreToolUse" },
};

/** The target's own event name, or "" when there is no counterpart. */
export function targetEvent(event: string, target: Target): string {
  const row = TARGET_EVENTS[target];
  return Object.hasOwn(row, event) ? (row[event] as string) : "";
}

/** The target's own tool name for a neutral matcher class, or "" when there is none. */
export function matcherTool(matcherClass: string, target: Target, table: TargetTable): string {
  return matcherClass === "shell" ? table[target].shellTool : "";
}

/** The shell's `$(...)` strips every trailing line feed. */
export function stripTrailingLf(text: string): string {
  return text.replace(/\n+$/, "");
}

/** The hook entries when `.hooks` is an array, else null (callers treat null as "nothing to do"). */
export function hooksArray(manifest: Map<string, JsonValue>): JsonValue[] | null {
  const hooks = manifest.get("hooks");
  return Array.isArray(hooks) ? hooks : null;
}

/**
 * `jq -r '.<key> // empty'` on one entry, captured by `$(...)`: "" for a missing, null or
 * false field, and for an entry that is not an object (jq errors, stderr aside).
 */
export function entryText(entry: JsonValue, key: string): string {
  if (!(entry instanceof Map)) return "";
  const value = entry.get(key);
  if (value === undefined || value === null || value === false) return "";
  return stripTrailingLf(jqText(value));
}

/** `has("matcher") and (.matcher != null)` on one entry. */
export function entryHasMatcher(entry: JsonValue): boolean {
  if (!(entry instanceof Map)) return false;
  const value = entry.get("matcher");
  return value !== undefined && value !== null;
}
