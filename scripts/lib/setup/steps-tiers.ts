// steps-tiers.ts — the `tiers` step of the setup flow (spec 0256 requirement 24; plan v2 step
// B3b.1, task T6): the artifact-install block of the four scripts (Claude 373-438, Gemini 331-394,
// Copilot 337-386, Antigravity 355-401). The body dispatches on `descriptor.strategies.tiers`:
// `standard` runs `runTierInstall` (Claude, Gemini, Copilot; homes and staging are the module's, by
// `ctx.cli`), `antigravity` runs `runAntigravityTiers`. The Antigravity supersession migration is
// NOT part of this step: it is the separate `migrate-superseded` step (steps-agy.ts) that the
// descriptor lists right after `tiers`, as the shell does.
//
// Test seam: `deps.seams.tierBuild` (`{ build }`) replaces the in-process component build.

import { runAntigravityTiers } from "./antigravity-tier.ts";
import type { StepFn, StepRegistry } from "./descriptor.ts";
import { SetupExit } from "./exit.ts";
import type { TierBuildDeps } from "./tier-build.ts";
import { runTierInstall } from "./tier-install.ts";

/** Narrow the untyped seam to the one `ensureTierBuilt` reads (`build` only). */
function tierBuildSeam(seams: Readonly<Record<string, unknown>> | undefined): TierBuildDeps {
  const seam: unknown = seams?.["tierBuild"];
  if (typeof seam !== "object" || seam === null) return {};
  const build: unknown = (seam as Record<string, unknown>)["build"];
  return typeof build === "function" ? { build: build as NonNullable<TierBuildDeps["build"]> } : {};
}

/** A descriptor mistake, not a failed install: never reported as `Error: cannot install`. */
class ProgrammingError extends Error {}

const tiers: StepFn = async ({ descriptor, ctx, state, session, deps }) => {
  const tierCtx = { ...ctx, outcomes: state.outcomes };
  const build = tierBuildSeam(deps.seams);
  try {
    if (descriptor.strategies.tiers === "antigravity") {
      await runAntigravityTiers({ ctx: tierCtx, session, deps: build });
    } else if (ctx.cli === "antigravity") {
      throw new ProgrammingError(
        "setup step 'tiers': the standard strategy cannot install for antigravity",
      );
    } else {
      await runTierInstall({ ctx: tierCtx, session, cli: ctx.cli, deps: build });
    }
  } catch (error) {
    // `SetupExit` (failed build, failed install, cancelled overlay) passes through; a bare `cp` or
    // `rm` the shell let abort under `set -e` fails closed (one line, exit 1).
    if (error instanceof SetupExit || !(error instanceof Error)) throw error;
    if (error instanceof ProgrammingError) throw error;
    ctx.io.err(`Error: cannot install the components: ${error.message}`);
    throw new SetupExit(1);
  }
};

export const tierSteps: StepRegistry = { tiers };
