// grade.ts — grading of one run into `grading.json` (spec 0290 R11, R12, R13).
//
// Order: every check first (R12), in file order, then every expectation, in file order. The judge
// is called only for `expectations` entries, and not at all for a run whose outputs directory
// cannot be read. A PASS needs valid evidence (evidence.ts); an unsupported PASS and an UNCERTAIN
// verdict are recorded `passed: false`. A judge that cannot answer raises `JudgeFailure`, which the
// caller turns into status `error`.
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
  readonly verdict: "PASS" | "FAIL" | "UNCERTAIN";
  readonly evidence: string | undefined;
  readonly confidence: string;
}

export interface JudgeMaterial {
  readonly transcript: string;
  readonly files: readonly ProducedFile[];
}

export type JudgeFn = (expectation: string, material: JudgeMaterial) => Promise<JudgeAnswer>;

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
  const files = readable ? readProducedFiles(input.outputsDir) : [];
  for (const text of input.evalCase.expectations) {
    if (!readable) {
      entries.push({
        text,
        passed: false,
        evidence: "the run's output directory could not be read; the judge was not called",
      });
      continue;
    }
    const answer = await input.judge(text, { transcript: input.transcript, files });
    if (answer.verdict === "UNCERTAIN")
      entries.push({
        text,
        passed: false,
        evidence: `the judge verdict was uncertain (confidence ${answer.confidence})`,
      });
    else if (answer.verdict === "FAIL")
      entries.push({
        text,
        passed: false,
        evidence: `the judge verdict was FAIL (confidence ${answer.confidence})${answer.evidence ? `: ${answer.evidence}` : ""}`,
      });
    else {
      const v = validateEvidence(answer.evidence, { transcript: input.transcript, files });
      if (v.ok) entries.push({ text, passed: true, evidence: answer.evidence ?? "" });
      else
        entries.push({
          text,
          passed: false,
          evidence: `the PASS verdict was unsupported: ${v.reason}${answer.evidence ? ` (evidence given: ${JSON.stringify(answer.evidence.slice(0, 200))})` : ""}`,
        });
    }
  }
  const grading: Grading = { expectations: entries, summary: summarize(entries) };
  if (input.mock === true) grading.mock = true;
  return grading;
}
