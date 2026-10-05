// run.ts — `run` (spec 0248 R21, R22).
//
// Order: plan the launch (a command refused outright takes no claim), gate,
// acquire or re-enter, re-gate, run in the toplevel, release. The release is the
// one thing that must not be unconditional: having acquired the claim is not a
// licence to drop it, because a `takeover` can land while the wrapped command is
// still running (the case `takeover` exists for). From the instant it lands the
// claim belongs to the taker, so the release re-checks the holder, and a
// declined release is ledgered under its own name and names the displacer
// instead of recording a `release` that did not happen. The wrapped command's
// code is the exit code either way.

import { claimExists, claimField } from "./claim-state.ts";
import { refuseDirty, treeDirt } from "./gate.ts";
import { ledgerAppend } from "./ledger.ts";
import { planLaunch, signalExitCode, startCommand } from "./launch.ts";
import type { LaunchResult } from "./launch.ts";
import { holdSignals } from "./signals.ts";
import { releaseClaimDir, reportHolder, tryCreateClaim, writeClaimState } from "./store.ts";
import { ClaimFailure } from "./types.ts";
import type { ClaimContext, Io, RunCommand } from "./types.ts";

/** What became of the claim when the command ended. */
type Outcome = "released" | "declined" | "not-acquired";

/** Release the claim this invocation acquired, unless it is gone or another agent holds it. */
function releaseIfOurs(ctx: ClaimContext, io: Io): Outcome {
  if (!claimExists(ctx)) {
    // Recording this as OUR release would be the lie a stale release tells.
    ledgerAppend(ctx, "release-declined", "run: claim was already gone at exit");
    io.err(`Notice: the claim on '${ctx.ticket}' was already gone when this run exited;`);
    io.err("       nothing was released. Run 'history' to see what happened to it.");
    return "declined";
  }
  const holder = claimField(ctx, "holder");
  if (holder !== ctx.agent) {
    ledgerAppend(ctx, "release-declined", `run: displaced by '${holder}'; claim left intact`);
    io.err(`Notice: '${holder}' took over the claim on '${ctx.ticket}' while this run`);
    io.err("       was in flight. Releasing it here would evict them, so the claim is");
    io.err("       left intact and the ledger records a declined release.");
    return "declined";
  }
  releaseClaimDir(ctx);
  ledgerAppend(ctx, "release", "run");
  return "released";
}

/** The sentence that closes a launch diagnostic: what happened to the claim. */
function claimClause(ctx: ClaimContext, outcome: Outcome): string {
  if (outcome === "released") return `the claim on '${ctx.ticket}' was released.`;
  if (outcome === "declined")
    return `the claim on '${ctx.ticket}' was left in place (see the Notice above).`;
  return `the claim on '${ctx.ticket}' held by '${ctx.agent}' was left in place.`;
}

/** The exit code of `run` for a finished or failed launch; prints the diagnostic of a failed one. */
function exitCodeOf(
  result: LaunchResult,
  name: string,
  ctx: ClaimContext,
  outcome: Outcome,
  io: Io,
): number {
  if (result.kind === "exit") return result.code;
  if (result.kind === "signal") return signalExitCode(result.signal);
  const missing = result.code === "ENOENT" || result.code === "ENOTDIR";
  const reason = missing ? "command not found" : `cannot be executed (${result.code})`;
  io.err(`Error: cannot run '${name}': ${reason}; ${claimClause(ctx, outcome)}`);
  return missing ? 127 : 126;
}

export const runCommand: RunCommand = async (ctx, opts, io) => {
  const argv = opts.command;
  const name = argv[0];
  if (name === undefined) throw new ClaimFailure("'run' needs a command after '--'.");

  // Before the gate: a command refused outright must leave no claim behind.
  const plan = planLaunch(argv, {
    platform: ctx.platform,
    env: process.env,
    toplevel: ctx.toplevel,
  });
  if (plan.kind === "refused") throw new ClaimFailure(plan.message);

  // The gate first, so a dirty tree is refused with 5 before the claim state is
  // consulted: a takeover grants no waiver, the taker is refused here too.
  const dirt = treeDirt(ctx);
  if (dirt !== "") return refuseDirty(ctx, dirt, io);

  const detail = `run: ${argv.join(" ")}`;
  let acquired = false;
  if (tryCreateClaim(ctx)) {
    acquired = true;
    writeClaimState(ctx, opts.operation);
    ledgerAppend(ctx, "take", detail);
  } else {
    if (claimField(ctx, "holder") !== ctx.agent) {
      io.out(`Refused: '${ctx.ticket}' is already claimed by another agent.`);
      reportHolder(ctx, io);
      return 4;
    }
    // Re-entrant: the caller already holds the claim. Proceed WITHOUT acquiring,
    // and therefore without releasing: that would drop the caller's own hold.
    ledgerAppend(ctx, "run-reentrant", detail);
  }

  // From here every path ends in `settle`, which releases at most once.
  const restoreSignals = holdSignals();
  let outcome: Outcome = "not-acquired";
  const settle = (): void => {
    if (!acquired) return;
    acquired = false;
    outcome = releaseIfOurs(ctx, io);
  };
  try {
    const again = treeDirt(ctx);
    if (again !== "") {
      settle();
      return refuseDirty(ctx, again, io);
    }
    // The command runs where the gate looked: both are the toplevel, so the
    // certified tree and the mutated tree are one tree by construction (spec 0126
    // R1, R2), whichever directory the caller stood in.
    const result = await startCommand(plan, ctx.toplevel);
    settle();
    return exitCodeOf(result, name, ctx, outcome, io);
  } finally {
    settle();
    restoreSignals();
  }
};
