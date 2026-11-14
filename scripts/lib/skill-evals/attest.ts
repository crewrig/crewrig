// attest.ts — the deterministic attestation check (spec 0290 R37, R38, R20, R21).
//
// No model call, no credential. For each skill selected by the content-hash comparison (the same
// selection as `--changed`), decide ONE status: `no-evals` (no evals/ directory), `invalid`
// (evals.json missing or invalid under R6, or a symlink / non-ignored untracked file under a
// hashed path), `stale` (results file absent, unparseable, incomplete, mock, another skill, a
// schema-1 file, `in-progress`, another plan, a different content hash, or a case_hash or eval list
// that differs from the tree's), else the status recomputed by plan.ts from the recorded runs and
// the merge-base file as it stands now (spec 0304 R25). `invalid` (also a file that fails the R11
// verification or the R10 ledger rule) and `stale` always block; `no-evals`, `fail` and
// `regression` block only under `missing-evals-blocking`, `fail-blocking` and
// `regression-blocking`.
//
// Usage: attestSelection(repoRoot, selection, settings). Exit codes: not applicable (library).
// Finding-line format: `<skill>: <status>[: <reason>]`.

import fs from "node:fs";
import path from "node:path";

import { caseHashesOf, caseProblem } from "./case-hash.ts";
import {
  branchEntries,
  ledgerProblem,
  mergeBaseSet,
  HistoryError,
  readHistory,
  unionEntries,
  v2Docs,
} from "./ledger.ts";
import type { History } from "./ledger.ts";
import { verifyRecord } from "./results-verify.ts";
import { validateEvals, formatViolation } from "./schema.ts";
import { blocks, parseResults, planEquals, resultsPath } from "./results.ts";
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
  /** R10: the branch entries of the skill's measurements; absent when no schema-2 file was read. */
  readonly branchMeasurements?: number;
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

const STALE_SCHEMA_1 = "schema 1: re-measure under the sampling plan";

export function attestSelection(
  sel: Selection,
  settings: AttestSettings = DEFAULT_ATTEST_SETTINGS,
  /** The repository, for the revisions committed in `<merge-base>..HEAD` (R10); without it only the merge-base copy is compared. */
  repoRoot?: string,
): AttestOutcome {
  const name = sel.skill.name;
  const mk = (
    status: AttestStatus,
    reason: string,
    blocking: boolean,
    extra: { record?: ResultsRecord; branch?: number } = {},
  ): AttestOutcome => ({
    skill: name,
    status,
    reason,
    blocking,
    ...(extra.record !== undefined ? { record: extra.record } : {}),
    ...(extra.branch !== undefined ? { branchMeasurements: extra.branch } : {}),
  });
  if (!fs.existsSync(path.join(sel.skill.dirAbs, "evals")))
    return mk("no-evals", `${name} has no evals/ directory`, settings.missingEvalsBlocking);
  if (sel.head.kind === "invalid") return mk("invalid", sel.head.problems.join("; "), true);
  if (sel.head.kind !== "ok" || sel.headHash === undefined)
    return mk("invalid", "the skill cannot be read", true);
  const evalsText = snapshotEvalsText(sel);
  const bad = evalsViolations(
    sel.skill.dirAbs,
    name,
    `${sel.skill.dirRel}/evals/evals.json`,
    evalsText,
  );
  if (bad.length > 0) return mk("invalid", bad.join("; "), true);
  const rf = resultsPath(sel.skill.dirAbs);
  const p = parseResults(fs.existsSync(rf) ? fs.readFileSync(rf, "utf8") : undefined);
  const stale = (reason: string, branch?: number) =>
    mk("stale", reason, true, branch === undefined ? {} : { branch });
  if (p.kind === "absent") return stale("evals/results.json is absent");
  if (p.kind === "unparseable") return stale(p.reason);
  if (p.kind === "mock") return stale("evals/results.json records a mock run");
  if (p.kind === "v1") return stale(STALE_SCHEMA_1);
  const doc = p.doc;
  if (doc["skill_name"] !== name)
    return stale(`evals/results.json names another skill (${JSON.stringify(doc["skill_name"])})`);
  let hist: History;
  try {
    hist =
      repoRoot !== undefined && sel.mergeBase !== undefined
        ? readHistory(repoRoot, sel.mergeBase, sel.skill.dirRel)
        : { mbText: sel.baseResultsText, revisions: [] };
  } catch (e) {
    if (e instanceof HistoryError) return mk("invalid", e.message, true);
    throw e;
  }
  const branch = branchEntries(
    unionEntries([doc, ...v2Docs(hist.revisions)]),
    mergeBaseSet(hist),
  ).length;
  const ledger = ledgerProblem(doc, hist);
  if (ledger !== undefined) return mk("invalid", ledger, true, { branch });
  if (doc["status"] === "in-progress")
    return stale(
      "the measurement is in-progress (interrupted); resume it with task skill-evals",
      branch,
    );
  if (!planEquals(doc["plan"]))
    return stale("the recorded plan differs from the sampling plan", branch);
  if (doc["content_hash"] !== sel.headHash)
    return stale(
      `recorded content_hash ${String(doc["content_hash"])} differs from the current ${sel.headHash}`,
      branch,
    );
  const v = verifyRecord(doc, {
    skillName: name,
    baseText: sel.baseResultsText,
    mergeBase: sel.mergeBase ?? "",
  });
  if (!v.ok) return mk("invalid", v.reason, true, { branch });
  const r = v.record;
  const recorded = new Map(r.evals.map((e) => [e.id, e.case_hash] as const));
  const tree = caseHashesOf(evalsText ?? "", sel.skill.dirAbs);
  const cp = caseProblem(recorded, tree);
  if (cp !== undefined) return stale(cp, branch);
  const d = v.decision;
  const status = d.status as AttestStatus;
  const fig = (n: number, of: number) => `${n}/${of}`;
  const reason =
    status === "regression" && d.regression !== null && v.comparison !== null
      ? `base ${fig(v.comparison.base.passes, v.comparison.base.runs)}${v.comparison.block.schema_version === 1 ? " (legacy)" : ""}, head ${fig(v.comparison.head.passes, v.comparison.head.runs)}, drop ${d.regression.drop.toFixed(3)}, p ${d.regression.pValue.toFixed(3)}`
      : status === "fail"
        ? `eval pass rate ${fig(d.evals.passes, d.evals.runs)} (stage ${d.stageReached.evals}), probe pass rate ${d.probes === null ? "n/a" : fig(d.probes.passes, d.probes.runs)}`
        : `recomputed status ${status}`;
  return mk(status, reason, blocks(status, settings), { record: r, branch });
}
