---
id: "0171"
slug: push-base-ref-test-strays
status: implemented
complexity: small
interaction-mode: AUTO
related-issue: 996
version: 1.0.0
---

# Push Event Base Ref Resolution for Test Strays Guard

## Intent

On `push` events to `main` (such as immediately after merging a pull request), GitHub Actions does not populate `$GITHUB_BASE_REF` (it is only set for `pull_request` events). Consequently, `scripts/check-test-strays.sh` fell back to its unresolvable-base full scan behavior and executed all 75+ test suites at runtime in `test-wiring`, taking nearly 4 minutes on every push to `main`.

This specification defines automated base ref resolution for push events and standalone environments:

1. `scripts/check-test-strays.sh` SHALL automatically resolve its diff base from `$GITHUB_BASE_REF`, `$CI_MERGE_REQUEST_TARGET_BRANCH_NAME`, `$CI_COMMIT_BEFORE_SHA` (when non-zero), `HEAD~1` (when a prior git commit exists in the local repository), or an explicit `--base-ref` argument.
2. In CI workflows (`.github/workflows/build.yml` and `.gitlab-ci.yml`), `check-test-strays.sh` is invoked with explicit `--base-ref` parameters or inherits environment variables that resolve the previous commit for push events.
3. On push events to `main` where no test suites under `scripts/tests/` were modified, `check-test-strays.sh` completes in milliseconds with zero runtime suite executions.

## Requirements

1. `scripts/check-test-strays.sh` SHALL resolve `BASE_REF` in the following precedence:
   - Explicit command-line argument `--base-ref <ref>` (if non-empty).
   - `$GITHUB_BASE_REF` (if non-empty, typical for GitHub pull request events).
   - `$CI_MERGE_REQUEST_TARGET_BRANCH_NAME` (if non-empty, typical for GitLab merge request pipelines).
   - `$CI_COMMIT_BEFORE_SHA` (if non-empty and not `0000000000000000000000000000000000000000`, typical for GitLab push pipelines).
   - `HEAD~1` when running inside a git repository where `git rev-parse --verify HEAD~1` succeeds (typical for GitHub Actions `push` pipelines and local commit checks).
2. When `BASE_REF` resolves to a valid git reference (e.g. `HEAD~1` on push to `main`), `scripts/check-test-strays.sh` SHALL compute `git diff --name-only <merge-base> HEAD -- scripts/tests/` and execute at runtime only the modified or added test suites.
3. If no test suites under `scripts/tests/` are modified in the resolved diff, `scripts/check-test-strays.sh` SHALL execute zero suites at runtime and exit 0 with `OK: zero runtime strays across all test suites.`.
4. If `BASE_REF` cannot be resolved and `HEAD~1` does not exist (e.g., shallow single commit with no parents, or non-git directory), `scripts/check-test-strays.sh` SHALL perform static syntax validation on all suites and execute un-cached suites at runtime as fallback.
5. The regression test suite `scripts/tests/test-check-test-strays.sh` SHALL include test cases verifying `HEAD~1` automatic resolution on git repositories without explicit `--base-ref`.

## Scenarios

### Scenario 1: Push event on main with no test modifications

- **Given** a git repository on `main` where the latest commit modified only non-test files (e.g. documentation, CI configs, or setup scripts)
- **When** `scripts/check-test-strays.sh` is executed without `--base-ref` and with `$GITHUB_BASE_REF` empty
- **Then** `scripts/check-test-strays.sh` automatically resolves `HEAD~1` as `BASE_REF`
- **And** performs static syntax validation (`bash -n`) across all suites in milliseconds
- **And** executes zero test suites at runtime
- **And** exits 0 with `OK: zero runtime strays across all test suites.`

### Scenario 2: Push event on main modifying a single test suite

- **Given** a git repository on `main` where the latest commit modified `scripts/tests/test-clean.sh`
- **When** `scripts/check-test-strays.sh` is executed without explicit `--base-ref`
- **Then** `scripts/check-test-strays.sh` resolves `HEAD~1`
- **And** executes only `scripts/tests/test-clean.sh` at runtime
- **And** exits 0 without running the remaining 74 test suites

## Out of scope

- Modifying the static syntax check rules (`bash -n`) introduced in Spec 0170.
- Altering the other steps in the `test-wiring` CI job.

## Open questions

- None. Precedence order and fallback behaviors are fully specified.
