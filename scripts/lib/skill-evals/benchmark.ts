// benchmark.ts — `benchmark.json` and the regression arithmetic (spec 0290 R14 as modified, R19).
//
// `runs` carries one entry per head run (`eval_id`, `configuration`, `summary`, and `result`, the
// same figures in the shape skill-creator's results viewer reads). `run_summary` is keyed by
// configuration with `pass_rate: {mean, stddev}` (population standard deviation, 0 for a single
// eval) plus `delta` as `{pass_rate: "<signed decimal>"}` and the number `delta_value`.
//
// Usage: buildBenchmark(runs, { skill, mock }); isRegression(headMean, baseMean, tolerance).
// Exit codes: not applicable (library). Finding-line format: not applicable.

import type { GradeSummary } from "./grade.ts";

export type Configuration = "with_skill" | "without_skill";

export interface RunRecord {
  readonly evalId: number;
  readonly configuration: Configuration;
  readonly summary: GradeSummary;
  readonly timeSeconds?: number;
}

export const mean = (xs: readonly number[]): number =>
  xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;

/** Population standard deviation; 0 for a single value (and for none). */
export function popStddev(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

export function signedDecimal(delta: number): string {
  const r = Math.round(delta * 100) / 100;
  return `${r < 0 ? "-" : "+"}${Math.abs(r).toFixed(2)}`;
}

/** R19: a regression is a head mean lower than the base mean by MORE than the tolerance. */
export function isRegression(headMean: number, baseMean: number, tolerance: number): boolean {
  return baseMean - headMean - tolerance > 1e-9;
}

export function configMean(runs: readonly RunRecord[], configuration: Configuration): number {
  return mean(
    runs.filter((r) => r.configuration === configuration).map((r) => r.summary.pass_rate),
  );
}

export function buildBenchmark(
  runs: readonly RunRecord[],
  opts: { skill: string; mock: boolean },
): Record<string, unknown> {
  const rates = (c: Configuration) =>
    runs.filter((r) => r.configuration === c).map((r) => r.summary.pass_rate);
  const withMean = mean(rates("with_skill"));
  const withoutMean = mean(rates("without_skill"));
  const delta = withMean - withoutMean;
  const out: Record<string, unknown> = {
    metadata: { skill_name: opts.skill },
    runs: runs.map((r) => ({
      eval_id: r.evalId,
      configuration: r.configuration,
      summary: r.summary,
      result: {
        pass_rate: r.summary.pass_rate,
        passed: r.summary.passed,
        failed: r.summary.failed,
        total: r.summary.total,
        time_seconds: r.timeSeconds ?? 0,
      },
    })),
    run_summary: {
      with_skill: { pass_rate: { mean: withMean, stddev: popStddev(rates("with_skill")) } },
      without_skill: {
        pass_rate: { mean: withoutMean, stddev: popStddev(rates("without_skill")) },
      },
      delta: { pass_rate: signedDecimal(delta) },
      delta_value: delta,
    },
  };
  if (opts.mock) out["mock"] = true;
  return out;
}
