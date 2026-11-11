// report.ts — the per-skill summary the runner prints (spec 0290 R22 as modified).
//
// One block per skill: status, with_skill and without_skill means, delta, base mean (n/a when the
// base replay was skipped or the skill is new), executor runs used, judge calls used, measured
// cost, number of trigger probes (counted, never scored: R5), plus the reason and, for a
// regression, the skill, both means, the delta and the tolerance. Statuses: pass, regression,
// invalid, no-evals, new, mock, error (and `stale`, reported by the attestation check only).
//
// Usage: formatReport(results, totals). Exit codes: not applicable (library).
// Finding-line format: `<skill>: status=<status> ...`.

export type RunStatus = "pass" | "regression" | "invalid" | "no-evals" | "new" | "mock" | "error";

export interface SkillResult {
  skill: string;
  status: RunStatus;
  blocking: boolean;
  withSkillMean?: number;
  withoutSkillMean?: number;
  baseMean?: number | null;
  deltaValue?: number;
  tolerance?: number;
  executorRuns: number;
  judgeCalls: number;
  /** Sum of measured run costs; null when any run's cost is unknown (a lower bound is printed). */
  costUsd: number | null;
  costLowerBound?: number;
  probes?: number;
  messages: string[];
}

const fmt = (n: number | null | undefined): string =>
  n === null || n === undefined ? "n/a" : n.toFixed(2);

export function formatSkill(r: SkillResult): string {
  const lines: string[] = [];
  const head =
    `${r.skill}: status=${r.status} with_skill=${fmt(r.withSkillMean)} without_skill=${fmt(r.withoutSkillMean)} ` +
    `delta=${r.deltaValue === undefined ? "n/a" : (r.deltaValue >= 0 ? "+" : "") + r.deltaValue.toFixed(2)} base=${fmt(r.baseMean)} ` +
    `executor_runs=${r.executorRuns} judge_calls=${r.judgeCalls} cost_usd=${
      r.costUsd === null
        ? `unknown (at least ${(r.costLowerBound ?? 0).toFixed(2)})`
        : r.costUsd.toFixed(2)
    }` +
    (r.probes !== undefined ? ` trigger_probes=${r.probes}` : "");
  lines.push(head);
  if (r.status === "regression")
    lines.push(
      `  regression: ${r.skill} base mean ${fmt(r.baseMean)}, head mean ${fmt(r.withSkillMean)}, delta ${(r.baseMean !== null && r.baseMean !== undefined && r.withSkillMean !== undefined ? r.withSkillMean - r.baseMean : 0).toFixed(2)}, tolerance ${fmt(r.tolerance)}`,
    );
  for (const m of r.messages) lines.push(`  ${m}`);
  return lines.join("\n");
}

export function formatReport(results: readonly SkillResult[]): string {
  const lines = results.map(formatSkill);
  const known = results.filter((r) => r.costUsd !== null).reduce((n, r) => n + (r.costUsd ?? 0), 0);
  const lower = results.reduce(
    (n, r) => n + (r.costUsd === null ? (r.costLowerBound ?? 0) : r.costUsd),
    0,
  );
  const anyUnknown = results.some((r) => r.costUsd === null);
  const runs = results.reduce((n, r) => n + r.executorRuns, 0);
  const calls = results.reduce((n, r) => n + r.judgeCalls, 0);
  lines.push(
    `invocation: skills=${results.length} executor_runs=${runs} judge_calls=${calls} cost_usd=${
      anyUnknown ? `unknown (at least ${lower.toFixed(2)})` : known.toFixed(2)
    }`,
  );
  return `${lines.join("\n")}\n`;
}
