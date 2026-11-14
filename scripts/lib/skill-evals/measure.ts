// measure.ts — how a measurement starts: resume, refuse or restart (spec 0304 R5, R8, R10).
//
// Given the working-tree results file, the merge-base copy and the revisions committed in
// `<merge-base>..HEAD`, `decideStart` acts on the content hash and the status of the working-tree
// file: (a) the same hash, `in-progress`, the same plan and ticket: resume; (b) the same hash and a
// final status: refuse, the measurement is complete; (c) the same hash, `in-progress`, another
// ticket: refuse; (d) another hash, or an unfinished file of another plan: a new measurement, the
// previous file moves into the ledger (`abandoned` when unfinished); (e) no file, an unparseable
// one or a schema-1 one: a new measurement (a schema-1 file never enters the ledger); (f) a new
// measurement of a hash that has a final entry in the union of all sources: refuse, because
// measuring identical content again is a reroll. No flag, setting or variable allows it.
//
// Usage: decideStart(input) -> Start. Exit codes: not applicable (library). Finding-line format: not applicable.

import {
  branchEntries,
  entryId,
  FINAL_STATUSES,
  mergeBaseSet,
  spendOf,
  unionEntries,
  v2Docs,
} from "./ledger.ts";
import type { History, LedgerEntry } from "./ledger.ts";
import { caseProblem } from "./case-hash.ts";
import { parseResults, planCopy, planEquals } from "./results.ts";
import type { ResultsRecord } from "./results.ts";
import { shapeProblem } from "./results-verify.ts";
import type { EvalsFile } from "./schema.ts";
import { MAX_MEASUREMENT_USD, RUNNER_VERSION } from "./settings.ts";
import { recordedSpend } from "./spend.ts";

export interface StartInput {
  readonly skill: string;
  readonly contentHash: string;
  readonly ticket: string;
  /** ISO 8601 UTC time of the declaration. */
  readonly now: string;
  readonly evals: EvalsFile;
  /** The case hash of every eval, by id (case-hash.ts). */
  readonly caseHashes: ReadonlyMap<number, string>;
  readonly workingText: string | undefined;
  readonly history: History;
  readonly executorModel: string;
  readonly judgeModel: string;
  readonly effort: string;
  /** The cost cap of one measurement (R22), `MAX_MEASUREMENT_USD` unless a test overrides it. */
  readonly maxMeasurementUsd?: number;
}

export interface Accepted {
  readonly record: ResultsRecord;
  /** The skill's spend since the merge-base, resumed measurement included (R22(c)). */
  readonly branchSpend: number;
  /** The worst case of the measurement still to run (R22). */
  readonly worst: number;
  /** The entries of the branch, the current measurement included (R10): the report's count. */
  readonly branchCount: number;
  /** True for a resumed measurement. */
  readonly resumed: boolean;
}

export type Start =
  | ({ readonly kind: "new" | "resume" } & Accepted)
  | { readonly kind: "refuse"; readonly message: string };

/** A fresh `in-progress` record: the plan, the ticket, the declaration time and no recorded run. */
export function freshRecord(input: StartInput, ledger: LedgerEntry[]): ResultsRecord {
  return {
    schema_version: 2,
    skill_name: input.skill,
    content_hash: input.contentHash,
    runner_version: RUNNER_VERSION,
    executor_model: input.executorModel,
    judge_model: input.judgeModel,
    effort: input.effort,
    plan: planCopy(),
    ticket: input.ticket,
    declared_at: input.now,
    date: input.now,
    status: "in-progress",
    stage_reached: {
      evals: 1,
      probes: input.evals.trigger_probes.length === 0 ? null : 1,
    },
    evals: input.evals.evals.map((e) => ({
      id: e.id,
      case_hash: input.caseHashes.get(e.id) ?? "",
      runs: [],
    })),
    probes: input.evals.trigger_probes.map((p, i) => ({
      index: i + 1,
      should_trigger: p.should_trigger,
      runs: [],
    })),
    eval_passes: 0,
    eval_runs: 0,
    eval_pass_rate: 0,
    probe_passes: 0,
    probe_runs: 0,
    probe_pass_rate: input.evals.trigger_probes.length === 0 ? null : 0,
    base: null,
    regression: null,
    errors: [],
    executor_runs: 0,
    judge_calls: 0,
    cost_usd: 0,
    judge_cost_usd: null,
    ledger,
  };
}

export function decideStart(input: StartInput): Start {
  const { history: hist, contentHash: hash } = input;
  const wt = parseResults(input.workingText);
  const wtDoc = wt.kind === "v2" ? wt.doc : undefined;
  const usable = wtDoc !== undefined && shapeProblem(wtDoc) === undefined;
  const sources = [
    ...(wtDoc === undefined ? [] : [wtDoc]),
    ...v2Docs(hist.revisions),
    ...v2Docs([hist.mbText]),
  ];
  const mbSet = mergeBaseSet(hist);
  const refuse = (message: string): Start => ({ kind: "refuse", message });
  const accept = (kind: "new" | "resume", record: ResultsRecord, ledger: LedgerEntry[]): Start => {
    const resumed = kind === "resume";
    const recorded = resumed ? recordedSpend(record) : 0;
    const branch = branchEntries(ledger, mbSet);
    return {
      kind,
      record: { ...record, ledger },
      branchSpend: spendOf(branch) + recorded,
      worst: (input.maxMeasurementUsd ?? MAX_MEASUREMENT_USD) - recorded,
      branchCount: branch.length + 1,
      resumed,
    };
  };
  if (usable) {
    const rec = wtDoc as unknown as ResultsRecord;
    if (rec.content_hash === hash && rec.status !== "in-progress")
      return refuse(
        `measurement complete for ${hash}: the status ${rec.status} is recorded in evals/results.json; ` +
          "change the skill content for a new measurement, or read the recorded status",
      );
    if (rec.content_hash === hash && rec.status === "in-progress") {
      if (rec.ticket !== input.ticket)
        return refuse(
          `the measurement of ${hash} is in progress under ticket ${rec.ticket}; this invocation is ticket ${input.ticket}: resume it under ticket ${rec.ticket}`,
        );
      if (planEquals(rec.plan)) {
        // R14: the case hashes are recorded at the start, so a case edited since would make the
        // finished file permanently stale; refuse instead of continuing into it.
        const edited = caseProblem(
          new Map(rec.evals.map((e) => [e.id, e.case_hash] as const)),
          input.caseHashes,
        );
        if (edited !== undefined)
          return refuse(
            `cannot resume the measurement of ${hash}: ${edited}, so the finished file would be stale for good; ` +
              "restore the case, or change the skill content (any edit of SKILL.md or evals/evals.json gives a new hash) to start a new measurement",
          );
        const ledger = unionEntries(sources, entryId(rec));
        return accept("resume", rec, ledger);
      }
    }
  }
  const union = unionEntries(sources);
  const done = union.find((e) => e.content_hash === hash && FINAL_STATUSES.has(e.status));
  if (done !== undefined) return refuse(`content already measured: ${hash}`);
  return accept("new", freshRecord(input, union), union);
}
