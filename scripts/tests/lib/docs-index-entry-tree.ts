// docs-index-entry-tree.ts — a throwaway repository holding only what the documentation index entry
// needs (spec 0265, row J2): `scripts/build-docs-index.ts`, `scripts/lib/docs-index/*.ts`, and on a
// POSIX host the forwarding shim and the Node.js floor guard. The entry imports no package, so no
// `node_modules` is staged. Files are the git-tracked ones, read through `git ls-files`.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { cleanEnv, realTmp, REPO, runNode } from "./worktree-fixtures.ts";
import type { Result } from "./worktree-fixtures.ts";

const ENTRY_FILES = [
  "scripts/build-docs-index.ts",
  "scripts/build-docs-index.sh",
  "scripts/lib/node-floor-guard.js",
];

function trackedFiles(): string[] {
  const listed = spawnSync(
    "git",
    ["ls-files", "-z", "--", ...ENTRY_FILES, "scripts/lib/docs-index"],
    {
      cwd: REPO,
      encoding: "utf8",
    },
  );
  if (listed.status !== 0) throw new Error(`git ls-files failed: ${listed.stderr}`);
  return listed.stdout.split("\0").filter(Boolean);
}

/** A fresh root with the entry copied in and `docs/` holding `pages` (relative path to text). */
export function entryTree(pages: Readonly<Record<string, string>>): string {
  const root = realTmp("docs-index-entry-");
  for (const rel of trackedFiles()) {
    const dest = path.join(root, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(REPO, rel), dest);
  }
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  for (const [rel, text] of Object.entries(pages)) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  return root;
}

export function childEnv(): NodeJS.ProcessEnv {
  return cleanEnv({ CI: undefined, NODE_TEST_CONTEXT: undefined, LC_ALL: "C" });
}

/** `node scripts/build-docs-index.ts <args>` inside `root`. */
export function runEntry(root: string, ...args: string[]): Result {
  return runNode(path.join(root, "scripts", "build-docs-index.ts"), args, {
    cwd: root,
    env: childEnv(),
  });
}
