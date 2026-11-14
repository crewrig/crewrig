// report.ts — the per-skill summary the runner prints (spec 0304 R24, R17, R7, R23; 0290 R22 as
// modified).
//
// One block per skill: the status; the eval rate with passes/runs and the stage reached; the probe
// rate with passes/runs (n/a without probes); the base figure (passes/runs, n/a when not compared,
// legacy for a schema-1 base) with the drop and the p-value; the number of eval runs that loaded the
// skill (0290 R48); executor runs, judge calls and the costs (a figure that is assumed says so).
// Then `measurements on this branch: <n>`, `evidence_reask: <n> of <m>` (always printed for a judged
// skill), the `evidence_window: <n> of <m>` line (0290 R50), the run counts of each eval, and as a
// diagnostic that affects no status the evals whose pass fraction fell by 0.5 or more against the
// base. Statuses: pass, fail, regression, in-progress, invalid, no-evals, mock, error (and `stale`,
// reported by the attestation check only).
//
// R43: in a real run the report ends with `credential_source: <label>` (no secret value).
//
// Usage: formatReport(results, source?). Exit codes: not applicable (library).
// Finding-line format: `<skill>: status=<status> ...`.

export type RunStatus =
  | "pass"
  | "fail"
  | "regression"
  | "in-progress"
  | "invalid"
  | "no-evals"
  | "mock"
  | "error";

export interface SkillResult {
  skill: string;
  status: RunStatus;
  blocking: boolean;
  evalPasses?: number;
  evalRuns?: number;
  evalStage?: 1 | 2;
  /** Absent without probes. */
  probePasses?: number;
  probeRuns?: number;
  probeStage?: 1 | 2;
  /** The base figures; null when not compared; `legacy` for a schema-1 base. */
  base?: { passes: number; runs: number; legacy: boolean } | null;
  drop?: number | null;
  pValue?: number | null;
  /** Eval runs that loaded the skill (0290 R48), informational. */
  skillLoaded?: number;
  /** 0290 R50: expectations accepted from a judge PASS, and those accepted by the window rule. */
  evidenceAccepted?: number;
  evidenceWindow?: number;
  /** R17: eval runs that were judged, and those that were re-asked. */
  judged?: number;
  reasked?: number;
  /** R10: the branch entries including the current measurement. */
  branch?: number;
  /** R7: the pass and run counts of each eval, in order. */
  evalCounts?: { id: number; passes: number; runs: number }[];
  /** R24: ids of the evals whose pass fraction fell by 0.5 or more against the base (diagnostic). */
  fallen?: number[];
  executorRuns: number;
  judgeCalls: number;
  /** Measured executor cost; null when some run's cost is unknown (a lower bound is printed). */
  costUsd: number | null;
  costLowerBound?: number;
  /** R23: the executor cost is assumed (no run reported one), at this figure. */
  costAssumedUsd?: number;
  /** Measured judge cost; null when no call reported one. */
  judgeCostUsd?: number | null;
  messages: string[];
}

/** R43 labels of the credential source. */
export const CREDENTIAL_LABELS = {
  session: "logged-in Claude Code session",
  token: "CLAUDE_CODE_OAUTH_TOKEN",
  "api-key": "ANTHROPIC_API_KEY (--use-api-key)",
} as const;

const JUDGE_ASSUMED_NOTE = "assumed (the driver reports no judge cost)";

const ratio = (passes: number | undefined, runs: number | undefined, stage?: number): string =>
  passes === undefined || runs === undefined || runs === 0
    ? "n/a"
    : `${(passes / runs).toFixed(2)} (${passes}/${runs}${stage === undefined ? "" : `, stage ${stage}`})`;

function costFigure(r: SkillResult): string {
  if (r.costAssumedUsd !== undefined) return `assumed ${r.costAssumedUsd.toFixed(2)}`;
  return r.costUsd === null
    ? `unknown (at least ${(r.costLowerBound ?? 0).toFixed(2)})`
    : r.costUsd.toFixed(2);
}

