---
id: "0186"
slug: incidental-lifecycle-findings-batch
status: approved
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 1028
version: 1.0.0
---

# 0186 — Incidental lifecycle findings batch

## Intent

The framework tooling, automated test suites, CI workflows, and lifecycle documentation maintain consistent accuracy and resilience by resolving incidental defects and protocol ambiguities discovered during recent multi-agent lifecycle runs.

## Requirements

1. The Bash 3.2 portability checking script SHALL accurately count and report only non-empty failure lines without inflating hit counts when standard output streams contain trailing newlines.
2. The countable invariant verification guidance in the plan review protocol documentation SHALL specify a grep expression that accurately matches reviewer-minted finding identifiers in conformant plan traceability tables.
3. The Palace path propagation test suite assertion helpers SHALL perform substring containment checks without piping commands under shell pipefail mode, preventing false assertion failures caused by broken pipe signals on large input payloads.
4. The plan review protocol documentation SHALL explicitly state that when a plan review routes an iteration out to the SPECS stage for delta-spec authoring, the return to the PLAN stage initiates a fresh planning iteration against the revised specification baseline, resetting the plan revision counter for that new iteration.
5. The plan review protocol documentation SHALL reconcile prior-finding traceability rules by stating that unaddressed blocking findings require a revision verdict, whereas unaddressed non-blocking residue MAY be disposed as developer-routed named edits recorded directly in the review verdict without consuming revision counts.
6. The monorepo release GitHub Actions workflow SHALL support manual execution via a workflow dispatch trigger to enable recovery from skipped or failed release push runs.
7. The pull request formatting documentation and agent working rules SHALL prohibit unescaped continuous integration skip directives in branch commit messages and pull request descriptions to prevent unintended suppression of release and validation pipelines on squash merge.

## Scenarios

### Scenario: Bash portability checker reports exact hit count on multiline failures

Given a script containing multiple forbidden Bash constructs where the grep output terminates with a newline
When `scripts/check-bash32-portability.sh` is executed against the codebase
Then the failure summary reports the exact number of matching violation lines without counting extra empty lines

### Scenario: Traceability table row count verification matches reviewer-minted IDs

Given a plan comment containing finding traceability rows formatted with reviewer-minted identifiers
When a reviewer or automated check executes the documented countable invariant command
Then the pattern matches all conformant traceability rows and returns the exact count of claimed findings

### Scenario: Palace path propagation test assertions handle large payloads without broken pipes

Given test output containing a large text payload subject to substring assertion under shell pipefail
When `scripts/tests/test-palace-path-propagation.sh` executes `assert_contains` and `assert_not_contains`
Then the assertions evaluate substring presence directly and succeed without raising broken pipe termination signals

### Scenario: Delta-spec authoring excursion resets plan revision counter

Given a ticket in the PLAN stage that has accumulated plan revisions and encounters a spec-class finding
When the finding routes to the SPECS stage, produces an approved delta-spec, and returns to the PLAN stage
Then the subsequent plan iteration begins with a clean revision baseline rather than inheriting the prior revision count

### Scenario: Non-blocking plan review residue is routed to development without blocking verdict

Given a revised plan where all blocking findings are resolved but non-blocking minor residue remains
When the plan reviewer audits prior findings during the review pass
Then the reviewer records the non-blocking items as developer-routed named edits in the review verdict rather than issuing a revision-blocking verdict

### Scenario: Monorepo release workflow is triggered manually

Given a merged commit on `main` where automated release execution was skipped or failed
When a maintainer initiates the Analyze & Release workflow via the GitHub Actions manual dispatch interface
Then the workflow executes the release process against the current repository state

### Scenario: Escaped CI directive text in commit message does not skip CI

Given a pull request with commit messages explaining CI skip behavior using an escaped format
When the pull request is squash merged to `main`
Then the CI build and release pipelines are triggered normally without being suppressed by squash commit directives

## Out of scope

- Modifying the core architecture or syntax rules defined in `ci/bash32-forbidden.txt`.
- Changing the total allowed plan revision iteration limits defined for complexity tiers in ADR-0010.
- Introducing automated pre-commit hooks that rewrite user commit messages.

## Open questions

(none)
