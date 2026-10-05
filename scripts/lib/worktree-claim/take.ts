// take.ts — `take` and `release` (spec 0248 R15, R17, R19).
//
// `take` order is check, create, re-check: the clean-tree gate runs before the
// claim so a refused operation leaves no claim behind, and again after it so a
// tree dirtied inside the window releases the claim and exits 5.

import { claimExists, claimField } from "./claim-state.ts";
import { refuseDirty, treeDirt } from "./gate.ts";
import { ledgerAppend } from "./ledger.ts";
import { releaseClaimDir, reportHolder, tryCreateClaim, writeClaimState } from "./store.ts";
import type { ClaimContext, ClaimOptions, Io } from "./types.ts";

export function cmdTake(ctx: ClaimContext, opts: ClaimOptions, io: Io): number {
  const dirt = treeDirt(ctx);
  if (dirt !== "") return refuseDirty(ctx, dirt, io);

  if (!tryCreateClaim(ctx)) {
    if (claimField(ctx, "holder") === ctx.agent) {
      io.out(`Already held by '${ctx.agent}'; nothing to take.`);
      reportHolder(ctx, io);
      return 0;
    }
    io.out(`Refused: '${ctx.ticket}' is already claimed by another agent.`);
    reportHolder(ctx, io);
    return 4;
  }
  writeClaimState(ctx, opts.operation);

  // A sibling can dirty the tree between the gate and the create; the residual
  // window is bounded by the create itself.
  const again = treeDirt(ctx);
  if (again !== "") {
    releaseClaimDir(ctx);
    ledgerAppend(ctx, "take-aborted", "tree became dirty inside the claim window");
    return refuseDirty(ctx, again, io);
  }

  ledgerAppend(ctx, "take", opts.operation);
  io.out(`Claimed '${ctx.ticket}' for '${ctx.agent}'.`);
  reportHolder(ctx, io);
  return 0;
}

export function cmdRelease(ctx: ClaimContext, io: Io): number {
  if (!claimExists(ctx)) {
    io.out(`Notice: '${ctx.ticket}' is not claimed; nothing to release.`);
    return 6;
  }
  const holder = claimField(ctx, "holder");
  if (holder !== ctx.agent) {
    io.out(`Refused: the claim on '${ctx.ticket}' is held by '${holder}', not by '${ctx.agent}'.`);
    reportHolder(ctx, io);
    return 4;
  }
  releaseClaimDir(ctx);
  ledgerAppend(ctx, "release", "");
  io.out(`Released '${ctx.ticket}' held by '${ctx.agent}'.`);
  io.out(`ledger: ${ctx.ledger}`);
  return 0;
}
