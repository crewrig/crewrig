// results.ts — `evals/results.json` of schema 2, the committed attestation (spec 0304 R5, R6, R7;
// 0290 R36-R38 as modified). The decision itself lives in plan.ts.
//
// The writer fixes the key order and writes atomically (a temporary file renamed over the target)
// after every graded run, so a measurement exists as `in-progress` before its first model call.
// A mock run writes nothing. The file is self-declared: the verifier proves freshness (the
// recorded content hash matches), not truth (0290 R38).
//
// Usage: writeResults(skillDirAbs, record); parseResults(text); blocks(status, settings).
// Exit codes: not applicable (library). Finding-line format: not applicable.

import fs from "node:fs";
import path from "node:path";

import type { LedgerEntry } from "./ledger.ts";
import { SAMPLING_PLAN } from "./settings.ts";

export const RESULT_STATUSES = ["pass", "fail", "regression"] as const;
export type ResultStatus = (typeof RESULT_STATUSES)[number];
export type RecordStatus = "in-progress" | ResultStatus;

export interface EvalRunRecord {
  passed: boolean;
  /** One `1` or `0` per check and then per expectation, in grading.json order. */
  assertions: string;
  skill_loaded: boolean;
  cost_usd: number | null;
  cost_assumed?: true;
  reasked: boolean;
}
export interface EvalEntry {
  id: number;
  case_hash: string;
  runs: EvalRunRecord[];
}
export interface ProbeEntry {
  index: number;
  should_trigger: boolean;
  runs: boolean[];
}
export interface ErrorEntry {
  slot: string;
  kind: string;
  message: string;
  time: string;
}
export interface BaseBlock {
  merge_base: string;
  schema_version: 1 | 2;
  passes: number;
  runs: number;
  common_evals: number;
}

export interface PlanCopy {
  id: string;
  evalRunsPerStage: number[];
  probeRunsPerStage: number[];
  acceptStage1: number;
  rejectStage1: number;
  acceptFinal: number;
  regression: { test: string; alpha: number; minDrop: number };
}

export interface ResultsRecord {
  schema_version: 2;
  skill_name: string;
  content_hash: string;
  runner_version: string;
  executor_model: string;
  judge_model: string;
  effort: string;
  plan: PlanCopy;
  ticket: string;
  declared_at: string;
  date: string;
  status: RecordStatus;
  stage_reached: { evals: 1 | 2; probes: 1 | 2 | null };
  evals: EvalEntry[];
  probes: ProbeEntry[];
  eval_passes: number;
  eval_runs: number;
  eval_pass_rate: number;
  probe_passes: number;
  probe_runs: number;
  probe_pass_rate: number | null;
  base: BaseBlock | null;
  regression: { drop: number; p_value: number } | null;
  errors: ErrorEntry[];
  executor_runs: number;
  judge_calls: number;
  cost_usd: number | null;
  judge_cost_usd: number | null;
  ledger: LedgerEntry[];
}

/** R6: the keys of the file, in order. */
export const KEYS = [
  "schema_version",
  "skill_name",
  "content_hash",
  "runner_version",
  "executor_model",
  "judge_model",
  "effort",
  "plan",
  "ticket",
  "declared_at",
  "date",
  "status",
  "stage_reached",
  "evals",
  "probes",
  "eval_passes",
  "eval_runs",
  "eval_pass_rate",
  "probe_passes",
  "probe_runs",
  "probe_pass_rate",
  "base",
  "regression",
  "errors",
  "executor_runs",
  "judge_calls",
  "cost_usd",
  "judge_cost_usd",
  "ledger",
] as const satisfies readonly (keyof ResultsRecord)[];

/** R1, R5: the plan as a JSON copy, so a file can be compared to SAMPLING_PLAN by value. */
export const planCopy = (): PlanCopy => JSON.parse(JSON.stringify(SAMPLING_PLAN)) as PlanCopy;

export const planEquals = (plan: unknown): boolean =>
  JSON.stringify(plan) === JSON.stringify(SAMPLING_PLAN);

export const resultsPath = (skillDirAbs: string): string =>
  path.join(skillDirAbs, "evals", "results.json");

/** The record with its keys in the order of R6 (and run keys in the order of R6 too). */
export function ordered(r: ResultsRecord): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of KEYS) out[k] = r[k];
  out["evals"] = r.evals.map((e) => ({
    id: e.id,
    case_hash: e.case_hash,
    runs: e.runs.map((x) => ({
      passed: x.passed,
      assertions: x.assertions,
      skill_loaded: x.skill_loaded,
      cost_usd: x.cost_usd,
      ...(x.cost_assumed === true ? { cost_assumed: true } : {}),
      reasked: x.reasked,
    })),
  }));
  return out;
}

/** Atomic write (R5); throws when the file cannot be written (the caller makes no model call). */
export function writeResults(skillDirAbs: string, r: ResultsRecord): void {
  const file = resultsPath(skillDirAbs);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(ordered(r), null, 2)}\n`);
  fs.renameSync(tmp, file);
}

export type Parsed =
  | { readonly kind: "absent" }
  | { readonly kind: "unparseable"; readonly reason: string }
  | { readonly kind: "mock" }
  | { readonly kind: "v1"; readonly doc: Record<string, unknown> }
  | { readonly kind: "v2"; readonly doc: Record<string, unknown> };

/** Classify the text of a results file; the schema-2 shape is checked by results-verify.ts. */
export function parseResults(text: string | undefined): Parsed {
  if (text === undefined) return { kind: "absent" };
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return { kind: "unparseable", reason: "evals/results.json cannot be parsed" };
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc))
    return { kind: "unparseable", reason: "evals/results.json is not a JSON object" };
  const o = doc as Record<string, unknown>;
  if (o["mock"] === true) return { kind: "mock" };
  return o["schema_version"] === 2 ? { kind: "v2", doc: o } : { kind: "v1", doc: o };
}

/** R20 (0290): each non-passing status blocks only under its own setting. */
export function blocks(
  status: string,
  s: { readonly failBlocking: boolean; readonly regressionBlocking: boolean },
): boolean {
  return (status === "fail" && s.failBlocking) || (status === "regression" && s.regressionBlocking);
}
