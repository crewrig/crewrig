// budget.ts — the cost ledger and guard (spec 0308 R8): a run starts only while the running cost
// plus its projected cost (the mean of the charged runs, the seed before any) stays under the cap. Pure and immutable.

export interface Ledger {
  cap: number;
  spent: number;
  charges: number[];
}

export function createLedger(cap: number): Ledger {
  return { cap, spent: 0, charges: [] };
}

/** Charge a run: its reported cost, or the per-run cap when none was reported. */
export function charge(l: Ledger, cost: number | null, perRunCap = 0.6): Ledger {
  const c = cost ?? perRunCap;
  return { ...l, spent: l.spent + c, charges: [...l.charges, c] };
}

/** The mean charged run, or `seed` (default the per-run cap) before any run was charged. */
export function projectedCost(l: Ledger, perRunCap: number, seed = perRunCap): number {
  return l.charges.length === 0 ? seed : l.spent / l.charges.length;
}

export function canStart(
  l: Ledger,
  perRunCap: number,
  seed = perRunCap,
): { ok: boolean; reason?: string } {
  const projected = projectedCost(l, perRunCap, seed);
  if (l.spent + projected < l.cap) return { ok: true };
  return {
    ok: false,
    reason: `cost guard: spent ${l.spent.toFixed(2)} + projected ${projected.toFixed(2)} reaches the ${l.cap} USD cap; continuing needs coordinator approval (--approved-cap)`,
  };
}

/** Per-run `--max-budget-usd`: the per-run cap, bounded by what remains of the cap. */
export function perRunBudget(l: Ledger, perRunCap: number): number {
  return Math.max(0, Math.min(perRunCap, l.cap - l.spent));
}
