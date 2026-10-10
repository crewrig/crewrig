// setup-differential.ts — the forwarding-parity comparison of one setup cell (spec 0256 requirement
// 10, plan v2 step C4, reworded when the shell scripts became shims): the result of `bash
// scripts/<entry>.sh` (the forwarding shim, leg `shell`) and the result of `node
// scripts/<entry>.ts` (leg `ts`) are compared with each other, never with the fixture, through the
// same tagged-deviation function the golden comparison uses (setup-golden-deviations.ts). An
// untagged difference is returned as a message naming the cell and the first differing lines.
// API: legDifference(c, shim, entry) -> string | undefined.

import { comparable } from "./setup-golden-deviations.ts";
import { askedByTs, QUESTIONS_FILE } from "./setup-golden-questions.ts";
import { GOLDEN_FILES, serialize, unifiedDiff } from "./setup-golden-regen.ts";
import type { CaseResult } from "./setup-golden-regen.ts";
import type { GoldenCase } from "./setup-golden-types.ts";

/** Lines of diff reported per differing file: enough to see where the legs part, no more. */
const REPORTED_LINES = 12;

/**
 * The untagged differences between the `shim` and the `entry` results of `c` (status, stdout,
 * stderr, tree and bak counts, and the sequence of questions each run echoed), or undefined when
 * the shim forwards faithfully under the cell's deviations. The tagged deviations are removed from
 * BOTH sides, so a tag never hides a one-sided change.
 */
export function legDifference(
  c: GoldenCase,
  shim: CaseResult,
  entry: CaseResult,
): string | undefined {
  const left = serialize(shim);
  const right = serialize(entry);
  const failures: string[] = GOLDEN_FILES.flatMap((name) => {
    const a = comparable(name, left[name], c.deviations);
    const b = comparable(name, right[name], c.deviations);
    return a === b
      ? []
      : [`--- shim ${name}\n+++ entry ${name}\n${unifiedDiff(a, b, REPORTED_LINES)}`];
  });
  // The `[answer]` echo lines are tagged (f) and dropped above: compare the questions they stand for.
  const asked = askedByTs(shim.stdout)
    .map((l) => `${l}\n`)
    .join("");
  const answered = askedByTs(entry.stdout)
    .map((l) => `${l}\n`)
    .join("");
  if (asked !== answered) {
    failures.push(
      `--- shim ${QUESTIONS_FILE} ([answer] echo lines)\n+++ entry ${QUESTIONS_FILE} ([answer] echo lines)\n${unifiedDiff(asked, answered, REPORTED_LINES)}`,
    );
  }
  return failures.length === 0
    ? undefined
    : `shim and entry differ for ${c.cli}/${c.id}: ${c.note}\n${failures.join("\n")}`;
}
