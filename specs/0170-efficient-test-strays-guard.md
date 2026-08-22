---
id: "0170"
slug: efficient-test-strays-guard
status: implemented
complexity: small
interaction-mode: AUTO
related-issue: 993
version: 1.0.0
---

# Efficient Test Strays Guard and Elimination of Full-Suite Redundant Execution

## Intent

The `test-wiring` CI job's `Check Test Strays` step (`scripts/check-test-strays.sh`) currently executes all 75+ test suites at runtime whenever any non-test file under `scripts/` changes, taking nearly 4 minutes on 2-vCPU CI runners. Because all test suites are already executed by their respective changeset-gated and targeted CI capabilities (`build`, `mempalace`, `setup`, `misc`, `extension-*`, etc.), re-running all 75+ suites in `check-test-strays.sh` creates redundant execution that unnecessarily slows down CI pipelines across the repository.

This specification changes the strays-guard strategy to eliminate full-suite redundant execution:

1. Fast static syntax validation (`bash -n`) is performed across all test suites in `scripts/tests/test-*.sh` in milliseconds.
2. Runtime execution for stray command detection (`command not found` check) is strictly scoped to the test suites modified or added in the changeset (`scripts/tests/test-*.sh`).
3. Changes to shared non-test scripts or libraries under `scripts/` (e.g. `scripts/lib/**`, `scripts/setup-*.sh`) SHALL NOT trigger runtime execution of unchanged test suites in `check-test-strays.sh`, because those scripts and their affected tests are already executed by their dedicated CI jobs.
4. When no test suites under `scripts/tests/` are modified in the changeset, `check-test-strays.sh` completes in milliseconds without executing any test suite at runtime.

## Requirements

1. `scripts/check-test-strays.sh` SHALL perform static syntax validation (`bash -n`) across all test suites under `scripts/tests/test-*.sh`. If any suite has a bash syntax error, the check SHALL fail immediately with exit code 1 naming the invalid file.
2. When a base ref is provided (via `--base-ref`, `$GITHUB_BASE_REF`, or `$CI_MERGE_REQUEST_TARGET_BRANCH_NAME`), `scripts/check-test-strays.sh` SHALL determine the set of modified or added test suites via `git diff --name-only <merge-base> HEAD -- scripts/tests/test-*.sh`.
3. Only the test suites identified in Requirement 2 (the changeset-modified suites) SHALL be executed at runtime to check for stray `command not found` errors.
4. Changes to non-test files under `scripts/` (such as `scripts/lib/**` or root-level scripts) SHALL NOT trigger runtime execution of unchanged test suites in `check-test-strays.sh`.
5. When no test suites under `scripts/tests/` are modified in the changeset (or when the diff against merge-base is empty for `scripts/tests/`), `check-test-strays.sh` SHALL execute zero test suites at runtime and emit an `OK` confirmation message.
6. When no base ref is provided or when git merge-base cannot be resolved (e.g. standalone local run without base ref), `scripts/check-test-strays.sh` SHALL run static syntax validation on all suites and execute only suites explicitly passed or whose content-addressed cache verdict is missing.
7. If any executed suite emits a `command not found` error during runtime execution, `scripts/check-test-strays.sh` SHALL fail with exit code 1 naming the failing suite and the error count.
8. Regression test suite `scripts/tests/test-check-test-strays.sh` SHALL be updated to verify the new changeset-scoped and static validation behavior.

## Scenarios

**Scenario:** changeset touches only non-test scripts under `scripts/`
Given a pull request modifying `scripts/setup-claude-interactive.sh` or `scripts/lib/common.sh`
And no files under `scripts/tests/` are modified
When `scripts/check-test-strays.sh` runs
Then static syntax validation passes across all 75+ suites in milliseconds
And zero test suites are executed at runtime
And the step completes in less than 2 seconds with an OK status.

**Scenario:** changeset modifies a single test suite
Given a pull request modifying `scripts/tests/test-setup-claude-transcript.sh`
When `scripts/check-test-strays.sh` runs
Then static syntax validation runs on all suites
And only `scripts/tests/test-setup-claude-transcript.sh` is executed at runtime and checked for stray errors
And no other test suites are executed at runtime.

**Scenario:** test suite has a syntax error
Given a test suite with a syntax error (e.g. unmatched quote or unbalanced bracket)
When `scripts/check-test-strays.sh` runs
Then static syntax validation fails immediately with exit code 1 naming the syntax error.

**Scenario:** modified test suite emits a stray command
Given a pull request adding a typo command `bogus-command-xyz` to a modified test suite `scripts/tests/test-example.sh`
When `scripts/check-test-strays.sh` runs
Then `scripts/tests/test-example.sh` is executed at runtime
And the stray command is detected and reported on stderr
And the check exits with code 1.

## Out of scope

- Modifying `scripts/check-test-wiring.sh` or the test wiring registry.
- Modifying how test suites are executed inside their dedicated functional CI capability jobs.
- Introducing external binary dependencies beyond standard bash utilities (`bash`, `git`, `grep`).

## Open questions

- None.
