// spend.ts — the cost of a measurement, counted as the caps count it (spec 0304 R22, R23).
//
// A run whose cost is unknown counts at `PER_RUN_USD`; when no run of the measurement reported a
// cost, every run counts at `RUN_ASSUMED_USD` and carries `cost_assumed: true`, so the runner stays
// usable with a driver that reports none. A judge call whose cost is not recorded counts at
// `JUDGE_ASSUMED_USD`. `MeasureMeter` is the live counter of one measurement; `recordedSpend` is the
// same figure for a file already on disk; `ticketSpend` sums a ticket label over the working tree.
//
// Usage: new MeasureMeter(prior, judge); recordedSpend(record); ticketSpend(repoRoot, ticket).
// Exit codes: not applicable (library). Finding-line format: not applicable.

import fs from "node:fs";
import path from "node:path";

import { entryOfRecord, entrySpend, entriesOf, v2Docs } from "./ledger.ts";
import { parseResults } from "./results.ts";
import type { ResultsRecord } from "./results.ts";
import { JUDGE_ASSUMED_USD, PER_RUN_USD, RUN_ASSUMED_USD } from "./settings.ts";

/** The spend recorded in a results file (executor and judge), unknown costs at the assumed figures. */
export const recordedSpend = (r: ResultsRecord): number => entrySpend(entryOfRecord(r));

export interface JudgeCounters {
  callsUsed(): number;
  costUsd(): number | null;
}

/** Costs are summed as integer micro-dollars, so no float drift builds up across resume sessions. */
export const micros = (usd: number): number => Math.round(usd * 1e6);

/** The live cost counter of one measurement; `prior` is what the resumed file already holds. */
export class MeasureMeter {
  private readonly costs: (number | null)[] = [];
  private readonly prior: ResultsRecord | undefined;
  private readonly judge: JudgeCounters;
  constructor(prior: ResultsRecord | undefined, judge: JudgeCounters) {
    this.prior = prior;
    this.judge = judge;
  }
  /** Account one executor attempt (a run, a probe or a failed attempt). */
  addRun(cost: number | null): void {
    this.costs.push(cost);
  }
  /** True when some run of the measurement so far reported a cost. */
  get reported(): boolean {
    const p = this.prior;
    const before =
      p !== undefined &&
      (p.cost_usd !== null || p.evals.some((e) => e.runs.some((x) => x.cost_usd !== null)));
    return before || this.costs.some((c) => c !== null);
  }
  /** R23: whether a run of unknown cost recorded now is an assumed one. */
  get assumed(): boolean {
    return !this.reported;
  }
  private get executorUsd(): number {
    const unit = this.reported ? PER_RUN_USD : RUN_ASSUMED_USD;
    return this.costs.reduce<number>((n, c) => n + (c ?? unit), 0);
  }
  private get judgeUsd(): number {
    return this.judge.costUsd() ?? this.judge.callsUsed() * JUDGE_ASSUMED_USD;
  }
  /** R22: the cost of the measurement so far, the figure the runtime cap is compared with. */
  get total(): number {
    return (
      (this.prior === undefined ? 0 : recordedSpend(this.prior)) + this.executorUsd + this.judgeUsd
    );
  }
  /** The file's `cost_usd`: the measured sum, null once any run's cost is unknown. */
  get costUsd(): number | null {
    const p = this.prior?.cost_usd;
    if (p === null || this.costs.some((c) => c === null)) return null;
    return (micros(p ?? 0) + this.costs.reduce<number>((n, c) => n + micros(c ?? 0), 0)) / 1e6;
  }
  /** The file's `judge_cost_usd`: the measured sum, null when no call reported a cost. */
  get judgeCostUsd(): number | null {
    const mine = this.judge.costUsd();
    const before = this.prior?.judge_cost_usd ?? null;
    return mine === null ? before : (micros(before ?? 0) + micros(mine)) / 1e6;
  }
}

/** R22(d): the recorded spend of a ticket label over every results file of the working tree. */
export function ticketSpend(repoRoot: string, ticket: string): number {
  let total = 0;
  const skills = path.join(repoRoot, "artifacts");
  let layers: string[] = [];
  try {
    layers = fs.readdirSync(skills);
  } catch {
    return 0;
  }
  for (const layer of layers) {
    const dir = path.join(skills, layer, "skills");
    let names: string[] = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const n of names) {
      const file = path.join(dir, n, "evals", "results.json");
      let text: string | undefined;
      try {
        text = fs.readFileSync(file, "utf8");
      } catch {
        continue;
      }
      if (parseResults(text).kind !== "v2") continue;
      for (const doc of v2Docs([text]))
        for (const e of entriesOf(doc)) if (e.ticket === ticket) total += entrySpend(e);
    }
  }
  return total;
}
