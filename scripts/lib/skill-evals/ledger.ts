// ledger.ts — the ledger of earlier measurements and the history it is rebuilt from (spec 0304
// R8(e), R10).
//
// An entry is identified by `content_hash`, `ticket` and `declared_at`. At every start the previous
// ledger is the union, by identity, of the ledgers and own measurements of the working-tree file,
// the merge-base copy and every revision committed in `<merge-base>..HEAD` (the commits that touch
// the path, read with `git show`; a commit that deletes the file contributes nothing and hides
// nothing), so neither a deletion nor a restore of the file drops an entry. The check compares a
// head file with the same sources: a head that lacks an entry of any of them, or records less
// spend, is `invalid`. Unknown costs count at the assumed figures of the settings.
//
// Usage: readHistory(repoRoot, mergeBase, skillDirRel); unionEntries(docs); ledgerProblem(head, hist).
// Exit codes: not applicable (library). Finding-line format: not applicable.

import { runGit } from "../governance/git-run.ts";
import { parseResults } from "./results.ts";
import type { ResultsRecord } from "./results.ts";
import { JUDGE_ASSUMED_USD, PER_RUN_USD, RUN_ASSUMED_USD } from "./settings.ts";

export interface LedgerEntry {
  content_hash: string;
  ticket: string;
  declared_at: string;
  /** `pass`, `fail`, `regression` or `abandoned`. */
  status: string;
  eval_pass_rate: number | null;
  probe_pass_rate: number | null;
  executor_runs: number;
  judge_calls: number;
  cost_usd: number | null;
  judge_cost_usd: number | null;
  /** True when no run of the measurement reported a cost. */
  cost_assumed: boolean;
}

export interface History {
  /** The results file as committed at the merge-base (undefined when absent there). */
  readonly mbText: string | undefined;
  /** Every revision of the file committed in `<merge-base>..HEAD`, newest first. */
  readonly revisions: readonly string[];
}

/** The range of the history cannot be listed: the ledger check fails closed instead of reading an empty history. */
export class HistoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HistoryError";
  }
}

export const NO_HISTORY: History = { mbText: undefined, revisions: [] };

export const FINAL_STATUSES: ReadonlySet<string> = new Set(["pass", "fail", "regression"]);

export const entryId = (e: Pick<LedgerEntry, "content_hash" | "ticket" | "declared_at">): string =>
  `${e.content_hash}|${e.ticket}|${e.declared_at}`;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** R10: the entry of one measurement (an unfinished one is `abandoned`). */
export function entryOfRecord(r: ResultsRecord): LedgerEntry {
  const noCost =
    r.cost_usd === null &&
    r.executor_runs > 0 &&
    r.evals.every((e) => e.runs.every((x) => x.cost_usd === null));
  return {
    content_hash: r.content_hash,
    ticket: r.ticket,
    declared_at: r.declared_at,
    status: r.status === "in-progress" ? "abandoned" : r.status,
    eval_pass_rate: r.eval_runs === 0 ? null : r.eval_pass_rate,
    probe_pass_rate: r.probe_pass_rate,
    executor_runs: r.executor_runs,
    judge_calls: r.judge_calls,
    cost_usd: r.cost_usd,
    judge_cost_usd: r.judge_cost_usd,
    cost_assumed: noCost,
  };
}

/** R10: the spend of an entry; an unknown cost counts at the assumed figures (conservative). */
export function entrySpend(e: LedgerEntry): number {
  const exec =
    e.cost_usd ?? e.executor_runs * (e.cost_assumed === true ? RUN_ASSUMED_USD : PER_RUN_USD);
  const judge = e.judge_cost_usd ?? e.judge_calls * JUDGE_ASSUMED_USD;
  return exec + judge;
}

export const spendOf = (entries: readonly LedgerEntry[]): number =>
  entries.reduce((n, e) => n + entrySpend(e), 0);

const validEntry = (v: unknown): v is LedgerEntry =>
  isRecord(v) &&
  typeof v["content_hash"] === "string" &&
  typeof v["ticket"] === "string" &&
  typeof v["declared_at"] === "string" &&
  typeof v["status"] === "string";

/** The ledger entries of a schema-2 document, then its own measurement as one more entry. */
export function entriesOf(doc: Record<string, unknown>): LedgerEntry[] {
  const out: LedgerEntry[] = [];
  const ledger = doc["ledger"];
  if (Array.isArray(ledger)) for (const e of ledger) if (validEntry(e)) out.push(normalise(e));
  if (
    typeof doc["content_hash"] === "string" &&
    typeof doc["declared_at"] === "string" &&
    typeof doc["status"] === "string"
  ) {
    const own = doc as unknown as ResultsRecord;
    out.push(
      entryOfRecord({
        ...own,
        ticket: String(own.ticket),
        evals: Array.isArray(own.evals) ? own.evals : [],
        executor_runs: Number(own.executor_runs) || 0,
        judge_calls: Number(own.judge_calls) || 0,
        cost_usd: typeof own.cost_usd === "number" ? own.cost_usd : null,
        judge_cost_usd: typeof own.judge_cost_usd === "number" ? own.judge_cost_usd : null,
      }),
    );
  }
  return out;
}

