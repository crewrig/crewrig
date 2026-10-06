// classify.ts — the entry a hook event becomes (spec 0247 R10), with the
// entry types, content templates and precedence of
// hooks/mempalace-transcript.sh:161-240, its two unguarded overrides
// included:
//   - a non-empty `prompt` replaces an Antigravity entry (`:180-190`);
//   - a `SessionStart` or `SessionEnd` event replaces any entry (`:215-220`).
//
// Standard library only.

import { firstChars, readField, selectAlt } from "./fields.ts";

export interface Entry {
  readonly type: string;
  readonly content: string;
}

export interface ClassifyInput {
  readonly payload: unknown;
  /** The Antigravity event argument, `""` outside Antigravity mode. */
  readonly antigravityEvent: string;
  /** `hook_event_name`, else the Antigravity event argument. */
  readonly event: string;
  /** Builds the Stop summary; only called for a `Stop` entry. */
  readonly stopSummary: (transcriptPath: string | undefined) => string;
}

// The nine literal substrings of `_is_harness_injection` (`:150`).
const HARNESS_LITERALS = [
  "<task-notification",
  "<system-reminder",
  "<system-message",
  "<SYSTEM_MESSAGE",
  "<task-status",
  "<command-status",
  "<harness-notification",
  "<notification",
  "[Message] timestamp=",
] as const;

// The extended regular expression of `:155`, applied to each line as `grep -E`
// does; `[[:space:]]` is the POSIX class, not JavaScript's Unicode `\s`.
const HARNESS_LINE =
  /^[ \t\n\v\f\r]*<([a-zA-Z0-9_-]+-(notification|reminder|message|status)|system-[a-zA-Z0-9_-]+|task-[a-zA-Z0-9_-]+|harness-[a-zA-Z0-9_-]+|SYSTEM_MESSAGE|system-reminder|task-notification)[^>]*>/;

/** `_is_harness_injection` of hooks/mempalace-transcript.sh:148-159. */
export function isHarnessInjection(text: string): boolean {
  if (HARNESS_LITERALS.some((literal) => text.includes(literal))) return true;
  return text.split("\n").some((line) => HARNESS_LINE.test(line));
}

/** A prompt-like text, `null` excepted as the shell excepted it. */
function promptEntry(text: string | undefined): Entry | undefined {
  if (text === undefined || text === "null") return undefined;
  return isHarnessInjection(text)
    ? { type: "harness-injection", content: `[HARNESS] ${text}` }
    : { type: "user-prompt", content: `[USER] ${text}` };
}

/** The entry for an event, or `undefined` when there is nothing to record. */
export function classify(input: ClassifyInput): Entry | undefined {
  const { payload, antigravityEvent, event } = input;
  let entry: Entry | undefined;

  if (antigravityEvent === "PreInvocation") {
    const n = readField(payload, ["invocationNum"]) ?? "?";
    const model = readField(payload, ["modelName"]) ?? "unknown";
    entry = {
      type: "session-lifecycle",
      content: `[SESSION] PreInvocation: invocation ${n} (${model})`,
    };
  } else if (antigravityEvent === "Stop") {
    const reason = readField(payload, ["terminationReason"]) ?? "unknown";
    entry = { type: "agent-response", content: `[AGENT] Session turn completed (${reason})` };
  }

  // Unguarded: a prompt replaces an Antigravity entry.
  entry = promptEntry(readField(payload, ["prompt"])) ?? entry;

  const toolName = readField(payload, ["tool_name"]);
  if (toolName !== undefined && toolName !== "null" && entry === undefined) {
    const argPaths = [
      ["tool_input", "command"],
      ["tool_input", "file_path"],
      ["tool_input", "pattern"],
    ] as const;
    const selected = selectAlt(payload, argPaths);
    const toolCmd = selected === undefined ? "(no args)" : (readField(payload, ...argPaths) ?? "");
    entry = { type: "tool-use", content: `[TOOL] ${toolName}: ${toolCmd}` };
  }

  if (event === "Stop" && entry === undefined) {
    const summary = input.stopSummary(readField(payload, ["transcript_path"], ["transcriptPath"]));
    entry = {
      type: "agent-response",
      content: summary === "" ? "[AGENT] Session turn completed" : `[AGENT] ${summary}`,
    };
  }

  // Unguarded: a session lifecycle event replaces any entry.
  if (event === "SessionStart" || event === "SessionEnd") {
    const source = readField(payload, ["source"]) ?? "unknown";
    entry = { type: "session-lifecycle", content: `[SESSION] ${event}: ${source}` };
  }

  if (entry === undefined) entry = promptEntry(readField(payload, ["user_input"], ["userInput"]));

  if (entry === undefined) {
    const response = readField(payload, ["model_response"], ["modelResponse"]);
    if (response !== undefined && response !== "null") {
      entry = { type: "agent-response", content: `[AGENT] ${firstChars(response, 2000)}` };
    }
  }

  return entry;
}
