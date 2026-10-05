// store.ts — the claim directory (spec 0248 R17, R18).
//
// A claim is the directory `<claim root>/<ticket>/`, created by an operation
// that fails when it already exists: an atomic create-or-fail, no lock file, no
// polling and no retry. Its four files are one line each, ending in a line feed.

import fs from "node:fs";
import path from "node:path";
import { claimExists, claimField } from "./claim-state.ts";
import { nowEpoch, nowIso } from "./clock.ts";
import { ensureClaimRoot } from "./ledger.ts";
import type { ClaimContext, Io } from "./types.ts";

export { claimExists, claimField };

/**
 * The only place a claim comes into existence. True when this call created the
 * directory; false when it was already there. As the shell tool's `mkdir`, any
 * failure to create it reads as "held".
 */
export function tryCreateClaim(ctx: ClaimContext): boolean {
  ensureClaimRoot(ctx);
  try {
    fs.mkdirSync(ctx.claimDir);
    return true;
  } catch {
    return false;
  }
}

/** Write `holder`, `since`, `since_epoch` and `operation`, as the shell tool did. */
export function writeClaimState(ctx: ClaimContext, operation: string): void {
  fs.writeFileSync(path.join(ctx.claimDir, "holder"), `${ctx.agent}\n`);
  fs.writeFileSync(path.join(ctx.claimDir, "since"), `${nowIso()}\n`);
  fs.writeFileSync(path.join(ctx.claimDir, "since_epoch"), `${nowEpoch()}\n`);
  fs.writeFileSync(path.join(ctx.claimDir, "operation"), `${operation}\n`);
}

/** Remove the claim directory when it exists; the ledger is a sibling and stays. */
export function releaseClaimDir(ctx: ClaimContext): void {
  if (claimExists(ctx)) fs.rmSync(ctx.claimDir, { recursive: true, force: true });
}

/** The five-line holder report every refusal and success message ends with. */
export function reportHolder(ctx: ClaimContext, io: Io): void {
  io.out(`ticket: ${ctx.ticket}`);
  io.out(`holder: ${claimField(ctx, "holder")}`);
  io.out(`since: ${claimField(ctx, "since")}`);
  io.out(`operation: ${claimField(ctx, "operation")}`);
  io.out(`claim-dir: ${ctx.claimDir}`);
}
