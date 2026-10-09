// manifest.ts — the `.crewrig/core-paths.txt` manifest of the sync: its parser and the
// pure helpers over the parsed entries (spec 0253 R19). Shell originals: the parse loop,
// `excluded_children_of`, `pathspec_for` and `path_is_governed`.

import type { ManifestEntry } from "./types.ts";

// bash `[[:space:]]` in a C or UTF-8 locale.
const SPACE = " \t\n\v\f\r";

function isSpace(ch: string | undefined): boolean {
  return ch !== undefined && SPACE.includes(ch);
}

/**
 * One entry per non-comment line, `<path>[<whitespace><policy>]`: a trailing CR is dropped,
 * empty and `#` lines are skipped, the path is the text before the first whitespace, the
 * policy is the first token after it and defaults to `strict`.
 */
export function parseManifest(text: string): ManifestEntry[] {
  const entries: ManifestEntry[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line === "" || line.startsWith("#")) continue;
    let end = 0;
    while (end < line.length && !isSpace(line[end])) end++;
    const path = line.slice(0, end);
    let start = end;
    while (start < line.length && isSpace(line[start])) start++;
    let stop = start;
    while (stop < line.length && !isSpace(line[stop])) stop++;
    const policy = line.slice(start, stop);
    entries.push({ path, policy: policy === "" ? "strict" : policy });
  }
  return entries;
}

/** The paths of the `excluded` entries nested strictly under `parent`, in manifest order. */
export function excludedChildrenOf(entries: readonly ManifestEntry[], parent: string): string[] {
  const prefix = `${parent}/`;
  return entries
    .filter((entry) => entry.policy === "excluded" && entry.path.startsWith(prefix))
    .map((entry) => entry.path);
}

/** `<path>` followed by a `:(exclude)` entry for every excluded child nested under it. */
export function pathspecFor(entries: readonly ManifestEntry[], path: string): string[] {
  return [path, ...excludedChildrenOf(entries, path).map((child) => `:(exclude)${child}`)];
}

/** True when `member` is an excluded path or lies under one. */
export function isUnderExcluded(excluded: readonly string[], member: string): boolean {
  return excluded.some((excl) => member === excl || member.startsWith(`${excl}/`));
}

/**
 * True when `path` is covered by a `strict`, `adopt-on-edit` or `regenerable` entry minus its
 * nested `excluded` children, or lies in the marker bookkeeping directory (checked
 * unconditionally, as spec 0086 R8 names it separately from the manifest).
 */
export function pathIsGoverned(entries: readonly ManifestEntry[], path: string): boolean {
  if (path === ".crewrig/.synced-markers" || path.startsWith(".crewrig/.synced-markers/")) {
    return true;
  }
  for (const entry of entries) {
    if (!["strict", "adopt-on-edit", "regenerable"].includes(entry.policy)) continue;
    if (path !== entry.path && !path.startsWith(`${entry.path}/`)) continue;
    if (isUnderExcluded(excludedChildrenOf(entries, entry.path), path)) continue;
    return true;
  }
  return false;
}
