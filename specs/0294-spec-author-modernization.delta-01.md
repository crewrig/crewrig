---
id: "0294"
slug: spec-author-modernization
status: approved
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 1894
version: 1.1.0
---

# Modernize the spec-author skill and agent to the authoring standard

*Delta 01 of `specs/0294-spec-author-modernization.md`. Source: the owner's decision of 2026-11-13, relayed on issue #1894 after the deciding measurements on the fixed eval runner (2.1.0) and review pass 2 of the implementation PR. The delta amends R5 so that the rewrite is accepted although the runner reports a `regression`, and records the grounds. Version 1.1.0, a MINOR bump. Requirements modified: R5. This delta opens no question.*

## ADDED

<!-- markdownlint-disable MD029 -->

17. **R17 (grounds of the acceptance).** The acceptance of R5 as amended SHALL rest on the figures recorded on issue #1894 and in the implementation PR: the baseline on the unchanged skill is 5/5 evals and 7/9 probes; the final measurement is 4/5 evals and 8/9 probes, runner status `regression` (difference -0.20, tolerance 0.05); the one expectation that changed is eval 3's subjective negative ("the Requirements and Scenarios never state that archived widgets are included or excluded"), which the judge failed on text that passed at the baseline, and the rewritten skill keeps parking the question as `[USER-PARKED]`. With five evals and a tolerance of 0.05, a single flipped expectation is a regression while a 5/5 baseline cannot show a gain, so the runner status alone does not tell a worse skill from a flaky judgement.
18. **R18 (follow-ups).** Two follow-ups SHALL be recorded on the wave issue #1852 and not done by this ticket: widening the `spec-author` evaluation set so that one judgement cannot move the status band, and reviewing the regression tolerance for small evaluation sets in the skill authoring standard.

## MODIFIED

5. **R5 (measurement), original:** "The contributor SHALL run `task skill-evals -- spec-author` once on the unchanged skill and once on the rewritten skill, and SHALL report both pass rates, the probe results, the cost and the number of runs on the logbook. The rewrite SHALL be kept only when the final status is not `regression`. A probe failure SHALL be fixed by revising the description before the body. The pull request SHALL commit the `evals/results.json` of a non-mock run on the final skill."

   **Amended:** the contributor SHALL measure the unchanged skill and the rewritten skill with `task skill-evals -- spec-author` on the eval runner as it is on `main` when measured, report both pass rates, the probe results, the cost and the number of runs on the logbook, and commit the `evals/results.json` of a non-mock run on the final skill. The rewrite SHALL be kept when the final status is not `regression`. A final status of `regression` SHALL NOT block the pull request when the owner has accepted it on the grounds of R17, and the pull request body SHALL then carry the analysis of R17. A probe failure SHALL still be fixed by revising the description before the body.

## REMOVED

Nothing is removed.