function normalise(e: LedgerEntry): LedgerEntry {
  return {
    content_hash: e.content_hash,
    ticket: e.ticket,
    declared_at: e.declared_at,
    status: e.status,
    eval_pass_rate: typeof e.eval_pass_rate === "number" ? e.eval_pass_rate : null,
    probe_pass_rate: typeof e.probe_pass_rate === "number" ? e.probe_pass_rate : null,
    executor_runs: Number(e.executor_runs) || 0,
    judge_calls: Number(e.judge_calls) || 0,
    cost_usd: typeof e.cost_usd === "number" ? e.cost_usd : null,
    judge_cost_usd: typeof e.judge_cost_usd === "number" ? e.judge_cost_usd : null,
    cost_assumed: e.cost_assumed === true,
  };
}

/** The schema-2 documents of some results texts (anything else contributes nothing). */
export function v2Docs(texts: readonly (string | undefined)[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const t of texts) {
    const p = parseResults(t);
    if (p.kind === "v2") out.push(p.doc);
  }
  return out;
}

/**
 * R8(e): the union by identity of the entries of the given schema-2 documents, in chronological
 * order. For one identity a final status wins over `abandoned`; `exclude` drops the measurement
 * being resumed (its own identity).
 */
export function unionEntries(
  docs: readonly Record<string, unknown>[],
  exclude?: string,
): LedgerEntry[] {
  const byId = new Map<string, LedgerEntry>();
  for (const d of docs)
    for (const e of entriesOf(d)) {
      const id = entryId(e);
      if (id === exclude) continue;
      const had = byId.get(id);
      if (had === undefined || (!FINAL_STATUSES.has(had.status) && FINAL_STATUSES.has(e.status)))
        byId.set(id, e);
    }
  return [...byId.values()].sort(
    (a, b) =>
      a.declared_at.localeCompare(b.declared_at) || a.content_hash.localeCompare(b.content_hash),
  );
}

/** The results file as committed at the merge-base and at every commit of `<merge-base>..HEAD`. */
export function readHistory(
  repoRoot: string,
  mergeBase: string | undefined,
  skillDirRel: string,
): History {
  if (mergeBase === undefined) return NO_HISTORY;
  const file = `${skillDirRel}/evals/results.json`;
  const show = (rev: string): string | undefined => {
    const r = runGit(["show", `${rev}:${file}`], { cwd: repoRoot });
    return r.status === 0 ? r.stdout.toString("utf8") : undefined;
  };
  // `--full-history`: on a merge-commit checkout (the pull-request merge ref) the default history
  // simplification follows one parent and could hide the commits that restored the file.
  const log = runGit(["log", "--full-history", "--format=%H", `${mergeBase}..HEAD`, "--", file], {
    cwd: repoRoot,
  });
  if (log.status !== 0)
    throw new HistoryError(
      `cannot list the revisions of ${file} in ${mergeBase}..HEAD (git log exit ${log.status}): ${log.stderr.toString("utf8").trim()}`,
    );
  const shas = log.stdout
    .toString("utf8")
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  const revisions: string[] = [];
  for (const sha of shas) {
    const t = show(sha);
    if (t !== undefined) revisions.push(t);
  }
  return { mbText: show(mergeBase), revisions };
}

/** The merge-base set: the entries of the merge-base file's ledger plus its own measurement (schema 2). */
export const mergeBaseSet = (h: History): LedgerEntry[] => unionEntries(v2Docs([h.mbText]));

/** R10: the entries of `all` that are not in the merge-base set: what R8(f), R22(c) and R22(d) count. */
export function branchEntries(
  all: readonly LedgerEntry[],
  mbSet: readonly LedgerEntry[],
): LedgerEntry[] {
  const mb = new Set(mbSet.map(entryId));
  return all.filter((e) => !mb.has(entryId(e)));
}

/**
 * R10, R25: why a head file is `invalid` against the history, or undefined. Every entry of the
 * merge-base set and of every revision committed in the range must be in the head file's entries,
 * and the head's recorded spend must not be lower than theirs.
 */
export function ledgerProblem(head: Record<string, unknown>, hist: History): string | undefined {
  const mine = unionEntries([head]);
  const have = new Set(mine.map(entryId));
  const sources: [string, LedgerEntry[]][] = [
    ["the merge-base file", mergeBaseSet(hist)],
    ...hist.revisions.map((t, i): [string, LedgerEntry[]] => [
      `a committed revision (${i + 1} of ${hist.revisions.length}, newest first)`,
      unionEntries(v2Docs([t])),
    ]),
  ];
  const mySpend = spendOf(mine);
  for (const [label, entries] of sources) {
    const missing = entries.find((e) => !have.has(entryId(e)));
    if (missing !== undefined)
      return `ledger: the file lacks the entry ${missing.content_hash} (ticket ${missing.ticket}, declared ${missing.declared_at}) of ${label}`;
    const theirs = spendOf(entries);
    if (mySpend + 1e-9 < theirs)
      return `ledger: the file records ${mySpend.toFixed(2)} USD, less than the ${theirs.toFixed(2)} USD of ${label}`;
  }
  return undefined;
}

/** R22(c): the spend since the merge-base of a skill, from its working-tree file and the history. */
export function branchSpendOf(workingText: string | undefined, hist: History): number {
  const docs = [...v2Docs([workingText]), ...v2Docs(hist.revisions), ...v2Docs([hist.mbText])];
  return spendOf(branchEntries(unionEntries(docs), mergeBaseSet(hist)));
}
