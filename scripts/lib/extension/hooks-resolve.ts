// hooks-resolve.ts — command resolution, resolved entries and gap records of the hook translator
// (spec 0254 R10). Twins of `_ext_hooks_resolve_command` (scripts/lib/extension-hooks.sh:241-254),
// `_ext_hooks_resolved_entries` (:271-308) and `ext_hooks_gaps` (:191-232).

import {
  entryHasMatcher,
  entryText,
  hooksArray,
  matcherAccepting,
  matcherTool,
  stripTrailingLf,
  targetEvent,
} from "./hooks-vocab.ts";
import type { Gap, JsonValue, Target, TargetTable } from "./types.ts";

export const EXT_HOOKS_NEUTRAL_ROOT_TOKEN = "${extensionRoot}";

/** One hook entry that has a counterpart on the target. `matcher` is null when the event takes none. */
export interface ResolvedEntry {
  readonly event: string;
  readonly hasMatcher: boolean;
  readonly matcher: string | null;
  readonly command: string;
}

/**
 * Substitute the neutral root token globally with the target's own form. A target without a
 * root token loses the token and one following "/", then any bare token. Split/join, never a
 * replacement string, so `$&` and friends in the root token stay inert.
 */
export function resolveCommand(command: string, target: Target, table: TargetTable): string {
  const rootToken = table[target].rootToken;
  const parts =
    rootToken !== ""
      ? command.split(EXT_HOOKS_NEUTRAL_ROOT_TOKEN).join(rootToken)
      : command
          .split(`${EXT_HOOKS_NEUTRAL_ROOT_TOKEN}/`)
          .join("")
          .split(EXT_HOOKS_NEUTRAL_ROOT_TOKEN)
          .join("");
  return stripTrailingLf(parts);
}

export function resolvedEntries(
  target: Target,
  manifest: Map<string, JsonValue>,
  table: TargetTable,
): ResolvedEntry[] {
  const hooks = hooksArray(manifest);
  if (hooks === null) return [];
  const records: ResolvedEntry[] = [];
  for (const entry of hooks) {
    const event = entryText(entry, "event");
    const command = entryText(entry, "command");
    const hasMatcher = entryHasMatcher(entry);
    const matcher = entryText(entry, "matcher");

    const nativeEvent = targetEvent(event, target);
    if (nativeEvent === "") continue;

    if (!matcherAccepting(event)) {
      records.push({
        event: nativeEvent,
        hasMatcher: false,
        matcher: null,
        command: resolveCommand(command, target, table),
      });
      continue;
    }

    let tool: string;
    if (hasMatcher) {
      tool = matcherTool(matcher, target, table);
      if (tool === "") continue; // matcher-class gap on this target
    } else {
      tool = table[target].matchAll;
    }
    records.push({
      event: nativeEvent,
      hasMatcher: true,
      matcher: tool,
      command: resolveCommand(command, target, table),
    });
  }
  return records;
}

/** The stderr warnings and the observed-gap records `ext_hooks_gaps` emits, in entry order. */
export interface HookGaps {
  readonly warnings: string[];
  readonly gaps: Gap[];
}

export function hookGaps(
  target: Target,
  manifest: Map<string, JsonValue>,
  table: TargetTable,
): HookGaps {
  const warnings: string[] = [];
  const gaps: Gap[] = [];
  const hooks = hooksArray(manifest);
  if (hooks === null) return { warnings, gaps };

  for (const entry of hooks) {
    const id = entryText(entry, "id");
    const event = entryText(entry, "event");
    const hasMatcher = entryHasMatcher(entry);
    const matcher = entryText(entry, "matcher");

    if (targetEvent(event, target) === "") {
      warnings.push(
        `Warning: hook '${id}' declares event '${event}', which has no counterpart on target '${target}'`,
      );
      gaps.push({
        subject: "hooks",
        target,
        hook: id,
        event,
        part: "event",
        reason: "neutral event has no counterpart on this target",
      });
      continue;
    }
    if (hasMatcher && matcherTool(matcher, target, table) === "") {
      warnings.push(
        `Warning: hook '${id}' (event '${event}') declares matcher '${matcher}', which has no counterpart on target '${target}'`,
      );
      gaps.push({
        subject: "hooks",
        target,
        hook: id,
        event,
        part: "matcher",
        reason: "neutral matcher class has no counterpart on this target",
      });
    }
  }
  return { warnings, gaps };
}
