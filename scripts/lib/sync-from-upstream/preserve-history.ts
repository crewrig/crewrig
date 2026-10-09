// preserve-history.ts — `--preserve-history` of scripts/sync-from-upstream.sh: the R12 shallow
// refusal and the history-preserving graft commit (spec 0086 R5-R9, R11; spec 0122 R1-R8).

import { gitIn, lines, type GitResult } from "./git.ts";
import { pathIsGoverned } from "./manifest.ts";
import { SyncExit, type Ctx } from "./types.ts";

/** What `$(...)` yields: the output without trailing newlines. */
function sub(text: string): string {
  return text.replace(/\n+$/, "");
}

/** The shell never redirected git's stderr on these calls: pass it through. */
function forward(result: GitResult): void {
  if (result.stderr !== "") process.stderr.write(result.stderr);
}

/** An unguarded `git -C <repoDir> ...` under `set -e`: its status ends the run. */
function must(repoDir: string, args: readonly string[]): string {
  const result = gitIn(repoDir, args);
  forward(result);
  if (result.status !== 0) throw new SyncExit(result.status);
  return sub(result.stdout);
}

/** R12: a shallow clone cannot host the two-parent graft commit; checked before anything else. */
export function refuseShallowForPreserve(repoDir: string, err: Ctx["err"]): void {
  const probe = gitIn(repoDir, ["rev-parse", "--is-shallow-repository"]);
  if (probe.status === 0 && sub(probe.stdout) === "true") {
    err("Error: --preserve-history requires a full (non-shallow) clone.");
    err(
      `Remove the shallow limitation (e.g. 'git -C "${repoDir}" fetch --unshallow') or omit --preserve-history.`,
    );
    throw new SyncExit(1);
  }
}

/** R8: the uncommitted paths outside the governed set (one quote stripped from each end). */
function ungovernedChanges(ctx: Ctx): string[] {
  const found: string[] = [];
  for (const statusLine of lines(
    gitIn(ctx.repoDir, ["status", "--porcelain", "--no-renames"]).stdout,
  )) {
    let changed = statusLine.slice(3);
    if (changed.endsWith('"')) changed = changed.slice(0, -1);
    if (changed.startsWith('"')) changed = changed.slice(1);
    if (!pathIsGoverned(ctx.entries, changed)) found.push(changed);
  }
  return found;
}

/** Spec 0122 R1-R2: commit-tree ignores commit.gpgsign, so resolve it and pass -S ourselves. */
function resolveSign(ctx: Ctx): boolean {
  if (gitIn(ctx.repoDir, ["config", "--get", "commit.gpgsign"]).status !== 0) return false;
  const raw = gitIn(ctx.repoDir, ["config", "--bool", "--get", "commit.gpgsign"]);
  forward(raw);
  if (raw.status !== 0) {
    ctx.err(
      "Error: --preserve-history cannot determine whether to sign this commit — commit.gpgsign holds a value git cannot read as a boolean; see the git error above.",
    );
    ctx.err(
      "The branch tip is unchanged and the restored files remain in the working tree. Correct commit.gpgsign and re-run.",
    );
    throw new SyncExit(1);
  }
  return sub(raw.stdout) === "true";
}

/** Spec 0122 R5: the header block (up to the first empty line) must carry a `gpgsig*` line. */
function hasSignatureHeader(ctx: Ctx, commit: string): boolean {
  for (const headerLine of gitIn(ctx.repoDir, ["cat-file", "commit", commit]).stdout.split("\n")) {
    if (headerLine === "") return false;
    if (headerLine.startsWith("gpgsig")) return true;
  }
  return false;
}

export function preserveHistory(ctx: Ctx): "noop" | "created" {
  const repo = ctx.repoDir;
  const tip = must(repo, ["rev-parse", "HEAD"]);

  // R11: nothing new to graft; checked before the R8 guard.
  if (gitIn(repo, ["merge-base", "--is-ancestor", "FETCH_HEAD", tip]).status === 0) {
    ctx.out(
      `Sync complete. FETCH_HEAD is already an ancestor of ${tip}; --preserve-history is a no-op.`,
    );
    return "noop";
  }

  const ungoverned = ungovernedChanges(ctx);
  if (ungoverned.length > 0) {
    ctx.err(
      "Error: --preserve-history refuses to commit — uncommitted change(s) outside the governed paths:",
    );
    for (const p of ungoverned) ctx.err(`  ${p}`);
    ctx.err(
      "Commit, stash, or revert these changes (outside .crewrig/core-paths.txt and .crewrig/.synced-markers/), or omit --preserve-history.",
    );
    throw new SyncExit(1);
  }

  // R5-R7, R9: the R8 check proved every uncommitted change is governed, so staging all is safe.
  must(repo, ["add", "-A"]);
  const tree = must(repo, ["write-tree"]);
  const upstream = must(repo, ["rev-parse", "FETCH_HEAD"]);
  const message = `🔀 Graft upstream history via --preserve-history (${must(repo, ["rev-parse", "--short", "FETCH_HEAD"])})`;

  const sign = resolveSign(ctx);
  const created = gitIn(repo, [
    "commit-tree",
    tree,
    "-p",
    tip,
    "-p",
    upstream,
    ...(sign ? ["-S"] : []),
    "-m",
    message,
  ]);
  forward(created);
  if (created.status !== 0) {
    if (sign) {
      ctx.err(
        "Error: --preserve-history refuses to commit — this repository is configured to sign commits (commit.gpgsign) but the signature could not be produced; see the git error above.",
      );
      ctx.err(
        "The branch tip is unchanged and the restored files remain in the working tree. Fix the signing setup (key, agent, gpg.format) and re-run, or clear commit.gpgsign for this repository.",
      );
    } else {
      ctx.err(
        "Error: --preserve-history could not create the graft commit; see the git error above.",
      );
    }
    throw new SyncExit(1);
  }
  const commit = sub(created.stdout);

  // Refuse a degraded (unsigned) commit BEFORE the ref moves.
  if (sign && !hasSignatureHeader(ctx, commit)) {
    ctx.err(
      "Error: --preserve-history built an unsigned commit though this repository is configured to sign; refusing to move the branch tip.",
    );
    throw new SyncExit(1);
  }

  must(repo, ["update-ref", "-m", "sync-from-upstream --preserve-history", "HEAD", commit]);
  const note = sign ? " (signed)" : "";
  ctx.out(`History-preserving commit created: ${commit}${note} (parents: ${tip}, ${upstream})`);
  return "created";
}
