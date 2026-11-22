// gitignore.ts — the `.gitignore` of the organization directory for the personal layers (spec 0315 R7). `build`
// ensures the lines of IGNORE_LINES; `setup` only reads the file and warns about the personal lines it lacks.
// `build` is the one command that writes this file: an absent file is created with the lines, a present file
// keeps every existing byte and gains only the missing lines at its end.

import fs from "node:fs";
import path from "node:path";

export const GITIGNORE = ".gitignore";

/** The lines `build` ensures, one per line, in this order. */
export const IGNORE_LINES: readonly string[] = ["config/SOUL.md", "config/PROFILE.md", "dist/"];

/** The personal files whose ignore line `setup` checks (spec 0315 R7, R6). */
export const PERSONAL_LINES: readonly string[] = ["config/SOUL.md", "config/PROFILE.md"];

/** Whether a line of the file already names `entry`: the path, or the path with a leading `/`, trailing spaces ignored. */
function namesEntry(line: string, entry: string): boolean {
  const trimmed = line.replace(/[ \t\r]+$/, "");
  return trimmed === entry || trimmed === `/${entry}`;
}

/** The entries of `lines` that the text does not name yet, in the order of `lines`. */
export function missingLines(text: string, lines: readonly string[]): string[] {
  const present = text.split("\n");
  return lines.filter((entry) => !present.some((line) => namesEntry(line, entry)));
}

/** The text of the `.gitignore` with its missing lines appended; the same text when nothing is missing. */
export function withIgnoreLines(text: string, lines: readonly string[]): string {
  const missing = missingLines(text, lines);
  if (missing.length === 0) return text;
  const lead = text === "" || text.endsWith("\n") ? "" : "\n";
  return `${text}${lead}${missing.map((entry) => `${entry}\n`).join("")}`;
}

/**
 * Ensure the `.gitignore` of `dir` holds IGNORE_LINES (`build`). Writes only when a line is missing, so a
 * complete file keeps its mtime. Returns the lines added (empty when none).
 */
export function ensureIgnoreLines(dir: string): string[] {
  const file = path.join(dir, GITIGNORE);
  const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const added = missingLines(existing, IGNORE_LINES);
  if (added.length === 0) return added;
  fs.writeFileSync(file, withIgnoreLines(existing, IGNORE_LINES));
  return added;
}

/** The personal lines the `.gitignore` of `dir` lacks (`setup`'s warning); the file is never written. */
export function personalLinesMissing(dir: string): string[] {
  const file = path.join(dir, GITIGNORE);
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  return missingLines(text, PERSONAL_LINES);
}
