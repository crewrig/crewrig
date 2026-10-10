// worktree-warning.ts — `warn_if_linked_worktree` of scripts/lib/common.sh (spec 0206 plan v3, issue
// #1169): the usage-capture and statusline shims are wired by an in-repo absolute path, so an install
// run from a linked git worktree is told that `git worktree remove` would break the wired hook.
// `git -C <repo> rev-parse --git-common-dir` prints the literal `.git` from the main checkout and an
// absolute path from a linked worktree. Layer 1: no import beyond the shared context types.

import type { Io, Spawner } from "./context.ts";

/** Print the four warning lines on standard output when `repoDir` is a linked worktree; silent otherwise. */
export function warnIfLinkedWorktree(
  ctx: { readonly io: Pick<Io, "out">; readonly repoDir: string },
  spawner: Spawner,
  what: string,
): boolean {
  // `$(...)` strips trailing line feeds; a failed git leaves whatever it printed (nothing, in practice).
  const result = spawner(["git", "-C", ctx.repoDir, "rev-parse", "--git-common-dir"]);
  const commonDir = result.stdout.replace(/\n+$/, "");
  if (commonDir === "" || commonDir === ".git") return false;
  ctx.io.out(`  WARNING: this checkout is a linked git worktree (${ctx.repoDir}).`);
  ctx.io.out(`           The ${what} wiring above points INTO this checkout — running`);
  ctx.io.out("           'git worktree remove' on it breaks the wired hook silently");
  ctx.io.out("           until this installer is re-run against a durable checkout.");
  return true;
}
