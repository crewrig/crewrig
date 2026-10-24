---
id: "0280"
slug: task-ci-contract
status: approved
complexity: large
interaction-mode: INTERMEDIATE
related-issue: 1777
version: 1.0.0
---

# Task is the CI contract

## Intent

A maintainer who reads a CI job on any engine sees the same three things: the repository is checked out, the toolchain is provisioned, and one named Task command runs. The commands of every job live in one place, the Taskfiles, so changing what a job verifies is one edit, adapting CI to a new engine needs one thin file, and the engine-specific CI YAML is a fraction of today's 12,681 lines. This spec decomposes that change into five ordered sub-specs, each shipped on its own with CI green and reversible. The rationale and rejected alternatives are in `docs/adr/0021-task-is-the-ci-contract.md`.

## Requirements

1. **R1 (contract rule).** After migration, every CI job on every engine SHALL, except a capability recorded as an exception under R4, consist of: a repository checkout, toolchain provisioning, and the invocation `task ci:<id>`, where `<id>` is the capability id. The commands of a job SHALL live only in `taskfiles/ci.yml`, and the `command:` of its capability in `ci/ci-capabilities.yml` SHALL shrink to `task ci:<id>`. Only genuinely engine-level properties (triggers, `paths:`, runtime, OS matrix, required tools, cache keys, history depth, provisioning) SHALL remain in the capability reference and engine files. An exception is a capability marked `portability: specific` with an evidence-backed reason in the reference (for example an engine-reserved job such as GitLab `pages`); it keeps its own command and is the only departure from this rule. Acceptance: for a migrated capability, a check shows its `command:` equals `task ci:<id>`, the task `ci:<id>` exists in `taskfiles/ci.yml`, and no engine file holds the former command text.

