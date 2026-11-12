// grade.ts — grading of one run into `grading.json` (spec 0290 R11, R12, R13).
//
// Order: every check first (R12), in file order, then every expectation, in file order. The judge
// is called ONCE, only when the eval has `expectations` and its outputs directory can be read. A
// PASS needs valid evidence (evidence.ts); an unsupported PASS, any other verdict word and a missing
// entry ("no verdict") are recorded `passed: false`. A judge that cannot answer raises
// `JudgeFailure`, which the caller turns into status `error`.
//
// Usage: const g = await gradeRun({ evalCase, outputsDir, skillDir, transcript, judge });
// Exit codes: not applicable (library). Finding-line format: not applicable.

import fs from "node:fs";

import { runCheck } from "./checks.ts";
import { readProducedFiles, validateEvidence } from "./evidence.ts";
import type { ProducedFile } from "./evidence.ts";
import type { EvalCase } from "./schema.ts";

export interface GradedExpectation {
  text: string;
  passed: boolean;
  evidence: string;
  /** R50: the rule that accepted a judge PASS; absent on checks and on failed entries. */
  evidence_match?: "exact" | "normalised" | "window" | "path_line";
  /** R50: with `window`, the share of the evidence covered by the longest verbatim run, 2 decimals. */
  window_share?: number;
}

export interface GradeSummary {
  passed: number;
  failed: number;
  total: number;
  pass_rate: number;
}

export interface Grading {
  expectations: GradedExpectation[];
  summary: GradeSummary;
  mock?: true;
}

export interface JudgeAnswer {
  /** The verdict word, upper-cased; only `PASS` can pass. */
  readonly verdict: string;
  readonly evidence: string | undefined;
}

export interface JudgeMaterial {
  readonly transcript: string;
  readonly files: readonly ProducedFile[];
}

/** One call for all of an eval's expectations; one entry per expectation, undefined when missing. */
export type JudgeFn = (
  expectations: readonly string[],
  material: JudgeMaterial,
  /** `rawFile`: where to persist the raw judge answer, before it is parsed. */
  opts?: { readonly rawFile?: string },
) => Promise<readonly (JudgeAnswer | undefined)[]>;

export class JudgeFailure extends Error {
  readonly reason: "no-verdict" | "cap" | "hard-failure" | "auth-missing" | "unsupported-backend";
  constructor(reason: JudgeFailure["reason"], message: string) {
    super(message);
    this.name = "JudgeFailure";
    this.reason = reason;
  }
}

export function summarize(entries: readonly { passed: boolean }[]): GradeSummary {
  const passed = entries.filter((e) => e.passed).length;
  const total = entries.length;
  return { passed, failed: total - passed, total, pass_rate: total === 0 ? 0 : passed / total };
}

export interface GradeInput {
  readonly evalCase: EvalCase;
  readonly outputsDir: string;
  /** The HEAD skill directory (exit_code scripts run from it). */
  readonly skillDir: string;
  readonly transcript: string;
  readonly judge: JudgeFn;
  /** The eval's `judge.txt`: the raw judge answer is written there, even when parsing fails. */
  readonly judgeRawFile?: string;
  readonly mock?: boolean;
}

export async function gradeRun(input: GradeInput): Promise<Grading> {
  const entries: GradedExpectation[] = [];
  for (const c of input.evalCase.checks) {
    const r = await runCheck(c, { outputsDir: input.outputsDir, skillDir: input.skillDir });
    entries.push({ text: r.text, passed: r.passed, evidence: r.evidence });
  }
  let readable = true;
  try {
    fs.readdirSync(input.outputsDir);
  } catch {
    readable = false;
  }
  const texts = input.evalCase.expectations;
  if (texts.length > 0 && !readable) {
    for (const text of texts)
      entries.push({
        text,
        passed: false,
        evidence: "the run's output directory could not be read; the judge was not called",
      });
  } else if (texts.length > 0) {
    const files = readProducedFiles(input.outputsDir);
    const answers = await input.judge(
      texts,
      { transcript: input.transcript, files },
      input.judgeRawFile !== undefined ? { rawFile: input.judgeRawFile } : undefined,
    );
    texts.forEach((text, i) => {
      const answer = answers[i];
      if (answer === undefined)
        entries.push({
          text,
          passed: false,
          evidence: "the judge gave no verdict for this expectation",
        });
      else if (answer.verdict !== "PASS")
        entries.push({
          text,
          passed: false,
          evidence: `the judge verdict was ${answer.verdict}${answer.evidence ? `: ${answer.evidence}` : ""}`,
        });
      else {
        const v = validateEvidence(answer.evidence, { transcript: input.transcript, files });
        if (v.ok)
          entries.push({
            text,
            passed: true,
            evidence: answer.evidence ?? "",
            evidence_match: v.rule,
            ...(v.rule === "window" ? { window_share: Math.round(v.share * 100) / 100 } : {}),
          });
        else
          entries.push({
            text,
            passed: false,
            evidence: `the PASS verdict was unsupported: ${v.reason}${answer.evidence ? ` (evidence given: ${JSON.stringify(answer.evidence.slice(0, 200))})` : ""}`,
          });
      }
    });
  }
  const grading: Grading = { expectations: entries, summary: summarize(entries) };
  if (input.mock === true) grading.mock = true;
  return grading;
}
