// compare.ts — arm comparison, the extension rule and the truncation mapping (spec 0308 R8, R12).

import type { Status } from "./criteria.ts";

export interface AttemptRecord {
  status: Status;
  note: string;
  subtype: string | null;
  costUsd: number | null;
  /** What the ledger was charged for this attempt. */
  charged: number;
  firstCallTokens: number | null;
}

export interface RunRecord {
  scenario: number;
  arm: "A" | "B";
  runIndex: number;
  attempts: AttemptRecord[];
  status: Status;
  /** The run and its single rerun were both truncated (non-success result subtype). */
  truncatedTwice: boolean;
  /**
   * Re-scored from an earlier invocation's first attempt (`--seed-arm-a`, delta-03 ADDED 2): its cost
   * was paid and is not charged to the ledger of this one.
   */
  seeded?: boolean;
}

export type VerdictKind = "no-regression" | "extend" | "regression" | "blocked" | "control-failed";
export interface ScenarioVerdict {
  verdict: VerdictKind;
  extend: boolean;
}

/**
 * A run truncated twice is `invalid`. In arm B, when the paired arm-A run (same index) completed, the
 * cell counts as `fail` so a truncation can never hide a regression; in arm A it stays `invalid`.
 */
export function applyTruncationRule(a: RunRecord[], b: RunRecord[]): { a: Status[]; b: Status[] } {
  const aByIdx = new Map(a.map((r) => [r.runIndex, r.status]));
  return {
    a: a.map((r) => r.status),
    b: b.map((r) => {
      const paired = aByIdx.get(r.runIndex);
      return r.status === "invalid" &&
        r.truncatedTwice &&
        paired !== undefined &&
        paired !== "invalid"
        ? "fail"
        : r.status;
    }),
  };
}

const rate = (s: Status[]): number => {
  const valid = s.filter((x) => x !== "invalid");
  return valid.length === 0 ? 0 : valid.filter((x) => x === "pass").length / valid.length;
};
const disagree = (s: Status[]): boolean => new Set(s.filter((x) => x !== "invalid")).size > 1;

/**
 * Verdict for one scenario. Runs disagreeing within an arm, or arms diverging, extend to `extendTo`
 * runs per arm before any conclusion; after the extension B below A is a regression. An invalid run
 * blocks the conclusion, but never hides a regression visible among the valid runs.
 */
export function scenarioVerdict(
  a: Status[],
  b: Status[],
  opts: { extendTo: number },
): ScenarioVerdict {
  const hasInvalid = [...a, ...b].includes("invalid");
  const extended = Math.min(a.length, b.length) >= opts.extendTo;
  const diverge = rate(a) !== rate(b);
  const needsExtension = disagree(a) || disagree(b) || diverge;
  const regression = rate(b) < rate(a);
  if (extended && regression) return { verdict: "regression", extend: false };
  if (hasInvalid) return { verdict: "blocked", extend: false };
  if (needsExtension && !extended) return { verdict: "extend", extend: true };
  return { verdict: "no-regression", extend: false };
}

/** The S5 control gate (delta-03 ADDED 3): arm A passes at least 4 of 5 runs (a ratio of 0.8). */
export const CONTROL_GATE_SCENARIO = 5;
export function controlGate(a: Status[]): { holds: boolean; passes: number; runs: number } {
  const passes = a.filter((x) => x === "pass").length;
  return { holds: a.length > 0 && passes * 5 >= a.length * 4, passes, runs: a.length };
}
