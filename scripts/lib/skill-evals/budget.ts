// budget.ts — planning and enforcing the caps of a run (spec 0290 R23 as modified, R28, R29).
//
// Pre-flight (after credentials, before the first model call): per selected skill, planned
// executor runs (one per eval and one per probe) against `max-executor-runs`, worst-case judge
// calls (one per eval that has expectations, plus a retry allowance) against the judge
// `max_calls`, and across all skills the worst-case executor cost (planned runs x per-run budget)
// against `max-invocation-usd`.
// Runtime: executor runs are reserved BEFORE each starts, so concurrent runs cannot exceed the cap;
// the summed measured cost stops new runs once it reaches `max-invocation-usd`.
//
// Usage: planSkill(...), preflight(plans, limits), new RunBudget(limits).
// Exit codes: not applicable (library). Finding-line format: not applicable.

import { JUDGE_RETRY_ALLOWANCE } from "./settings.ts";
import type { EvalsFile } from "./schema.ts";

export interface Limits {
  readonly maxExecutorRuns: number;
  readonly judgeMaxCalls: number;
  readonly maxInvocationUsd: number;
  readonly perRunUsd: number;
}

export interface SkillPlan {
  readonly skill: string;
  readonly evals: number;
  readonly probes: number;
  readonly executorRuns: number;
  readonly judgeCalls: number;
}

export function planSkill(skill: string, evals: EvalsFile): SkillPlan {
  const judged = evals.evals.filter((e) => e.expectations.length > 0).length;
  return {
    skill,
    evals: evals.evals.length,
    probes: evals.trigger_probes.length,
    executorRuns: evals.evals.length + evals.trigger_probes.length,
    judgeCalls: judged + Math.ceil(judged * JUDGE_RETRY_ALLOWANCE),
  };
}

/** Pre-flight refusals: empty when every plan fits, else one message per breach (planned vs cap). */
export function preflight(plans: readonly SkillPlan[], limits: Limits): string[] {
  const errors: string[] = [];
  for (const p of plans) {
    if (p.executorRuns > limits.maxExecutorRuns)
      errors.push(
        `${p.skill}: planned executor runs ${p.executorRuns} exceed max-executor-runs ${limits.maxExecutorRuns}`,
      );
    if (p.judgeCalls > limits.judgeMaxCalls)
      errors.push(
        `${p.skill}: worst-case judge calls ${p.judgeCalls} exceed the judge max_calls ${limits.judgeMaxCalls}`,
      );
  }
  const runs = plans.reduce((n, p) => n + p.executorRuns, 0);
  const usd = runs * limits.perRunUsd;
  if (usd > limits.maxInvocationUsd)
    errors.push(
      `planned executor cost ${usd} dollars (${runs} runs x ${limits.perRunUsd}) exceeds max-invocation-usd ${limits.maxInvocationUsd}; select fewer skills per invocation (planned ${runs} runs, cap ${limits.maxInvocationUsd} dollars)`,
    );
  return errors;
}

/** Runtime counters of one invocation; one instance per skill for runs, one shared for cost. */
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
