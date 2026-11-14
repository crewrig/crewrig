// progress.ts — the live state of one measurement, its persistence and its report line (spec 0304
// R5-R7, R24).
//
// `persist` recomputes every derived figure of the record from its runs with plan.ts (so the file
// on disk always carries the decision the attestation will recompute), then rewrites the file
// atomically. `skillResult` turns the state into the report block.
//
// Usage: persist(live, now); skillResult(live, decision, mock).
// Exit codes: not applicable (library). Finding-line format: see report.ts.

import { decideRecord, fallenEvals, readBase } from "./base.ts";
import type { RunBudget } from "./budget.ts";
import type { Judge } from "./judge.ts";
import type { SkillDecision } from "./plan.ts";
import type { RunStatus, SkillResult } from "./report.ts";
import { writeResults } from "./results.ts";
import type { ResultsRecord } from "./results.ts";
import type { EvalsFile } from "./schema.ts";
import type { Selection } from "./select.ts";
import { RUN_ASSUMED_USD } from "./settings.ts";
import type { MeasureMeter } from "./spend.ts";

export interface LiveSkill {
  readonly sel: Selection;
  readonly evals: EvalsFile;
  readonly record: ResultsRecord;
  readonly priorRuns: number;
  readonly priorJudgeCalls: number;
  /** The base file as committed at the merge-base (R13), and the merge-base commit. */
  readonly baseText: string | undefined;
  readonly mergeBase: string;
  readonly budget: RunBudget;
  readonly judge: Judge;
  readonly meter: MeasureMeter;
  readonly controller: AbortController;
  /** False in mock mode: no results file is written. */
  readonly write: boolean;
  /** R10: the branch entries including the current measurement. */
  readonly branchCount: number;
  /** Set when the skill ended in error (cap, second failure of a slot, write failure). */
  stop: string | undefined;
  evidence: { accepted: number; window: number };
}

const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

/** Recompute the derived figures of the record from its runs and the live counters. */
export function applyDecision(s: LiveSkill, now: string): SkillDecision {
  const r = s.record;
  const { decision, comparison } = decideRecord(
    r.evals,
    r.probes,
    r.skill_name,
    s.baseText,
    s.mergeBase,
  );
  r.status = decision.status;
  r.stage_reached = decision.stageReached;
  r.eval_passes = decision.evals.passes;
  r.eval_runs = decision.evals.runs;
  r.eval_pass_rate = decision.evals.runs === 0 ? 0 : decision.evals.passes / decision.evals.runs;
  const p = decision.probes;
  r.probe_passes = p?.passes ?? 0;
  r.probe_runs = p?.runs ?? 0;
  r.probe_pass_rate = p === null ? null : p.runs === 0 ? 0 : p.passes / p.runs;
  const final = decision.status !== "in-progress";
  r.base = final && comparison !== null ? comparison.block : null;
  r.regression =
    decision.regression === null
      ? null
      : { drop: round6(decision.regression.drop), p_value: round6(decision.regression.pValue) };
  r.executor_runs = s.priorRuns + s.budget.used;
  r.judge_calls = s.priorJudgeCalls + s.judge.callsUsed();
  r.cost_usd = s.meter.costUsd;
  r.judge_cost_usd = s.meter.judgeCostUsd;
  r.date = now;
  return decision;
}

/** Recompute, then rewrite `evals/results.json` atomically (a mock run writes nothing). */
export function persist(s: LiveSkill, now: string): SkillDecision {
  const d = applyDecision(s, now);
  if (s.write) writeResults(s.sel.skill.dirAbs, s.record);
  return d;
}

/** The report block of a measurement that ran (or was finalised) in this invocation. */
export function skillResult(
  s: LiveSkill,
  d: SkillDecision,
  mock: boolean,
  blocking: boolean,
  messages: string[],
  status?: RunStatus,
): SkillResult {
  const r = s.record;
  const baseDoc = readBase(s.baseText, r.skill_name);
  const cmp = decideRecord(r.evals, r.probes, r.skill_name, s.baseText, s.mergeBase).comparison;
  const judgedEvals = new Set(
    s.evals.evals.filter((e) => e.expectations.length > 0).map((e) => e.id),
  );
  const judgedRuns = r.evals.filter((e) => judgedEvals.has(e.id)).flatMap((e) => e.runs);
  return {
    skill: r.skill_name,
    status: status ?? (mock ? "mock" : d.status),
    blocking,
    evalPasses: d.evals.passes,
    evalRuns: d.evals.runs,
    evalStage: d.stageReached.evals,
    ...(d.probes === null
      ? {}
      : { probePasses: d.probes.passes, probeRuns: d.probes.runs, probeStage: d.probes.stage }),
    base:
      cmp === null
        ? null
        : { passes: cmp.base.passes, runs: cmp.base.runs, legacy: cmp.block.schema_version === 1 },
    drop: d.regression?.drop ?? null,
    pValue: d.regression?.pValue ?? null,
    skillLoaded: r.evals.flatMap((e) => e.runs).filter((x) => x.skill_loaded).length,
    evidenceAccepted: s.evidence.accepted,
    evidenceWindow: s.evidence.window,
    judged: judgedRuns.length,
    reasked: judgedRuns.filter((x) => x.reasked).length,
    branch: s.branchCount,
    evalCounts: r.evals.map((e) => ({
      id: e.id,
      passes: e.runs.filter((x) => x.passed).length,
      runs: e.runs.length,
    })),
    fallen: fallenEvals(r.evals, baseDoc),
    executorRuns: r.executor_runs,
    judgeCalls: r.judge_calls,
    costUsd: r.cost_usd,
    ...(r.cost_usd === null ? { costLowerBound: lowerBound(r) } : {}),
    ...(!s.meter.reported && r.executor_runs > 0
      ? { costAssumedUsd: r.executor_runs * RUN_ASSUMED_USD }
      : {}),
    judgeCostUsd: r.judge_cost_usd,
    messages,
  };
}

const lowerBound = (r: ResultsRecord): number =>
  r.evals.flatMap((e) => e.runs).reduce((n, x) => n + (x.cost_usd ?? 0), 0);
