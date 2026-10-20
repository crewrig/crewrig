// walk.ts — list the pages the index covers: every regular file named `*.md` under docs/ (the
// shell's `find docs -type f -name '*.md' | sort`). Symlinks are neither listed nor followed,
// and the order is UTF-8 byte order of the full path, not tree order ("docs/a.md" sorts before
// "docs/a/b.md" because '.' < '/').

import fs from "node:fs";

import { compareBytes } from "./render.ts";

// Generator sources of docs/cli-matrix.md (spec 0272): not pages. Exact repo-relative equality.
const SKIPPED_DIR = "docs/cli-matrix";

function collect(dir: string, rel: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // an unreadable directory is skipped, as find reports it on stderr and goes on
  }
  for (const entry of entries) {
    const childRel = `${rel}/${entry.name}`;
    if (entry.isDirectory()) {
      if (childRel !== SKIPPED_DIR) collect(`${dir}/${entry.name}`, childRel, out);
    } else if (entry.isFile() && entry.name.endsWith(".md")) out.push(childRel);
  }
}

/** Repository-relative paths (`docs/...`) of every page, in byte order. */
export function listPages(repoRoot: string): string[] {
  const out: string[] = [];
  let top: fs.Stats;
  try {
    top = fs.lstatSync(`${repoRoot}/docs`);
  } catch {
    return out;
  }
  // `find` does not follow a symlinked starting point, so a docs/ that is one lists nothing.
  if (top.isDirectory()) collect(`${repoRoot}/docs`, "docs", out);
  return out.toSorted(compareBytes);
}
