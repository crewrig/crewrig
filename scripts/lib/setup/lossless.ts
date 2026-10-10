// lossless.ts — the refusal of a rewrite that would change a number or reorder a key (finding i1-F11).
// A layer-3 writer reads a settings, hooks or config file with the plain reader and writes the whole
// document back; a number JS cannot hold (`12345678901234567890`) or spell as the file does (`1.0`,
// `1e3`) would silently change, where the shell's `jq` keeps every literal. `assertRewritable` reuses the
// refusal of hook-config.ts (`readJsonConfig` with `lossless: true`, its `LossyJsonError`): the file is
// left untouched and one `Error:` line goes to standard error; `assertRewritable` then ends the run with
// `SetupExit(1)`, `reportIfLossy` (best-effort steps) returns `false` and the run goes on.
// Call it before the backup of a write that is certain, never on a path that writes nothing.
// Standard library and hook-config.ts only: it runs before the dependency step.

import { LossyJsonError, readJsonConfig } from "../hook-config.ts";
import type { Io } from "./context.ts";
import { SetupExit } from "./exit.ts";

/**
 * The non-throwing form, for the best-effort rewrite steps: `true` when `file` is absent, is not one JSON
 * object (each caller keeps its own refusal for that), or round-trips exactly; otherwise print
 * `Error: <file> cannot be rewritten without loss: <reason>.` and return `false`, the step's failure status
 * (the shell continues past `guard_rewrite_installed ... || true` and the usage-capture rewrite).
 */
export function reportIfLossy(ctx: { readonly io: Pick<Io, "err"> }, file: string): boolean {
  try {
    readJsonConfig(file, { lossless: true });
  } catch (error) {
    if (!(error instanceof LossyJsonError)) return true;
    ctx.io.err(`Error: ${error.message}`);
    return false;
  }
  return true;
}

/**
 * Return when `file` is rewritable (see `reportIfLossy`); otherwise print the same `Error:` line and throw
 * `SetupExit(1)`. For the writers that are not best-effort.
 */
export function assertRewritable(ctx: { readonly io: Pick<Io, "err"> }, file: string): void {
  if (!reportIfLossy(ctx, file)) throw new SetupExit(1, `${file} cannot be rewritten without loss`);
}
