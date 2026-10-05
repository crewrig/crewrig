// ledger.ts — the append-only ledger (spec 0248 R17, R18).
//
// `<claim root>/<ticket>.log`, a sibling of the claim directory and never a
// child, so releasing a claim cannot remove its history. One line per event of
// five tab-separated fields: timestamp, action, agent, ticket, detail.

import fs from "node:fs";
import { nowIso } from "./clock.ts";
import { ClaimFailure } from "./types.ts";
import type { ClaimContext } from "./types.ts";

/** A tab or a line break in a free-text field would forge a column or a row. */
export function flatten(text: string): string {
  return text.replace(/[\t\n\r]/g, " ");
}

/** Append one event line, creating the claim root when it does not exist yet. */
export function ledgerAppend(ctx: ClaimContext, action: string, detail = ""): void {
  ensureClaimRoot(ctx);
  const fields = [
    nowIso(),
    flatten(action),
    flatten(ctx.agent),
    flatten(ctx.ticket),
    flatten(detail),
  ];
  // The detail of a `run` line is the wrapped argv: owner-only on creation (the
  // mode is ignored where the platform has no POSIX modes).
  fs.appendFileSync(ctx.ledger, `${fields.join("\t")}\n`, { mode: 0o600 });
}

/** `mkdir -p <claim root>`, with the shell tool's diagnostic when it cannot. */
export function ensureClaimRoot(ctx: ClaimContext): void {
  try {
    fs.mkdirSync(ctx.claimRoot, { recursive: true });
  } catch {
    throw new ClaimFailure(
      `cannot create '${ctx.claimRoot}' — the git common directory is not writable.`,
    );
  }
}

export function ledgerExists(ledger: string): boolean {
  try {
    return fs.statSync(ledger).isFile();
  } catch {
    return false;
  }
}

/**
 * Field `n` (1-based) of the ledger's last line, or the empty string.
 * `tail -n 1 | cut -f n`: a line with no tab is printed whole by `cut`.
 */
export function ledgerLastField(ledger: string, n: number): string {
  if (!ledgerExists(ledger)) return "";
  const content = fs.readFileSync(ledger, "utf8");
  const text = content.endsWith("\n") ? content.slice(0, -1) : content;
  const line = text.slice(text.lastIndexOf("\n") + 1);
  if (!line.includes("\t")) return line;
  return line.split("\t")[n - 1] ?? "";
}

/** `wc -l` of the ledger: the number of line feeds. */
export function ledgerEntryCount(ledger: string): number {
  let count = 0;
  for (const byte of fs.readFileSync(ledger)) if (byte === 0x0a) count++;
  return count;
}
