// blobs.ts — blob identity, upstream-history membership and the synced-marker files of the
// sync (spec 0253 R19-R21; shell `blob_sha`, `upstream_has_blob`, `strict_blob_is_dirty`,
// `write_marker`, `path_in_org_history` and the two-tier decision shared by
// `reconcile_member` and the blob adopt-on-edit arm).

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { git, lines } from "./git.ts";
import type { Ctx } from "./types.ts";

/** `$(...)` strips every trailing newline. */
function stripTrailingNewlines(text: string): string {
  return text.replace(/\n+$/, "");
}

/** Working-tree blob of `path` (the HEAD blob when the file is absent); "" when git fails. */
export function blobSha(ctx: Ctx, path: string): string {
  const full = `${ctx.repoDir}/${path}`;
  const result = existsSync(full) ? git(["hash-object", full]) : git(["rev-parse", `HEAD:${path}`]);
  return result.status === 0 ? stripTrailingNewlines(result.stdout) : "";
}

/** True iff `sha` equals the blob of `path` at any commit of FETCH_HEAD history. */
export function upstreamHasBlob(path: string, sha: string): boolean {
  const log = git(["log", "--format=%H", "FETCH_HEAD", "--", path]);
  for (const commit of lines(log.stdout)) {
    const hist = git(["rev-parse", `${commit}:${path}`]);
    if (hist.status !== 0) continue;
    if (stripTrailingNewlines(hist.stdout) === sha) return true;
  }
  return false;
}

/** True iff `path` resolves to an object (blob or tree) at FETCH_HEAD. */
export function resolvesAtFetchHead(path: string): boolean {
  return git(["cat-file", "-e", `FETCH_HEAD:${path}`]).status === 0;
}

/** The object type of `path` at FETCH_HEAD; "" when it does not resolve. */
export function objectTypeAtFetchHead(path: string): string {
  const result = git(["cat-file", "-t", `FETCH_HEAD:${path}`]);
  return result.status === 0 ? stripTrailingNewlines(result.stdout) : "";
}

/** True iff `path` is locally modified relative to upstream (the strict dirty test). */
export function strictBlobIsDirty(ctx: Ctx, path: string): boolean {
  const full = `${ctx.repoDir}/${path}`;
  if (existsSync(full)) {
    const current = stripTrailingNewlines(git(["hash-object", full]).stdout);
    return !upstreamHasBlob(path, current);
  }
  // Absent locally: dirty iff it was in HEAD (locally deleted).
  return git(["cat-file", "-e", `HEAD:${path}`]).status === 0;
}

/** True iff `path` is reachable from the adopter's own HEAD history. */
export function pathInOrgHistory(path: string): boolean {
  return git(["rev-list", "HEAD", "--", path]).stdout.trim() !== "";
}

function markerPath(ctx: Ctx, path: string): string {
  return join(ctx.markersDir, `${path}.sha`);
}

/** The marker content (trailing newlines stripped, as `$(cat file)` does); undefined when not a file. */
export function readMarker(ctx: Ctx, path: string): string | undefined {
  const file = markerPath(ctx, path);
  try {
    if (!statSync(file).isFile()) return undefined;
    return stripTrailingNewlines(readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

/** Record `sha` as the last-synced blob marker of `path`. */
export function writeMarker(ctx: Ctx, path: string, sha: string): void {
  const file = markerPath(ctx, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${sha}\n`);
}

/** The stateless two-tier "modified?" decision: marker fast path, then upstream-history membership. */
export function blobEntryDecision(
  ctx: Ctx,
  path: string,
): { readonly decision: "update" | "freeze"; readonly current: string } {
  const current = blobSha(ctx, path);
  if (current !== "" && readMarker(ctx, path) === current) return { decision: "update", current };
  if (current !== "" && upstreamHasBlob(path, current)) return { decision: "update", current };
  return { decision: "freeze", current };
}
