// apply.ts — the per-policy apply loop of scripts/sync-from-upstream.sh (spec 0253 R19-R21).
// `git restore --source=FETCH_HEAD --worktree` neither stages nor commits.

import { rmSync } from "node:fs";
import { git, gitInherit, lines } from "./git.ts";
import {
  blobEntryDecision,
  blobSha,
  objectTypeAtFetchHead,
  resolvesAtFetchHead,
  strictBlobIsDirty,
  writeMarker,
} from "./blobs.ts";
import { excludedChildrenOf, isUnderExcluded, pathspecFor } from "./manifest.ts";
import { isOrgComponentOutput } from "./org-components.ts";
import { reconcileDir } from "./reconcile.ts";
import { SyncExit, type Ctx } from "./types.ts";

/** An unguarded `git restore` under `set -e`: git's own output, and its status ends the run. */
function restore(args: readonly string[]): void {
  const status = gitInherit(["restore", "--source=FETCH_HEAD", "--worktree", "--", ...args]);
  if (status !== 0) throw new SyncExit(status);
}

function warnPhantom(ctx: Ctx, path: string): void {
  ctx.err(`Warning: skipping manifest entry absent from upstream: ${path}`);
}

/** `strict` / `regenerable`: restore from FETCH_HEAD, then drop upstream-deleted tracked files. */
function applyRestoring(ctx: Ctx, path: string, policy: string): void {
  if (!resolvesAtFetchHead(path)) {
    warnPhantom(ctx, path);
    return;
  }
  const regenerable = policy === "regenerable";
  if (objectTypeAtFetchHead(path) !== "tree") {
    if (regenerable && strictBlobIsDirty(ctx, path)) {
      ctx.out(`Restored (diverged, regenerable): ${path}`);
    }
    restore(pathspecFor(ctx.entries, path));
    return;
  }
  const excluded = excludedChildrenOf(ctx.entries, path);
  // Spec 0059 R3-R4: every upstream member individually, so new-in-upstream files appear.
  for (const member of lines(
    git(["ls-tree", "-r", "--name-only", "FETCH_HEAD", "--", `${path}/`]).stdout,
  )) {
    if (isUnderExcluded(excluded, member)) continue;
    // Spec 0199 R42/R48: reported BEFORE the restore, afterwards the member no longer looks dirty.
    if (regenerable && strictBlobIsDirty(ctx, member)) {
      ctx.out(`Restored (diverged, regenerable): ${member}`);
    }
    restore([member]);
  }
  // Spec 0064 orphan cleanup: tracked files absent from FETCH_HEAD.
  const tracked = git(["ls-files", "--", `${path}/`], { cwd: ctx.repoDir }).stdout;
  for (const file of lines(tracked)) {
    if (isUnderExcluded(excluded, file)) continue;
    // Spec 0204: keep compiled outputs of active organization-tier components.
    if (isOrgComponentOutput(ctx, file)) continue;
    if (lines(git(["ls-tree", "FETCH_HEAD", "--", file]).stdout).length === 0) {
      rmSync(`${ctx.repoDir}/${file}`, { force: true });
      ctx.out(`Removed (upstream-deleted): ${file}`);
    }
  }
}

/** `adopt-on-edit`: directory entries reconcile member by member, blob entries use the two-tier decision. */
function applyAdoptOnEdit(ctx: Ctx, path: string): void {
  if (!resolvesAtFetchHead(path)) {
    warnPhantom(ctx, path);
    return;
  }
  if (objectTypeAtFetchHead(path) === "tree") {
    if (ctx.isShallow) {
      ctx.err(
        `Warning: refusing to reconcile adopt-on-edit directory '${path}' on a shallow clone.`,
      );
      ctx.err("         History-based add/delete decisions cannot be trusted (a truncated history");
      ctx.err("         can hide an old deletion and wrongly re-add a file). Run sync from a full");
      ctx.err(`         (non-shallow) clone to reconcile '${path}'.`);
      return;
    }
    reconcileDir(ctx, path);
    return;
  }
  const { decision, current } = blobEntryDecision(ctx, path);
  if (decision === "update") {
    restore(pathspecFor(ctx.entries, path));
    // Refresh the marker so subsequent syncs short-circuit on Tier 1.
    const newSha = blobSha(ctx, path);
    if (newSha !== "") writeMarker(ctx, path, newSha);
    return;
  }
  // Freeze marker = the adopter's OWN current blob, never an upstream one.
  if (current !== "") writeMarker(ctx, path, current);
  ctx.err(`Preserved (adopter customisation): ${path}`);
}

export function applyPolicies(ctx: Ctx): void {
  for (const { path, policy } of ctx.entries) {
    switch (policy) {
      case "excluded":
        break; // Org-owned: never touched.
      case "strict":
      case "regenerable":
        applyRestoring(ctx, path, policy);
        break;
      case "adopt-on-edit":
        applyAdoptOnEdit(ctx, path);
        break;
      default:
        ctx.err(`Error: unknown policy '${policy}' for path '${path}' in ${ctx.manifestPath}`);
        throw new SyncExit(1);
    }
  }
}
