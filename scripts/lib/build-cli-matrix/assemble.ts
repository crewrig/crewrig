// assemble.ts — assemble docs/cli-matrix.md from its sources (spec 0272 R2, R5, R7, R11).
//
// Usage: assemble(sourceDir)
// Exit codes: not applicable (library); failures throw Error.
// Finding-line format: not applicable.

import { readFileSync } from "node:fs";
import { demoteHeadings, rewriteLinks } from "./transform.ts";
import { readManifest } from "./manifest.ts";

export const GENERATED_COMMENT =
  "<!-- GENERATED FILE, DO NOT EDIT BY HAND. Source: docs/cli-matrix/ (see order.txt). " +
  "Regenerate with: task cli-matrix:build -->";

function normalise(raw: string): string {
  return raw.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
}

/** Insert the generated-file comment after the blank line that follows the marker line. */
function withComment(intro: string): string {
  const lines = intro.split("\n");
  const at = lines.findIndex((l) => l.includes("crewrig-doc:"));
  if (at === -1 || lines[at + 1] !== "")
    throw new Error("intro.md: expected a blank line after the crewrig-doc marker");
  lines.splice(at + 2, 0, GENERATED_COMMENT, "");
  return lines.join("\n");
}

/** notes.md carries a source-only H1 that is consumed, not emitted, with its blank line. */
function dropSourceTitle(text: string): string {
  const lines = text.split("\n");
  if (!/^# \S/.test(lines[0] ?? "")) throw new Error("notes.md: must start with a level-1 heading");
  if (lines[1] !== "") throw new Error("notes.md: expected a blank line after the title");
  return lines.slice(2).join("\n");
}

export function assemble(sourceDir: string): string {
  const out: string[] = [];
  for (const part of readManifest(sourceDir)) {
    let text = normalise(readFileSync(part.path, "utf8"));
    if (!/^# \S/.test(text)) throw new Error(`${part.name}: must start with a level-1 heading`);
    text = rewriteLinks(text, part.prefix, part.name);
    if (part.name === "notes.md") text = dropSourceTitle(text);
    else text = demoteHeadings(text, part.offset, part.name);
    if (part.name === "intro.md") text = withComment(text);
    out.push(text);
  }
  return `${out.join("\n\n")}\n`;
}
