// seat-ledger-resolve.ts — cross-check and read path of a seat pass (spec 0275 R-B3, R-B5).
// Re-exported by seat-ledger.ts.

import {
  LedgerError,
  earlierRevision,
  parseLedger,
  rebuildFromVerdicts,
  reconstructFromLedger,
  type Disposition,
  type Finding,
  type Ledger,
  type Verdict,
} from "./seat-ledger-parse.ts";

export interface Mismatch {
  kind:
    | "ledger-unparsable"
    | "missing-finding"
    | "extra-finding"
    | "class"
    | "blocking"
    | "status-regressed"
    | "examined";
  detail: string;
}

export interface Resolution {
  state: "vacant" | "ledger" | "rebuilt";
  findings: Finding[];
  examined: string | null;
  mismatches: Mismatch[];
}

function nonVoid(verdicts: readonly Verdict[]): Verdict[] {
  return verdicts.filter((v) => !v.void);
}

export function crossCheck(
  ledger: Ledger,
  verdicts: readonly Verdict[],
  dispositions: readonly Disposition[] = [],
): Mismatch[] {
  const mism: Mismatch[] = [];
  const expected = new Map(rebuildFromVerdicts(verdicts, dispositions).map((f) => [f.id, f]));
  const held = new Map(ledger.findings.map((f) => [f.id, f]));
  const byDisp = new Map(dispositions.map((d) => [d.id, d]));
  for (const [id, e] of expected) {
    const h = held.get(id);
    if (!h) {
      mism.push({ kind: "missing-finding", detail: id });
      continue;
    }
    if (h.class !== e.class)
      mism.push({ kind: "class", detail: `${id}: ${h.class} != ${e.class}` });
    if (h.blocking !== e.blocking) mism.push({ kind: "blocking", detail: id });
    const d = byDisp.get(id);
    if (d && h.status === "open" && d.status !== "open")
      mism.push({ kind: "status-regressed", detail: `${id}: open, expected ${d.status}` });
  }
  for (const id of held.keys())
    if (!expected.has(id)) mism.push({ kind: "extra-finding", detail: id });
  const last = nonVoid(verdicts)
    .filter((v) => v.revision !== null)
    .at(-1);
  if (last && last.revision !== null && last.revision !== ledger.examined)
    mism.push({
      kind: "examined",
      detail: `ledger ${ledger.examined}, latest verdict ${last.revision}`,
    });
  return mism;
}

/**
 * Read path of a pass (R-B3, R-B5): the ledger when present and consistent; otherwise rebuilt
 * from the verdicts (verdicts win). No ledger and no non-void verdict is a vacant seat. `examined`
 * is the earlier of the ledger's and the latest verdict's revision.
 */
export function resolveSeat(input: {
  ledgerText: string | null;
  verdicts: readonly Verdict[];
  dispositions?: readonly Disposition[];
  order?: readonly string[];
  /** Restrict to one seat (a generation owns its ledger): verdicts of other seats are ignored. */
  seat?: string;
}): Resolution {
  const { ledgerText, dispositions = [], order, seat } = input;
  const verdicts =
    seat === undefined ? input.verdicts : input.verdicts.filter((v) => v.seat === seat);
  const live = nonVoid(verdicts);
  const lastRev = live.filter((v) => v.revision !== null).at(-1)?.revision ?? null;
  if (ledgerText === null) {
    if (live.length === 0 && verdicts.length === 0)
      return { state: "vacant", findings: [], examined: null, mismatches: [] };
    return {
      state: live.length === 0 ? "vacant" : "rebuilt",
      findings: rebuildFromVerdicts(verdicts, dispositions),
      examined: lastRev,
      mismatches: [],
    };
  }
  let ledger: Ledger;
  try {
    ledger = parseLedger(ledgerText);
  } catch (err) {
    if (!(err instanceof LedgerError)) throw err;
    return {
      state: "rebuilt",
      findings: rebuildFromVerdicts(verdicts, dispositions),
      examined: lastRev,
      mismatches: [{ kind: "ledger-unparsable", detail: err.message }],
    };
  }
  const mismatches = crossCheck(ledger, verdicts, dispositions);
  const examined =
    lastRev === null ? ledger.examined : earlierRevision(ledger.examined, lastRev, order);
  const content = mismatches.filter((m) => m.kind !== "examined");
  if (content.length > 0)
    return {
      state: "rebuilt",
      findings: rebuildFromVerdicts(verdicts, dispositions),
      examined,
      mismatches,
    };
  return { state: "ledger", findings: reconstructFromLedger(ledger), examined, mismatches };
}
