// plan.ts — the pure decision core of the sampling plan (spec 0304 R2-R4, R11, R12).
//
// No file, clock, network or environment access. The runner and the attestation check both import
// it, so one set of recorded runs yields one decision in both. Every comparison is exact: rates
// are compared on integer counts against the plan's decimal constants (read as rationals), and
// the one-sided Fisher test is computed with BigInt (the exact hypergeometric distribution).
//
// Usage: poolState(runsPerItem, perStage, plan); decideSkill(input, plan); fisherOneSided(...).
// Exit codes: not applicable (library). Finding-line format: not applicable.

import { SAMPLING_PLAN } from "./settings.ts";

export interface PlanShape {
  readonly evalRunsPerStage: readonly [number, number];
  readonly probeRunsPerStage: readonly [number, number];
  readonly acceptStage1: number;
  readonly rejectStage1: number;
  readonly acceptFinal: number;
  readonly regression: { readonly test: string; readonly alpha: number; readonly minDrop: number };
}

/** The recorded runs of one pool: one array of pass flags per eval (or per probe), in run order. */
export type PoolRuns = readonly (readonly boolean[])[];
export interface Counts {
  readonly passes: number;
  readonly runs: number;
}
export type Stage1Verdict = "accepted" | "rejected" | "continue";
export type PoolVerdict = "accepted" | "rejected" | "pending";
export type SkillStatus = "in-progress" | "fail" | "regression" | "pass";

/** A decimal constant such as 0.9 as an exact fraction (no float arithmetic at the comparison). */
export function rational(x: number): { n: bigint; d: bigint } {
  const s = String(x);
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`not a plain decimal: ${s}`);
  const [, frac = ""] = s.split(".");
  return { n: BigInt(s.replace(".", "")), d: 10n ** BigInt(frac.length) };
}

/** passes / runs >= x, exactly (9 of 10 meets 0.90). */
export function atLeast(passes: number, runs: number, x: number): boolean {
  const { n, d } = rational(x);
  return BigInt(passes) * d >= n * BigInt(runs);
}

/** R2 stage 1: accepted at or above `acceptStage1`, rejected below `rejectStage1`, else continues. */
export function stage1Verdict(
  passes: number,
  runs: number,
  plan: PlanShape = SAMPLING_PLAN,
): Stage1Verdict {
  if (atLeast(passes, runs, plan.acceptStage1)) return "accepted";
  return atLeast(passes, runs, plan.rejectStage1) ? "continue" : "rejected";
}

/** R2 stage 2: the cumulative rate is accepted at or above `acceptFinal`. */
export function finalVerdict(
  passes: number,
  runs: number,
  plan: PlanShape = SAMPLING_PLAN,
): "accepted" | "rejected" {
  return atLeast(passes, runs, plan.acceptFinal) ? "accepted" : "rejected";
}

const count = (rows: PoolRuns): Counts => ({
  passes: rows.reduce((n, r) => n + r.filter(Boolean).length, 0),
  runs: rows.reduce((n, r) => n + r.length, 0),
});

export interface PoolState {
  readonly items: number;
  /** The stage the pool has reached: 2 once stage 1 left it continuing. */
  readonly stage: 1 | 2;
  readonly verdict: PoolVerdict;
  /** Cumulative counts over every recorded run. */
  readonly passes: number;
  readonly runs: number;
  /** The stage-1 decision, undefined while stage 1 is incomplete. */
  readonly stage1: Stage1Verdict | undefined;
  /** Missing runs of each item for the current stage (all zero once decided). */
  readonly remaining: readonly number[];
  /** Runs per item the stage path prescribes once decided (undefined while pending). */
  readonly prescribed: number | undefined;
}

/** R2, R4: the state of one pool from its recorded runs. An empty pool has no state (the caller skips it). */
export function poolState(
  rows: PoolRuns,
  perStage: readonly [number, number],
  plan: PlanShape = SAMPLING_PLAN,
): PoolState {
  const [n1, n2] = perStage;
  const total = count(rows);
  const base = { items: rows.length, passes: total.passes, runs: total.runs };
  const missing = (to: number) => rows.map((r) => Math.max(0, to - r.length));
  if (rows.some((r) => r.length < n1))
    return {
      ...base,
      stage: 1,
      verdict: "pending",
      stage1: undefined,
      remaining: missing(n1),
      prescribed: undefined,
    };
  const first = count(rows.map((r) => r.slice(0, n1)));
  const s1 = stage1Verdict(first.passes, first.runs, plan);
  if (s1 !== "continue")
    return {
      ...base,
      stage: 1,
      verdict: s1,
      stage1: s1,
      remaining: rows.map(() => 0),
      prescribed: n1,
    };
  if (rows.some((r) => r.length < n1 + n2))
    return {
      ...base,
      stage: 2,
      verdict: "pending",
      stage1: s1,
      remaining: missing(n1 + n2),
      prescribed: undefined,
    };
  return {
    ...base,
    stage: 2,
    verdict: finalVerdict(total.passes, total.runs, plan),
    stage1: s1,
    remaining: rows.map(() => 0),
    prescribed: n1 + n2,
  };
}

