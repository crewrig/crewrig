// claim-state.ts — the single definition of claim state (spec 0248 R3).
//
// `status` prints from `claimStateFor` and the guard decides from
// `readClaimState`, which is `claimStateFor` over a freshly resolved context, so
// the guard's verdict equals the `state:` line by construction. Standard library
// and sibling modules only: the guard loads this graph lazily (R11).

import fs from "node:fs";
import path from "node:path";
import { ledgerExists, ledgerLastField } from "./ledger.ts";
import { isValidTicket, resolveContext } from "./repo.ts";
import type { ClaimContext, ClaimState, Env } from "./types.ts";

/** `[ -d "$CLAIM_DIR" ]`: an empty claim directory still reads `claimed`. */
export function claimExists(ctx: ClaimContext): boolean {
  try {
    return fs.statSync(ctx.claimDir).isDirectory();
  } catch {
    return false;
  }
}

/** One claim file as `$(cat …)` reads it: no trailing line feeds, empty when absent. */
export function claimField(ctx: ClaimContext, name: string): string {
  const file = path.join(ctx.claimDir, name);
  try {
    if (!fs.statSync(file).isFile()) return "";
    return fs.readFileSync(file, "utf8").replace(/\n+$/, "");
  } catch {
    return "";
  }
}

/** The state of the ticket of an already resolved context. */
export function claimStateFor(ctx: ClaimContext): ClaimState {
  if (claimExists(ctx)) {
    return {
      state: "claimed",
      holder: claimField(ctx, "holder"),
      since: claimField(ctx, "since"),
      operation: claimField(ctx, "operation"),
    };
  }
  if (!ledgerExists(ctx.ledger)) return { state: "unclaimed" };
  return {
    state: "unclaimed",
    last: {
      action: ledgerLastField(ctx.ledger, 2),
      holder: ledgerLastField(ctx.ledger, 3),
      at: ledgerLastField(ctx.ledger, 1),
    },
  };
}

/**
 * The state of `ticket` in the repository that contains `cwd` (or
 * `CREWRIG_REPO_DIR` when set and non-empty, as `git_here` read it). A ticket
 * the shell tool would refuse, such as `..` taken from a payload path, and any
 * failure to resolve the repository return `undetermined`: never `claimed`.
 */
export function readClaimState(input: {
  readonly env: Env;
  readonly cwd: string;
  readonly ticket: string;
  readonly platform?: NodeJS.Platform;
}): ClaimState {
  const platform = input.platform ?? process.platform;
  if (!isValidTicket(input.ticket, platform)) {
    return { state: "undetermined", reason: `invalid ticket '${input.ticket}'` };
  }
  const override = input.env["CREWRIG_REPO_DIR"];
  const repoDir = override === undefined || override === "" ? input.cwd : override;
  try {
    const resolved = resolveContext({
      repoDir,
      subcommand: "status",
      ticket: input.ticket,
      agent: "",
      platform,
    });
    if (!resolved.ok) return { state: "undetermined", reason: resolved.message };
    return claimStateFor(resolved.ctx);
  } catch (error) {
    return {
      state: "undetermined",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
