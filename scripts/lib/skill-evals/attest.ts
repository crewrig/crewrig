// attest.ts — the deterministic attestation check (spec 0290 R37, R38, R20, R21).
//
// No model call, no credential. For each skill selected by the content-hash comparison (the same
// selection as `--changed`), decide ONE status: `no-evals` (no evals/ directory), `invalid`
// (evals.json missing or invalid under R6, or a symlink / non-ignored untracked file under a
// hashed path), `stale` (results file absent, unparseable, incomplete, mock, another skill, a
// status other than pass/fail/regression, a former-shape file, or a different content hash), else
// the recorded status. `invalid` and `stale` always block; `no-evals`, a recorded `fail` and a
// recorded `regression` block only under `missing-evals-blocking`, `fail-blocking` and
// `regression-blocking`; the `fail` and `regression` conditions are decided by `decide()` from the
// recorded figures, the same function the runner uses (R20, R37).
//
// Usage: attestSelection(repoRoot, selection, settings). Exit codes: not applicable (library).
// Finding-line format: `<skill>: <status>[: <reason>]`.

import fs from "node:fs";
import path from "node:path";

import { validateEvals, formatViolation } from "./schema.ts";
import { blocks, decide, figuresOf, resultsPath, verifyResults } from "./results.ts";
import type { ResultsRecord } from "./results.ts";
import type { Selection } from "./select.ts";
import { FAIL_BLOCKING, MISSING_EVALS_BLOCKING, REGRESSION_BLOCKING } from "./settings.ts";

export type AttestStatus = "pass" | "fail" | "regression" | "invalid" | "no-evals" | "stale";

export interface AttestOutcome {
  readonly skill: string;
  readonly status: AttestStatus;
  readonly reason: string;
  readonly blocking: boolean;
  readonly record?: ResultsRecord;
}

export interface AttestSettings {
  readonly regressionBlocking: boolean;
  readonly failBlocking: boolean;
  readonly missingEvalsBlocking: boolean;
}

export const DEFAULT_ATTEST_SETTINGS: AttestSettings = {
  regressionBlocking: REGRESSION_BLOCKING,
  failBlocking: FAIL_BLOCKING,
  missingEvalsBlocking: MISSING_EVALS_BLOCKING,
};

/** The evals.json validity of a skill directory: the list of violations (empty when valid). */
export function evalsViolations(
  skillDirAbs: string,
  skillName: string,
  relFile: string,
  /** The evals.json bytes of the single snapshot read (undefined: the file is not in the snapshot). */
  text: string | undefined,
): string[] {
  if (text === undefined)
    return [`${relFile}: $: R1: evals/ exists but evals/evals.json is missing`];
  const { violations } = validateEvals(text, {
    file: relFile,
    skillDir: skillDirAbs,
    skillName,
  });
  return violations.map(formatViolation);
}

/** evals/evals.json as read once into the snapshot that is hashed and installed (never re-read from disk). */
export function snapshotEvalsText(sel: Selection): string | undefined {
  if (sel.head.kind !== "ok") return undefined;
  const f = sel.head.files.find((x) => x.rel === "evals/evals.json");
  return f === undefined ? undefined : f.bytes.toString("utf8");
}

export function attestSelection(
  sel: Selection,
  settings: AttestSettings = DEFAULT_ATTEST_SETTINGS,
): AttestOutcome {
  const name = sel.skill.name;
  const mk = (
    status: AttestStatus,
    reason: string,
    blocking: boolean,
    record?: ResultsRecord,
  ): AttestOutcome => ({
    skill: name,
    status,
    reason,
    blocking,
    ...(record !== undefined ? { record } : {}),
  });
  if (!fs.existsSync(path.join(sel.skill.dirAbs, "evals")))
    return mk("no-evals", `${name} has no evals/ directory`, settings.missingEvalsBlocking);
  if (sel.head.kind === "invalid") return mk("invalid", sel.head.problems.join("; "), true);
  if (sel.head.kind !== "ok" || sel.headHash === undefined)
    return mk("invalid", "the skill cannot be read", true);
  const bad = evalsViolations(
    sel.skill.dirAbs,
    name,
    `${sel.skill.dirRel}/evals/evals.json`,
    snapshotEvalsText(sel),
  );
  if (bad.length > 0) return mk("invalid", bad.join("; "), true);
  const rf = resultsPath(sel.skill.dirAbs);
  const text = fs.existsSync(rf) ? fs.readFileSync(rf, "utf8") : undefined;
  const v = verifyResults(text, name, sel.headHash);
  if (!v.ok) return mk("stale", v.reason, true);
  const r = v.record;
  const d = decide(figuresOf(r));
  const reason =
    r.status === "regression"
      ? `base eval pass rate ${r.base_eval_pass_rate}, eval pass rate ${r.eval_pass_rate}, tolerance ${r.tolerance}`
      : r.status === "fail"
        ? `eval pass rate ${r.eval_pass_rate}, probe pass rate ${r.probe_pass_rate ?? "n/a"}, threshold ${r.threshold}`
        : `recorded status ${r.status}`;
  return mk(r.status, reason, blocks(d, settings), r);
}
