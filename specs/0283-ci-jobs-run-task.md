---
id: "0283"
slug: ci-jobs-run-task
status: implemented
complexity: large
interaction-mode: INTERMEDIATE
related-issue: 1780
version: 1.0.0
---

# CI jobs run `task ci:<id>`

## Intent

Every CI job still carries its own command text, its own checkout and toolchain boilerplate and its own copy of a path list, on three surfaces that together total 14,226 lines on origin/main (baseline 12,681; `.github/workflows/build.yml` 4,191, `.gitlab-ci.yml` 4,268). Moving `command:` text into `taskfiles/ci.yml` alone cannot reach the 10,780-line floor of `specs/0280-task-ci-contract.md` R10: about 6,850 of those lines are `paths` lists, roughly half of the trigger and `changes:` lists being a duplicate of the other trigger (2,635 trigger-path and 145 `cache.files` lines in `ci/ci-capabilities.yml`, 2,654 `changes:` and 145 cache key lines in `.gitlab-ci.yml`, 1,262 `dorny/paths-filter` lines in `build.yml`), and about 1,000 more are per-job boilerplate in `build.yml`. This is slice 3 of 0280 (R4, with the invariants of R9 and the measurement of R10). Predecessors: `specs/0282-verified-task-provisioning.md` (merged, the verified `task`) and two deltas, each its own spec-PR owned by the orchestrator, that SHALL merge before the first PR of this slice: `specs/0279-pre-push-guard.delta-03.md` (amends 0279 R3/R4) and `specs/0049-ci-drift-harness.delta-02.md` (amends 0049 delta-01 R15, which says a trigger that declares no `paths` is unfiltered and so contradicts the inheritance of R3, and R12-R20, which compare the reference to the GitHub-side filter that R6 and R7 replace). The slice makes the capability the single authority for the path set, makes the task the single authority for the command, and makes each GitHub job a checkout plus one composite action. The rationale is in `docs/adr/0021-task-is-the-ci-contract.md`.

## Requirements

