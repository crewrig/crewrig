// merge-root.ts — the merge root, its ownership guard, the content digest and cleanup.
//
// Twins of model-resolve.sh `_mapping_merge_root` (:115), `_mapping_sha256` (:134)
// and `mapping_merge_cleanup` (:506), plus the filesystem tests of `_merge_mapping`
// (:402, :409, :410: `-e`, `-O`, `mkdir -p -m 700`). Spec 0199 R26-R28, D11; spec
// 0250 R20. R2 (spec 0250): this slice moved only because the step (b) build
// depends on it, not as precedent for the other consumers of the library.
//
// The root is a pure function of the environment: `MAPPING_MERGE_DIR` with one
// trailing slash removed, else `<TMPDIR or the platform temporary directory>/
// crewrig-mapping-<pid>`. `mappingMergeCleanup` re-derives it rather than
// remembering it, and removes it only when the library derived it (D11).

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { ResolveContext } from "./types.ts";

/** Join path parts: `/` on POSIX (byte parity with the shell, trailing slashes kept), native on win32. */
export function pathJoin(platform: NodeJS.Platform, ...parts: string[]): string {
  return platform === "win32" ? path.join(...parts) : parts.join("/");
}

/** `[ -f path ]`: a regular file, symbolic links followed. */
export function isFile(file: string): boolean {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function withoutOneSlash(text: string): string {
  return text.endsWith("/") ? text.slice(0, -1) : text;
}

/** `_mapping_merge_root`: pure, no side effect. */
export function mappingMergeRoot(ctx: ResolveContext): string {
  const dir = ctx.env["MAPPING_MERGE_DIR"];
  if (dir !== undefined && dir !== "") return withoutOneSlash(dir);
  const tmp = ctx.env["TMPDIR"];
  const base = withoutOneSlash(tmp !== undefined && tmp !== "" ? tmp : ctx.tmpdir);
  return pathJoin(ctx.platform, base, `crewrig-mapping-${ctx.pid}`);
}

/** `mapping_merge_cleanup`: removes only a root the library derived (D11); never throws. */
export function mappingMergeCleanup(ctx: ResolveContext): void {
  const dir = ctx.env["MAPPING_MERGE_DIR"];
  if (dir !== undefined && dir !== "") return;
  try {
    fs.rmSync(mappingMergeRoot(ctx), { recursive: true, force: true });
  } catch {
    // the shell's `rm -rf` ignored failures and returned 0
  }
}

function readBytes(file: string): Buffer {
  try {
    return fs.readFileSync(file);
  } catch {
    return Buffer.alloc(0);
  }
}

/**
 * `_mapping_sha256`: the lower-case SHA-256 of `<target>`, NUL, the core file's bytes
 * (nothing when it does not exist), NUL, the org file's bytes.
 */
export function mappingSha256(target: string, core: string, org: string): string {
  return createHash("sha256")
    .update(target)
    .update(Buffer.from([0]))
    .update(isFile(core) ? readBytes(core) : Buffer.alloc(0))
    .update(Buffer.from([0]))
    .update(readBytes(org))
    .digest("hex");
}

/**
 * `-e` and `-O` of the shell, as one answer: `absent`, `owned` by the current user, or
 * `foreign`. Ownership is not modelled on win32, where an existing root is `owned`.
 */
export function rootState(ctx: ResolveContext, root: string): "absent" | "owned" | "foreign" {
  try {
    const stat = fs.statSync(root);
    return ctx.uid === undefined || stat.uid === ctx.uid ? "owned" : "foreign";
  } catch {
    return "absent";
  }
}

/** `mkdir -p -m 700 root`: parents by default mode, the root owner-only; failures are silent. */
export function ensureRoot(root: string): void {
  try {
    fs.mkdirSync(path.dirname(root), { recursive: true });
    fs.mkdirSync(root, { mode: 0o700 });
  } catch {
    // an existing root, or a refusal the ownership test that follows turns into a note
  }
}
