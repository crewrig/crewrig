---
id: "0280"
slug: task-ci-contract
status: approved
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 1782
version: 1.1.0
---

# Task is the CI contract

Delta-01 relaxes one ordering constraint of R7. Slice 3 (spec 0283) has only its last PR left (removing the `dorny/paths-filter` steps), and that PR waits on a shadow-sample window it cannot shorten. The three-surface total on `origin/main` is already below the 10,780 floor of R10 (10,423 lines at a67ca65e), so the reason for ordering slice 5 after slice 3 is met in substance. This delta lets the paper stages of slice 5 run while that last PR is in flight, and keeps the code stage strictly after it. Every other requirement of spec 0280 is unchanged.

## ADDED

(none)

## MODIFIED

- **R7 (order and dependency), third sentence.** Original: "Slice 5 SHALL NOT start before slice 3 is merged." Replacement: "Slice 5 SPECS and PLAN stages (its sub-spec, its spec-PR, its plan and their review seats) MAY run in parallel with the last pull request of slice 3, and its spec-PR MAY merge before that pull request. Slice 5 DEV SHALL NOT start, and no slice 5 implementation branch SHALL be cut, before the last pull request of slice 3 is merged, so every slice 5 line count is measured on the final state of slice 3. The slice 5 sub-spec SHALL name this delta and the last slice 3 pull request as its predecessor."
- **R7 (order and dependency), Acceptance.** Original: "each sub-spec names its predecessor, and a sub-spec PR for slice 3 or 5 is not merged before its predecessor." Replacement: "each sub-spec names its predecessor, a sub-spec PR for slice 3 is not merged before its predecessor, and no implementation PR for slice 5 is opened before the last pull request of slice 3 is merged (the spec-PR of slice 5 is exempt, as stated above)."
- **R10 (measurement), the clause on slice 5 starting.** Original: "slice 5 SHALL NOT start unless the total after slice 3 is at most 10,780 lines (a reduction of at least 15%), otherwise the coordinator decides whether to stop". Replacement: "slice 5 DEV SHALL NOT start unless the total after slice 3 is at most 10,780 lines (a reduction of at least 15%), otherwise the coordinator decides whether to stop; the total is read on the first `origin/main` commit after the last pull request of slice 3". The condition is already satisfied at a67ca65e (10,423 lines).

## REMOVED

(none)
