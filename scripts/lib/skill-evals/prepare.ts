// prepare.ts — classification and start of the measurements of a run, before any model call
// (spec 0304 R8, R22; 0290 R6, R23).
//
// `classify` sorts the selected skills into no-evals, invalid and ready (a valid evals.json, a
// readable head snapshot). `startSkills` reads the previous results file and the history of the
// range for each ready skill and decides, per skill, to resume, restart or refuse (measure.ts), and
// turns the outcome into the rows the spend caps are checked on (budget.ts). A mock run reads no
// results file and no history: every skill starts a fresh in-memory measurement.
//
// Usage: classify(selections, cfg); startSkills(args). Exit codes: not applicable (library).
// Finding-line format: not applicable.

import fs from "node:fs";
import path from "node:path";

import { decideRecord } from "./base.ts";
import { evalsViolations, snapshotEvalsText } from "./attest.ts";
import { planSkill } from "./budget.ts";
import type { SkillPlan, SpendRow } from "./budget.ts";
import { caseHashesOf } from "./case-hash.ts";
import { NO_HISTORY, readHistory } from "./ledger.ts";
import { decideStart, freshRecord } from "./measure.ts";
import type { Accepted, StartInput } from "./measure.ts";
import type { RunStatus, SkillResult } from "./report.ts";
import { resultsPath } from "./results.ts";
import type { RunSettings } from "./run-settings.ts";
import { validateEvals } from "./schema.ts";
import type { EvalsFile } from "./schema.ts";
import type { Selection } from "./select.ts";

export interface Candidate {
  readonly sel: Selection;
  readonly evals: EvalsFile;
  readonly plan: SkillPlan;
}

const blank = (
  skill: string,
  status: RunStatus,
  blocking: boolean,
  messages: string[],
): SkillResult => ({
  skill,
  status,
  blocking,
  executorRuns: 0,
  judgeCalls: 0,
  costUsd: 0,
  messages,
});

export const refusedResult = (skill: string, message: string): SkillResult =>
  blank(skill, "error", true, [message]);

/** Sort the selected skills into no-evals, invalid and ready; no model call, no file write. */
export function classify(
  selections: readonly Selection[],
  cfg: RunSettings,
): { candidates: Candidate[]; results: SkillResult[] } {
  const candidates: Candidate[] = [];
  const results: SkillResult[] = [];
  for (const sel of selections) {
    const name = sel.skill.name;
    if (!fs.existsSync(path.join(sel.skill.dirAbs, "evals"))) {
      results.push(
        blank(name, "no-evals", cfg.missingEvalsBlocking, [
          `warning: ${name} has no evals/ directory`,
        ]),
      );
      continue;
    }
    if (sel.head.kind === "invalid") {
      results.push(blank(name, "invalid", true, sel.head.problems));
      continue;
    }
    const rel = `${sel.skill.dirRel}/evals/evals.json`;
    const evalsText = snapshotEvalsText(sel);
    const bad = evalsViolations(sel.skill.dirAbs, name, rel, evalsText);
    if (sel.head.kind !== "ok" || sel.headHash === undefined || bad.length > 0) {
      results.push(
        blank(name, "invalid", true, bad.length > 0 ? bad : ["the skill cannot be read"]),
      );
      continue;
    }
    const parsed = validateEvals(evalsText ?? "", {
      file: rel,
      skillDir: sel.skill.dirAbs,
      skillName: name,
    });
    if (parsed.evals === undefined) {
      results.push(
        blank(
          name,
          "invalid",
          true,
          parsed.violations.map((v) => `${v.file}: ${v.path}: ${v.rule}: ${v.message}`),
        ),
      );
      continue;
    }
    candidates.push({ sel, evals: parsed.evals, plan: planSkill(name, parsed.evals) });
  }
  return { candidates, results };
}

export interface Started {
  readonly cand: Candidate;
  readonly accepted: Accepted;
  /** True when the plan has no remaining slot: the file is finalised with no model call. */
  readonly finalise: boolean;
}

export interface StartArgs {
  readonly repoRoot: string;
  readonly mock: boolean;
  readonly candidates: readonly Candidate[];
  readonly ticket: string;
  readonly cfg: RunSettings;
  readonly now: string;
  readonly judgeModel: string;
}

/** R8: resume, restart or refuse each skill; refusals become error results, accepted skills rows of R22. */
export function startSkills(a: StartArgs): {
  started: Started[];
  results: SkillResult[];
  rows: SpendRow[];
} {
  const started: Started[] = [];
  const results: SkillResult[] = [];
  const rows: SpendRow[] = [];
  for (const cand of a.candidates) {
    const { sel } = cand;
    const name = sel.skill.name;
    const rf = resultsPath(sel.skill.dirAbs);
    const input: StartInput = {
      skill: name,
      contentHash: sel.headHash ?? "",
      ticket: a.ticket,
      now: a.now,
      evals: cand.evals,
      caseHashes: caseHashesOf(snapshotEvalsText(sel) ?? "", sel.skill.dirAbs),
      workingText: a.mock || !fs.existsSync(rf) ? undefined : fs.readFileSync(rf, "utf8"),
      history: a.mock ? NO_HISTORY : readHistory(a.repoRoot, sel.mergeBase, sel.skill.dirRel),
      executorModel: a.cfg.executorModel,
      judgeModel: a.judgeModel,
      effort: a.cfg.effort,
      maxMeasurementUsd: a.cfg.maxMeasurementUsd,
    };
    if (a.mock) {
      const record = freshRecord(input, []);
      started.push({
        cand,
        accepted: { record, branchSpend: 0, worst: 0, branchCount: 1, resumed: false },
        finalise: false,
      });
      continue;
    }
    const start = decideStart(input);
    if (start.kind === "refuse") {
      results.push(refusedResult(name, start.message));
      continue;
    }
    if (start.resumed && !hasOpenSlot(start)) {
      started.push({ cand, accepted: start, finalise: true });
      continue;
    }
    if (start.resumed && start.worst <= 0) {
      results.push(
        refusedResult(
          name,
          `the measurement of ${start.record.content_hash} is at its cap: ${(a.cfg.maxMeasurementUsd - start.worst).toFixed(2)} USD recorded, max-measurement-usd ${a.cfg.maxMeasurementUsd}; change the skill content for a new measurement`,
        ),
      );
      continue;
    }
    started.push({ cand, accepted: start, finalise: false });
    rows.push({ skill: name, spent: start.branchSpend, worst: start.worst });
  }
  return { started, results, rows };
}

/** True when the resumed record still has a slot to run (else it is finalised without a model call). */
function hasOpenSlot(start: Accepted): boolean {
  const r = start.record;
  const { decision } = decideRecord(r.evals, r.probes, r.skill_name, undefined, "");
  return (
    decision.evals.remaining.some((n) => n > 0) ||
    (decision.probes?.remaining.some((n) => n > 0) ?? false)
  );
}
