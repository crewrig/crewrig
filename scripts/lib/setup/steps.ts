// steps.ts — the common steps of the setup flow (spec 0256 requirements 3, 6, 20; plan v2 step
// B3b.1) and the helpers every step file shares. The other steps are registered by the seven files
// `flow.ts` spreads after `commonSteps` (steps-rules, steps-mcp, steps-hooks, steps-agy,
// steps-usage, steps-tiers, summary): a file adds its steps by exporting a `StepRegistry`; nobody
// edits this file to add one. A step id with no body anywhere is `notImplemented(id)`.
//
// `link-confirm` is not here: the flow executes it itself, because it owns the line queue the
// one-key question must precede (requirement 16).

import fs from "node:fs";
import path from "node:path";

import type { Io } from "./context.ts";
import { installProductionDependencies } from "./deps-step.ts";
import type { StepFn, StepId, StepRegistry } from "./descriptor.ts";
import { SetupExit } from "./exit.ts";
import { checkIdentity, checkPrerequisites } from "./prerequisites.ts";
import { sessionCheckStep } from "./session-check.ts";
import { offerTlsDelegation } from "./tls-offer.ts";

/**
 * The failure policy of a bare `cp`, `mv`, `find -delete` or marker write that the shell let abort
 * under `set -e`: print one `Error: <what failed>` line on standard error and exit 1.
 */
export function failClosed<T>(io: Io, what: string, action: () => T): T {
  try {
    return action();
  } catch (error) {
    if (error instanceof SetupExit) throw error;
    const reason = error instanceof Error ? error.message : String(error);
    io.err(`Error: ${what}: ${reason}`);
    throw new SetupExit(1);
  }
}

/** The placeholder of a step nobody registered: a programming error, never a silent skip. */
export function notImplemented(id: StepId): StepFn {
  return async () => {
    throw new Error(`setup step '${id}' has no implementation registered`);
  };
}

const banner: StepFn = async ({ ctx, descriptor }) => {
  ctx.io.out("====================================");
  ctx.io.out(`  ${descriptor.banner}`);
  ctx.io.out("====================================");
  ctx.io.out("");
};

/** `mkdir -p` of the rules directory (the CLI home for Gemini and Antigravity). */
const ensureHome: StepFn = async ({ ctx, descriptor }) => {
  const dir = path.join(ctx.home, descriptor.homes.rulesDir);
  failClosed(ctx.io, `cannot create ${dir}`, () => fs.mkdirSync(dir, { recursive: true }));
};

const prerequisites: StepFn = async ({ ctx, spawn }) => {
  checkPrerequisites(ctx, spawn);
};

const identityCheck: StepFn = async ({ ctx }) => {
  checkIdentity(ctx);
};

/** The offer, then its variables into the flow-owned env (children and later modules see them). */
const tlsOffer: StepFn = async ({ ctx, state, session }) => {
  const result = await offerTlsDelegation({ ctx, session });
  Object.assign(state.env, result.vars);
  state.tlsVars = { ...state.tlsVars, ...result.vars };
  state.tlsWrote = state.tlsWrote || result.wrote;
  ctx.io.out("");
};

const depsInstall: StepFn = async ({ ctx, spawn }) => {
  if (installProductionDependencies({ ctx, spawn }) !== 0) throw new SetupExit(1);
  ctx.io.out("");
};

export const commonSteps: StepRegistry = {
  banner,
  "ensure-home": ensureHome,
  prerequisites,
  "identity-check": identityCheck,
  "tls-offer": tlsOffer,
  "deps-install": depsInstall,
  "session-check": sessionCheckStep,
};
