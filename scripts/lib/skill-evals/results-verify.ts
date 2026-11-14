// results-verify.ts — the shape of a schema-2 results file and the recorded status that must follow
// from the recorded runs (spec 0304 R6, R11).
//
// `shapeProblem` checks that every key of R6 is present and of the right type. `verifyRecord`
// recomputes from the recorded runs, with plan.ts: the per-pool counts and rates, `stage_reached`,
// the number of runs the stage path prescribes for every eval and probe, and the status, taking the
// recorded `base` block as the base figures when it equals the one the current merge-base file
// gives. A file that differs from the recomputation anywhere is `invalid`; the reason names the
// first difference. The verifier proves consistency, not truth (0290 R38).
//
// Usage: verifyRecord(doc, { skillName, baseText, mergeBase }). Exit codes: not applicable (library).
// Finding-line format: not applicable.

import { decideRecord } from "./base.ts";
import type { Comparison } from "./base.ts";
import type { SkillDecision } from "./plan.ts";
import { KEYS, RESULT_STATUSES } from "./results.ts";
import type { ResultsRecord } from "./results.ts";
import { micros } from "./spend.ts";

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): boolean => typeof v === "number" && Number.isFinite(v);
const numOrNull = (v: unknown): boolean => v === null || num(v);
const CASE_HASH = /^sha256:[0-9a-f]{64}$/;

const SCALARS: Record<string, (v: unknown) => boolean> = {
  schema_version: (v) => v === 2,
  skill_name: (v) => typeof v === "string",
  content_hash: (v) => typeof v === "string",
  runner_version: (v) => typeof v === "string",
  executor_model: (v) => typeof v === "string",
  judge_model: (v) => typeof v === "string",
  effort: (v) => typeof v === "string",
  plan: isObj,
  ticket: (v) => typeof v === "string",
  declared_at: (v) => typeof v === "string",
  date: (v) => typeof v === "string",
  status: (v) => v === "in-progress" || (RESULT_STATUSES as readonly unknown[]).includes(v),
  stage_reached: (v) => isObj(v) && "evals" in v && "probes" in v,
  evals: Array.isArray,
  probes: Array.isArray,
  eval_passes: num,
  eval_runs: num,
  eval_pass_rate: num,
  probe_passes: num,
  probe_runs: num,
  probe_pass_rate: numOrNull,
  base: (v) => v === null || isObj(v),
  regression: (v) => v === null || isObj(v),
  errors: Array.isArray,
  executor_runs: num,
  judge_calls: num,
  cost_usd: numOrNull,
  judge_cost_usd: numOrNull,
  ledger: Array.isArray,
};

/** R6, R11: a key that is missing or of the wrong type, or undefined. */
export function shapeProblem(doc: Record<string, unknown>): string | undefined {
  for (const k of KEYS) {
    if (!(k in doc)) return `evals/results.json lacks the key ${k}`;
    if (SCALARS[k]?.(doc[k]) !== true) return `evals/results.json: the key ${k} has the wrong type`;
  }
  for (const [i, e] of (doc["evals"] as unknown[]).entries()) {
    if (
      !isObj(e) ||
      !num(e["id"]) ||
      typeof e["case_hash"] !== "string" ||
      !CASE_HASH.test(e["case_hash"])
    )
      return `evals/results.json: evals[${i}] needs an id and a sha256 case_hash`;
    if (!Array.isArray(e["runs"])) return `evals/results.json: evals[${i}].runs is not an array`;
    for (const [j, r] of (e["runs"] as unknown[]).entries())
      if (
        !isObj(r) ||
        typeof r["passed"] !== "boolean" ||
        typeof r["assertions"] !== "string" ||
        !/^[01]*$/.test(r["assertions"]) ||
        typeof r["skill_loaded"] !== "boolean" ||
        !numOrNull(r["cost_usd"]) ||
        typeof r["reasked"] !== "boolean"
      )
        return `evals/results.json: evals[${i}].runs[${j}] is malformed`;
  }
  for (const [i, p] of (doc["probes"] as unknown[]).entries())
    if (
      !isObj(p) ||
      !num(p["index"]) ||
      typeof p["should_trigger"] !== "boolean" ||
      !Array.isArray(p["runs"]) ||
      (p["runs"] as unknown[]).some((x) => typeof x !== "boolean")
    )
      return `evals/results.json: probes[${i}] is malformed`;
  return undefined;
}

const close = (a: number | null, b: number | null): boolean =>
  a === null || b === null ? a === b : Math.abs(a - b) < 1e-9;

export type Verified =
  | {
      readonly ok: true;
      readonly record: ResultsRecord;
      /** The recomputation against the base file as it stands now. */
      readonly decision: SkillDecision;
      readonly comparison: Comparison | null;
    }
  | { readonly ok: false; readonly reason: string };

export interface VerifyContext {
  readonly skillName: string;
  /** `evals/results.json` at the merge-base as it stands now (R13). */
  readonly baseText: string | undefined;
  readonly mergeBase: string;
}

