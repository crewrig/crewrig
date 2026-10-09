// dirty.ts — the strict-policy dirty-core detection and its refusal (spec 0253 R19-R21;
// shell lines "Dirty-core detection" through the nine-line refusal, specs 0059, 0129).

import { objectTypeAtFetchHead, resolvesAtFetchHead, strictBlobIsDirty } from "./blobs.ts";
import { git, lines } from "./git.ts";
import { excludedChildrenOf, isUnderExcluded } from "./manifest.ts";
import { type Ctx, SyncExit } from "./types.ts";

/** Every locally modified file governed by a strict entry, in manifest order, first occurrence only. */
export function collectDirty(ctx: Ctx): string[] {
  const dirty: string[] = [];
  for (const entry of ctx.entries) {
    if (entry.policy !== "strict") continue;
    // A phantom entry cannot be dirty; the apply loop owns its single warning.
    if (!resolvesAtFetchHead(entry.path)) continue;

    if (objectTypeAtFetchHead(entry.path) === "tree") {
      // Report the MEMBERS, never the directory entry (spec 0129 R1/R2); no early break (R3).
      const excluded = excludedChildrenOf(ctx.entries, entry.path);
      const members = lines(
        git(["ls-tree", "-r", "--name-only", "FETCH_HEAD", "--", `${entry.path}/`]).stdout,
      );
      for (const member of members) {
        if (isUnderExcluded(excluded, member)) continue;
        if (strictBlobIsDirty(ctx, member)) dirty.push(member);
      }
    } else if (strictBlobIsDirty(ctx, entry.path)) {
      dirty.push(entry.path);
    }
  }
  return [...new Set(dirty)];
}

/** Refuse the sync (exit 1) with the nine-line message when any strict path is dirty. */
export function refuseIfDirty(ctx: Ctx): void {
  const dirty = collectDirty(ctx);
  if (dirty.length === 0) return;
  ctx.err("Error: the following core-layer paths have local modifications:");
  for (const path of dirty) ctx.err(`  ${path}`);
  ctx.err("Revert these changes before running sync, or promote them to overlay overrides.");
  ctx.err("");
  ctx.err("Restore ONLY the files listed above, one path at a time:");
  ctx.err("  git checkout <your-ref> -- <path listed above>");
  ctx.err("Never restore the containing directory. A directory-level checkout also");
  ctx.err("reverts every file upstream added or changed in it, silently.");
  throw new SyncExit(1);
}
