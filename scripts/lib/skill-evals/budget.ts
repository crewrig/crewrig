// budget.ts — planning and enforcing the caps of a run (spec 0304 R21, R22; 0290 R23, R28, R29 as
// modified).
//
// Pre-flight (after credentials, before the first model call): per selected skill, the plan maximum
// of executor runs against `max-executor-runs` (a), the worst-case judge calls (eval runs of the
// plan maximum that have expectations, times two, plus 25 percent rounded up) against the judge
// `max_calls` (b), the skill's spend since the merge-base plus its worst case against
// `max-skill-usd` (c), the ticket's recorded spend plus the summed worst cases against
// `max-ticket-usd` (d), and the aggregate bound against `max-invocation-usd`. Every refusal names
// the planned or spent figure, the worst case and the cap. Runtime: executor runs are reserved
// BEFORE each starts, so concurrent runs cannot exceed the cap.
//
// Usage: planSkill(...), preflight(plans, limits), refuseSpend(rows, ticket, spent, limits),
//        new RunBudget(maxRuns), new CostMeter(capUsd).
// Exit codes: not applicable (library). Finding-line format: not applicable.

import { planMaximum } from "./plan.ts";
import { JUDGE_RETRY_ALLOWANCE, SAMPLING_PLAN } from "./settings.ts";
import type { EvalsFile } from "./schema.ts";

export interface Limits {
  readonly maxExecutorRuns: number;
  readonly judgeMaxCalls: number;
  readonly maxInvocationUsd: number;
  readonly perRunUsd: number;
  readonly maxMeasurementUsd: number;
  readonly maxSkillUsd: number;
  readonly maxTicketUsd: number;
  readonly executorConcurrency: number;
}

export interface SkillPlan {
  readonly skill: string;
  readonly evals: number;
  readonly probes: number;
  /** The plan maximum of executor runs (both stages for every eval and probe). */
  readonly executorRuns: number;
  /** The evals that carry expectations. */
  readonly judged: number;
  /** R22(b): the worst-case judge calls of the plan maximum. */
  readonly judgeCalls: number;
}

/** R22(b): worst-case judge calls for `judged` evals: two per eval run, plus 25 percent for retries. */
export function judgeWorstCase(judged: number): number {
  const runs = judged * (SAMPLING_PLAN.evalRunsPerStage[0] + SAMPLING_PLAN.evalRunsPerStage[1]);
  return runs * 2 + Math.ceil(runs * JUDGE_RETRY_ALLOWANCE);
}

export function planSkill(skill: string, evals: EvalsFile): SkillPlan {
  const judged = evals.evals.filter((e) => e.expectations.length > 0).length;
  return {
    skill,
    evals: evals.evals.length,
    probes: evals.trigger_probes.length,
    executorRuns: planMaximum(evals.evals.length, evals.trigger_probes.length),
    judged,
    judgeCalls: judgeWorstCase(judged),
  };
}

/** R22 (a), (b) and the aggregate bound: empty when every plan fits, else one message per breach. */
export function preflight(plans: readonly SkillPlan[], limits: Limits): string[] {
  const errors: string[] = [];
  for (const p of plans) {
    if (p.executorRuns > limits.maxExecutorRuns)
      errors.push(
        `${p.skill}: planned executor runs ${p.executorRuns} exceed max-executor-runs ${limits.maxExecutorRuns}; split the skill's evals or reduce them`,
      );
    if (p.judgeCalls > limits.judgeMaxCalls)
      errors.push(
        `${p.skill}: worst-case judge calls ${p.judgeCalls} exceed the judge max_calls ${limits.judgeMaxCalls}; split the skill's evals or reduce them (at most 6 evals that carry expectations)`,
      );
  }
  const usd = plans.reduce(
    (n, p) =>
      n +
      Math.min(
        p.executorRuns * limits.perRunUsd,
        limits.maxMeasurementUsd + limits.executorConcurrency * limits.perRunUsd,
      ),
    0,
  );
  if (usd > limits.maxInvocationUsd)
    errors.push(
      `planned worst-case cost ${usd} dollars exceeds max-invocation-usd ${limits.maxInvocationUsd}; select fewer skills per invocation (planned ${usd} dollars, cap ${limits.maxInvocationUsd} dollars)`,
    );
  return errors;
}

export interface SpendRow {
  readonly skill: string;
  /** The skill's recorded spend since the merge-base (its branch entries, and a resumed measurement). */
  readonly spent: number;
  /** The worst case of the new (or resumed) measurement. */
  readonly worst: number;
}

/** R22 (c) per skill, then (d) once: refusals naming the spent figure, the worst case and the cap. */
export function refuseSpend(
  rows: readonly SpendRow[],
  ticket: string,
  ticketSpent: number,
  limits: Limits,
): string[] {
  const out: string[] = [];
  for (const r of rows)
    if (r.spent + r.worst > limits.maxSkillUsd + 1e-9)
      out.push(
        `${r.skill}: spent since the merge-base ${r.spent.toFixed(2)} USD plus the worst case ${r.worst.toFixed(2)} USD exceeds max-skill-usd ${limits.maxSkillUsd} USD`,
      );
  const worst = rows.reduce((n, r) => n + r.worst, 0);
  if (ticketSpent + worst > limits.maxTicketUsd + 1e-9)
    out.push(
      `ticket ${ticket}: spent ${ticketSpent.toFixed(2)} USD plus the summed worst case ${worst.toFixed(2)} USD exceeds max-ticket-usd ${limits.maxTicketUsd} USD`,
    );
  return out;
}

/** Runtime counters of one invocation; one instance per skill for runs. */
export class RunBudget {
  readonly maxRuns: number;
  used = 0;
  breach: string | undefined;
  constructor(maxRuns: number) {
    this.maxRuns = maxRuns;
  }
  /** Reserve one executor run before it starts; false (and a recorded breach) when the cap is reached. */
  reserve(): boolean {
    if (this.breach !== undefined) return false;
    if (this.used >= this.maxRuns) {
      this.breach = `executor-run cap ${this.maxRuns} reached`;
      return false;
    }
    this.used++;
    return true;
  }
}

/** The measured cost of the whole invocation, stopping new runs once it reaches the cap. */
export class CostMeter {
  readonly capUsd: number;
  spent = 0;
  unknown = 0;
  constructor(capUsd: number) {
    this.capUsd = capUsd;
  }
  add(cost: number | null): void {
    if (cost === null) this.unknown++;
    else this.spent += cost;
  }
  get reached(): boolean {
    return this.spent >= this.capUsd;
  }
}
