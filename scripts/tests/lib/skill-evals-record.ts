// skill-evals-record.ts — builders of schema-2 results files for the attestation, ledger and
// measurement suites (spec 0304 R6, R10, R11). A record is built from a skill's real evals.json (its
// case hashes come from case-hash.ts) with the recorded runs the test gives, and every derived
// figure is recomputed with plan.ts, so a record is consistent unless the test breaks it on purpose.
//
// Usage: const rec = buildRecord(selectionOf(repo, "demo"), { evalRuns: [[true, true]] });
//        writeRecord(sel.skill.dirAbs, rec); writeRaw(dirAbs, anyJson).

import fs from "node:fs";
import path from "node:path";

import { decideRecord } from "../../lib/skill-evals/base.ts";
import { caseHashesOf } from "../../lib/skill-evals/case-hash.ts";
import { entryOfRecord } from "../../lib/skill-evals/ledger.ts";
import type { LedgerEntry } from "../../lib/skill-evals/ledger.ts";
import { planCopy, resultsPath, writeResults } from "../../lib/skill-evals/results.ts";
import type { EvalRunRecord, ResultsRecord } from "../../lib/skill-evals/results.ts";
import { snapshotEvalsText } from "../../lib/skill-evals/attest.ts";
import type { Selection } from "../../lib/skill-evals/select.ts";

export interface RecordOptions {
  /** Pass flags of the runs of each eval, in order (default: two passing runs per eval). */
  readonly evalRuns?: readonly (readonly boolean[])[];
  /** Pass flags of the runs of each probe (default: one passing run per probe). */
  readonly probeRuns?: readonly (readonly boolean[])[];
  readonly ticket?: string;
  readonly declaredAt?: string;
  readonly ledger?: readonly LedgerEntry[];
  readonly costUsd?: number | null;
  readonly judgeCostUsd?: number | null;
  readonly contentHash?: string;
  /** Force the recorded status instead of the recomputed one (to build an inconsistent file). */
  readonly status?: ResultsRecord["status"];
}

const run = (passed: boolean, cost: number | null): EvalRunRecord => ({
  passed,
  assertions: passed ? "11" : "10",
  skill_loaded: true,
  cost_usd: cost,
  reasked: false,
});

/** A consistent schema-2 record of `sel`, its derived figures recomputed with plan.ts. */
export function buildRecord(sel: Selection, o: RecordOptions = {}): ResultsRecord {
  const name = sel.skill.name;
  const text = snapshotEvalsText(sel) ?? "";
  const doc = JSON.parse(text) as {
    evals: { id: number }[];
    trigger_probes?: { should_trigger: boolean }[];
  };
  const hashes = caseHashesOf(text, sel.skill.dirAbs);
  const probes = doc.trigger_probes ?? [];
  const cost = o.costUsd === undefined ? 0.1 : o.costUsd;
  const evals = doc.evals.map((e, i) => ({
    id: e.id,
    case_hash: hashes.get(e.id) ?? "",
    runs: (o.evalRuns?.[i] ?? [true, true]).map((p) => run(p, cost)),
  }));
  const probeEntries = probes.map((p, i) => ({
    index: i + 1,
    should_trigger: p.should_trigger,
    runs: [...(o.probeRuns?.[i] ?? [true])],
  }));
  const at = o.declaredAt ?? "2026-01-01T00:00:00.000Z";
  const base: ResultsRecord = {
    schema_version: 2,
    skill_name: name,
    content_hash: o.contentHash ?? sel.headHash ?? "",
    runner_version: "3.0.0",
    executor_model: "m",
    judge_model: "j",
    effort: "medium",
    plan: planCopy(),
    ticket: o.ticket ?? "1958",
    declared_at: at,
    date: at,
    status: "pass",
    stage_reached: { evals: 1, probes: probes.length === 0 ? null : 1 },
    evals,
    probes: probeEntries,
    eval_passes: 0,
    eval_runs: 0,
    eval_pass_rate: 0,
    probe_passes: 0,
    probe_runs: 0,
    probe_pass_rate: probes.length === 0 ? null : 0,
    base: null,
    regression: null,
    errors: [],
    executor_runs:
      evals.reduce((n, e) => n + e.runs.length, 0) +
      probeEntries.reduce((n, e) => n + e.runs.length, 0),
    judge_calls: evals.reduce((n, e) => n + e.runs.length, 0),
    cost_usd: cost === null ? null : cost * evals.reduce((n, e) => n + e.runs.length, 0),
    judge_cost_usd: o.judgeCostUsd === undefined ? 0.05 : o.judgeCostUsd,
    ledger: [...(o.ledger ?? [])],
  };
  return recompute(base, sel, o.status);
}

