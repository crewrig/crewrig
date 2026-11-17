// orchestrate.ts — the experiment loop (spec 0308 R8-R10): pairs the arms (A1 B1 A2 B2), reruns an
// invalid run once, extends a diverging scenario to 5 runs per arm, and stops at the cost guard.
// The model call is an injected `execute`, so the loop is testable without a model.

import { canStart, charge, createLedger, perRunBudget } from "./budget.ts";
import type { Ledger } from "./budget.ts";
import {
  applyTruncationRule,
  CONTROL_GATE_SCENARIO,
  controlGate,
  scenarioVerdict,
} from "./compare.ts";
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
  /** Arms to run (default both). A single arm is a calibration run: no verdict is produced. */
  arms?: Array<"A" | "B">;
  /** Runs per arm after an extension. */
  extendTo?: number;
  cap?: number;
  perRunCap?: number;
  /** Projected cost of the first run, before any run is charged (default: the per-run cap). */
  projectionSeed?: number;
  /** Records of an earlier, stopped invocation (resume), or `seeded` records (not charged). */
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
  const arms = o.arms ?? (["A", "B"] as Array<"A" | "B">);
  const perRunCap = o.perRunCap ?? 0.6;
  let ledger = createLedger(o.cap ?? 12);
  const records: RunRecord[] = [];
  const verdicts: Record<number, ScenarioVerdict> = {};
  let stopped: { reason: string } | null = null;

  for (const p of o.prior ?? []) {
    if (!p.seeded) for (const a of p.attempts) ledger = charge(ledger, a.charged, perRunCap);
    if (isComplete(p)) records.push(p);
  }
  const find = (s: number, arm: string, idx: number) =>
    records.find((r) => r.scenario === s && r.arm === arm && r.runIndex === idx);

  async function executeRun(
    scenario: Scenario,
    arm: "A" | "B",
    runIndex: number,
  ): Promise<boolean> {
    const attempts: AttemptRecord[] = [];
    const truncs: boolean[] = [];
    for (let attempt = 1; attempt <= 2; attempt++) {
      const guard = canStart(ledger, perRunCap, o.projectionSeed);
      if (!guard.ok) {
        stopped = { reason: guard.reason ?? "cost guard" };
        if (attempts.length > 0) {
          // charged but unfinished: keep the spend visible; a resume reruns this cell
          const rec: RunRecord = {
            scenario: scenario.id,
            arm,
            runIndex,
            attempts,
            status: "invalid",
            truncatedTwice: false,
          };
          records.push(rec);
          o.onRecord?.(rec);
        }
        return false;
      }
      const res = await o.execute({
        scenario,
        arm,
        runIndex,
        attempt,
        maxBudgetUsd: perRunBudget(ledger, perRunCap),
      });
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

  async function ensureRuns(
    scenario: Scenario,
    upTo: number,
    armList: Array<"A" | "B"> = arms,
  ): Promise<boolean> {
    for (let idx = 1; idx <= upTo; idx++) {
      for (const arm of armList) {
        if (find(scenario.id, arm, idx)) continue;
        if (!(await executeRun(scenario, arm, idx))) return false;
      }
    }
    return true;
  }

  function verdictOf(scenario: Scenario): ScenarioVerdict {
    const a = records
      .filter((r) => r.scenario === scenario.id && r.arm === "A" && isComplete(r))
      .sort((x, y) => x.runIndex - y.runIndex);
    const b = records
      .filter((r) => r.scenario === scenario.id && r.arm === "B" && isComplete(r))
      .sort((x, y) => x.runIndex - y.runIndex);
    const s = applyTruncationRule(a, b);
    return scenarioVerdict(s.a, s.b, { extendTo });
  }

  const armRecords = (s: Scenario, arm: "A" | "B") =>
    records
      .filter((r) => r.scenario === s.id && r.arm === arm && isComplete(r))
      .sort((x, y) => x.runIndex - y.runIndex);

  for (const scenario of scenarioList(o.scenarios)) {
    const gated = scenario.id === CONTROL_GATE_SCENARIO && arms.includes("A") && arms.includes("B");
    if (gated) {
      // control gate (delta-03 ADDED 3): arm A completes first; B is only run, and compared, if it holds
      if (!(await ensureRuns(scenario, runs, ["A"]))) break;
      if (!controlGate(armRecords(scenario, "A").map((r) => r.status)).holds) {
        verdicts[scenario.id] = { verdict: "control-failed", extend: false };
        continue;
      }
    }
    if (!(await ensureRuns(scenario, runs))) break;
    if (arms.length < 2) continue;
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
