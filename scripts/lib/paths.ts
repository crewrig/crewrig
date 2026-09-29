// paths.ts — shared path arithmetic for migrated scripts (spec 0240 R8, R11).
//
// Standard library only (spec 0240 R16). Every migrated script builds, resolves
// and anchors its paths through these three functions instead of re-deriving
// the arithmetic, so no script depends on the host separator or on two paths
// that differ only by letter case.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Join path segments with the host separator, normalising the result. */
export function joinPath(...segments: string[]): string {
  return path.join(...segments);
}

/**
 * Resolve a path to its absolute, symlink-resolved form.
 *
 * Uses `fs.realpathSync.native`, which also returns the on-disk letter case on
 * case-insensitive file systems, so two spellings of one file compare equal.
 * Throws the underlying `ENOENT` when the path does not exist.
 */
export function resolveReal(target: string): string {
  return fs.realpathSync.native(path.resolve(target));
}

/**
 * Locate the repository root from a calling script's own `import.meta.url`.
 *
 * Walks up from the script's directory to the first directory holding a
 * `.git` entry. That entry may be a directory (a plain clone) or a file (a
 * linked worktree or a submodule). Throws when no ancestor holds one.
 */
export function repoRootFrom(importMetaUrl: string): string {
  let dir = path.dirname(resolveReal(fileURLToPath(importMetaUrl)));
  for (;;) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(`no repository root (.git) above ${fileURLToPath(importMetaUrl)}`);
    }
    dir = parent;
  }
}
