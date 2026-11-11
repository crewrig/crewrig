// provenance-carrying.ts — the one definition of "provenance-carrying" (spec 0053
// delta-01 R26), shared by the build's retired-layout cleanup and the Antigravity setup
// migration so neither can remove content the framework did not install.
//
// A file is provenance-carrying when its LEADING frontmatter (line 1 exactly `---`, up
// to the next `---`, and nothing after it) holds a top-level `metadata:` mapping with a
// `provenance:` mapping under it with a non-empty `canonical:` value under that. A body
// mention of `provenance`, or a `provenance` key without `canonical`, does not qualify.
// Standard library only.

import fs from "node:fs";
import path from "node:path";

/** Leading `---` block lines; [] when line 1 is not exactly `---`. */
function frontmatterOf(text: string): string[] {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== "---") return [];
  const end = lines.indexOf("---", 1);
  return lines.slice(1, end < 0 ? undefined : end);
}

const indentOf = (line: string): number => line.length - line.trimStart().length;
const isBlank = (line: string): boolean => line.trim() === "" || line.trim().startsWith("#");

/** The lines nested under the key at `index` (strictly deeper indent), blank lines skipped. */
function childBlock(lines: readonly string[], index: number): string[] {
  const base = indentOf(lines[index] ?? "");
  const block: string[] = [];
  for (let i = index + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (isBlank(line)) continue;
    if (indentOf(line) <= base) break;
    block.push(line);
  }
  return block;
}

/** The index of the first line that is exactly the mapping key `key:` (no inline value). */
function findKey(lines: readonly string[], key: string, indent: number): number {
  const wanted = new RegExp(`^${key}:[ \\t]*(#.*)?$`);
  return lines.findIndex((line) => indentOf(line) === indent && wanted.test(line.trimStart()));
}

/** True when `text`'s leading frontmatter holds `metadata.provenance.canonical`, non-empty. */
export function isProvenanceCarryingText(text: string): boolean {
  const fm = frontmatterOf(text);
  const meta = findKey(fm, "metadata", 0);
  if (meta < 0) return false;
  const metaBlock = childBlock(fm, meta);
  const prov = findKey(metaBlock, "provenance", indentOf(metaBlock[0] ?? ""));
  if (prov < 0) return false;
  const provBlock = childBlock(metaBlock, prov);
  const childIndent = indentOf(provBlock[0] ?? "");
  for (const line of provBlock) {
    if (indentOf(line) !== childIndent) continue;
    const match = /^canonical:[ \t]*(.*)$/.exec(line.trimStart());
    if (match === null) continue;
    const value = (match[1] ?? "").replace(/[ \t]+#.*$/, "").trim();
    return value !== "" && value !== '""' && value !== "''" && value !== "null" && value !== "~";
  }
  return false;
}

/** The same, reading `file`; false when it cannot be read. */
export function isProvenanceCarrying(file: string): boolean {
  try {
    return isProvenanceCarryingText(fs.readFileSync(file, "utf8"));
  } catch {
    return false;
  }
}

/**
 * True when `dir` is a real directory (never a symbolic link) holding exactly one entry: a
 * regular file named exactly `AGENT.md` that is provenance-carrying. The sole removal
 * predicate of the retired Antigravity agent directory, in the build and in the setup
 * (spec 0053 delta-01 R14, R19). Exact listing, no case-folded lookup (R25).
 */
export function isSoleProvenanceAgentDir(dir: string): boolean {
  try {
    if (!fs.lstatSync(dir).isDirectory()) return false;
    const entries = fs.readdirSync(dir);
    if (entries.length !== 1 || entries[0] !== "AGENT.md") return false;
    const file = path.join(dir, "AGENT.md");
    return fs.lstatSync(file).isFile() && isProvenanceCarrying(file);
  } catch {
    return false;
  }
}
