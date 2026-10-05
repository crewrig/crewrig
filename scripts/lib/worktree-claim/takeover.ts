// takeover.ts — `takeover` (spec 0248 R20).
//
// Transfers a claim held by another agent whose age is at least `--stale-after`
// minutes. Deliberately no clean-tree gate (the residue an ended holder left
// behind is the reason a takeover is needed) and no waiver either: `take` and
// `run` re-evaluate the gate on every invocation. No working-tree file is touched.

import { claimExists, claimField } from "./claim-state.ts";
import { nowEpoch } from "./clock.ts";
import { ledgerAppend } from "./ledger.ts";
import { claimAgeSeconds, staleSeconds } from "./staleness.ts";
import { reportHolder, writeClaimState } from "./store.ts";
import type { ClaimContext, ClaimOptions, Io } from "./types.ts";

export function cmdTakeover(ctx: ClaimContext, opts: ClaimOptions, io: Io): number {
  if (!claimExists(ctx)) {
    io.out(`Refused: '${ctx.ticket}' is not claimed, so there is nothing to take over.`);
    io.out("Use 'take' — it evaluates the clean-tree gate, which 'takeover' does not.");
    return 4;
  }

  const holder = claimField(ctx, "holder");
  const since = claimField(ctx, "since");
  const sinceEpoch = claimField(ctx, "since_epoch");

  if (holder === ctx.agent) {
    io.out(`Already held by '${ctx.agent}'; nothing to take over.`);
    reportHolder(ctx, io);
    return 0;
  }

  const age = claimAgeSeconds(sinceEpoch, nowEpoch());
  const stale = staleSeconds(opts.staleAfter);
  if (age !== undefined && age < stale) {
    io.out(`Refused: the claim on '${ctx.ticket}' is not stale.`);
    io.out(`held-for-seconds: ${age}`);
    io.out(`stale-after-seconds: ${stale}`);
    reportHolder(ctx, io);
    return 4;
  }

  writeClaimState(ctx, opts.operation);
  ledgerAppend(
    ctx,
    "takeover",
    `displaced=${holder} displaced-since=${since} stale-after-minutes=${opts.staleAfter}`,
  );
  io.out(`Took over '${ctx.ticket}' from '${holder}' (held since ${since}).`);
  reportHolder(ctx, io);
  io.out("");
  io.out("This transfers the CLAIM and nothing else. It grants no clean-tree waiver:");
  io.out("'take' and 'run' re-evaluate the gate on every invocation. Residue you");
  io.out("authored, commit; residue you did not author, flag to team-lead and stop.");
  return 0;
}
