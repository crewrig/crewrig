---
id: "0290"
slug: skill-eval-runner
status: approved
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 1902
version: 3.2.0
---

# Skill eval runner: grade a skill from its evals.json when SKILL.md changes

*Delta 06 of `specs/0290-skill-eval-runner.md`, building on delta-01 to delta-05. Source: issue #1902, found while writing the tests of delta-05. The acceptance clause of requirement 49 states that a quote that changes one word of a real excerpt, and a quote whose pieces occur out of order, are rejected. That is true only when no verbatim run of the evidence reaches both floors of rule 3; the implemented and specified rule accepts a long quote with one altered word, and long pieces in the wrong order, because rule 3 ignores the pieces' order and tolerates unmatched words up to 70 percent of the evidence. The owner's decision at the spec gate (recorded on issue #1902): a one-word swap can be a negation, so the residual that rule 3 leaves is made auditable instead of silent. This delta therefore also adds R50, which records the rule that accepted each evidence and counts the rule-3 acceptances in the report. The version bump is MINOR (additive requirement). Requirements added: R50. Requirements modified: R11, R22 and R49 (its acceptance clause, and its sentence that the matching rule is not recorded). This delta opens no question.*

## ADDED

<!-- markdownlint-disable MD029 -->

50. **The matching rule is recorded and counted.** For every expectation recorded `passed: true` from a judge `PASS`, the entry in `grading.json` SHALL carry `evidence_match`, one of `exact`, `normalised`, `window` (the rules of requirement 49) or `path_line` (the `path:line` reference of R13), and, when it is `window`, `window_share`, the share of the evidence's letters and digits covered by the longest verbatim run, a number rounded to two decimals. An entry for a check, and an entry recorded `passed: false`, SHALL carry neither key. The report of requirement R22 SHALL print, for each skill, a line `evidence_window: <n> of <m>` with *m* the number of expectations accepted from a judge `PASS` across the skill's eval runs and *n* those among them accepted by rule 3 only (`evidence_match` is `window`); the line SHALL be printed even when *n* is 0, so that the residual of rule 3 is visible on every run. Neither key nor the line affects a status, a pass rate or the exit code. Mock runs record the keys like any other run.
    Acceptance: a judge answer accepted by the exact rule writes `evidence_match: "exact"` and no `window_share`; one accepted only by rule 2 writes `"normalised"`; one accepted only by rule 3 writes `"window"` and `window_share` 0.38 for the recorded flake m5 eval 1 expectation 4; a `path:line` acceptance writes `"path_line"`; a failed expectation and a check carry neither key; with two accepted expectations of which one by rule 3 the report line reads `evidence_window: 1 of 2`, and with none by rule 3 it reads `evidence_window: 0 of <m>`; statuses and pass rates are identical with and without the keys.

## MODIFIED

**R11 (grading.json), as modified by delta-04.** Addition: an `expectations` entry MAY carry `evidence_match` and `window_share` under requirement 50; every other clause stands, so `text`, `passed` and `evidence` keep their rules and the `summary` is unchanged.

**R22 (report), as modified by delta-04.** Addition: the per-skill block prints the `evidence_window: <n> of <m>` line of requirement 50. Every other clause stands.

**R49 (evidence matching), as added by delta-05.** Replacement of one sentence: "The matching rule that held is not recorded in `grading.json` (R11 is unchanged)." now reads "The matching rule that held is recorded under requirement 50." Acceptance clause, original: "...a quote that changes one word of a real excerpt, a quote whose pieces occur out of order, a piece shorter than 12 letters and digits next to an ellipsis, a 39-letter-and-digit verbatim run inside invented text, ... are all rejected; ..." Replacement: a quote that changes one word of a real excerpt, and a quote whose real pieces occur out of order, are rejected when no run of consecutive words of the evidence that occurs verbatim in the material holds at least 40 letters and digits and at least 30 percent of the evidence's letters and digits, for instance when the excerpt is short; the same alterations in a long excerpt that leaves such a run are accepted by rule 3. This is intended: rule 3 proves that the evidence is grounded in the run's real output, not that it is faithful to it, and the exact check never proved more. The other cases of the acceptance clause stand (a piece shorter than 12 letters and digits next to an ellipsis, a 39-letter-and-digit verbatim run inside invented text, a verbatim run inside a much longer invented claim, a paraphrase sharing no 40-character run, the 40-letter-and-digit and 30-percent boundaries on both sides).
    Acceptance: a one-word change in a quote of two verbatim runs of 22 and 18 letters and digits is rejected; two real pieces of 22 and 27 letters and digits in reverse order are rejected; both are accepted by the exact rule in their original form.

## REMOVED

None.

## Scenarios

**Scenario:** a short quote with one altered word is rejected

```text
Given a produced spec that holds "Given the widgets service fails after part of the list"
When  the judge's evidence reads "Given the widgets service succeeds after part of the list"
Then  the longest verbatim run is 22 letters and digits, below 40, and the evidence is unsupported
```

## Out of scope

- Any change to the matching rules or their figures. The "recording in `grading.json` which matching rule held" that delta-05 listed as out of scope is now in scope through requirement 50, and only that.
