---
id: "0078"
slug: e2e-runner-hermetic
status: draft
complexity: standard
interaction-mode: AUTO
related-issue: 543
version: 1.0.0
---

# End-to-end runner regression test made hermetic and current

## Intent

CrewRig ships a regression test that guards its end-to-end scenario runner,
but that test is currently unsafe to run and out of step with the runner it
checks. This specification makes the test trustworthy: running it never
touches the report fixtures the repository commits, so it can no longer delete
or corrupt checked-in data; its assertions describe what the runner actually
does today rather than an earlier expectation that has since drifted; and it is
no longer quarantined — it runs in continuous integration and, like its sibling
runner tests, upholds the same ordered command-parity guarantee, so a real
regression in the runner is caught automatically.

## Requirements

1. `scripts/tests/test-e2e-runner.sh` SHALL operate entirely within a
   temporary reports directory that it creates, and SHALL NOT read, create,
   modify, or delete any path under the committed `tests/e2e/reports/`
   directory.
2. `tests/e2e/run.sh` SHALL support redirecting its reports-root directory to a
   caller-specified location; when that override is absent, the runner's
   behavior SHALL be unchanged from its current behavior.
3. A single execution of `scripts/tests/test-e2e-runner.sh` SHALL leave every
   committed fixture under `tests/e2e/reports/` byte-for-byte unchanged.
4. The assertions in `scripts/tests/test-e2e-runner.sh` SHALL match the current
   actual behavior of `tests/e2e/run.sh` — its emitted TAP plan and its
   `--keep` prune semantics — and SHALL NOT assert stale expectations
   predating issue #80 that no longer hold.
5. `scripts/tests/test-e2e-runner.sh` SHALL pass, SHALL be removed from
   `ci/test-wiring-exemptions.txt`, and SHALL be executed by a CI workflow.
6. Wiring `scripts/tests/test-e2e-runner.sh` into CI SHALL preserve the ordered
   GitHub-Actions-to-GitLab command-parity guarantee.

## Scenarios

**Scenario:** the rewritten test runs hermetically, passes, and is wired
(happy path)

Given the fix has rewritten `scripts/tests/test-e2e-runner.sh` to run inside a
      temporary reports directory it creates and removes, and has removed the
      test's entry from `ci/test-wiring-exemptions.txt`
When  the test runs as part of a CI workflow
Then  the test passes, it is executed by a CI workflow, and the test-wiring
      guard is green with no stale or redundant exemption for it

**Scenario:** committed report fixtures survive a test run untouched
(data-safety, happy path)

Given the committed tree under `tests/e2e/reports/` is captured before the test
      runs
When  `scripts/tests/test-e2e-runner.sh` executes to completion
Then  the committed tree under `tests/e2e/reports/` is byte-for-byte identical
      to the captured state, with no fixture directory created, modified, or
      deleted

**Scenario:** the pre-fix test corrupts fixtures and asserts a stale plan
(failure path)

Given the pre-fix `scripts/tests/test-e2e-runner.sh`, which points its reports
      directory at the real committed `tests/e2e/reports/` and asserts the
      `1..0 # no scenarios defined yet (waiting for #80)` TAP plan — the state
      this ticket resolves
When  that test runs against the current `tests/e2e/run.sh`, whose
      `[scenarios.*]` config is now populated
Then  the run deletes or mutates committed report fixtures and fails its TAP
      assertion, because the asserted plan no longer matches the runner's
      current output

**Scenario:** command-parity gate stays green after wiring (non-regression)

Given the test has been wired into CI and removed from the exemption allowlist
When  the ordered GitHub-Actions-to-GitLab command-parity gate runs
Then  it remains green, because the ordered per-test enumeration is preserved
      identically across both CI surfaces

## Out of scope

- Changing the actual TAP output or prune behavior of `tests/e2e/run.sh`; this
  ticket adds only the reports-root override and realigns the test to the
  runner's current behavior.
- Populating the `[scenarios.*]` config (issue #80) or changing which scenarios
  exist.
- The sibling quarantined tests `test-e2e-readme.sh` and
  `test-e2e-libs-readme.sh` (issue #542, done) and `test-e2e-toml-merge.sh`
  (issue #544).
- Restructuring the end-to-end harness beyond the reports-root override.

## Open questions
