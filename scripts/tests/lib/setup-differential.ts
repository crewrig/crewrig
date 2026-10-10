// setup-differential.ts — the direct comparison of the two legs of one setup cell (spec 0256
// requirement 10, plan v2 step C4): the shell result and the TypeScript result are compared with
// each other, never with the fixture, through the same tagged-deviation function the golden
// comparison uses (setup-golden-deviations.ts). An untagged difference is returned as a message
// naming the cell and the first differing lines.
// API: legDifference(c, shell, ts) -> string | undefined.

import { comparable, questionTexts } from "./setup-golden-deviations.ts";
import { QUESTIONS_FILE } from "./setup-golden-questions.ts";
import { GOLDEN_FILES, serialize, unifiedDiff } from "./setup-golden-regen.ts";
import type { CaseResult } from "./setup-golden-regen.ts";
import type { GoldenCase } from "./setup-golden-types.ts";

/** Lines of diff reported per differing file: enough to see where the legs part, no more. */
const REPORTED_LINES = 12;

/**
 * The untagged differences between the `shell` and the `ts` results of `c` (status, stdout,
 * stderr, tree and bak counts), or undefined when the legs agree under the cell's deviations.
 * The tagged deviations are removed from BOTH sides, so a tag never hides a one-sided change.
 */
export function legDifference(
  c: GoldenCase,
  shell: CaseResult,
  ts: CaseResult,
): string | undefined {
  const left = serialize(shell);
  const right = serialize(ts);
  const failures: string[] = GOLDEN_FILES.flatMap((name) => {
    const a = comparable("ts", name, left[name], c.deviations);
    const b = comparable("ts", name, right[name], c.deviations);
    return a === b
      ? []
      : [`--- shell leg ${name}\n+++ ts leg ${name}\n${unifiedDiff(a, b, REPORTED_LINES)}`];
  });
  // The questions the TypeScript run asked against the shell's fzf records (tags f and a/b drop both).
  const [asked, answered] = questionTexts(c.cli, shell.fzfRecords, ts.stdout);
  if (asked !== answered) {
    failures.push(
      `--- shell leg ${QUESTIONS_FILE} (fzf records)\n+++ ts leg ${QUESTIONS_FILE} ([answer] echo lines)\n${unifiedDiff(asked, answered, REPORTED_LINES)}`,
    );
  }
  return failures.length === 0
    ? undefined
    : `legs differ for ${c.cli}/${c.id}: ${c.note}\n${failures.join("\n")}`;
}
