// gate.ts — the clean-tree gate (spec 0248 R19).
//
// A whole-tree operation proceeds only over an EMPTY
// `git status --porcelain --untracked-files=all`, run in the toplevel. The
// claim is never an input. A `git status` that fails proves nothing about the
// tree and is never read as clean. Ignored state is outside the gate: the limit
// is part of the contract and stays stated in the `--help` block.

import { runGit, stripTrailingNewlines } from "./git.ts";
import { ClaimFailure } from "./types.ts";
import type { ClaimContext, Io } from "./types.ts";

/** The porcelain listing of the toplevel; empty means clean. Throws when `git status` fails. */
export function treeDirt(ctx: ClaimContext): string {
  const result = runGit(["status", "--porcelain", "--untracked-files=all"], ctx.toplevel);
  if (!result.ok) {
    throw new ClaimFailure(`'git status' failed in '${ctx.toplevel}' (exit ${result.status}), so this run proves
       nothing about the tree. Refusing to report it clean.`);
  }
  return stripTrailingNewlines(result.stdout);
}

/** The `Refused:` block for a dirty tree; returns the exit code 5. */
export function refuseDirty(ctx: ClaimContext, dirt: string, io: Io): number {
  io.out(`Refused: the worktree at '${ctx.toplevel}' carries uncommitted changes.`);
  io.out("A whole-tree git operation would discard changes no one can attribute:");
  io.out("git records no author for an uncommitted change, so this gate refuses");
  io.out("outright rather than guessing whose work it is about to destroy.");
  io.out("");
  io.out(dirt);
  io.out("");
  io.out("Commit what you authored (spec 0114 R10). Residue you did NOT author is");
  io.out("not yours to resolve: flag it to team-lead under docs/agent-team-protocol.md");
  io.out("-> Worktree Isolation -> Stray-file discovery - no unilateral action.");
  io.out("Holding a claim does not waive this gate, however it was acquired.");
  return 5;
}