2. **R2 (slice 1, split self-tests from checks, issue #1778).** A sub-spec SHALL split each capability whose command bundles a check with its checker's own regression suite into a check capability and a checker-test capability, each with its own `paths:`. It SHALL re-measure `ci:pre-push` under load against the 60 s budget of spec 0279 and update `docs/pre-push-guard.md` with the new figures. Acceptance: no capability command bundles a check with its checker's self-tests; the measured `ci:pre-push` wall time under load is recorded in `docs/pre-push-guard.md` and is within 60 s, or the shortfall is stated with its cause.

3. **R3 (slice 2, uniform verified Task provisioning, issue #1779).** A sub-spec SHALL provide one provisioning mechanism per engine for Task: a pinned version at or above the floor 3.39 of spec 0278 R8, a verified download, and a `task --version` check. On GitHub it SHALL be a local composite action; on GitLab it SHALL be a recipe in `scripts/lib/build-ci/tools.ts`. Every job that runs `task` SHALL use it, and a guard SHALL fail when any job installs Task by another route or by a fail-open command. Acceptance: the guard exits non-zero on a fixture job with an unverified `Install Task` step and exits zero on the repository; the repository holds zero unverified `Install Task` steps.

4. **R4 (slice 3, migrate jobs family by family, issue #1780).** A sub-spec SHALL migrate jobs to `task ci:<id>` in this order: the 22 fast-tier capabilities already mirrored by spec 0279 first, then the remaining Linux jobs, then the Windows jobs under the Windows-command rule of spec 0266. It MAY split into several PRs by family. Acceptance: at the end of the slice every capability `command:` is `task ci:<id>`, or each exception (the closed set R1 allows) is recorded with its evidence in the reference. Because a migrated capability's `command:` is `task ci:<id>`, the sub-spec SHALL amend spec 0279 R3 and R4 by a delta-spec of 0279 (its own spec-PR), as follows: for a migrated capability the parity guard `scripts/check-ci-pre-push-parity.ts` no longer compares command lists and instead fails when the capability's `command:` is not `task ci:<id>` or the task `ci:<id>` does not exist; for a not yet migrated capability, 0279 R3 and R4 apply unchanged, so the guard stays green at every intermediate merge.

5. **R5 (slice 4, alert on a red scheduled run, issue #1781).** A sub-spec SHALL add the simplest portable mechanism that notifies a human when a scheduled run fails, for example opening or updating an issue on failure. Acceptance: a failing scheduled run produces a visible notification in a test against a forced failure, and a passing run produces none.

6. **R6 (slice 5, shrink, issue #1782).** A sub-spec SHALL simplify the capability reference, `scripts/build-ci.ts` and its library, and `scripts/check-ci-parity.ts` and its library to what the thin contract needs, and SHALL publish a line-count report against the baseline of R10. Acceptance: the report is committed with the slice and lists every surface of R10 before and after.

7. **R7 (order and dependency).** The slices SHALL ship in the order R2, R3, R4, R5, R6. Slice 3 SHALL NOT start before slice 2 is merged, because every migrated job depends on a verified `task`. Slice 5 SHALL NOT start before slice 3 is merged. Slice 4 SHALL NOT start before slice 3 is merged, so the alert covers the migrated jobs (owner order; no technical dependency forces it, and the coordinator MAY revise this order by a decision recorded on the logbook of issue #1777). Sub-spec ids are assigned when each sub-spec is authored; until then each slice is identified by its child issue. Acceptance: each sub-spec names its predecessor, and a sub-spec PR for slice 3 or 5 is not merged before its predecessor.

8. **R8 (context handoff).** After slice 2 merges, the coordinator SHALL write a handoff of the decisions and measurements so far, so slice 3 starts from references and not from conversation history. Acceptance: the logbook of issue #1777 carries a handoff comment dated after the slice 2 merge and before the first slice 3 PR.

9. **R9 (per-slice invariants).** Each slice SHALL, at its merge: keep CI green; be reversible by reverting its PRs; leave `.gitlab-ci.yml` regenerated and `check-ci-parity` green; keep `cancel-on-failure`, `changeset-coverage` and `path-ownership` working; keep every task name stable; add new tasks only to `taskfiles/ci.yml` and never to the root `Taskfile.yml`; and introduce no new framework and no new YAML parser, reusing `scripts/lib/taskfile-tree.ts`, `scripts/lib/ci-parity/reference-read.ts`, `scripts/lib/glob-engine.ts` and the parity guard of issue #1763. Acceptance: each sub-spec lists these invariants in its own requirements, and its PR shows them green.

10. **R10 (measurement).** Each slice SHALL report the line counts of the baseline surfaces and compare them with it. Baseline on origin/main, 2026-10-24: `.github/workflows/build.yml` 3,758; `ci/ci-capabilities.yml` 5,189; `.gitlab-ci.yml` 3,734; total 12,681. The work package succeeds when: the total engine-specific CI YAML (the three surfaces above) is at most 8,880 lines at the end of slice 5, a reduction of at least 30% from 12,681, reported per slice (assumption — verify: the figure is a starting target the owner may adjust in the slice 5 sub-spec); slice 5 SHALL NOT start unless the total after slice 3 is at most 10,780 lines (a reduction of at least 15%), otherwise the coordinator decides whether to stop; `ci:pre-push` under load is within the 60 s budget after slice 1; zero `Install Task` steps are unverified; and adapting CI to a new engine needs one thin file plus the shared Taskfiles, shown by `docs/ci-reference-format.md` carrying a thin-job template of at most 15 lines per job that a new engine file reuses unchanged. Acceptance: the PR of each slice carries the counts, and the final report states each success measure as met or not met with its figure.

## Scenarios

**Scenario:** A migrated job is thin

Given the capability `lint-specs` has been migrated
When a maintainer reads its job in the GitHub workflow and in `.gitlab-ci.yml`
Then each shows a checkout, the verified Task provisioning, and `task ci:lint-specs`, and nothing else.

**Scenario:** Changing a check touches one file

Given a migrated job
When a maintainer changes what the check runs
Then only `taskfiles/ci.yml` changes, and both engines run the new command with no regeneration of command text.

**Scenario:** Unverified provisioning is rejected

Given a job that installs Task with an unverified download
When the provisioning guard runs
Then it exits non-zero and names the job.

**Scenario:** A slice is reverted

Given a merged slice that causes a regression
When its PRs are reverted
Then CI returns to green, `check-ci-parity` passes, and no other slice needs to change.

**Scenario:** Out-of-order start is refused

Given slice 2 is not merged
When a slice 3 PR is proposed for merge
Then it is held until slice 2 is merged.

**Scenario:** A red scheduled run notifies

Given the Exhaustive Run fails on a schedule
When the run ends
Then an issue is opened or updated to notify a human, and a later green run leaves no new notification.

## Out of scope

- Changing what any CI job verifies, adding or removing capabilities (other than the slice 1 split), or changing triggers and `paths:` semantics.
- Unifying caching or path filtering across engines; they stay engine-specific.
- Adding a new CI engine, a container-based runner, Dagger, `act`, or a git-hook framework (rejected in ADR-0021).
- The pre-push hook itself (spec 0279), beyond re-measuring it in slice 1.
- Authoring the five sub-specs here; each is its own SPECS-stage artifact and PR.

## Open questions

- The thresholds of R10 (15% after slice 3, 30% at the end) are proposals; the owner may adjust them in the slice 5 sub-spec.
- Does slice 4 need Task at all, given it targets the scheduled workflow itself? To settle in its sub-spec.
- Which exceptions, if any, remain `specific` and keep a non-Task command (for example engine-reserved jobs such as GitLab `pages`)? To settle in slice 3 with evidence.
