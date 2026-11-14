// orchestrate.ts — the experiment loop (spec 0308 R8-R10): pairs the arms (A1 B1 A2 B2), reruns an
// invalid run once, extends a diverging scenario to 5 runs per arm, and stops at the cost guard.
// The model call is an injected `execute`, so the loop is testable without a model.

import { canStart, charge, createLedger, perRunBudget } from "./budget.ts";
import type { Ledger } from "./budget.ts";
import { applyTruncationRule, scenarioVerdict } from "./compare.ts";
import type { AttemptRecord, RunRecord, ScenarioVerdict } from "./compare.ts";
import { scoreRun } from "./criteria.ts";
import type { Scenario } from "./scenarios.ts";

export interface ExecuteRequest {
  scenario: Scenario;
  arm: "A" | "B";
  runIndex: number;
  /** 1 for the run, 2 for its single rerun. */
  attempt: number;
  maxBudgetUsd: number;
}
export interface ExecuteResult {
  transcript: string | null;
  callLog: string | null;
}
export type ExecuteFn = (req: ExecuteRequest) => Promise<ExecuteResult>;

export interface ExperimentOptions {
  scenarios: Scenario[];
  execute: ExecuteFn;
  /** Runs per arm before any extension. */
  runs?: number;
  /** Runs per arm after an extension. */
  extendTo?: number;
  cap?: number;
  perRunCap?: number;
  /** Records of an earlier, stopped invocation (resume). */
  prior?: RunRecord[];
  onRecord?: (r: RunRecord) => void;
}

export interface ExperimentResult {
  records: RunRecord[];
  ledger: Ledger;
  stopped: { reason: string } | null;
  verdicts: Record<number, ScenarioVerdict>;
}

const isComplete = (r: RunRecord): boolean => r.status !== "invalid" || r.attempts.length >= 2;

export async function runExperiment(o: ExperimentOptions): Promise<ExperimentResult> {
  const runs = o.runs ?? 2;
  const extendTo = o.extendTo ?? 5;
  const perRunCap = o.perRunCap ?? 0.6;
  let ledger = createLedger(o.cap ?? 12);
  const records: RunRecord[] = [];
  const verdicts: Record<number, ScenarioVerdict> = {};
  let stopped: { reason: string } | null = null;

  for (const p of o.prior ?? []) {
    for (const a of p.attempts) ledger = charge(ledger, a.charged, perRunCap);
    if (isComplete(p)) records.push(p);
  }
  const find = (s: number, arm: string, idx: number) => records.find((r) => r.scenario === s && r.arm === arm && r.runIndex === idx);

  async function executeRun(scenario: Scenario, arm: "A" | "B", runIndex: number): Promise<boolean> {
    const attempts: AttemptRecord[] = [];
    const truncs: boolean[] = [];
    for (let attempt = 1; attempt <= 2; attempt++) {
      const guard = canStart(ledger, perRunCap);
      if (!guard.ok) {
        stopped = { reason: guard.reason ?? "cost guard" };
        if (attempts.length > 0) {
          // charged but unfinished: keep the spend visible; a resume reruns this cell
          const rec: RunRecord = { scenario: scenario.id, arm, runIndex, attempts, status: "invalid", truncatedTwice: false };
          records.push(rec);
          o.onRecord?.(rec);
        }
        return false;
      }
      const res = await o.execute({ scenario, arm, runIndex, attempt, maxBudgetUsd: perRunBudget(ledger, perRunCap) });
      const score = scoreRun(scenario.id, res);
      const before = ledger.spent;
      ledger = charge(ledger, score.costUsd, perRunCap);
      attempts.push({
        status: score.status,
        note: score.note,
        subtype: score.subtype,
        costUsd: score.costUsd,
        charged: ledger.spent - before,
        firstCallTokens: score.firstCallTokens,
      });
      truncs.push(score.truncated);
      if (score.status !== "invalid") break;
    }
    const last = attempts[attempts.length - 1] as AttemptRecord;
    const rec: RunRecord = {
      scenario: scenario.id,
      arm,
      runIndex,
      attempts,
      status: last.status,
      truncatedTwice: attempts.length === 2 && truncs.every(Boolean),
    };
    records.push(rec);
    o.onRecord?.(rec);
    return true;
  }

  async function ensureRuns(scenario: Scenario, upTo: number): Promise<boolean> {
    for (let idx = 1; idx <= upTo; idx++) {
      for (const arm of ["A", "B"] as const) {
        if (find(scenario.id, arm, idx)) continue;
        if (!(await executeRun(scenario, arm, idx))) return false;
      }
    }
    return true;
  }

  function verdictOf(scenario: Scenario): ScenarioVerdict {
    const a = records.filter((r) => r.scenario === scenario.id && r.arm === "A" && isComplete(r)).sort((x, y) => x.runIndex - y.runIndex);
    const b = records.filter((r) => r.scenario === scenario.id && r.arm === "B" && isComplete(r)).sort((x, y) => x.runIndex - y.runIndex);
    const s = applyTruncationRule(a, b);
    return scenarioVerdict(s.a, s.b, { extendTo });
  }

  for (const scenario of scenarioList(o.scenarios)) {
    if (!(await ensureRuns(scenario, runs))) break;
    let v = verdictOf(scenario);
    if (v.extend) {
      if (!(await ensureRuns(scenario, extendTo))) break;
      v = verdictOf(scenario);
    }
    verdicts[scenario.id] = v;
  }
  return { records, ledger, stopped, verdicts };
}

const scenarioList = (s: Scenario[]): Scenario[] => s;
