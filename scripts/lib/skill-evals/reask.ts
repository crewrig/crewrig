// reask.ts — the one evidence re-ask (spec 0304 R17).
//
// When at least one judge PASS of an eval run is refused for unsupported evidence, the runner makes
// ONE further judge call for that run, asking only for those expectations and stating why each was
// refused. The answer is recorded `passed: true` only when it is a PASS with valid evidence (R15,
// R16, 0290 R13 and R49); any other answer, a second unsupported PASS included, is `passed: false`.
// A judge FAIL is never re-asked, at most one re-ask is made per run, and every expectation it
// resolves carries `reasked: true`. The re-ask counts as a judge call against the caps.
//
// Usage: await reaskRefused({ judge, texts, reasons, material, rawFile }).
// Exit codes: not applicable (library). Finding-line format: not applicable.

import { acceptedEntry, validateEvidence } from "./evidence.ts";
import type { EvidenceMaterial } from "./evidence.ts";
import type { GradedExpectation, JudgeFn } from "./grade.ts";

export interface ReaskInput {
  readonly judge: JudgeFn;
  /** The refused expectations, in order. */
  readonly texts: readonly string[];
  /** Why each was refused, parallel to `texts`. */
  readonly reasons: readonly string[];
  readonly material: EvidenceMaterial;
  readonly rawFile?: string;
}

/** One entry per refused expectation, each marked `reasked`. A judge failure propagates (R9). */
export async function reaskRefused(input: ReaskInput): Promise<GradedExpectation[]> {
  const answers = await input.judge(input.texts, input.material, {
    reasons: input.reasons,
    ...(input.rawFile !== undefined ? { rawFile: input.rawFile } : {}),
  });
  return input.texts.map((text, i): GradedExpectation => {
    const a = answers[i];
    if (a === undefined)
      return {
        text,
        passed: false,
        evidence: "the re-ask gave no verdict for this expectation",
        reasked: true,
      };
    if (a.verdict !== "PASS")
      return {
        text,
        passed: false,
        evidence: `the judge verdict was ${a.verdict} on the re-ask${a.evidence ? `: ${a.evidence}` : ""}`,
        reasked: true,
      };
    const v = validateEvidence(a.evidence, input.material);
    if (v.ok) return { ...acceptedEntry(text, a.evidence ?? "", v), reasked: true };
    return {
      text,
      passed: false,
      evidence: `the PASS verdict was unsupported on the re-ask: ${v.reason}${a.evidence ? ` (evidence given: ${JSON.stringify(a.evidence.slice(0, 200))})` : ""}`,
      reasked: true,
    };
  });
}
