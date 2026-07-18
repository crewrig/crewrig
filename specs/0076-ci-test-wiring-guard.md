---
id: "0076"
slug: ci-test-wiring-guard
status: draft
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 534
version: 1.0.0
---

# Every test script is wired into CI or exempted with a reason

## Intent

A contributor who adds a test script to the project's automated test suite
can no longer have it silently run in zero continuous-integration workflows.
The moment a test script exists that no workflow executes and that no explicit
exemption records, the project's CI fails and names the unwired test, so the
contributor learns at review time that the test would otherwise never run.
Test scripts that genuinely cannot run in the standard CI environment stay
visible through an explicit exemption list, each entry carrying a recorded
reason, so the set of never-run tests is always a deliberate, auditable choice
rather than an accident. The class of false-negative regression that once hid
undetected for months — a test that existed but executed nowhere — can no
longer recur unnoticed.

## Requirements

1. A continuous-integration check SHALL fail whenever a test script matching
   `scripts/tests/test-*.sh` is neither executed by any of the project's CI
   workflows nor listed in an explicit exemption allowlist.
2. When the check fails because of an unwired, unexempted test script, it
   SHALL identify that script by name in its output.
3. Every entry in the exemption allowlist SHALL carry a recorded,
   human-readable reason stating why the named test script is not executed in
   CI; an exemption entry lacking a reason SHALL cause the check to fail.
4. At the time this specification is realized, every `scripts/tests/test-*.sh`
   script that no CI workflow executes SHALL be resolved to exactly one
   terminal state: executed by a CI workflow, or listed in the exemption
   allowlist with a reason.
5. The check SHALL fail when the exemption allowlist names a test script that
   no longer exists under `scripts/tests/`, so that stale exemptions cannot
   silently accumulate.
6. The test-wiring guard SHALL follow the repository's existing convention in
   which every `check-*.sh` script has a corresponding `test-*.sh` script, and
   the guard SHALL itself be executed by a CI workflow so that the guard cannot
   silently stop running.
7. The chosen mechanism SHALL preserve the existing GitHub-Actions-to-GitLab
   command-parity guarantee: the ordered command-parity gate SHALL remain green
   after the mechanism is introduced.
8. A test script that cannot pass in the hermetic CI environment SHALL NOT be
   forced into a CI job where it would fail spuriously; such a script SHALL
   instead be listed in the exemption allowlist with a reason, or otherwise
   gated, never wired into a job it cannot satisfy.

## Scenarios

**Scenario:** clean checkout of the realized repository passes (happy path)

```text
Given a clean checkout of `main` after this specification is realized, in
      which every `scripts/tests/test-*.sh` script is either executed by a CI
      workflow or listed in the exemption allowlist with a reason,
When   the test-wiring guard runs as part of the project's CI,
Then   the guard is executed by CI and exits without reporting any unwired or
       stale test, and CI is green.
```

**Scenario:** contributor wires a new test into a workflow (happy path)

```text
Given a contributor adds `scripts/tests/test-foo.sh` and adds a step that
      executes it to a CI workflow,
When   the test-wiring guard runs,
Then   the guard passes, because `test-foo.sh` is executed by a workflow.
```

**Scenario:** contributor exempts a non-hermetic test with a reason (happy path)

```text
Given a contributor adds `scripts/tests/test-bar.sh` that requires an
      environment the hermetic CI job does not provide, and lists it in the
      exemption allowlist with a recorded reason,
When   the test-wiring guard runs,
Then   the guard passes, because `test-bar.sh` is exempted with a reason and is
       not forced into a job it cannot satisfy.
```

**Scenario:** contributor adds an unwired, unexempted test (failure path)

```text
Given a contributor adds `scripts/tests/test-foo.sh`, wires it into no CI
      workflow, and adds no exemption entry for it,
When   the test-wiring guard runs,
Then   the guard fails and names `test-foo.sh` as an unwired, unexempted test
       script, and CI is red.
```

**Scenario:** contributor exempts a test without a reason (failure path)

```text
Given a contributor adds `scripts/tests/test-baz.sh` to the exemption
      allowlist but records no reason for the exemption,
When   the test-wiring guard runs,
Then   the guard fails, because every exemption entry must carry a reason.
```

**Scenario:** a stale exemption survives its test file (failure path)

```text
Given the exemption allowlist names `scripts/tests/test-gone.sh`, but that
      test file has since been deleted from the repository,
When   the test-wiring guard runs,
Then   the guard fails and flags the stale exemption, so the allowlist stays
       honest.
```

**Scenario:** command-parity gate stays green (non-regression)

```text
Given the test-wiring guard has been introduced and the current set of
      orphaned tests resolved,
When   the ordered GitHub-Actions-to-GitLab command-parity gate runs,
Then   it remains green, because the explicit per-test enumeration and its
       ordering are preserved.
```

## Out of scope

- The auto-discovering "glob runner" alternative — a mechanism that would
  discover and run every `scripts/tests/test-*.sh` automatically. It is
  deliberately rejected in favor of the registration guard, which preserves
  per-test CI granularity and the ordered command-parity model.
- Fixing any product or logic regression that a newly-wired test surfaces. A
  wired test that reveals a genuine pre-existing bug is flagged for a separate
  ticket; this specification wires tests and guards wiring, it does not own the
  code the tests exercise.
- Changing what any test script asserts, and changing the end-to-end scenario
  runner (`tests/e2e/run.sh`) itself.
- Non-test scripts — `check-*.sh`, `build-*.sh`, and any other script that is
  not a `scripts/tests/test-*.sh` — which this guard does not govern.

## Open questions

- The hermetic-versus-exempt classification of each currently-orphaned test
  script is a realization detail resolved during PLAN and DEV, not an
  authoring-time open question. Requirement 4 fixes the two terminal states
  (executed in CI, or exempted with a reason); which state each orphaned test
  lands in follows from whether that test runs in the hermetic CI environment,
  a determination the implementation makes per test. No owner input is required
  before approval.
