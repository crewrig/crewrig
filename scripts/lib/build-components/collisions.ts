// collisions.ts — the source files named by the build's installed-name refusal (spec 0315 R5). The refusal lines of
// the shell parity (component-resolve.ts `reportInstalledNameCollisions`) are unchanged; this module adds the file
// names on their own line. It reads the same installed-target records and computes nothing else.

import path from "node:path";

import { installedTargets } from "../component-resolve.ts";

/**
 * The source files of every component whose installed target another component claims too, sorted and without
 * repeats. A file of a directory listed twice is named once.
 */
export function collidingSources(artifactsDirs: readonly string[]): string[] {
  const dirs = [...new Set(artifactsDirs.map((dir) => path.resolve(dir)))];
  const records = dirs.flatMap((dir) => installedTargets(dir));
  const counts = new Map<string, number>();
  for (const r of records) {
    const key = `${r.tierClass}\t${r.installTarget}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const sources = records
    .filter((r) => (counts.get(`${r.tierClass}\t${r.installTarget}`) ?? 0) > 1)
    .flatMap((r) => (r.source === undefined ? [] : [r.source]));
  return [...new Set(sources)].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
}