export function formatSkill(r: SkillResult): string {
  const lines: string[] = [];
  const base =
    r.base === undefined || r.base === null
      ? "n/a"
      : `${r.base.passes}/${r.base.runs}${r.base.legacy ? " legacy" : ""}`;
  const judgeCost =
    r.judgeCostUsd === undefined || (r.judgeCostUsd === null && r.judgeCalls === 0)
      ? "n/a"
      : r.judgeCostUsd === null
        ? JUDGE_ASSUMED_NOTE
        : r.judgeCostUsd.toFixed(2);
  lines.push(
    `${r.skill}: status=${r.status} eval_pass_rate=${ratio(r.evalPasses, r.evalRuns, r.evalStage)} ` +
      `probe_pass_rate=${ratio(r.probePasses, r.probeRuns, r.probeStage)} ` +
      `base=${base} drop=${r.drop === undefined || r.drop === null ? "n/a" : r.drop.toFixed(3)} ` +
      `p_value=${r.pValue === undefined || r.pValue === null ? "n/a" : r.pValue.toFixed(3)} ` +
      `skill_loaded=${r.skillLoaded === undefined ? "n/a" : `${r.skillLoaded}/${r.evalRuns}`} ` +
      `executor_runs=${r.executorRuns} judge_calls=${r.judgeCalls} cost_usd=${costFigure(r)} judge_cost_usd=${judgeCost}`,
  );
  if (r.branch !== undefined) lines.push(`  measurements on this branch: ${r.branch}`);
  if (r.judged !== undefined) lines.push(`  evidence_reask: ${r.reasked ?? 0} of ${r.judged}`);
  if (r.evidenceAccepted !== undefined)
    lines.push(`  evidence_window: ${r.evidenceWindow ?? 0} of ${r.evidenceAccepted}`);
  if (r.evalCounts !== undefined && r.evalCounts.length > 0)
    lines.push(
      `  eval runs: ${r.evalCounts.map((e) => `${e.id}=${e.passes}/${e.runs}`).join(" ")}`,
    );
  if (r.base === null) lines.push("  not compared: no usable evals/results.json at the merge-base");
  if (r.status === "regression" && r.base !== null && r.base !== undefined)
    lines.push(
      `  regression: ${r.skill} base ${base}, head ${r.evalPasses}/${r.evalRuns}, drop ${(r.drop ?? 0).toFixed(3)}, p ${(r.pValue ?? 0).toFixed(3)}`,
    );
  if (r.fallen !== undefined && r.fallen.length > 0)
    lines.push(
      `  diagnostic: pass fraction fell by 0.5 or more against the base on eval ${r.fallen.join(", ")}`,
    );
  if (r.judgeCostUsd === null && r.judgeCalls > 0)
    lines.push(`  judge cost is ${JUDGE_ASSUMED_NOTE}`);
  if (r.costAssumedUsd !== undefined)
    lines.push("  executor cost is assumed (no run reported a cost)");
  for (const m of r.messages) lines.push(`  ${m}`);
  return lines.join("\n");
}

export function formatReport(
  results: readonly SkillResult[],
  source?: keyof typeof CREDENTIAL_LABELS,
): string {
  const lines = results.map(formatSkill);
  const lower = results.reduce(
    (n, r) =>
      n +
      (r.costAssumedUsd !== undefined
        ? r.costAssumedUsd
        : r.costUsd === null
          ? (r.costLowerBound ?? 0)
          : r.costUsd),
    0,
  );
  const anyUnknown = results.some((r) => r.costUsd === null || r.costAssumedUsd !== undefined);
  const runs = results.reduce((n, r) => n + r.executorRuns, 0);
  const calls = results.reduce((n, r) => n + r.judgeCalls, 0);
  lines.push(
    `invocation: skills=${results.length} executor_runs=${runs} judge_calls=${calls} cost_usd=${
      anyUnknown ? `unknown or assumed (at least ${lower.toFixed(2)})` : lower.toFixed(2)
    }`,
  );
  if (source !== undefined) lines.push(`credential_source: ${CREDENTIAL_LABELS[source]}`);
  return `${lines.join("\n")}\n`;
}