1. **R1 (authority inversion, command).** For every capability not in the closed exception set of R2, `command:` in `ci/ci-capabilities.yml` SHALL be the single entry `task ci:<id>`, and the former command list SHALL become the body of the task `ci:<id>` in `taskfiles/ci.yml`. Tasks SHALL be added only there, never to the root `Taskfile.yml`; names are stable; every command satisfies the Windows-command rule of spec 0266; provisioning stays out of tasks (spec 0279 R5): a task whose tool is missing fails a `preconditions:` entry whose message points at `task lint-bootstrap`. Acceptance: no migrated capability carries a command other than `task ci:<id>`, `scripts/check-taskfile-tree.ts` and `scripts/check-taskfile-commands.ts` pass, and a test over every capability proves the task exists.
2. **R2 (closed exception set, measured).** Of 128 capabilities, 27 are `portability: specific`: 24 `windows-*` and `claude`, `copilot`, `pages-deploy` (grep of `ci/ci-capabilities.yml`, 2026-10-24). The three non-Windows ones are GitHub-native with a recorded `exception.evidence` (mention triggers in `claude.yml` and `copilot.yml`; the Pages action chain in `pages.yml`) and are the only departure from R1: they keep their hand-authored workflow and are not thin-job candidates. The 24 `windows-*` capabilities are specific only because GitLab has no Windows runner; they SHALL migrate (R9). Any further capability a PR cannot express as one task is a recorded exception in the reference (`portability: specific` plus evidence), justified by the step that has no task form, never a silent skip. Acceptance: the exception list in `docs/ci-reference-format.md` equals the capabilities that keep their own command, and `check-ci-parity` rejects an unrecorded one.
3. **R3 (one path set per capability).** The capability entry SHALL accept an optional capability-level `paths:`. A `pull-request` or `push` trigger with no `paths:` of its own inherits it, and `cache.files` defaults to it when absent. Trigger-level `paths:` stays accepted and wins. The slice SHALL convert every capability mechanically with a committed one-shot script, and a test over every capability SHALL prove the effective path set per trigger and the effective `cache.files` are identical before and after. The reference uses no `paths-ignore:` (grep of `ci/ci-capabilities.yml` finds none) and the generator SHALL reject it on a migrated capability. Decision: no delta of spec 0047, because the text of 0047 and 0048 never mentions `paths`, the format is normative in `docs/ci-reference-format.md` (which this slice amends additively), and 0048's generated output keeps its meaning; the contradiction with 0049 is resolved by its delta-02, not here. Acceptance: the before/after equivalence test is green on all 128 capabilities, and the pull-request/push duplicate of each list is removed, which roughly halves the 2,635 trigger-path lines.
4. **R4 (GitLab output without repetition).** `scripts/lib/build-ci/` SHALL emit each job's `changes:` list once, with a YAML anchor, and reference it by alias in the second rule; the cache key `files:` list likewise. The parity reader (`scripts/lib/ci-parity/gitlab-arm.ts`, through `scripts/lib/yq-accessors`) SHALL resolve anchors; if it does not today, the minimal extension is to resolve aliases in the existing accessor, with no new YAML parser. Acceptance: `.gitlab-ci.yml` equals the generator output, GitLab's lint accepts it, and a test shows the parity reader returns the same lists with and without anchors.
5. **R5 (GitHub thin job).** A local composite action `.github/actions/ci-job` SHALL take inputs `id`, `node` (22 or 24), `install` (`ci`, `install`, `omit-dev`, `none`) and `task` (boolean), and perform in order: `setup-node`, the runtime path gate of R6, `./.github/actions/setup-task` (spec 0282) when `task` is true, the dependency install, the Node floor guard when applicable, `task ci:<id>`, and the cancel-on-failure step on failure. A migrated job SHALL be a checkout plus `uses: ./.github/actions/ci-job` with `with:`, at most 15 lines. The template is committed in `docs/ci-reference-format.md` (0280 R10). Acceptance: each migrated job fits the template; the ratchet test of R10 fails a longer one.
6. **R6 (path gate replaces `dorny/paths-filter`).** The filter lists SHALL leave `build.yml`. A script (suggested `scripts/ci-paths-gate.ts`) SHALL read the capability's effective `paths:` with `scripts/lib/ci-parity/reference-read.ts` and match the changed files with `scripts/lib/glob-engine.ts`; no new parser and no glob library. Semantics SHALL equal today's filter: `pull_request` is the files changed by the PR (merge ref against the base tip, a tree diff that needs no merge-base), `push` is `before..after`. It SHALL FAIL OPEN, running the job, whenever the diff cannot be computed (no base, force-push, missing object), and SHALL emit a visible `::notice` annotation on each fail-open so the rate is countable; the shadow period of R9 reports it. A glob the engine does not support is a hard error in the parity guard at review time, never at runtime. The checkout SHALL fetch the base commit (`fetch-depth` sufficient for the tree diff, or an explicit fetch of the base sha), and the gate SHALL preserve the behaviour of the existing filter step: a skipped job reports success so required checks stay satisfiable. Rollout is two-step: the gate first runs in shadow mode beside `dorny/paths-filter`, which stays authoritative and logs each disagreement as a workflow annotation; the filter is removed only by the later PR of R9. Acceptance: a test over fixtures covers match, no match, no base, force-push (with the `::notice`) and unsupported glob; a job whose files do not match is skipped green.
7. **R7 (parity and guards).** `scripts/check-ci-pre-push-parity.ts` SHALL stop comparing command lists for a migrated capability and instead require `command:` equal to `task ci:<id>` and the task to exist (per the 0279 delta). The effective path set of a trigger SHALL be its own `paths` when present, else the capability `paths` (the definition 0049 delta-02 carries). `scripts/check-ci-parity.ts` concern 6 (path filters) SHALL become, for a migrated job, "the job uses `ci-job` with its own capability id", as that delta defines. Traceability, the cancel-on-failure guard, changeset-coverage, path-ownership and the spec 0282 provisioning guard SHALL keep working, reusing `scripts/lib/taskfile-tree.ts`, `reference-read.ts` and `glob-engine.ts`. Acceptance: each guard has a failing fixture and a passing repository.
8. **R8 (invariants, 0280 R9).** At each merge: CI green; reversible by reverting the PR; `.gitlab-ci.yml` regenerated and `check-ci-parity` green; `cancel-on-failure`, `changeset-coverage` and `path-ownership` working; task names stable; new tasks only in `taskfiles/ci.yml`; no new framework and no new YAML parser; every new test wired in `build.yml`, `ci/ci-capabilities.yml`, `.gitlab-ci.yml` and `scripts/check-test-wiring.ts` (following spec 0281: check and self-test as separate capabilities); every new test uses `mkdtemp` directories only (host safety). Acceptance: the PR shows each green.
9. **R9 (families and PR plan).** The slice MAY split into several PRs, each CI-green and reversible, on `test/1777-<slug>` branches until the last. Order: PR1 is the foundation (R3, R4, R5, R6 in shadow mode beside `dorny/paths-filter`, R7) plus the 22 fast-tier capabilities of `ci/pre-push-tier.json`; a later PR removes `dorny/paths-filter` and its filter lists once the shadow sample is met (at least 20 distinct runs over at least 3 days, or the run count the PLAN fixes, with zero disagreements), so every PR stays reversible; then the remaining Linux jobs in two or three family PRs; last the 24 `windows-*` jobs. Spec 0282 R4 fails closed on non-Linux, so the Windows PR SHALL add the `windows_amd64` checksum to `ci/task-pin.json` and prove the zip extraction on a `windows-latest` runner under the bash shell before any Windows job depends on it; Windows jobs that do not run `task` today gain it here. Acceptance: at the end every capability's `command:` is `task ci:<id>` or is a recorded exception (R2).
10. **R10 (measurement, hard floor).** Every PR SHALL report line counts per surface (`build.yml`, `ci/ci-capabilities.yml`, `.gitlab-ci.yml`, total) and the growth of `taskfiles/ci.yml` and of every new script, so the shrink is not flattering. The slice is done only when the total of the three surfaces is at most 10,780 lines (owner decision, not lowered), and `docs/ci-reference-format.md` carries the thin-job template. A ratchet test SHALL pin the total so it cannot regrow. Only the three surfaces count toward the floor; `taskfiles/ci.yml` and new scripts are reported but sit outside it. Estimate, re-measured by the PLAN per family, from today's 14,226 to the end of the slice:

