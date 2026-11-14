// conventions-block.ts — the subagent conventions block (spec 0306 R1-R4, R6, R10, R11).
//
// One source, `artifacts/core/fragments/subagent-conventions.md`, read from the core tier
// whatever the tier of the agent. It is read once per build, and only when an agent is about
// to be emitted: a build that emits no agent never touches it (R10). Every compiled agent
// body is the source body without trailing line feeds, a blank line, then the fragment bytes.

import fs from "node:fs";
import path from "node:path";

import { BuildFailure } from "./types.ts";
import type { Ctx } from "./types.ts";

/** Repository-relative path of the fragment, as printed in every message about it. */
export const FRAGMENT_REL = "artifacts/core/fragments/subagent-conventions.md";

/** R3: the ceiling in characters, inclusive. */
export const FRAGMENT_CEILING = 1500;

/** The R4 provenance test: the strip pattern of `provenance.ts` plus the Gemini carrier. */
const PROVENANCE = /<!--\s*provenance:|crewrig-provenance/;

/** The loaded fragment: its bytes verbatim and its first (heading) line. */
export interface ConventionsBlock {
  readonly text: string;
  readonly heading: string;
}

function refuse(rule: string): BuildFailure {
  return new BuildFailure(`Error: ${FRAGMENT_REL}: ${rule}`);
}

/** The first rule of R2-R4 that `text` breaks, or `null`. */
function violation(text: string): string | null {
  if (text === "") return "the fragment is empty (spec 0306 R10)";
  if (text.includes("\r")) return "CRLF line endings are not allowed, use LF (spec 0306 R2)";
  const lines = text.split("\n");
  const first = lines[0] ?? "";
  if (!/^## \S/.test(first)) {
    return "the first line must be a level-2 heading `## ...`, with no frontmatter (spec 0306 R2)";
  }
  if (!text.endsWith("\n") || text.endsWith("\n\n")) {
    return "the fragment must end with exactly one trailing line feed (spec 0306 R2)";
  }
  if ([...text].length > FRAGMENT_CEILING) {
    return `the fragment exceeds the ${FRAGMENT_CEILING.toLocaleString("en-US")}-character ceiling (spec 0306 R3)`;
  }
  if (/\$\{[^}]*\}/.test(text)) {
    return "the fragment carries a ${KEY} build placeholder (spec 0306 R4)";
  }
  if (PROVENANCE.test(text)) {
    return "the fragment carries a provenance comment (spec 0306 R4)";
  }
  if (lines.includes("---")) {
    return "the fragment carries a line that is exactly --- (spec 0306 R4)";
  }
  return null;
}

/**
 * The validated fragment, read on first use and memoised on the build state. Throws a
 * `BuildFailure` naming the fragment and the rule broken.
 */
export function loadConventions(ctx: Ctx): ConventionsBlock {
  const memo = ctx.state.conventions;
  if (memo !== undefined) return memo;
  const file = path.join(ctx.artifactsDir, "core", "fragments", "subagent-conventions.md");
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    throw refuse("the fragment is missing or cannot be read (spec 0306 R10)");
  }
  const broken = violation(text);
  if (broken !== null) throw refuse(broken);
  const block: ConventionsBlock = { text, heading: text.split("\n")[0] ?? "" };
  ctx.state.conventions = block;
  return block;
}

/** R11: an agent source whose body holds a line equal to the heading carries a hand copy. */
export function assertNoHandCopy(block: ConventionsBlock, file: string, body: string): void {
  if (body.split("\n").includes(block.heading)) {
    throw new BuildFailure(
      `Error: ${file}: the body carries a copy of the conventions block; delete it, the build appends ${FRAGMENT_REL} itself (spec 0306 R11)`,
    );
  }
}

/** R6: the source body without trailing line feeds, a blank line, then the fragment. */
export function withConventions(block: ConventionsBlock, body: string): string {
  return `${body.replace(/\n+$/, "")}\n\n${block.text}`;
}
