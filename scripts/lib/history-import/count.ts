// count.ts — the counting primitives of the history importers (spec 0253 R13), Node `fs` only:
// no `find`, `wc`, `grep`, `du` or `xargs` is spawned.

import fs from "node:fs";
import path from "node:path";

/**
 * Regular files under `root` whose base name satisfies `match`, like
 * `find <root> -name <pattern> -type f`: symbolic links are neither followed nor counted,
 * unreadable directories are skipped silently. Sorted by path for determinism.
 */
export function listFiles(root: string, match: (name: string) => boolean): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && match(entry.name)) found.push(full);
    }
  };
  walk(root);
  return found.sort();
}

/** Direct subdirectories of `root` (`-maxdepth 1 -mindepth 1 -type d`); 0 when unreadable. */
export function countSubdirs(root: string): number {
  try {
    return fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).length;
  } catch {
    return 0;
  }
}

/** Non-empty lines of `file`; a line holding only `\r` is empty (spec 0253 deviation 4); 0 when unreadable. */
export function countNonEmptyLines(file: string): number {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return 0;
  }
  let count = 0;
  for (const line of text.split("\n")) {
    if (line !== "" && line !== "\r") count += 1;
  }
  return count;
}

/** Sum of the apparent sizes of `files`; an unreadable file counts for 0. */
export function totalBytes(files: readonly string[]): number {
  let sum = 0;
  for (const file of files) {
    try {
      sum += fs.statSync(file).size;
    } catch {
      // vanished or unreadable: skipped, like du's discarded stderr
    }
  }
  return sum;
}