/** R11: every recorded figure and the recorded status must follow from the recorded runs. */
export function verifyRecord(doc: Record<string, unknown>, ctx: VerifyContext): Verified {
  const bad = (reason: string): Verified => ({ ok: false, reason });
  const shape = shapeProblem(doc);
  if (shape !== undefined) return bad(shape);
  const r = doc as unknown as ResultsRecord;
  const { decision, comparison } = decideRecord(
    r.evals,
    r.probes,
    ctx.skillName,
    ctx.baseText,
    ctx.mergeBase,
  );
  for (const ev of r.evals)
    for (const [k, run] of ev.runs.entries())
      if (run.passed !== (run.assertions !== "" && !run.assertions.includes("0")))
        return bad(
          `eval ${ev.id} run ${k + 1} records passed ${String(run.passed)} but its assertions are "${run.assertions}"`,
        );
  const recordedRuns =
    r.evals.reduce((n, x) => n + x.runs.length, 0) +
    r.probes.reduce((n, x) => n + x.runs.length, 0);
  if (r.executor_runs < recordedRuns)
    return bad(`executor_runs ${r.executor_runs} is below the ${recordedRuns} recorded runs`);
  // integer micro-dollars, as the runner sums them: no float drift across resume sessions
  const runMicros = r.evals.flatMap((x) => x.runs).reduce((n, x) => n + micros(x.cost_usd ?? 0), 0);
  if (r.cost_usd !== null && micros(r.cost_usd) < runMicros)
    return bad(`cost_usd ${r.cost_usd} is below the ${runMicros / 1e6} of the recorded eval runs`);
  const e = decision.evals;
  const p = decision.probes;
  const diff = (name: string, recorded: unknown, computed: unknown): Verified =>
    bad(
      `recorded ${name} ${JSON.stringify(recorded)} differs from the recomputed ${JSON.stringify(computed)}`,
    );
  if (r.eval_passes !== e.passes) return diff("eval_passes", r.eval_passes, e.passes);
  if (r.eval_runs !== e.runs) return diff("eval_runs", r.eval_runs, e.runs);
  const evalRate = e.runs === 0 ? 0 : e.passes / e.runs;
  if (!close(r.eval_pass_rate, evalRate)) return diff("eval_pass_rate", r.eval_pass_rate, evalRate);
  if (r.probe_passes !== (p?.passes ?? 0))
    return diff("probe_passes", r.probe_passes, p?.passes ?? 0);
  if (r.probe_runs !== (p?.runs ?? 0)) return diff("probe_runs", r.probe_runs, p?.runs ?? 0);
  const probeRate = p === null ? null : p.runs === 0 ? 0 : p.passes / p.runs;
  if (!close(r.probe_pass_rate, probeRate))
    return diff("probe_pass_rate", r.probe_pass_rate, probeRate);
  if (
    r.stage_reached.evals !== decision.stageReached.evals ||
    r.stage_reached.probes !== decision.stageReached.probes
  )
    return diff("stage_reached", r.stage_reached, decision.stageReached);
  const pools: [string, readonly { id: number; n: number }[], typeof e | null][] = [
    ["eval", r.evals.map((x) => ({ id: x.id, n: x.runs.length })), e],
    ["probe", r.probes.map((x) => ({ id: x.index, n: x.runs.length })), p],
  ];
  const plan = r.plan;
  for (const [kind, items, st] of pools) {
    if (st === null) continue;
    const perStage = kind === "eval" ? plan.evalRunsPerStage : plan.probeRunsPerStage;
    const want =
      st.prescribed ??
      (st.stage1 === undefined ? perStage[0] : (perStage[0] ?? 0) + (perStage[1] ?? 0));
    if (st.verdict === "pending" && r.status !== "in-progress")
      return bad(
        `status ${r.status} is recorded while the ${kind} pool has not run its ${st.stage === 1 ? "first" : "second"} stage in full (${kind} runs ${st.runs})`,
      );
    if (st.verdict === "pending") continue;
    for (const it of items)
      if (it.n !== want)
        return bad(`${kind} ${it.id} holds ${it.n} runs; the stage path prescribes ${want}`);
  }
  if (r.status === "in-progress") return { ok: true, record: r, decision, comparison };
  const failed = decision.status === "fail";
  if ((r.status === "fail") !== failed)
    return bad(`recorded status ${r.status} differs from the recomputed status ${decision.status}`);
  const sameBase = JSON.stringify(r.base) === JSON.stringify(comparison?.block ?? null);
  if (sameBase && r.status !== decision.status)
    return bad(`recorded status ${r.status} differs from the recomputed status ${decision.status}`);
  if (sameBase && !failed) {
    const want = decision.regression;
    const got = r.regression;
    if ((want === null) !== (got === null))
      return bad("recorded regression block differs from the recomputed one");
    if (
      want !== null &&
      got !== null &&
      (Math.abs(want.drop - got.drop) > 1e-6 || Math.abs(want.pValue - got.p_value) > 1e-6)
    )
      return diff("regression", got, { drop: want.drop, p_value: want.pValue });
  }
  return { ok: true, record: r, decision, comparison };
}