/** R4: the runs of a stage path: `items` times the runs of stage 1, plus stage 2 when it continues. */
export function stagePathRuns(
  items: number,
  perStage: readonly [number, number],
  continues: boolean,
): number {
  return items * (perStage[0] + (continues ? perStage[1] : 0));
}

/** R22(a): the plan maximum of executor runs of a skill (both stages for every eval and probe). */
export function planMaximum(
  evals: number,
  probes: number,
  plan: PlanShape = SAMPLING_PLAN,
): number {
  return (
    stagePathRuns(evals, plan.evalRunsPerStage, true) +
    stagePathRuns(probes, plan.probeRunsPerStage, true)
  );
}

const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? a : gcd(b, a % b));
const choose = (n: bigint, k: bigint): bigint => {
  if (k < 0n || k > n) return 0n;
  let r = 1n;
  for (let i = 1n; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
};

/** R12: p = P(X <= a), X hypergeometric (population n+m, a+b successes, n draws), as a reduced fraction. */
export function fisherOneSided(
  head: Counts,
  base: Counts,
): { readonly num: bigint; readonly den: bigint } {
  const n = BigInt(head.runs);
  const m = BigInt(base.runs);
  const big = n + m;
  const k = BigInt(head.passes + base.passes);
  const a = BigInt(head.passes);
  let num = 0n;
  for (let x = n - (big - k) > 0n ? n - (big - k) : 0n; x <= a; x++)
    num += choose(k, x) * choose(big - k, n - x);
  const den = choose(big, n);
  const g = gcd(num, den) || 1n;
  return { num: num / g, den: den / g };
}

export interface RegressionFigures {
  /** base rate minus head rate (a number for the report; the decision never uses it). */
  readonly drop: number;
  readonly pValue: number;
  readonly p: { readonly num: bigint; readonly den: bigint };
  readonly dropHolds: boolean;
  readonly pHolds: boolean;
  readonly holds: boolean;
}

const ratioNumber = (num: bigint, den: bigint): number =>
  den === 0n ? 0 : Number((num * 10n ** 12n) / den) / 1e12;

/** R12: the regression test, both conditions exact against the plan's decimal constants. */
export function regressionTest(
  head: Counts,
  base: Counts,
  plan: PlanShape = SAMPLING_PLAN,
): RegressionFigures {
  const n = BigInt(head.runs);
  const m = BigInt(base.runs);
  const md = rational(plan.regression.minDrop);
  // (b/m - a/n) >= minDrop  <=>  (b*n - a*m) * d >= minDropNum * m * n
  const diff = BigInt(base.passes) * n - BigInt(head.passes) * m;
  const dropHolds = diff * md.d >= md.n * m * n;
  const p = fisherOneSided(head, base);
  const al = rational(plan.regression.alpha);
  const pHolds = p.num * al.d < al.n * p.den;
  const drop = m === 0n || n === 0n ? 0 : ratioNumber(diff, m * n);
  return {
    drop,
    pValue: ratioNumber(p.num, p.den),
    p,
    dropHolds,
    pHolds,
    holds: dropHolds && pHolds,
  };
}

export interface SkillInput {
  readonly evals: PoolRuns;
  /** Empty or absent: the skill has no probe pool. */
  readonly probes?: PoolRuns | null;
  /** The figures of R12 over the common evals; null when the skill is not compared. */
  readonly compare?: { readonly head: Counts; readonly base: Counts } | null;
}

export interface SkillDecision {
  readonly status: SkillStatus;
  readonly evals: PoolState;
  readonly probes: PoolState | null;
  readonly stageReached: { readonly evals: 1 | 2; readonly probes: 1 | 2 | null };
  readonly regression: RegressionFigures | null;
}

/** R3: the status of a skill from its recorded runs, for the runner and the attestation alike. */
export function decideSkill(input: SkillInput, plan: PlanShape = SAMPLING_PLAN): SkillDecision {
  const evals = poolState(input.evals, plan.evalRunsPerStage, plan);
  const probes =
    input.probes === undefined || input.probes === null || input.probes.length === 0
      ? null
      : poolState(input.probes, plan.probeRunsPerStage, plan);
  const pools = probes === null ? [evals] : [evals, probes];
  const stageReached = { evals: evals.stage, probes: probes === null ? null : probes.stage };
  // R9: the measurement is `in-progress` while any pool still has runs to do, whatever the other pool
  // decided; `fail` is final only when every pool is decided.
  if (pools.some((p) => p.verdict === "pending"))
    return { status: "in-progress", evals, probes, stageReached, regression: null };
  if (pools.some((p) => p.verdict === "rejected"))
    return { status: "fail", evals, probes, stageReached, regression: null };
  const regression =
    input.compare === undefined || input.compare === null
      ? null
      : regressionTest(input.compare.head, input.compare.base, plan);
  return {
    status: regression?.holds === true ? "regression" : "pass",
    evals,
    probes,
    stageReached,
    regression,
  };
}
