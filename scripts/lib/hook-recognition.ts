// hook-recognition.ts — recognition of a registered hook command by CONTENT
// (spec 0243 R20).
//
// The TypeScript twin of `uc_sig_re`/`uc_legacy_re` in
// scripts/lib/usage-capture-optin.sh. The two SHALL accept and reject the same
// commands: both are run over scripts/tests/fixtures/usage-capture/
// recognition-corpus.json, and neither may change without that corpus changing.
//
// A command is a hook command when its WHOLE shape matches: an optional
// `VAR=value` / `env` / `bash|sh|node` prefix, a script path ending in
// `/hooks/<basename>.sh` or `.ts` (double-quoted, single-quoted or a bare
// token), and exactly the arguments the descriptor names. An operator's own
// hook that merely names a script called `<basename>.sh` with other arguments
// is never recognised.
//
// Standard library only (spec 0240 R16).

import type { HookDescriptor } from "./hook-descriptor.ts";

export interface HookCommandParse {
  /** Everything before the script path (env/interpreter prefix), verbatim. */
  readonly pre: string;
  /** The registered script path, quotes stripped. */
  readonly path: string;
  /** Which form the registered path is: the legacy shell script or the direct entry. */
  readonly ext: "sh" | "ts";
  /** Everything after the script path (the arguments), verbatim. */
  readonly post: string;
  /** Whether the path was quoted in the command. */
  readonly quoted: boolean;
}

export interface RecognitionOptions {
  /**
   * Existence test for the legacy spaced-path form, which is ambiguous
   * (`bash /x/tool /a b/hooks/…` is a tool with an argument) and so counts
   * only when its whole path names an existing file. Without it that form is
   * never recognised, which is what the Bash corpus run does too.
   */
  readonly pathExists?: (path: string) => boolean;
}

const ESCAPE = /[.*+?^${}()|[\]\\]/g;
const escapeRe = (text: string): string => text.replace(ESCAPE, "\\$&");

const PREFIX =
  "(?<pre>\\s*(?:[A-Za-z_][A-Za-z0-9_]*=\\S*\\s+)*(?:(?:\\S*/)?env\\s+)?(?:(?:\\S*/)?(?:bash|sh|node)\\s+)?)";

function defaultArgsPattern(descriptor: HookDescriptor): string {
  const ids = Object.values(descriptor.cliIds).map(escapeRe).join("|");
  return `\\s+(?:${ids})\\s+[A-Za-z]+\\s*`;
}

function signature(descriptor: HookDescriptor): RegExp {
  const name = escapeRe(descriptor.basename);
  const tail = `/hooks/${name}\\.(?:sh|ts)`;
  const args = descriptor.argsPattern ?? defaultArgsPattern(descriptor);
  return new RegExp(
    `^${PREFIX}(?:"(?<dq>[^"]*${tail})"|'(?<sq>[^']*${tail})'|(?<uq>[^\\s"']*${tail}))(?<post>${args})$`,
  );
}

function legacySpaced(descriptor: HookDescriptor): RegExp | null {
  const legacy = descriptor.legacySpaced;
  if (legacy === undefined) return null;
  const name = escapeRe(descriptor.basename);
  // The path class excludes every character a shell reads as syntax in an
  // unquoted word, so `bash /opt/prep.sh && <abs> …` never matches (#1174 N1).
  const pathClass = "[^\\x00-\\x1f\\x7f\"';&|<>()$`\\\\*?\\[\\]{}#~]*";
  return new RegExp(
    `^(?<pre>bash )(?<uq>/${pathClass}/hooks/${name}\\.sh)(?<post> ${escapeRe(legacy.cliId)} ${escapeRe(legacy.event)})$`,
  );
}

/** Parse a command string; `null` when it is not a hook command of `descriptor`. */
export function parseHookCommand(
  command: string,
  descriptor: HookDescriptor,
  options: RecognitionOptions = {},
): HookCommandParse | null {
  const direct = signature(descriptor).exec(command)?.groups;
  if (direct !== undefined) {
    const path = direct["dq"] ?? direct["sq"] ?? direct["uq"] ?? "";
    return {
      pre: direct["pre"] ?? "",
      path,
      ext: path.endsWith(".ts") ? "ts" : "sh",
      post: direct["post"] ?? "",
      quoted: direct["uq"] === undefined,
    };
  }
  const legacyRe = legacySpaced(descriptor);
  const legacy = legacyRe?.exec(command)?.groups;
  if (legacy !== undefined && options.pathExists !== undefined) {
    const path = legacy["uq"] ?? "";
    if (options.pathExists(path)) {
      return {
        pre: legacy["pre"] ?? "",
        path,
        ext: "sh",
        post: legacy["post"] ?? "",
        quoted: false,
      };
    }
  }
  return null;
}

/** A handler object of `{type?: "command", command: string}` that parses as a hook command. */
export function parseHandler(
  handler: unknown,
  descriptor: HookDescriptor,
  options: RecognitionOptions = {},
): HookCommandParse | null {
  if (typeof handler !== "object" || handler === null || Array.isArray(handler)) return null;
  const record = handler as Record<string, unknown>;
  // jq's `//` treats null and false as absent, like a missing key.
  const rawType = record["type"];
  const type = rawType === undefined || rawType === null || rawType === false ? "command" : rawType;
  const command = record["command"];
  if (type !== "command" || typeof command !== "string") return null;
  return parseHookCommand(command, descriptor, options);
}

export function isHookCommand(
  command: string,
  descriptor: HookDescriptor,
  options: RecognitionOptions = {},
): boolean {
  return parseHookCommand(command, descriptor, options) !== null;
}
