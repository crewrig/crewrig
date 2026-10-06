// transcript-recognition.ts — the class of a registered MemPalace transcript
// command (spec 0247 R24, delta-01), decided from the command text alone.
//
// The TypeScript twin of `sr_transcript_class` in
// scripts/lib/usage-capture-optin.sh. The two SHALL return the same answer for
// every row of scripts/tests/fixtures/mempalace-transcript/recognition-corpus.json,
// and neither may change without that corpus changing.
//
// A command is a transcript command when it parses as the MEMPALACE_TRANSCRIPT
// descriptor (scripts/lib/hook-recognition.ts): an optional `NAME=value`
// prefix, an optional `env`, an optional `bash|sh|node`, a script path ending
// in `/mempalace-transcript.sh` or `.ts`, and one of the four argument forms
// setup has ever written — (i) none, (ii) one event word, (iii) a CLI
// identifier, (iv) `antigravity-cli <event>` — or the guarded prefix of spec
// 0243 delta-03 R34 in place of that prefix. Its class:
//   foreign-prefix   a prefix assignment to a name the framework does not own,
//                    or the direct shape (iii)/(iv) with any assignment;
//   direct           (iii)/(iv) with no prefix, or with the guarded prefix;
//   legacy-enabled   (i)/(ii) whose prefix is exactly one
//                    `MEMPALACE_TRANSCRIPT_ENABLED=1` and at most one
//                    `MEMPALACE_PYTHON=<non-blank word>`;
//   legacy-unmarked  every other (i)/(ii) command: no prefix, or one made only
//                    of the two owned names without that consent.
// A command carrying shell syntax that chains, substitutes or redirects — `;`,
// `&`, `|`, `<`, `>`, parentheses, a backquote, `$(`, a backslash, a line
// break — is `no`, whatever the signature matched.
// The guarded prefix is accepted on every CLI: the class is decided from the
// text alone, and the corpus carries no CLI column.
//
// Standard library only (spec 0240 R16).

import { MEMPALACE_TRANSCRIPT } from "./hook-descriptor.ts";
import { parseHookCommand, type HookCommandParse } from "./hook-recognition.ts";

export type TranscriptClass =
  | "no"
  | "direct"
  | "legacy-enabled"
  | "legacy-unmarked"
  | "foreign-prefix";

/** The classes setup owns: rewritten, deduplicated or removed (R23, R24). */
export const OWN_CLASSES: readonly TranscriptClass[] = [
  "direct",
  "legacy-enabled",
  "legacy-unmarked",
];

export interface Assignment {
  readonly name: string;
  readonly value: string;
}

const LEADING_ASSIGNMENT = /\s*([A-Za-z_][A-Za-z0-9_]*)=(\S*)\s+/y;
const CLI_IDS = ["claude-code", "gemini-cli", "copilot-cli"];

/** The `NAME=value` words that open a command prefix, before any `env` or interpreter. */
export function prefixAssignments(pre: string): Assignment[] {
  const found: Assignment[] = [];
  LEADING_ASSIGNMENT.lastIndex = 0;
  for (let m = LEADING_ASSIGNMENT.exec(pre); m !== null; m = LEADING_ASSIGNMENT.exec(pre)) {
    found.push({ name: m[1] ?? "", value: m[2] ?? "" });
  }
  return found;
}

/** Forms (iii) and (iv): a CLI identifier first. */
export function isDirectShape(post: string): boolean {
  const words = post.split(/\s+/).filter((word) => word !== "");
  if (words.length === 1) return CLI_IDS.includes(words[0] ?? "");
  return words.length === 2 && words[0] === "antigravity-cli";
}

// Shell syntax a transcript command never carries outside its prefix values
// (security review S1): a command that chains, substitutes or redirects is an
// operator's, never the framework's. The descriptor's shared signature is
// wider (it serves C1 and C2 unchanged), so the transcript class narrows it
// here, in both twins (`sr_tr_safe` in scripts/lib/usage-capture-optin.sh).
const SAFE_WORD = "[^\\s;&|<>()$`\\\\\"'*?\\[\\]{}#~]";
const SAFE_PRE = new RegExp(
  `^[ \\t]*(?:[A-Za-z_][A-Za-z0-9_]*=${SAFE_WORD}*[ \\t]+)*(?:(?:${SAFE_WORD}*/)?env[ \\t]+)?(?:(?:${SAFE_WORD}*/)?(?:bash|sh|node)[ \\t]+)?$`,
);
const UNSAFE_PATH = /[;&|<>()`\\]|\$\(/;
const LINE_BREAK = /[\n\r]/;

/** Whether a parsed command is free of shell syntax that would chain or substitute (S1). */
export function isShellSafe(parse: HookCommandParse): boolean {
  if (LINE_BREAK.test(parse.pre) || LINE_BREAK.test(parse.path) || LINE_BREAK.test(parse.post)) {
    return false;
  }
  if (parse.guarded) return true;
  return SAFE_PRE.test(parse.pre) && !UNSAFE_PATH.test(parse.path);
}

/** Classify an already-parsed transcript command. */
export function classOfParse(parse: HookCommandParse): TranscriptClass {
  if (!isShellSafe(parse)) return "no";
  const direct = isDirectShape(parse.post);
  if (parse.guarded) return direct ? "direct" : "legacy-unmarked";
  const owned = MEMPALACE_TRANSCRIPT.ownedEnvNames ?? [];
  const assignments = prefixAssignments(parse.pre);
  if (assignments.some((a) => !owned.includes(a.name))) return "foreign-prefix";
  if (direct) return assignments.length === 0 ? "direct" : "foreign-prefix";
  const enabled = assignments.filter((a) => a.name === "MEMPALACE_TRANSCRIPT_ENABLED");
  const python = assignments.filter((a) => a.name === "MEMPALACE_PYTHON");
  const consented =
    enabled.length === 1 &&
    enabled[0]?.value === "1" &&
    python.length <= 1 &&
    python.every((a) => a.value !== "");
  return consented ? "legacy-enabled" : "legacy-unmarked";
}

/** The class of a command string. */
export function classifyTranscript(command: string): TranscriptClass {
  const parse = parseHookCommand(command, MEMPALACE_TRANSCRIPT);
  return parse === null ? "no" : classOfParse(parse);
}

/** The class of a handler object (`{type?: "command", command}`); `no` for anything else. */
export function classifyHandler(handler: unknown): TranscriptClass {
  if (typeof handler !== "object" || handler === null || Array.isArray(handler)) return "no";
  const record = handler as Record<string, unknown>;
  const rawType = record["type"];
  const type = rawType === undefined || rawType === null || rawType === false ? "command" : rawType;
  const command = record["command"];
  if (type !== "command" || typeof command !== "string") return "no";
  return classifyTranscript(command);
}

/** The assignment names (never values: they may be credentials) a report may print. */
export function assignmentNames(command: string): string[] {
  const parse = parseHookCommand(command, MEMPALACE_TRANSCRIPT);
  return parse === null || parse.guarded ? [] : prefixAssignments(parse.pre).map((a) => a.name);
}
