// files.ts — place one file or one directory the way the shell's `install_file` / `install_dir`
// do (scripts/lib/common.sh; spec 0256 requirements 22 and 38, deviation 44(i)).
//
// Copy mode copies the bytes (a source file is LF already, nothing is rewritten) through the
// staged swap of `placeCopy`; link mode (`ctx.link`) places an absolute link through `linkOrCopy`.
// A link the platform refuses places a copy and prints `Copied:` instead of `Linked:`; the outcome
// is recorded in `ctx.outcomes` (when the caller supplies the array) so one `fallbackSummary`
// notice is printed at the end of the run. Layer 1: node built-ins and repository modules only.

import { linkOrCopy, placeCopy, summarizeFallbacks } from "../link-or-copy.ts";
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
  const options: LinkOrCopyOptions = { env: ctx.env, platform: ctx.platform, ...ctx.linkOptions };
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