/** Recompute the derived figures of a record from its runs (as progress.applyDecision does). */
export function recompute(
  r: ResultsRecord,
  sel: Pick<Selection, "baseResultsText" | "mergeBase">,
  forced?: ResultsRecord["status"],
): ResultsRecord {
  const { decision, comparison } = decideRecord(
    r.evals,
    r.probes,
    r.skill_name,
    sel.baseResultsText,
    sel.mergeBase ?? "",
  );
  const p = decision.probes;
  const final = decision.status !== "in-progress";
  return {
    ...r,
    status: forced ?? decision.status,
    executor_runs: Math.max(
      r.executor_runs,
      r.evals.reduce((n, e) => n + e.runs.length, 0) +
        r.probes.reduce((n, e) => n + e.runs.length, 0),
    ),
    cost_usd:
      r.cost_usd === null
        ? null
        : Math.max(
            r.cost_usd,
            r.evals.flatMap((e) => e.runs).reduce((n, x) => n + (x.cost_usd ?? 0), 0),
          ),
    stage_reached: decision.stageReached,
    eval_passes: decision.evals.passes,
    eval_runs: decision.evals.runs,
    eval_pass_rate: decision.evals.runs === 0 ? 0 : decision.evals.passes / decision.evals.runs,
    probe_passes: p?.passes ?? 0,
    probe_runs: p?.runs ?? 0,
    probe_pass_rate: p === null ? null : p.runs === 0 ? 0 : p.passes / p.runs,
    base: final && comparison !== null ? comparison.block : null,
    regression:
      decision.regression === null
        ? null
        : {
            drop: Math.round(decision.regression.drop * 1e6) / 1e6,
            p_value: Math.round(decision.regression.pValue * 1e6) / 1e6,
          },
  };
}

export const writeRecord = (skillDirAbs: string, r: ResultsRecord): void =>
  writeResults(skillDirAbs, r);

/** Write any JSON (or text) as the skill's results file, bypassing the writer (a broken file). */
export function writeRaw(skillDirAbs: string, content: unknown): void {
  const file = resultsPath(skillDirAbs);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`,
  );
}

export const readRecord = (skillDirAbs: string): ResultsRecord =>
  JSON.parse(fs.readFileSync(resultsPath(skillDirAbs), "utf8")) as ResultsRecord;

/** The ledger entry of a record (an unfinished one is `abandoned`). */
export const entryOf = (r: ResultsRecord): LedgerEntry => entryOfRecord(r);

/** A hand-written ledger entry. */
export function ledgerEntry(over: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    content_hash: "sha256:aaaa",
    ticket: "1",
    declared_at: "2025-12-01T00:00:00.000Z",
    status: "fail",
    eval_pass_rate: 0.5,
    probe_pass_rate: null,
    executor_runs: 10,
    judge_calls: 10,
    cost_usd: 1,
    judge_cost_usd: 0.3,
    cost_assumed: false,
    ...over,
  };
}

/**
 * Pass flags of `items` items over the stages of the plan: `passes[s]` of the `perStage[s] * items`
 * runs of stage `s` pass (assigned run-major, so every item gets its share). The result has one
 * array per item holding the runs of every stage in order.
 */
export function stagedRuns(
  items: number,
  perStage: readonly number[],
  passes: readonly number[],
): boolean[][] {
  const out: boolean[][] = Array.from({ length: items }, () => []);
  perStage.forEach((n, s) => {
    const left = passes[s] ?? 0;
    for (let j = 0; j < n; j++) for (let i = 0; i < items; i++) out[i]?.push(j * items + i < left);
  });
  return out;
}

/** `n` runs of every one of `items` items, all passing. */
export const allPass = (items: number, n: number): boolean[][] =>
  Array.from({ length: items }, () => Array.from({ length: n }, () => true));
