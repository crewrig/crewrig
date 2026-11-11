// results.ts — `evals/results.json`, the committed attestation (spec 0290 R36, R37, R38).
//
// The writer fixes the key order and writes only for a non-mock run whose status is `pass`,
// `regression` or `new` (temp file then rename). The verifier reports why a results file is
// `stale`. The file is self-declared: the verifier proves freshness (the recorded content hash
// matches the current content), not truth (R38).
//
// Usage: writeResults(skillDirAbs, record); verifyResults(text, skillName, currentHash).
// Exit codes: not applicable (library). Finding-line format: not applicable.

import fs from "node:fs";
import path from "node:path";

export const RESULT_STATUSES = ["pass", "regression", "new"] as const;
export type ResultStatus = (typeof RESULT_STATUSES)[number];

export interface ResultsRecord {
  skill_name: string;
  content_hash: string;
  runner_version: string;
  executor_model: string;
  judge_model: string;
  date: string;
  status: ResultStatus;
  benchmark: {
    with_skill_mean: number;
    without_skill_mean: number;
    base_mean: number | null;
    delta_value: number;
    tolerance: number;
  };
  executor_runs: number;
  judge_calls: number;
  cost_usd: number | null;
}

const TOP_KEYS = [
  "skill_name",
  "content_hash",
  "runner_version",
  "executor_model",
  "judge_model",
  "date",
  "status",
  "benchmark",
  "executor_runs",
  "judge_calls",
  "cost_usd",
] as const;
const BENCH_KEYS = [
  "with_skill_mean",
  "without_skill_mean",
  "base_mean",
  "delta_value",
  "tolerance",
] as const;

export const resultsPath = (skillDirAbs: string): string =>
  path.join(skillDirAbs, "evals", "results.json");

export function writeResults(skillDirAbs: string, r: ResultsRecord): void {
  const ordered: Record<string, unknown> = {};
  for (const k of TOP_KEYS) {
    if (k === "benchmark") {
      const b: Record<string, unknown> = {};
      for (const bk of BENCH_KEYS) b[bk] = r.benchmark[bk];
      ordered[k] = b;
    } else ordered[k] = r[k];
  }
  const file = resultsPath(skillDirAbs);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(ordered, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

export type Verification =
  | { readonly ok: true; readonly record: ResultsRecord }
  | { readonly ok: false; readonly reason: string };

export function verifyResults(
  text: string | undefined,
  skillName: string,
  currentHash: string,
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
  for (const k of TOP_KEYS)
    if (!(k in o)) return { ok: false, reason: `evals/results.json lacks the key ${k}` };
  const b = o["benchmark"];
  if (typeof b !== "object" || b === null)
    return { ok: false, reason: "evals/results.json benchmark is not an object" };
  for (const k of BENCH_KEYS)
    if (!(k in (b as object)))
      return { ok: false, reason: `evals/results.json lacks the key benchmark.${k}` };
  if (o["skill_name"] !== skillName)
    return {
      ok: false,
      reason: `evals/results.json names another skill (${JSON.stringify(o["skill_name"])})`,
    };
  if (!(RESULT_STATUSES as readonly unknown[]).includes(o["status"]))
    return {
      ok: false,
      reason: `evals/results.json records the status ${JSON.stringify(o["status"])}, which is not pass, regression or new`,
    };
  if (o["content_hash"] !== currentHash)
    return {
      ok: false,
      reason: `recorded content_hash ${String(o["content_hash"])} differs from the current ${currentHash}`,
    };
  return { ok: true, record: o as unknown as ResultsRecord };
}
