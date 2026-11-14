// legacy.ts — the schema-1 results file read as a base (spec 0304 R13, R26).
//
// A schema-1 file (the keys of 0290 R36 as modified by delta-04, not a mock, naming the skill) is
// *legacy*: it contributes `evals_passed` over `evals_total` as one run each, over all its evals.
// It is never rewritten and never re-measured; it is not carried into any ledger.
//
// Usage: legacyCounts(doc, skillName). Exit codes: not applicable (library).
// Finding-line format: not applicable.

import { RESULT_STATUSES } from "./results.ts";
import type { Counts } from "./plan.ts";

export function legacyCounts(doc: Record<string, unknown>, skillName: string): Counts | undefined {
  if (doc["mock"] === true || doc["skill_name"] !== skillName) return undefined;
  if (!(RESULT_STATUSES as readonly unknown[]).includes(doc["status"])) return undefined;
  const passes = doc["evals_passed"];
  const runs = doc["evals_total"];
  if (typeof passes !== "number" || typeof runs !== "number" || runs <= 0 || passes < 0)
    return undefined;
  return { passes, runs };
}
