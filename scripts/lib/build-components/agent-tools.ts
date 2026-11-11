// agent-tools.ts — the `metadata.tools` declaration of an agent source and its per-CLI
// spelling (spec 0291 R8, R10, R11, R13, R14).
//
// A source MAY declare `metadata.tools`, a non-empty list drawn from the six classes below.
// The declaration is CLI-agnostic, like `metadata.model` (spec 0195); each emitter translates
// the classes to its CLI's own names, in the vocabulary's order whatever the order in the
// source. A tool allowlist withholds every tool it does not name (artifacts/FORMAT.md), so a
// name that is guessed is never written: a value outside the vocabulary stops the build.
// An agent that declares nothing gets no `tools` key on any CLI (R12).

import { escapeControl } from "./diagnostics.ts";
import { BuildFailure } from "./types.ts";
import type { CliId, SourceDoc } from "./types.ts";

/** The closed vocabulary, in the order the emitters write it (R8, R11). */
export const TOOL_CLASSES = ["read", "search", "edit", "execute", "web", "agent"] as const;
export type ToolClass = (typeof TOOL_CLASSES)[number];

const KEY = "metadata.tools";
const PATH = ["metadata", "tools"] as const;

/** The six classes, as an error message names them. */
const ADMITTED = TOOL_CLASSES.join(", ");

/** Class to Claude Code names (https://code.claude.com/docs/en/sub-agents, read 2026-11-11). */
const CLAUDE: Readonly<Record<ToolClass, readonly string[]>> = {
  read: ["Read"],
  search: ["Grep", "Glob"],
  edit: ["Edit", "Write"],
  execute: ["Bash"],
  web: ["WebFetch", "WebSearch"],
  agent: ["Agent"],
};

/**
 * Class to Gemini CLI names (https://geminicli.com/docs/reference/tools/, read 2026-11-11;
 * the strict `tools` key is the one recorded in docs/cli-matrix row 43). Subagents cannot call
 * other subagents (https://geminicli.com/docs/core/subagents/), so `agent` has no name (R13).
 */
const GEMINI: Readonly<Record<ToolClass, readonly string[]>> = {
  read: ["read_file", "read_many_files", "list_directory"],
  search: ["grep_search", "glob"],
  edit: ["write_file", "replace"],
  execute: ["run_shell_command"],
  web: ["web_fetch", "google_web_search"],
  agent: [],
};

const isToolClass = (value: string): value is ToolClass =>
  (TOOL_CLASSES as readonly string[]).includes(value);

function refuse(source: SourceDoc, what: string, value: string): BuildFailure {
  return new BuildFailure(
    `Error: ${escapeControl(source.file)}: ${KEY} ${what}; value: ${escapeControl(value)}; ` +
      `the admitted classes are ${ADMITTED}`,
  );
}

/**
 * The classes `source` declares, in the vocabulary's order; `null` when it declares none
 * (the key is absent), which is the opt-in case of R12.
 *
 * @throws BuildFailure (status 1) naming the file, the key, the value and the six classes,
 *   when the value is not a list, is empty, holds a string outside the vocabulary or holds a
 *   duplicate (R10).
 */
export function readAgentTools(source: SourceDoc): readonly ToolClass[] | null {
  if (!source.has(PATH)) return null;
  const kind = source.entries(["metadata"]).find((entry) => entry.key === "tools")?.kind;
  if (kind !== "sequence") {
    throw refuse(source, "must be a list", kind === "scalar" ? source.alt(PATH) : String(kind));
  }
  const written = source.seq(PATH);
  if (written.length === 0) throw refuse(source, "must not be empty", "[]");
  const seen = new Set<string>();
  for (const value of written) {
    if (!isToolClass(value)) throw refuse(source, "holds a value outside the vocabulary", value);
    if (seen.has(value)) throw refuse(source, "holds a duplicate", value);
    seen.add(value);
  }
  return TOOL_CLASSES.filter((cls) => seen.has(cls));
}

/**
 * The `tools:` frontmatter line of `cli` for `classes`, and the classes it had to omit.
 * Claude Code takes a comma-separated string (the form probed on the shared `.claude/agents/`
 * surface, R11); Copilot CLI and Gemini CLI a one-line flow sequence. Antigravity CLI is not
 * written (R14): the caller emits `toolsDrop` instead.
 */
export function toolsLine(
  cli: Exclude<CliId, "antigravity">,
  classes: readonly ToolClass[],
): { readonly line: string; readonly omitted: readonly ToolClass[] } {
  const names = (table: Readonly<Record<ToolClass, readonly string[]>>): string[] =>
    classes.flatMap((cls) => table[cls]);
  const omitted = cli === "gemini" ? classes.filter((cls) => GEMINI[cls].length === 0) : [];
  if (cli === "claude") return { line: `tools: ${names(CLAUDE).join(", ")}`, omitted };
  const list = cli === "gemini" ? names(GEMINI) : [...classes];
  return { line: `tools: [${list.join(", ")}]`, omitted };
}

/** A `tools-drop` record: the six tab-separated fields of `model-drop`, with path `metadata.tools` (R7). */
export function toolsDrop(
  agent: string,
  target: string,
  declared: readonly ToolClass[],
  reason: "unsupported-on-cli" | "no-equivalent-on-cli",
): string {
  return ["tools-drop", agent, target, KEY, declared.join(","), reason].join("\t");
}

/** The failure of R13: omitting `agent` left a Gemini agent no tool, and no empty list is ever written. */
export function noGeminiTool(source: SourceDoc, declared: readonly ToolClass[]): BuildFailure {
  return refuse(
    source,
    `has no Gemini CLI name for ${declared.join(", ")} (subagents cannot call other subagents, ` +
      "so an empty tools list would be written)",
    declared.join(","),
  );
}
