// results.ts — `evals/results.json`, the committed attestation (spec 0290 R19, R20, R36, R37, R38,
// delta-04), and the decision both the runner and the attestation take from its figures.
//
// The writer fixes the key order and writes only for a non-mock run whose status is `pass`, `fail`
// or `regression` (temp file then rename). The verifier reports why a results file is `stale`; with
// no hash it reads the merge-base's file for the regression comparison instead. The file is
// self-declared: the verifier proves freshness (the recorded content hash matches the current
// content), not truth (R38).
//
// Usage: writeResults(skillDirAbs, record); verifyResults(text, skillName, currentHash?);
//        decide(figures); blocks(decision, { failBlocking, regressionBlocking }).
// Exit codes: not applicable (library). Finding-line format: not applicable.

import fs from "node:fs";
import path from "node:path";

export const RESULT_STATUSES = ["pass", "fail", "regression"] as const;
export type ResultStatus = (typeof RESULT_STATUSES)[number];

export interface ResultsRecord {
  skill_name: string;
  content_hash: string;
  runner_version: string;
  executor_model: string;
  judge_model: string;
  effort: string;
  date: string;
  status: ResultStatus;
  eval_pass_rate: number;
  probe_pass_rate: number | null;
  base_eval_pass_rate: number | null;
  threshold: number;
  /** One case: 1 / evals_total (#1963). */
  tolerance: number;
  evals_passed: number;
  evals_total: number;
  probes_passed: number;
  probes_total: number;
  executor_runs: number;
  judge_calls: number;
  cost_usd: number | null;
  /** Eval runs that loaded the skill; absent in a file written before runner 3.0.0. */
  skill_loaded?: number;
}

const KEYS = [
  "skill_name",
  "content_hash",
  "runner_version",
  "executor_model",
  "judge_model",
  "effort",
  "date",
  "status",
  "eval_pass_rate",
  "probe_pass_rate",
  "base_eval_pass_rate",
  "threshold",
  "tolerance",
  "evals_passed",
  "evals_total",
  "probes_passed",
  "probes_total",
  "executor_runs",
  "judge_calls",
  "cost_usd",
  "skill_loaded",
] as const satisfies readonly (keyof ResultsRecord)[];

/** The figures `decide` works from; recorded in the results file, so the attestation can recompute. */
export interface Figures {
  readonly evalPassRate: number;
  /** null when the skill has no probe. */
  readonly probePassRate: number | null;
  /** null when not compared (R19). */
  readonly baseEvalPassRate: number | null;
  /** The advisory score bar; never fails a skill. */
  readonly threshold: number;
  /** One case (1 / eval count): the room a head score has below the base's. */
  readonly tolerance: number;
  readonly evalsTotal?: number;
  /** Eval runs that loaded the skill; null or absent when unknown. */
  readonly skillLoaded?: number | null;
}

export interface Decision {
  /** #1963: the skill did not load in every eval. */
  readonly fail: boolean;
  /** #1963: the eval score is below the base's by more than one case. */
  readonly regression: boolean;
  /** Advisory only: an eval or probe pass rate is below the threshold. Never changes the status. */
  readonly belowThreshold: boolean;
  /** `fail` wins over `regression`. */
  readonly status: ResultStatus;
}

/** R19: a regression is a head rate lower than the base rate by MORE than the tolerance. */
export function isRegression(head: number, base: number, tolerance: number): boolean {
  return base - head - tolerance > 1e-9;
}

/** R20, R46: the one function that decides `fail` and `regression`, for the runner and the attestation. */
export function decide(f: Figures): Decision {
  const fail =
    f.skillLoaded !== undefined &&
    f.skillLoaded !== null &&
    f.evalsTotal !== undefined &&
    f.skillLoaded < f.evalsTotal;
  const belowThreshold =
    f.threshold - f.evalPassRate > 1e-9 ||
    (f.probePassRate !== null && f.threshold - f.probePassRate > 1e-9);
  const regression =
    f.baseEvalPassRate !== null && isRegression(f.evalPassRate, f.baseEvalPassRate, f.tolerance);
  return {
    fail,
    regression,
    belowThreshold,
    status: fail ? "fail" : regression ? "regression" : "pass",
  };
}

/** R20: each condition blocks only under its own setting. */
export function blocks(
  d: Decision,
  s: { readonly failBlocking: boolean; readonly regressionBlocking: boolean },
): boolean {
  return (d.fail && s.failBlocking) || (d.regression && s.regressionBlocking);
}

export const figuresOf = (r: ResultsRecord): Figures => ({
  evalPassRate: r.eval_pass_rate,
  probePassRate: r.probe_pass_rate,
  baseEvalPassRate: r.base_eval_pass_rate,
  threshold: r.threshold,
  tolerance: r.tolerance,
  evalsTotal: r.evals_total,
  skillLoaded: r.skill_loaded ?? null,
});

export const resultsPath = (skillDirAbs: string): string =>
  path.join(skillDirAbs, "evals", "results.json");

export function writeResults(skillDirAbs: string, r: ResultsRecord): void {
  const ordered: Record<string, unknown> = {};
  for (const k of KEYS) ordered[k] = r[k];
  const file = resultsPath(skillDirAbs);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(ordered, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

export type Verification =
  | { readonly ok: true; readonly record: ResultsRecord }
  | { readonly ok: false; readonly reason: string };

/** `currentHash` undefined skips the freshness check: the merge-base's file is read for its rate only. */
export function verifyResults(
  text: string | undefined,
  skillName: string,
  currentHash?: string,
): Verification {
  if (text === undefined) return { ok: false, reason: "evals/results.json is absent" };
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return { ok: false, reason: "evals/results.json cannot be parsed" };
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc))
    return { ok: false, reason: "evals/results.json is not a JSON object" };
  const o = doc as Record<string, unknown>;
  if (o["mock"] === true) return { ok: false, reason: "evals/results.json records a mock run" };
  for (const k of KEYS)
    if (k !== "skill_loaded" && !(k in o))
      return { ok: false, reason: `evals/results.json lacks the key ${k}` };
  if (o["skill_name"] !== skillName)
    return {
      ok: false,
      reason: `evals/results.json names another skill (${JSON.stringify(o["skill_name"])})`,
    };
  if (!(RESULT_STATUSES as readonly unknown[]).includes(o["status"]))
    return {
      ok: false,
      reason: `evals/results.json records the status ${JSON.stringify(o["status"])}, which is not pass, fail or regression`,
    };
  for (const k of ["eval_pass_rate", "threshold", "tolerance"] as const)
    if (typeof o[k] !== "number")
      return { ok: false, reason: `evals/results.json ${k} is not a number` };
  for (const k of ["probe_pass_rate", "base_eval_pass_rate"] as const)
    if (o[k] !== null && typeof o[k] !== "number")
      return {
        ok: false,
        reason: `evals/results.json ${k} is neither a number nor null`,
      };
  if (currentHash !== undefined && o["content_hash"] !== currentHash)
    return {
      ok: false,
      reason: `recorded content_hash ${String(o["content_hash"])} differs from the current ${currentHash}`,
    };
  return { ok: true, record: o as unknown as ResultsRecord };
}
