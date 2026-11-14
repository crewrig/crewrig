// report.ts — the per-skill summary the runner prints (spec 0290 R22 as modified by delta-04).
//
// One block per skill: status, the eval pass rate with evals passed/total, the probe pass rate with
// probes passed/total (n/a without probes), the threshold, the base eval pass rate and the
// difference (n/a when not compared, with a line saying so), the number of eval runs that loaded
// the skill (R48), a line `evidence_window: <n> of <m>` counting the expectations accepted by the
// window rule among those accepted from a judge PASS (R50), executor runs used, judge calls used and measured cost, plus the reason and,
// when the regression condition holds, the regression line. Statuses: pass, fail, regression,
// invalid, no-evals, mock, error (and `stale`, reported by the attestation check only).
//
// R43: in a real run the report ends with `credential_source: <label>` (no secret value).
//
// Usage: formatReport(results, source?). Exit codes: not applicable (library).
// Finding-line format: `<skill>: status=<status> ...`.

export type RunStatus = "pass" | "fail" | "regression" | "invalid" | "no-evals" | "mock" | "error";

export interface SkillResult {
  skill: string;
  status: RunStatus;
  blocking: boolean;
  evalPassRate?: number;
  evalsPassed?: number;
  evalsTotal?: number;
  /** null when the skill has no probe. */
  probePassRate?: number | null;
  probesPassed?: number;
  probesTotal?: number;
  threshold?: number;
  /** null when not compared (R19). */
  baseEvalPassRate?: number | null;
  tolerance?: number;
  /** The R19 regression condition holds (it can hold under status `fail`). */
  regression?: boolean;
  /** Eval runs that loaded the skill (R48), informational. */
  skillLoaded?: number;
  /** R50: expectations accepted from a judge PASS, and those accepted by the window rule (rule 3). */
  evidenceAccepted?: number;
  evidenceWindow?: number;
  executorRuns: number;
  judgeCalls: number;
  /** Sum of measured run costs; null when any run's cost is unknown (a lower bound is printed). */
  costUsd: number | null;
  costLowerBound?: number;
  messages: string[];
}

/** R43 labels of the credential source. */
export const CREDENTIAL_LABELS = {
  session: "logged-in Claude Code session",
  token: "CLAUDE_CODE_OAUTH_TOKEN",
  "api-key": "ANTHROPIC_API_KEY (--use-api-key)",
} as const;

const fmt = (n: number | null | undefined): string =>
  n === null || n === undefined ? "n/a" : n.toFixed(2);

const ratio = (rate: number | null | undefined, n?: number, of?: number): string =>
  rate === null || rate === undefined ? "n/a" : `${rate.toFixed(2)} (${n}/${of})`;

export function formatSkill(r: SkillResult): string {
  const lines: string[] = [];
  const diff =
    r.baseEvalPassRate === null || r.baseEvalPassRate === undefined || r.evalPassRate === undefined
      ? "n/a"
      : (r.evalPassRate - r.baseEvalPassRate >= 0 ? "+" : "") +
        (r.evalPassRate - r.baseEvalPassRate).toFixed(2);
  const head =
    `${r.skill}: status=${r.status} eval_pass_rate=${ratio(r.evalPassRate, r.evalsPassed, r.evalsTotal)} ` +
    `probe_pass_rate=${ratio(r.probePassRate, r.probesPassed, r.probesTotal)} threshold=${fmt(r.threshold)} ` +
    `base=${fmt(r.baseEvalPassRate)} diff=${diff} ` +
    `skill_loaded=${r.skillLoaded === undefined ? "n/a" : `${r.skillLoaded}/${r.evalsTotal}`} ` +
    `executor_runs=${r.executorRuns} judge_calls=${r.judgeCalls} cost_usd=${
      r.costUsd === null
        ? `unknown (at least ${(r.costLowerBound ?? 0).toFixed(2)})`
        : r.costUsd.toFixed(2)
    }`;
  lines.push(head);
  if (r.evidenceAccepted !== undefined)
    lines.push(`  evidence_window: ${r.evidenceWindow ?? 0} of ${r.evidenceAccepted}`);
  if (r.baseEvalPassRate === null)
    lines.push("  not compared: no valid evals/results.json at the merge-base");
  if (
    r.evalPassRate !== undefined &&
    r.threshold !== undefined &&
    r.threshold - r.evalPassRate > 1e-9
  )
    lines.push(
      `  advisory: eval pass rate ${fmt(r.evalPassRate)} is below ${fmt(r.threshold)}; not a failure`,
    );
  if (r.regression === true)
    lines.push(
      `  regression: ${r.skill} base eval pass rate ${fmt(r.baseEvalPassRate)}, head ${fmt(r.evalPassRate)}, diff ${diff}, tolerance ${fmt(r.tolerance)}`,
    );
  for (const m of r.messages) lines.push(`  ${m}`);
  return lines.join("\n");
}

export function formatReport(
  results: readonly SkillResult[],
  source?: keyof typeof CREDENTIAL_LABELS,
): string {
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
  if (source !== undefined) lines.push(`credential_source: ${CREDENTIAL_LABELS[source]}`);
  return `${lines.join("\n")}\n`;
}
