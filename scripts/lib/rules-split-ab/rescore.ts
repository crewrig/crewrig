// rescore.ts — offline re-score of existing run directories (spec 0308 delta-02 ADDED 5). Reads
// `runs/s<N>-<arm><idx>-try<k>.transcript.jsonl` and its `.calls.jsonl`, scores the last try of each
// cell with the current criteria and compares with the status recorded in `ledger.json`. No model call.

import fs from "node:fs";
import path from "node:path";

import type { RunRecord } from "./compare.ts";
import { scoreRun } from "./criteria.ts";
import type { RunScore, Status } from "./criteria.ts";

export interface Counts {
  pass: number;
  fail: number;
  invalid: number;
}
export interface Flip {
  tag: string;
  before: Status;
  after: Status;
}
export interface TryResult {
  tag: string;
  attempt: number;
  status: Status;
  note: string;
}
export interface SourceResult {
  dir: string;
  arms: Record<"A" | "B", Counts>;
  /** Every attempt (try1, try2) of every run, re-scored; `firstAttempts` counts only try1. */
  tries: TryResult[];
  firstAttempts: Record<"A" | "B", Counts>;
  flips: Flip[];
  /** Runs without a recorded status in the ledger. */
  unrecorded: number;
}
export interface RescoreResult {
  scenario: number;
  sources: SourceResult[];
  total: number;
}

const FILE = /^s(\d+)-([AB])(\d+)-try(\d+)\.transcript\.jsonl$/;

function scoreFile(runsDir: string, file: string, scenario: number): RunScore {
  const calls = path.join(runsDir, file.replace(".transcript.", ".calls."));
  return scoreRun(scenario, {
    transcript: fs.readFileSync(path.join(runsDir, file), "utf8"),
    callLog: fs.existsSync(calls) ? fs.readFileSync(calls, "utf8") : null,
  });
}

/**
 * Arm A records seeded from the FIRST attempt of each arm A run of an earlier directory, re-scored
 * with the current criteria (delta-03 ADDED 2). They keep their run index, carry `seeded` so their
 * paid cost is not charged again, and an `invalid` first attempt is dropped by the runner (rerun).
 */
export function seedArmA(dir: string, scenario: number): RunRecord[] {
  const runsDir = path.join(dir, "runs");
  if (!fs.existsSync(runsDir)) throw new Error(`no runs directory in ${dir}`);
  const out: RunRecord[] = [];
  for (const f of fs.readdirSync(runsDir)) {
    const m = FILE.exec(f);
    if (!m || Number(m[1]) !== scenario || m[2] !== "A" || Number(m[4]) !== 1) continue;
    const sc = scoreFile(runsDir, f, scenario);
    out.push({
      scenario,
      arm: "A",
      runIndex: Number(m[3]),
      attempts: [
        {
          status: sc.status,
          note: sc.note,
          subtype: sc.subtype,
          costUsd: sc.costUsd,
          charged: 0,
          firstCallTokens: sc.firstCallTokens,
        },
      ],
      status: sc.status,
      truncatedTwice: false,
      seeded: true,
    });
  }
  return out.sort((x, y) => x.runIndex - y.runIndex);
}

export function rescoreDirs(dirs: string[], scenario: number): RescoreResult {
  const sources: SourceResult[] = [];
  let total = 0;
  for (const dir of dirs) {
    const runsDir = path.join(dir, "runs");
    if (!fs.existsSync(runsDir)) throw new Error(`no runs directory in ${dir}`);
    const recorded = new Map<string, Status>();
    const ledger = path.join(dir, "ledger.json");
    if (fs.existsSync(ledger)) {
      const l = JSON.parse(fs.readFileSync(ledger, "utf8")) as {
        records: Array<{ scenario: number; arm: string; runIndex: number; status: Status }>;
      };
      for (const r of l.records)
        if (r.scenario === scenario) recorded.set(`${r.arm}${r.runIndex}`, r.status);
    }
    // last try of each cell
    const cells = new Map<string, { try: number; file: string }>();
    const tries: TryResult[] = [];
    const firstAttempts = {
      A: { pass: 0, fail: 0, invalid: 0 },
      B: { pass: 0, fail: 0, invalid: 0 },
    };
    for (const f of fs.readdirSync(runsDir)) {
      const m = FILE.exec(f);
      if (!m || Number(m[1]) !== scenario) continue;
      const key = `${m[2]}${m[3]}`;
      const n = Number(m[4]);
      if ((cells.get(key)?.try ?? 0) < n) cells.set(key, { try: n, file: f });
      const sc = scoreFile(runsDir, f, scenario);
      tries.push({ tag: key, attempt: n, status: sc.status, note: sc.note });
      if (n === 1) firstAttempts[m[2] as "A" | "B"][sc.status]++;
    }
    tries.sort(
      (x, y) => x.tag.localeCompare(y.tag, undefined, { numeric: true }) || x.attempt - y.attempt,
    );
    const arms = {
      A: { pass: 0, fail: 0, invalid: 0 },
      B: { pass: 0, fail: 0, invalid: 0 },
    };
    const flips: Flip[] = [];
    let unrecorded = 0;
    const keys = [...cells.keys()].sort((x, y) => x.localeCompare(y, undefined, { numeric: true }));
    for (const key of keys) {
      const file = (cells.get(key) as { file: string }).file;
      const after = scoreFile(runsDir, file, scenario).status;
      arms[key[0] as "A" | "B"][after]++;
      total++;
      const before = recorded.get(key);
      if (before === undefined) unrecorded++;
      else if (before !== after) flips.push({ tag: key, before, after });
    }
    sources.push({ dir, arms, tries, firstAttempts, flips, unrecorded });
  }
  return { scenario, sources, total };
}

export function formatRescore(r: RescoreResult): string {
  const out: string[] = [`offline re-score of scenario ${r.scenario}: ${r.total} transcripts`];
  const sum = { A: { pass: 0, fail: 0, invalid: 0 }, B: { pass: 0, fail: 0, invalid: 0 } };
  for (const s of r.sources) {
    out.push(`source ${s.dir}`);
    for (const arm of ["A", "B"] as const) {
      const c = s.arms[arm];
      out.push(`  arm ${arm}: pass ${c.pass}, fail ${c.fail}, invalid ${c.invalid}`);
      sum[arm].pass += c.pass;
      sum[arm].fail += c.fail;
      sum[arm].invalid += c.invalid;
    }
    for (const t of s.tries) out.push(`  s${r.scenario}-${t.tag} try${t.attempt}: ${t.status}`);
    for (const arm of ["A", "B"] as const) {
      const c = s.firstAttempts[arm];
      if (c.pass + c.fail + c.invalid > 0)
        out.push(
          `  arm ${arm} first attempts: pass ${c.pass}, fail ${c.fail}, invalid ${c.invalid}`,
        );
    }
    for (const f of s.flips) out.push(`  flip s${r.scenario}-${f.tag} ${f.before} -> ${f.after}`);
    if (s.flips.length === 0) out.push("  no flip against the recorded statuses");
    if (s.unrecorded > 0) out.push(`  ${s.unrecorded} runs have no recorded status`);
  }
  for (const arm of ["A", "B"] as const)
    out.push(
      `all sources, arm ${arm}: pass ${sum[arm].pass}, fail ${sum[arm].fail}, invalid ${sum[arm].invalid}`,
    );
  return out.join("\n") + "\n";
}
