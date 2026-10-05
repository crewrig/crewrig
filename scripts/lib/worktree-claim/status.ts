// status.ts — the read-only subcommands `status` and `history` (spec 0248 R3, R16).
//
// Neither carries the `.worktrees/` guard: they answer from the main checkout
// after the worktree has been removed, which is when an investigation runs.

import fs from "node:fs";
import { claimStateFor } from "./claim-state.ts";
import { ledgerEntryCount, ledgerExists } from "./ledger.ts";
import type { ClaimContext, Io } from "./types.ts";

export function cmdStatus(ctx: ClaimContext, io: Io): number {
  io.out(`ticket: ${ctx.ticket}`);
  io.out(`claim-root: ${ctx.claimRoot}`);
  io.out(`claim-dir: ${ctx.claimDir}`);
  io.out(`ledger: ${ctx.ledger}`);
  const state = claimStateFor(ctx);
  if (state.state === "claimed") {
    io.out("state: claimed");
    io.out(`holder: ${state.holder}`);
    io.out(`since: ${state.since}`);
    io.out(`operation: ${state.operation}`);
  } else {
    io.out("state: unclaimed");
    if (state.state === "unclaimed" && state.last !== undefined) {
      // An investigation that asks after the claim is gone still gets a name.
      io.out(`last-action: ${state.last.action}`);
      io.out(`last-holder: ${state.last.holder}`);
      io.out(`last-at: ${state.last.at}`);
    }
  }
  return 0;
}

export function cmdHistory(ctx: ClaimContext, io: Io): number {
  io.out(`ticket: ${ctx.ticket}`);
  io.out(`claim-root: ${ctx.claimRoot}`);
  io.out(`ledger: ${ctx.ledger}`);
  if (ledgerExists(ctx.ledger)) {
    io.out(`entries: ${ledgerEntryCount(ctx.ledger)}`);
    io.out("");
    io.raw(fs.readFileSync(ctx.ledger));
  } else {
    io.out("entries: 0");
  }
  return 0;
}
