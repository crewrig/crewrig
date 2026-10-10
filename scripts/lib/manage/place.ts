// place.ts — place one component under its own name (spec 0255 R7, plan step 9).
//
// Ports `place_component` of the four manage-*-component.sh scripts, which are identical in it:
// the item name is the basename of the source (a trailing slash does not change it, the shell's
// `basename`), a `.gitkeep` is skipped, whatever sits at the destination (file, directory, link,
// dangling link) is removed first, then link mode places through `linkOrCopy` and install mode
// through `placeCopy`. A link that fell back to a copy prints `Copied:` (R17) and its outcome is
// collected so the caller prints ONE `summarizeFallbacks` notice at the end of the process (R18).

import path from "node:path";

import type { Io } from "../extension/types.ts";
import { linkOrCopy, placeCopy, removePlaced, summarizeFallbacks } from "../link-or-copy.ts";
import type { LinkOrCopyOptions, LinkOutcome } from "../link-or-copy.ts";

export type PlaceMode = "install" | "link";

/** Everything a placement reads or records; `outcomes` and `placed` are filled by `placeComponent`. */
export interface PlaceCtx {
  readonly io: Pick<Io, "out" | "err">;
  readonly env: Record<string, string | undefined>;
  readonly platform: string;
  /** Test seams and policy switches; they win over `env` and `platform` above. */
  readonly linkOptions?: LinkOrCopyOptions;
  /** Every outcome, in placement order (input of the one aggregated notice). */
  readonly outcomes: LinkOutcome[];
  /** The names placed, in order (the antigravity script's `PLACED_NAMES`). */
  readonly placed: string[];
}

/** A fresh context: nothing placed yet. */
export function newPlaceCtx(
  io: Pick<Io, "out" | "err">,
  env: Record<string, string | undefined>,
  platform: string,
  linkOptions?: LinkOrCopyOptions,
): PlaceCtx {
  const ctx = { io, env, platform, outcomes: [], placed: [] };
  return linkOptions === undefined ? ctx : { ...ctx, linkOptions };
}

/**
 * Place `src` as `<destDir>/<basename(src)>`. Returns the outcome, or `undefined` for a `.gitkeep`.
 * A link refused for a reason `linkOrCopy` does not map to a copy propagates unchanged.
 */
export function placeComponent(
  src: string,
  destDir: string,
  mode: PlaceMode,
  ctx: PlaceCtx,
): LinkOutcome | undefined {
  const name = path.basename(path.resolve(src));
  if (name === ".gitkeep") return undefined;
  ctx.placed.push(name);
  const dest = path.join(destDir, name);
  removePlaced(dest);
  const opts: LinkOrCopyOptions = { env: ctx.env, platform: ctx.platform, ...ctx.linkOptions };
  const outcome = mode === "link" ? linkOrCopy(src, dest, opts) : placeCopy(src, dest, opts);
  ctx.outcomes.push(outcome);
  ctx.io.out(`  ${outcome.method === "link" ? "Linked" : "Copied"}: ${name}`);
  return outcome;
}

/** Print the one aggregated fallback notice on standard error, when any link became a copy. */
export function flushFallbackNotice(ctx: PlaceCtx): void {
  const notice = summarizeFallbacks(ctx.outcomes);
  if (notice !== "") ctx.io.err(notice);
}
