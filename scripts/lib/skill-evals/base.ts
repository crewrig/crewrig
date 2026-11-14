// base.ts — the base of the regression test and the one decision taken over a record (spec 0304
// R12, R13).
//
// The base is the `evals/results.json` committed at the merge-base, read from that tree and never
// re-measured. A schema-2 base (a final status, not a mock, naming the skill) contributes the
// recorded runs of the evals present on both sides with equal `case_hash`; a schema-1 base is
// legacy (legacy.ts) and widens the head side to all evals. A base that is absent, unreadable,
// `in-progress` or without a common eval is not compared. The runner and the attestation both call
// `decideRecord`, so one record yields one status in both.
//
// Usage: readBase(text, skillName); decideRecord(record, baseText, mergeBase).
// Exit codes: not applicable (library). Finding-line format: not applicable.

import { legacyCounts } from "./legacy.ts";
import { decideSkill } from "./plan.ts";
import type { Counts, SkillDecision } from "./plan.ts";
import { parseResults, RESULT_STATUSES } from "./results.ts";
import type { BaseBlock, EvalEntry, ProbeEntry } from "./results.ts";

export type BaseDoc =
  | { readonly kind: "legacy"; readonly counts: Counts }
  | {
      readonly kind: "v2";
      readonly evals: readonly { caseHash: string; runs: readonly boolean[] }[];
    };

export function readBase(text: string | undefined, skillName: string): BaseDoc | undefined {
  const p = parseResults(text);
  if (p.kind === "v1") {
    const counts = legacyCounts(p.doc, skillName);
    return counts === undefined ? undefined : { kind: "legacy", counts };
  }
  if (p.kind !== "v2") return undefined;
  const d = p.doc;
  if (d["skill_name"] !== skillName) return undefined;
  if (!(RESULT_STATUSES as readonly unknown[]).includes(d["status"])) return undefined;
  if (!Array.isArray(d["evals"])) return undefined;
  const evals: { caseHash: string; runs: boolean[] }[] = [];
  for (const e of d["evals"] as Record<string, unknown>[]) {
    if (typeof e?.["case_hash"] !== "string" || !Array.isArray(e["runs"])) return undefined;
    evals.push({
      caseHash: e["case_hash"],
      runs: (e["runs"] as Record<string, unknown>[]).map((r) => r?.["passed"] === true),
    });
  }
  return { kind: "v2", evals };
}

const sum = (rows: readonly (readonly boolean[])[]): Counts => ({
  passes: rows.reduce((n, r) => n + r.filter(Boolean).length, 0),
  runs: rows.reduce((n, r) => n + r.length, 0),
});

export interface Comparison {
  readonly block: BaseBlock;
  readonly head: Counts;
  readonly base: Counts;
}

/** R12, R13: the figures over the common evals, or null when the skill is not compared. */
export function compareBase(
  headEvals: readonly EvalEntry[],
  base: BaseDoc | undefined,
  mergeBase: string,
): Comparison | null {
  if (base === undefined) return null;
  if (base.kind === "legacy") {
    return {
      block: {
        merge_base: mergeBase,
        schema_version: 1,
        passes: base.counts.passes,
        runs: base.counts.runs,
        common_evals: headEvals.length,
      },
      head: sum(headEvals.map((e) => e.runs.map((r) => r.passed))),
      base: base.counts,
    };
  }
  const bycase = new Map(base.evals.map((e) => [e.caseHash, e.runs]));
  const common = headEvals.filter((e) => bycase.has(e.case_hash));
  if (common.length === 0) return null;
  const b = sum(common.map((e) => bycase.get(e.case_hash) ?? []));
  return {
    block: {
      merge_base: mergeBase,
      schema_version: 2,
      passes: b.passes,
      runs: b.runs,
      common_evals: common.length,
    },
    head: sum(common.map((e) => e.runs.map((r) => r.passed))),
    base: b,
  };
}

/** The decision over a record's runs against a base file's text (R3, R12, R13). */
export function decideRecord(
  evals: readonly EvalEntry[],
  probes: readonly ProbeEntry[],
  skillName: string,
  baseText: string | undefined,
  mergeBase: string,
): { decision: SkillDecision; comparison: Comparison | null } {
  const comparison = compareBase(evals, readBase(baseText, skillName), mergeBase);
  const decision = decideSkill({
    evals: evals.map((e) => e.runs.map((r) => r.passed)),
    probes: probes.map((p) => p.runs),
    compare: comparison === null ? null : { head: comparison.head, base: comparison.base },
  });
  return { decision, comparison };
}

/** R24: the ids of the common evals whose pass fraction fell by 0.5 or more against the base (a diagnostic only). */
export function fallenEvals(headEvals: readonly EvalEntry[], base: BaseDoc | undefined): number[] {
  if (base === undefined || base.kind !== "v2") return [];
  const bycase = new Map(base.evals.map((e) => [e.caseHash, e.runs]));
  const out: number[] = [];
  for (const e of headEvals) {
    const b = bycase.get(e.case_hash);
    if (b === undefined || b.length === 0 || e.runs.length === 0) continue;
    const bp = b.filter(Boolean).length;
    const hp = e.runs.filter((r) => r.passed).length;
    // bp/bn - hp/hn >= 1/2, on integers
    if ((bp * e.runs.length - hp * b.length) * 2 >= b.length * e.runs.length) out.push(e.id);
  }
  return out;
}
