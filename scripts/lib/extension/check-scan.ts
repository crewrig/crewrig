// check-scan.ts — the two `--check` path scans (spec 0254 R14).
// Twins `ext_name_axis_scan` / `_ext_name_axis_matches` (scripts/build-extension.sh:163-212):
// a path names a tool when ANY `/`-separated segment, after stripping at most one leading dot
// and lowercasing, STARTS with one of the CLI tokens (a prefix rule: "regeminate.md" is not
// charged, ".geminiignore" and "GEMINI.md" are). `classScan` is `ext_class_scan`, which
// tree-copy.ts already implements. Every list is in code-unit order.

import fs from "node:fs";
import path from "node:path";

import { readJsonFile } from "./descriptors.ts";
import { scanGenerated } from "./tree-copy.ts";
import type { JsonValue } from "./types.ts";

/** `_ext_name_axis_matches`: true when any segment of `rel` begins with a token. */
export function nameAxisMatches(rel: string, tokens: readonly string[]): boolean {
  for (const segment of rel.split("/")) {
    if (segment === "") continue;
    const stripped = segment.startsWith(".") ? segment.slice(1) : segment;
    const lower = stripped.toLowerCase();
    if (tokens.some((token) => token !== "" && lower.startsWith(token))) return true;
  }
  return false;
}

/** The keys of the target descriptor minus `_readme`: the CLI tokens the scan matches. */
export function nameAxisTokens(libDir: string): string[] {
  const doc: JsonValue = readJsonFile(path.join(libDir, "extension-targets.json"));
  return doc instanceof Map ? [...doc.keys()].filter((key) => key !== "_readme") : [];
}

function walk(root: string, rel: string, out: string[]): void {
  for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const next = rel === "" ? entry.name : `${rel}/${entry.name}`;
    if (entry.isDirectory()) walk(root, next, out);
    else if (entry.isFile()) out.push(next);
  }
}

/** `ext_name_axis_scan`: the regular files under `dir` (relative) that name a tool. */
export function nameAxisScan(dir: string, tokens: readonly string[]): string[] {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];
  const files: string[] = [];
  walk(dir, "", files);
  return files.sort().filter((rel) => nameAxisMatches(rel, tokens));
}

/** `ext_class_scan`: the files of the generated-output class (see `scanGenerated`). */
export const classScan = scanGenerated;
