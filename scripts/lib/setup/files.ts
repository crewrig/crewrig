// files.ts — place one file or one directory the way the shell's `install_file` / `install_dir`
// do (retired scripts/lib/common.sh; spec 0256 requirements 22 and 38, deviation 44(i)).
//
// Copy mode copies the bytes (a source file is LF already, nothing is rewritten) through the
// staged swap of `placeCopy`; link mode (`ctx.link`) places an absolute link through `linkOrCopy`.
// A link the platform refuses places a copy and prints `Copied:` instead of `Linked:`; the outcome
// is recorded in `ctx.outcomes` (when the caller supplies the array) so one `fallbackSummary`
// notice is printed at the end of the run. Layer 1: node built-ins and repository modules only.

import fs from "node:fs";
import path from "node:path";

import { linkOrCopy, placeCopy, summarizeFallbacks } from "../link-or-copy.ts";
import { discardStage, stagedName, swapIn } from "../link-or-copy-swap.ts";
import type { LinkOrCopyOptions, LinkOutcome } from "../link-or-copy.ts";
import type { SetupCtx } from "./context.ts";

/**
 * What a placement reads: a `SetupCtx` satisfies it as is. `outcomes` (filled in placement order)
 * and `linkOptions` (test seams and policy switches of `linkOrCopy`) are optional.
 */
export type FilesCtx = Pick<SetupCtx, "io" | "env" | "platform" | "link"> & {
  readonly outcomes?: LinkOutcome[];
  readonly linkOptions?: LinkOrCopyOptions;
};

/** The ctx of a run that wants its link fallbacks collected into one notice. */
export function withOutcomes(ctx: FilesCtx): FilesCtx & { readonly outcomes: LinkOutcome[] } {
  return { ...ctx, outcomes: [] };
}

function place(ctx: FilesCtx, src: string, dest: string): LinkOutcome {
  const options: LinkOrCopyOptions = {
    env: ctx.env,
    platform: ctx.platform,
    ...ctx.linkOptions,
  };
  const outcome = ctx.link ? linkOrCopy(src, dest, options) : placeCopy(src, dest, options);
  ctx.outcomes?.push(outcome);
  return outcome;
}

/**
 * `install_file <source> <target> <label>`: replace whatever sits at `dest` (a file, a link, a
 * dangling link) with the source's content or a link to it, creating the parent directories.
 * Prints `  Linked: <label>` or `  Copied: <label>` and returns what was done.
 */
export function installFile(ctx: FilesCtx, src: string, dest: string, label: string): LinkOutcome {
  const outcome = place(ctx, src, dest);
  ctx.io.out(`  ${outcome.method === "link" ? "Linked" : "Copied"}: ${label}`);
  return outcome;
}

/**
 * `install_dir <source_dir> <target_dir> <label>`: any prior install (a copy or a link) is replaced,
 * so switching mode is idempotent and a file removed from the source does not linger.
 * Prints `  Linked dir: <label>` or `  Copied dir: <label>`.
 */
export function installDir(
  ctx: FilesCtx,
  srcDir: string,
  destDir: string,
  label: string,
): LinkOutcome {
  const outcome = place(ctx, srcDir, destDir);
  ctx.io.out(`  ${outcome.method === "link" ? "Linked" : "Copied"} dir: ${label}`);
  return outcome;
}

/**
 * A stamped file (spec 0316 R11): `stamp` maps the source text to the deployed bytes, which are
 * written under a staging name and swapped in. Always a copy, in link mode too: a link would expose
 * the authored block. The swap replaces a previous link as a link, so a linked install never
 * writes through into the repository source.
 */
export function installStampedFile(
  ctx: FilesCtx,
  src: string,
  dest: string,
  label: string,
  stamp: (text: string) => string,
): void {
  const bytes = stamp(fs.readFileSync(src, "utf8"));
  const stage = stagedName(dest);
  try {
    fs.mkdirSync(path.dirname(path.resolve(dest)), { recursive: true });
    fs.writeFileSync(stage, bytes);
    fs.chmodSync(stage, fs.statSync(src).mode & 0o777);
    swapIn(stage, dest);
  } catch (error) {
    discardStage(stage);
    throw error;
  }
  ctx.io.out(`  Copied: ${label}`);
}

/**
 * A stamped directory: every `.md` file at its top level goes through `stamp(text, name)`, every
 * other entry is copied as is, all under a staging directory swapped in whole (a file removed from
 * the source does not linger). Always a copy.
 */
export function installStampedDir(
  ctx: FilesCtx,
  srcDir: string,
  destDir: string,
  label: string,
  stamp: (text: string, name: string) => string,
): void {
  const stage = stagedName(destDir);
  try {
    fs.mkdirSync(stage, { recursive: true });
    for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
      const from = path.join(srcDir, entry.name);
      const to = path.join(stage, entry.name);
      if (entry.isFile() && entry.name.endsWith(".md")) {
        fs.writeFileSync(to, stamp(fs.readFileSync(from, "utf8"), entry.name));
        fs.chmodSync(to, fs.statSync(from).mode & 0o777);
      } else {
        fs.cpSync(from, to, { recursive: true, dereference: true });
      }
    }
    swapIn(stage, destDir);
  } catch (error) {
    discardStage(stage);
    throw error;
  }
  ctx.io.out(`  Copied dir: ${label}`);
}

/** The one aggregated notice for the links that became copies, or `undefined` when none did. */
export function fallbackSummary(ctx: Pick<FilesCtx, "outcomes">): string | undefined {
  const text = summarizeFallbacks(ctx.outcomes ?? []);
  return text === "" ? undefined : text;
}

/** Print `fallbackSummary` on standard error (the end-of-run notice of requirement 44(i)). */
export function flushFallbackNotice(ctx: FilesCtx): void {
  const text = fallbackSummary(ctx);
  if (text !== undefined) ctx.io.err(text);
}
