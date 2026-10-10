// link-or-copy.ts — place a component as a symbolic link, or as a copy when the link is refused
// (spec 0255 R14-R21). Synchronous, prints nothing: callers print the Copied:/Linked: lines and
// ONE `summarizeFallbacks` notice on standard error. The staged swap lives in link-or-copy-swap.ts,
// the refusal classification (and the single read of the test seam) in link-or-copy-classify.ts.

import fs from "node:fs";
import path from "node:path";

import { assertSafeToRemove, copyTreeDereferenced } from "./extension/tree-copy.ts";
import { classifyRefusal, forcedRefusal } from "./link-or-copy-classify.ts";
import { discardStage, stagedName, swapIn } from "./link-or-copy-swap.ts";
import type { SwapOptions } from "./link-or-copy-swap.ts";
import type { LinkOrCopyOptions, LinkOutcome } from "./link-or-copy-types.ts";
import { joinPath, resolveReal } from "./paths.ts";

export type { LinkOrCopyOptions, LinkOutcome } from "./link-or-copy-types.ts";

// scripts/lib/../.. is the repository root; no `.git` lookup, so a sandbox copy of scripts/ works too.
const REPO_DIR = path.resolve(import.meta.dirname, "..", "..");

function errCode(error: unknown): string {
  return error instanceof Error && "code" in error ? String(error.code) : "";
}

/** The real path of `p`, or of its nearest existing ancestor with the missing tail re-appended. */
function realOrAncestor(p: string): string {
  const abs = path.resolve(p);
  try {
    return resolveReal(abs);
  } catch {
    const parent = path.dirname(abs);
    return parent === abs ? abs : joinPath(realOrAncestor(parent), path.basename(abs));
  }
}

function isSameOrWithin(inner: string, outer: string): boolean {
  const rel = path.relative(outer, inner);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** Resolve the source and refuse a destination that is the source or lies inside it (R16). */
function resolveSource(source: string, dest: string): string {
  const src = resolveReal(source);
  if (isSameOrWithin(realOrAncestor(dest), src)) {
    throw new Error(`refusing to place '${dest}' inside its source '${source}'`);
  }
  return src;
}

function swapOptions(opts: LinkOrCopyOptions): SwapOptions {
  return opts.platform === undefined ? {} : { platform: opts.platform };
}

/** Copy `src` to a staging name beside `dest`, then swap it in; a failed copy leaves `dest` intact. */
function stageCopy(src: string, dest: string, opts: LinkOrCopyOptions): void {
  const stage = stagedName(dest);
  try {
    fs.mkdirSync(path.dirname(path.resolve(dest)), { recursive: true });
    copyTreeDereferenced(src, stage);
  } catch (error) {
    discardStage(stage);
    throw error;
  }
  swapIn(stage, dest, swapOptions(opts));
}

/**
 * Explicit copy mode (install): a byte-for-byte copy of `source` at `dest`, links inside the source
 * dereferenced, mode bits kept. An existing destination of any kind is replaced once the copy of
 * the new content succeeded. The source and the destination must not nest.
 */
export function placeCopy(source: string, dest: string, opts: LinkOrCopyOptions = {}): LinkOutcome {
  const src = resolveSource(source, dest);
  stageCopy(src, dest, opts);
  return { method: "copy", dest, source: src };
}

/**
 * Link mode: an absolute symbolic link at `dest`, created under a staging name and swapped in. A
 * refusal that `classifyRefusal` maps to a fallback copies instead (outcome `fallback-copy`) unless
 * `opts.onRefusal` is `"throw"`; every other error is rethrown unchanged (R15).
 */
export function linkOrCopy(
  source: string,
  dest: string,
  opts: LinkOrCopyOptions = {},
): LinkOutcome {
  const src = resolveSource(source, dest);
  const forced = forcedRefusal(opts.env ?? process.env);
  const platform = forced === null ? (opts.platform ?? process.platform) : "win32";
  const symlink =
    forced === null
      ? (opts.symlinkImpl ?? ((t, p, type) => fs.symlinkSync(t, p, type)))
      : () => {
          throw Object.assign(new Error(`forced link refusal: ${forced}`), { code: forced });
        };
  const stage = stagedName(dest);
  try {
    fs.mkdirSync(path.dirname(path.resolve(dest)), { recursive: true });
    symlink(src, stage, fs.statSync(src).isDirectory() ? "dir" : "file");
  } catch (error) {
    discardStage(stage);
    const code = errCode(error);
    if (opts.onRefusal === "throw" || classifyRefusal(code, platform) === "rethrow") throw error;
    stageCopy(src, dest, opts);
    return { method: "fallback-copy", dest, source: src, code };
  }
  swapIn(stage, dest, swapOptions(opts));
  return { method: "link", dest, source: src };
}

/**
 * Remove a placed entry by name, as `[ -e ] || [ -L ]` then `rm -rf` does: a link is unlinked and
 * never followed (its target is untouched), anything else is removed recursively after
 * `assertSafeToRemove`. Returns what was there.
 */
export function removePlaced(dest: string): "symlink" | "copy" | "absent" {
  let st: fs.Stats;
  try {
    st = fs.lstatSync(dest);
  } catch (error) {
    if (errCode(error) === "ENOENT") return "absent";
    throw error;
  }
  if (!st.isSymbolicLink()) assertSafeToRemove(dest, REPO_DIR);
  fs.rmSync(dest, { recursive: true, force: true });
  return st.isSymbolicLink() ? "symlink" : "copy";
}

/**
 * The one aggregated stderr notice (R18) for the outcomes that became a copy because a link was
 * refused: every such destination on its own line, and the refresh rule. `""` when none did.
 * The text carries no trailing newline.
 */
export function summarizeFallbacks(outcomes: readonly LinkOutcome[]): string {
  const fallbacks = outcomes.filter((o) => o.method === "fallback-copy");
  if (fallbacks.length === 0) return "";
  const codes = [...new Set(fallbacks.map((o) => o.code))].join(", ");
  return [
    `Symbolic links were refused (${codes}); these destinations are copies, not links:`,
    ...fallbacks.map((o) => `  ${o.dest}`),
    "A change to the source takes effect in a copy only after the same operation is run again.",
  ].join("\n");
}
