---
id: "0130"
slug: cases-23-24-cd-mutants-discrimination
status: approved
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 839
version: 1.0.0
---

# Spec 0130 — Cases 23/24 cd mutants discrimination

## Intent

Document and pin in the falsification matrix of `scripts/tests/test-worktree-claim.sh` the two subshell rewrite mutants of `cmd_run` (`( cd "$TOPLEVEL" && "$@" ) || RC=$?` and `( cd "$TOPLEVEL"; "$@" ) || RC=$?`) as known non-discriminating dead rows, preventing false assumptions about test suite coverage regarding subshell `cd` rewrites.

## Requirements

1. `scripts/tests/test-worktree-claim.sh` SHALL document in its falsification matrix header the two subshell mutant forms of `cmd_run` (`( cd "$TOPLEVEL" && "$@" ) || RC=$?` and `( cd "$TOPLEVEL"; "$@" ) || RC=$?`).
2. The falsification matrix entries for both subshell mutants SHALL explicitly record their dead row status (both reporting `24 passed, 0 failed` when mutated).
3. The matrix documentation SHALL record why the suite does not discriminate these mutants (behavioural identity when `cd` succeeds, divergence requiring a post-certify `cd` failure).
4. The test suite execution output and existing test cases (1 through 24) SHALL remain fully passing (`24 passed, 0 failed`).

## Scenarios

### Scenario 1: Falsification matrix records subshell cd mutants

Given `scripts/tests/test-worktree-claim.sh`
When a maintainer or agent inspects the falsification matrix header
Then both subshell mutant forms `( cd "$TOPLEVEL" && "$@" ) || RC=$?` and `( cd "$TOPLEVEL"; "$@" ) || RC=$?` are documented with their exact dead-row status and rationale.

### Scenario 2: Regression test suite passes cleanly

Given `scripts/tests/test-worktree-claim.sh`
When `bash scripts/tests/test-worktree-claim.sh` is executed
Then all 24 test cases pass with exit code 0.

## Out of scope

- Modifying `scripts/worktree-claim.sh` execution logic.
- Injecting artificial `cd` failures or seaming `cmd_run` to force `cd` failure scenarios in `test-worktree-claim.sh`.

## Open questions

(None)
