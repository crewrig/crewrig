---
id: "0290"
slug: skill-eval-runner
status: draft
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 1849
version: 2.0.1
---

# Skill eval runner: grade a skill from its evals.json when SKILL.md changes

*Delta 02 of `specs/0290-skill-eval-runner.md`, building on `specs/0290-skill-eval-runner.delta-01.md`. Source: the CI parity test `scripts/tests/ci-paths-push-trigger.test.ts`, which requires a capability filtered by `paths` on `pull-request` to be filtered identically on `push`. Requirement 18 keeps the attestation check `pull-request`-only, so a path filter on it cannot be satisfied; the filter is dropped. The version is a PATCH bump: the observable outcome is unchanged (see the scenario), and a trigger without a path filter is a superset of the filtered one, so no in-flight implementation is invalidated. This delta opens no question.*

## ADDED

None.

## MODIFIED

**R18 (capability and task wiring), as modified by delta-01.** Original (delta-01 replacement): "`ci/ci-capabilities.yml` SHALL gain a portable capability `skill-evals-attestation`, triggered on `pull-request` only, path-filtered to `artifacts/**/skills/**`, requiring full history for the base comparison, declaring no secret (requirement 39), whose `command` is `task ci:skill-evals-attestation`; `taskfiles/ci/integration.yml` SHALL define that task." Replacement: `ci/ci-capabilities.yml` SHALL gain a portable capability `skill-evals-attestation`, triggered on `pull-request` only and declaring NO `paths` filter, requiring full history for the base comparison, declaring no secret (requirement 39), whose `command` is `task ci:skill-evals-attestation`; `taskfiles/ci/integration.yml` SHALL define that task. The check SHALL select the skills to verify by content hash (requirements 34 and 37), not by changed path, and SHALL exit 0 with no finding, no warning and no blocking outcome when no skill's content changed against the base. Reason: `scripts/tests/ci-paths-push-trigger.test.ts` requires a capability filtered by `paths` on `pull-request` to be filtered identically on `push`, and requirement 18 keeps this check `pull-request`-only; dropping the filter satisfies the test without adding a `push` trigger. Every other clause of delta-01 R18 (the `task ci:pre-push` inclusion, the second capability running the runner's own tests in mock mode whenever the runner's sources change, and conformance to `docs/ci-reference-format.md` and the CI parity check) is unchanged.
    Acceptance: the `skill-evals-attestation` entry in `ci/ci-capabilities.yml` has a `pull-request` trigger, no `push` trigger and no `paths` key, and `scripts/tests/ci-paths-push-trigger.test.ts` passes.

**Coverage of the path-filter statement.** A search of the base spec and delta-01 for "path-filtered" and `artifacts/**/skills` finds the statement in exactly two places, both of which are the same requirement: base R18 (`path-filtered to artifacts/**/skills/*/SKILL.md`, already replaced by delta-01) and delta-01 R18 (`path-filtered to artifacts/**/skills/**`, replaced above). No other requirement or scenario states that the capability is path-filtered. Requirement ids modified by this delta: R18 only.

## REMOVED

None. The path filter on the `skill-evals-attestation` capability is removed through the modification above, not as a standalone requirement.

## Scenarios

**Scenario:** a pull request touching no skill content runs the check and nothing blocks

```text
Given a pull request that changes only docs/ and no file under any skill's source directory
When  the skill-evals-attestation capability runs on that pull request
Then  the check is triggered, because the capability carries no path filter
And   it computes no stale attestation, since no skill's content hash differs from the base
And   it exits 0 and reports nothing to block, with no warning
```
