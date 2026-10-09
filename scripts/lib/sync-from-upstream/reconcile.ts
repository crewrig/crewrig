// reconcile.ts — adopt-on-edit reconciliation of one member and of a whole directory
// (spec 0253 R19-R21; shell `reconcile_member` and `reconcile_dir`).

import { existsSync } from "node:fs";

import { blobEntryDecision, blobSha, pathInOrgHistory, writeMarker } from "./blobs.ts";
import { git, gitInherit, lines } from "./git.ts";
import { type Ctx, SyncExit } from "./types.ts";

/** `git restore --source=FETCH_HEAD --worktree -- <path>`, unredirected; a failure ends the run (`set -e`). */
function restoreFromFetchHead(path: string): void {
  const status = gitInherit(["restore", "--source=FETCH_HEAD", "--worktree", "--", path]);
  if (status !== 0) throw new SyncExit(status);
}

/** Restore `path` then refresh its marker to the now-current blob. */
function restoreAndMark(ctx: Ctx, path: string): void {
  restoreFromFetchHead(path);
  const fresh = blobSha(ctx, path);
  if (fresh !== "") writeMarker(ctx, path, fresh);
}

/** The two-tier decision for one member present both upstream and locally. */
export function reconcileMember(ctx: Ctx, path: string): void {
  const { decision, current } = blobEntryDecision(ctx, path);
  if (decision === "update") {
    restoreAndMark(ctx, path);
    return;
  }
  if (current !== "") writeMarker(ctx, path, current);
  ctx.err(`Preserved (adopter customisation): ${path}`);
}

/** Plain code-unit order, the C-locale byte order of `sort` for ASCII paths. */
function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Directory-level adopt-on-edit reconciliation (add / skip / freeze / two-tier per member). */
export function reconcileDir(ctx: Ctx, dir: string): void {
  const upstream = lines(
    git(["ls-tree", "-r", "--name-only", "FETCH_HEAD", "--", `${dir}/`]).stdout,
  );
  const upstreamSet = new Set(upstream);
  const working = existsSync(`${ctx.repoDir}/${dir}`)
    ? lines(
        git(["ls-files", "--cached", "--others", "--exclude-standard", "--", `${dir}/`], {
          cwd: ctx.repoDir,
        }).stdout,
      )
    : [];
  const union = [...new Set([...upstream, ...working])].sort(byCodeUnit);

  for (const f of union) {
    const inUpstream = upstreamSet.has(f);
    if (inUpstream && !existsSync(`${ctx.repoDir}/${f}`)) {
      if (pathInOrgHistory(f)) {
        ctx.err(`Preserved (org-deleted): ${f}`);
      } else {
        restoreAndMark(ctx, f);
        ctx.err(`Added (new upstream file): ${f}`);
      }
    } else if (!inUpstream) {
      // Org-owned: upstream dropped it or never had it; never touched.
    } else {
      reconcileMember(ctx, f);
    }
  }
}
