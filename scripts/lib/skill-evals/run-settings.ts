// run-settings.ts — the settings of one run, defaulting to the declared constants (spec 0290 R19-R23,
// R27-R31; 0304 R1, R21).
//
// Every field has its default in settings.ts; a test may override a field through `RunOptions`.
// The sampling plan itself is never overridable: it is one constant (R1).
//
// Usage: { ...DEFAULT_SETTINGS, ...override }. Exit codes: not applicable (library).
// Finding-line format: not applicable.

import * as S from "./settings.ts";

export interface RunSettings {
  regressionBlocking: boolean;
  missingEvalsBlocking: boolean;
  failBlocking: boolean;
  maxExecutorRuns: number;
  judgeMaxCalls: number;
  maxInvocationUsd: number;
  maxMeasurementUsd: number;
  maxSkillUsd: number;
  maxTicketUsd: number;
  executorConcurrency: number;
  perRunTurns: number;
  perRunSeconds: number;
  perRunUsd: number;
  executorModel: string;
  effort: string;
}

export const DEFAULT_SETTINGS: RunSettings = {
  regressionBlocking: S.REGRESSION_BLOCKING,
  missingEvalsBlocking: S.MISSING_EVALS_BLOCKING,
  failBlocking: S.FAIL_BLOCKING,
  maxExecutorRuns: S.MAX_EXECUTOR_RUNS,
  judgeMaxCalls: S.JUDGE_MAX_CALLS,
  maxInvocationUsd: S.MAX_INVOCATION_USD,
  maxMeasurementUsd: S.MAX_MEASUREMENT_USD,
  maxSkillUsd: S.MAX_SKILL_USD,
  maxTicketUsd: S.MAX_TICKET_USD,
  executorConcurrency: S.EXECUTOR_CONCURRENCY,
  perRunTurns: S.PER_RUN_TURNS,
  perRunSeconds: S.PER_RUN_SECONDS,
  perRunUsd: S.PER_RUN_USD,
  executorModel: S.EXECUTOR_MODEL,
  effort: S.EFFORT,
};
