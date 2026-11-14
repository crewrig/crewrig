// eval-rules.ts — the three eval-authoring warnings of the skill linter (spec 0304 R19).
//
// Warnings only: none changes the exit code of check-skill-quality.ts unless `--strict` is given,
// and all three are in ALWAYS_WARNING so a protected skill is not broken by them.
//   evals-absence-expectation: an expectation worded as an absence cannot be judged soundly from a
//     quoted line; write it as a `file_not_contains` check, or quote the enumerating lines.
//   evals-sample-missing: an eval without `evals/samples/<id>/` skips the authoring guard
//     (`task skill-evals -- <skill> --dry-run`), so an unsatisfiable expectation is found only
//     after a paid baseline.
//   evals-too-many: more evals than the judge cap admits, or a plan maximum above the run cap.
//
// Usage: evalWarnings(skill, evals, file). Exit codes: not applicable (library).
// Finding-line format: see run.ts `formatFinding`.

import fs from "node:fs";
import path from "node:path";

import { judgeWorstCase } from "../skill-evals/budget.ts";
import { planMaximum } from "../skill-evals/plan.ts";
import type { EvalsFile } from "../skill-evals/schema.ts";
import { JUDGE_MAX_CALLS, MAX_EXECUTOR_RUNS } from "../skill-evals/settings.ts";
import type { Raw, SkillDir } from "./types.ts";

/** A whole-word, case-insensitive absence wording: `does not`, `do not`, `never`, `no longer`, `none`, `without`, or `no` followed by a noun. */
export const ABSENCE = /\b(?:does not|do not|never|no longer|none|without)\b|\bno\s+[a-z]/i;

export function evalWarnings(skill: SkillDir, evals: EvalsFile, file: string): Raw[] {
  const out: Raw[] = [];
  for (const e of evals.evals)
    for (const [j, x] of e.expectations.entries())
      if (ABSENCE.test(x))
        out.push({
          rule: "evals-absence-expectation",
          message: `eval ${e.id} expectation ${j + 1} is worded as an absence ("${x.slice(0, 80)}"); write the absence as a file_not_contains check when it concerns a produced file, or quote the lines that enumerate the inspected content`,
          file,
        });
  for (const e of evals.evals)
    if (!fs.existsSync(path.join(skill.dir, "evals", "samples", String(e.id))))
      out.push({
        rule: "evals-sample-missing",
        message: `eval ${e.id} has no evals/samples/${e.id}/ directory; add a hand-written sample and run task skill-evals -- ${skill.name} --dry-run (the authoring guard) before any baseline is paid`,
        file,
      });
  const judged = evals.evals.filter((e) => e.expectations.length > 0).length;
  const worst = judgeWorstCase(judged);
  const planned = planMaximum(evals.evals.length, evals.trigger_probes.length);
  if (worst > JUDGE_MAX_CALLS || planned > MAX_EXECUTOR_RUNS)
    out.push({
      rule: "evals-too-many",
      message: `${judged} evals carry expectations (judge worst case ${worst} calls against the cap of ${JUDGE_MAX_CALLS}) and the plan maximum is ${planned} runs (cap ${MAX_EXECUTOR_RUNS}): the runner refuses such a skill before any run; split the skill or reduce its evals (at most 6 evals that carry expectations)`,
      file,
    });
  return out;
}