| Surface | Today | Removed | Added | End of slice |
|---|---|---|---|---|
| `ci/ci-capabilities.yml` | 5,767 | about 1,315 duplicate trigger paths, 140 cache lines, 770 command lines | none | about 3,540 |
| `.gitlab-ci.yml` | 4,268 | about 1,110 duplicate `changes:` lines, 100 cache lines, 570 script lines | alias and `task` lines, already netted | about 2,490 |
| `.github/workflows/build.yml` | 4,191 | 1,262 filter lines, about 1,000 boilerplate, about 700 run-step lines | about 850 thin-job lines | about 2,100 |
| Total of the three | 14,226 | | | about 8,130, margin about 2,650 |
| `taskfiles/ci.yml` (outside the floor) | growth | | about 900 command lines plus task overhead | reported |

Acceptance: the last PR reports a total at or below 10,780; if a PLAN re-measurement projects a total above 10,780 it SHALL say so before DEV and the coordinator decides; otherwise the coordinator stops slice 5 per 0280 R10.
11. **R11 (rejected alternatives and the riskiest decision).** Rejected: for R3, de-duplicating only in the generator, because the 2,635 lines live in the reference a maintainer edits; for R4, a GitLab `extends:` template, because `rules:` do not merge across `extends`; for R6, `dorny/paths-filter` with a generated filters file (a fourth uncounted surface), per-job native `on.paths` (not expressible for 100+ jobs in one workflow) and fewer jobs (ADR-0021 keeps the granularity). Devil's advocate on R6: replacing a widely used action with an in-repo gate moves the decision to run a required check into code we own, so a wrong skip is a silent hole in CI and a fail-open default can hide a broken diff behind slow green runs. Mitigation: fail open by construction with a counted `::notice`, the equivalence test of R3, the fixtures of R6, and the shadow period of R9 (the gate beside the authoritative filter for at least 20 distinct runs over at least 3 days, zero disagreements) before a separate PR removes the filter. Acceptance: the PR that removes the filter records the sample size, the period and a zero disagreement count.

## Scenarios

**Scenario:** A migrated job is thin

Given `lint-specs` is migrated
When a maintainer reads its job in `build.yml` and `.gitlab-ci.yml`
Then GitHub shows a checkout and `ci-job` in at most 15 lines, GitLab shows the generated job, and both run `task ci:lint-specs`.

**Scenario:** One edit changes a path set

Given a capability with a capability-level `paths:`
When a maintainer adds a path
Then the pull-request trigger, the push trigger, the GitLab `changes:` lists, the GitHub gate and `cache.files` all follow, from one edit.

**Scenario:** The gate fails open

Given a push whose `before` commit is absent from the checkout
When the gate runs
Then it runs the job instead of skipping it.

**Scenario:** An unrecorded command is rejected

Given a capability whose `command:` is not `task ci:<id>` and which records no exception
When `check-ci-parity` runs
Then it exits non-zero naming the capability.

**Scenario:** The Windows pin is proven

Given the Windows PR
When `setup-task` runs on `windows-latest`
Then the archive is checksum-verified and `task --version` matches the pin, and a missing checksum still fails closed.

**Scenario:** GitLab anchors are equivalent

Given a generated job whose second rule aliases the `changes:` list of the first
When the parity reader and a test read the job with and without alias resolution
Then both return the same lists, and GitLab's lint accepts the file.

**Scenario:** A migrated job without its own id is rejected

Given a migrated job that uses `ci-job` with another capability's id, or a filter step instead
When `check-ci-parity` concern 6 runs
Then it exits non-zero naming the job and the expected id.

## Out of scope

- Changing what any job verifies, its triggers or its path semantics; adding or removing capabilities.
- The pre-push hook and tier mechanics (0279), beyond the delta; the scheduled-run alert (slice 4) and the shrink of the generators (slice 5).
- Unifying caching across engines; a new engine, container runner, Dagger or `act`.

## Open questions

- Does the GitHub gate need `fetch-depth` above 1 for pull-request jobs, and what does that cost on the 106 jobs? The PLAN measures it before PR1.
- Can the Windows archive be verified with the bash shell's `unzip`, or does it need a PowerShell step the Windows-command rule does not admit? Decided by the proof in R9.
