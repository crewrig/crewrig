// validate-hooks.ts — the generic `hooks` section validator (spec 0254 R9).
// Twin of `ext_hooks_validate` (scripts/lib/extension-hooks.sh:133-187).
// Pure: returns the VALIDATION-ERROR lines the shell prints to stderr.

import {
  entryHasMatcher,
  entryText,
  isKnownEvent,
  isKnownMatcherClass,
  matcherAccepting,
} from "./hooks-vocab.ts";
import type { JsonValue } from "./types.ts";

const ID_PATTERN = /^[A-Za-z0-9._-]+$/;

export function validateHooks(manifestPath: string, manifest: Map<string, JsonValue>): string[] {
  const hooks = manifest.get("hooks");
  // `has("hooks") and (.hooks != null)`: omitting the section stays valid.
  if (hooks === undefined || hooks === null) return [];
  const head = `VALIDATION-ERROR: ${manifestPath} —`;
  if (!Array.isArray(hooks)) {
    return [`${head} the generic 'hooks' section must be an array of hook entries`];
  }

  const lines: string[] = [];
  hooks.forEach((entry, n) => {
    const id = entryText(entry, "id");
    const event = entryText(entry, "event");
    const command = entryText(entry, "command");
    const matcher = entryText(entry, "matcher");
    const at = `hooks[${n}] (id '${id}')`;

    if (id === "") {
      lines.push(`${head} hooks[${n}] is missing required field 'id'`);
    } else if (!ID_PATTERN.test(id)) {
      lines.push(`${head} hooks[${n}].id '${id}' must match ^[A-Za-z0-9._-]+$`);
    }
    if (event === "") {
      lines.push(`${head} ${at} is missing required field 'event'`);
    } else if (!isKnownEvent(event)) {
      lines.push(
        `${head} ${at} declares event '${event}', outside the admissible set {PreToolUse, UserPromptSubmit}`,
      );
    }
    if (command === "") {
      lines.push(`${head} ${at} is missing required field 'command'`);
    }
    if (entryHasMatcher(entry)) {
      if (!isKnownMatcherClass(matcher)) {
        lines.push(
          `${head} ${at} declares matcher '${matcher}', outside the admissible set {shell}`,
        );
      } else if (event !== "" && !matcherAccepting(event)) {
        lines.push(`${head} ${at} declares a matcher on event '${event}', which accepts none`);
      }
    }
  });
  return lines;
}
