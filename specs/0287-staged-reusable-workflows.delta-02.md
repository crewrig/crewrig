---
id: "0287"
slug: staged-reusable-workflows
status: approved
complexity: standard
interaction-mode: AUTO
related-issue: 1933
version: 2.1.0
---

# Staged reusable workflows for the GitHub CI

Delta-02 lets a pull request that changes only files under `specs/` skip the 24 `windows-*` jobs. Measured baseline: run 43705279898 (PR #2029, a spec-only PR) took 296 s with 110 jobs, of which the 24 Windows jobs cost 1,587 of 2,662 runner-seconds; the last non-Windows job of that run ended at 180 s. Spec 0287 R1, R4 and R9 forbid any `if:` on a caller job so that "a skipped dependency can never silently skip a required check"; this delta replaces that blanket ban with exactly one permitted `if:`, on the `windows` caller job, fed by one new scope job. The rationale for the ban holds: no required context lives in the `windows` group, and the permitted `if:` fails open. Delta-01 (version 2.0.0) is the base; version 2.1.0 is a minor bump because an implementation of 2.0.0 stays valid for every path except the one added here. Every requirement not named below is unchanged.

Compatibility verdicts, checked against the repository at the commit of this delta (the reasoning is in R26):

- Spec 0283 R3 and `docs/ci-reference-format.md` "No `paths-ignore`": the `if:` is not a path filter and the reference gains no exclusion form; the `windows` capabilities keep no `paths:`. No conflict.
- Spec 0283 R1 and R2: R1 requires `command: task ci:<id>` for every capability outside the closed exception set of R2, and the thin job body of 0283 R5/R6 (`.github/actions/ci-job`) ends with a `cancel-on-failure` step. `pr-scope` cannot use that body (R24: a cancel would defeat fail-open), so it is a new recorded exception under R2's last sentence ("a recorded exception in the reference, justified by the step that has no task form, never a silent skip"): R22 records it. With that record, no conflict.
- Spec 0049 delta-01 R16 and R17: the harness reads path filters of the attributed job (`ci-job` gate, `dorny/paths-filter`, workflow `paths`); a caller job has no steps and is skipped by 0287 R8, so the `if:` is outside what R16 forbids. No conflict, with the gap recorded non-silently (R26).
- Spec 0251 R4: concerns `repository-scan` and catch-all globs; untouched.
- Spec 0147 delta-01 R13, R15, R19: path ownership reads `paths:` sets of the reference and evaluates every tracked file; a caller `if:` removes no file from ownership. No conflict.

## ADDED

- **R22 (scope job `pr-scope`).** `ci/capabilities` SHALL gain one capability `pr-scope` (group `gate`, `portability: specific` with an `exception` for engine `github-actions`, `pull-request` and `push` triggers on `main` and `release/**`, no `paths:`), run by a top-level job `pr-scope` of `.github/workflows/build.yml` (a third hosting exception beside the two of R21, with the same reason: the job's output is consumed by the caller). The job SHALL expose one output `spec-only`, equal to `true` if and only if the event is a `pull_request`, the list of files changed by the pull request is non-empty, and every changed path is under `specs/`. A renamed file counts both its old and its new path, so a file moved out of `specs/` is not spec-only. In every other case (a `push`, a `workflow_dispatch`, an empty list, one path outside `specs/`) the output SHALL be `false`. The job SHALL fail, and SHALL NOT report `false`, when the list reaches 3,000 entries (the cap of the pull-request files API, past which the list may be truncated), whatever source the list comes from, and when it cannot be computed (R24). The classification SHALL live in this job and nowhere else: no `kind` or "PR kind" field is added to the capability format of specs 0047 and 0049, and those specs are not changed by this delta. `docs/ci-reference-format.md` changes only by the additive entry of `pr-scope` in its list of capabilities that keep their own command (0283 R2); its format, fields and rules are unchanged. **0283 exception record.** `pr-scope` SHALL NOT use `.github/actions/ci-job` and SHALL carry no `cancel-on-failure` step: `ci-job` ends with `cancel-on-failure` under `if: ... && failure()`, which runs `gh run cancel` on the whole run (verified in `.github/actions/ci-job/action.yml` and `.github/actions/cancel-on-failure/action.yml`), and a cancelled run makes `!cancelled()` false and Windows never starts. The capability therefore keeps its own `command:` (not `task ci:pr-scope`), with `portability: specific` and an `exception.evidence` that states this reason, and `scripts/check-ci-parity.ts` SHALL accept it as a recorded exception. `pr-scope` has no `needs` and is in the `needs` of no Linux group, so the fail-fast graph of R4 is unchanged for them. Acceptance: offline cases of the classification (only `specs/` files; one file outside; a rename out of `specs/`; a rename into `specs/`; an empty list; a push) yield the stated output.
- **R23 (the single permitted `if:`).** The `windows` caller job SHALL be declared with `needs: [pr-scope]` and with exactly this condition: `if: ${{ !cancelled() && (github.event_name != 'pull_request' || needs.pr-scope.outputs.spec-only != 'true') }}`. It is the only `if:` allowed on any caller job of `build.yml`; the other five caller jobs and the three top-level jobs carry no `if:`. Push events to `main` and `release/**`, `workflow_dispatch` and every pull request that is not spec-only SHALL run the `windows` group in full, and the unfiltered push of specs 0309 delta-02 R6, #2034 and #2035 is unchanged. Acceptance: the wiring test of R9 asserts the single `if:` and its exact text.
- **R24 (fail-open).** The cases GitHub can produce for `needs.pr-scope.result` are `success`, `failure` (a script error, a step failure or a job timeout) and `cancelled`; `skipped` cannot occur because `pr-scope` has no `needs` and no `if:`. When `pr-scope` fails, or produces an output that is not exactly `true`, the `windows` group SHALL run. `cancelled` happens only when the whole run is cancelled (a superseding push, a user, or the cancel of another job), and then no job of the run starts, Windows included, which is the intended outcome and not a silent skip. `pr-scope` has no `cancel-on-failure` step (R22), so its failure fails that job alone, leaves the run uncancelled, and `!cancelled()` stays true. The scope job SHALL fail (not report `false`) when it cannot compute the changed-file list, and the condition of R23 turns that failure into a Windows run, so a scope failure never skips Windows silently. The failure SHALL remain visible as a failed `pr-scope` check and SHALL NOT be masked with `continue-on-error`. Acceptance, three layers: (a) the exact text of the condition is asserted by the wiring test of R9; (b) a committed truth table pins the expected outcome of that text for every combination of `github.event_name` (`pull_request`, `push`, `workflow_dispatch`), `needs.pr-scope.result` (`success`, `failure`) and `needs.pr-scope.outputs.spec-only` (`true`, `false`, absent), written by hand from R23 and reviewed, and a test evaluates the condition text extracted from `build.yml` (not a copy of it) over those rows with a small evaluator of the expression grammar the condition uses (`!`, `&&`, `||`, `!=`, string literals, context lookups), with the single skipping row being `pull_request`, `success`, `true`; the table guards regressions of the text and is not evidence of GitHub's own semantics; (c) that evidence is two recorded runs of a throwaway branch and pull request, closed unmerged: one spec-only run showing `windows` skipped, and one run with `pr-scope` forced to fail showing `pr-scope` failed, the run not cancelled and the 24 Windows jobs started; the run ids go in the pull request body.
- **R25 (required contexts on a spec-only pull request).** The required contexts `ratchet` and `lint-typescript` (rulesets `main-protected` and `release-protected`, unchanged, R5) are jobs of `build.yml` outside the `windows` group and carry no `if:` and no dependency on `pr-scope`, so they run and report on every pull request, spec-only or not. When the `if:` of R23 is false, the `windows` caller job reports as skipped, none of the 24 callee jobs is created, so no `windows / <job>` context exists for that run; a skipped caller job satisfies no ruleset and blocks none, and no ruleset requires a `windows` context. No ruleset, branch protection or `gh api` command is run or prepared (R5). Acceptance: the report of the implementation pull request lists, for a spec-only run, `ratchet` and `lint-typescript` as success and `windows` as skipped, and the merge box is satisfied without any ruleset change.
- **R26 (parity and GitLab).** The conditional run of the `windows` group is a GitHub-side run condition by pull-request kind, not a path filter: the reference keeps no `paths:` on the 24 `windows-*` capabilities, gains no exclusion form and no `paths-ignore:`, and no workflow in `.github/workflows/` gains `paths:` or `paths-ignore:`. `scripts/check-ci-parity.ts` SHALL keep passing: it skips caller jobs (R8) and reads no caller `if:`, and `pr-scope` is traced by its capability id and accepted as the recorded exception of R22. The gap between the unfiltered reference and the GitHub behaviour SHALL be recorded once, as an accepted non-silent gap, in the amendment of `docs/adr/0021-task-is-the-ci-contract.md` (R14) and in the `description` of the `pr-scope` capability. `.gitlab-ci.yml` is unaffected and SHALL NOT gain an equivalent `rules:changes` or any scope job: the 24 `windows-*` capabilities are GitHub-only (`exception.engine: github-actions`, GitLab has no Windows runner), so the generated GitLab file contains none of their jobs; `pr-scope` is GitHub-only for the same reason and its `exception` states that a GitLab merge-request pipeline has no Windows group to skip. Acceptance: `node scripts/build-ci.ts` leaves `.gitlab-ci.yml` free of any `pr-scope` job and of any change to a Windows stage, and `check-ci-parity` is green.
- **R27 (time goal and honest measurement).** The goal, set by the owner, is a spec-only pull request whose CI completes in under 3 minutes (180 s); the baseline is 296 s. This delta controls only the removal of the Windows jobs, and the baseline's last non-Windows job ended at 180 s, so the goal is not guaranteed by this delta alone. Acceptance is therefore: (a) the median wall-clock time of three consecutive green spec-only `pull_request` runs, measured as in R10, is reported with the number of jobs and the runner-seconds against the baseline of 110 jobs and 2,662 runner-seconds, the 24 Windows jobs shown as skipped; (b) the report names the Linux critical path (its last job and its end time) and shows that the median is within 10 s of it, which proves that the Windows group no longer extends the run; (c) when the median is below 180 s the goal is met; when it is not, the report states the gap to 180 s and the finding goes back as a new spec ticket, without relaxing the criterion and without skipping any other group (R23). The R10 window of 375 s to 435 s keeps applying to a pull request that is not spec-only. The R10 rule that Windows jobs start within 60 s of the run start is kept for runs where Windows runs, and is measured: the report of such a run states the start of `pr-scope`, its end and the start of the first Windows job.

## MODIFIED

- **R1 (six callee files, one caller), caller job count.** Delta-01 text: "...SHALL contain exactly eight jobs: six caller jobs, one per group, each a `uses: ./.github/workflows/_ci-<group>.yml` reference with no steps, plus the two top-level jobs `ratchet` and `lint-typescript` of R21, which have steps." Replacement: "...SHALL contain exactly nine jobs: six caller jobs, one per group, each a `uses: ./.github/workflows/_ci-<group>.yml` reference with no steps, plus the three top-level jobs `ratchet`, `lint-typescript` and `pr-scope` (R21, R22), which have steps. The `windows` caller job is the only caller job that carries a `needs` on a top-level job outside the Linux chain and the only one that carries an `if:` (R23)." The original sentence of 0287 R1 "SHALL contain only six caller jobs ... with no steps" is thereby superseded together with its delta-01 replacement, and the callee file names, triggers and seven-file acceptance are unchanged.
- **R2 (job keys unchanged, each present once), count.** Delta-01 text: "the 106 callee keys plus the 2 top-level keys ... SHALL still equal the 108 capability ids". Replacement: "the 106 callee keys plus the 3 top-level keys (`ratchet`, `lint-typescript`, `pr-scope`), excluding the six caller job ids, SHALL equal the 109 capability ids of the GitHub engine in `ci/capabilities`; no key appears twice and none is lost."
- **R3 (group of every job), counts.** Delta-01 text: "(gate 19, modules 15, governance 28, extensions 14, integration 8, windows 24, total 108), but the 19 `gate` jobs are hosted as 17 in `_ci-gate.yml` and 2 ... in `build.yml`." Replacement: "gate 20, modules 15, governance 28, extensions 14, integration 8, windows 24, total 109, the 20 `gate` jobs being hosted as 17 in `_ci-gate.yml` and 3 (`ratchet`, `lint-typescript`, `pr-scope`) in `build.yml`." The table and every other sentence are unchanged.
- **R4 (needs graph), `windows` and the `if:` ban.** Delta-01 text: "`windows` with no `needs` and therefore starting at once, and ungated" and "the prohibition of an `if:` on any caller job are unchanged". Original 0287 R4 text: "No caller job SHALL carry an `if:` that skips a group, so that a skipped dependency can never silently skip a required check." Replacement: "`pr-scope` with no `needs`; `windows` with `needs: [pr-scope]` only, starting as soon as `pr-scope` completes, and not gated on any Linux group or on `gate`, `ratchet` or `lint-typescript`; the other five groups as in delta-01. Exactly one caller job, `windows`, SHALL carry an `if:`, the condition of R23; no other caller job SHALL carry an `if:` that skips a group, and none SHALL `needs` `windows`, so that a skipped `windows` can never skip another job or a required check." The R10 rule that Windows jobs start within 60 s of the run start still holds with the added dependency and is measured by R27.
- **R9 (wiring test), needs graph and `if:` assertion.** Delta-01 text: "the needs graph of R4 (`gate`, `ratchet` and `lint-typescript` precede every Linux group, `windows` has no `needs`, no group is skipped by an `if:`)". Replacement: "the needs graph of R4 (`gate`, `ratchet` and `lint-typescript` precede every Linux group, `windows` has exactly `needs: [pr-scope]`, `pr-scope` has no `needs`); that `build.yml` contains exactly nine jobs including `pr-scope`; that exactly one job of `build.yml` carries an `if:`, that it is `windows`, and that its text equals the condition of R23 character for character after whitespace normalisation; and that no other group is skipped, that is, no other caller job and none of `ratchet`, `lint-typescript` and `pr-scope` has an `if:`; the group-versus-file check accepts exactly the keys `ratchet`, `lint-typescript` and `pr-scope` in `build.yml`." The mutation set gains: adding an `if:` to any other caller job fails; changing the text of the `windows` condition fails; removing `!cancelled()` from it fails; removing the `if:` from `windows` fails; moving `pr-scope` into `_ci-gate.yml` fails.
- **R11 (shared `group` field), last check.** Delta-01 text: "`ratchet` and `lint-typescript` (group `gate`) SHALL be held by `build.yml` (R21)". Replacement: "`ratchet`, `lint-typescript` and `pr-scope` (group `gate`) SHALL be held by `build.yml` (R21, R22) and fail if held anywhere else."
- **R21 (hosting exception for the required contexts), scope.** Delta-01 text: "Exactly two jobs, `ratchet` and `lint-typescript`, are exempt". Replacement: "Exactly three jobs, `ratchet`, `lint-typescript` and `pr-scope`, are exempt from the rule that a capability's job lives in its group's callee file; the third is exempt for the reason of R22, not for a required context." The acceptance of R21 is extended to the three keys.
- **R13 (line ratchet and report).** Delta-01 text: re-measure at DEV time, hard cap 9,100 unchanged. Replacement: the re-measurement SHALL include the `pr-scope` capability, its job, its script and the `if:` of the caller; the cap and the pin rules are unchanged.
- **R14 (ADR amendment).** Delta-01 text: the amendment records the R21 exception. Replacement: it SHALL additionally record the conditional `windows` group, the fail-open condition, the reason the `if:` is not a path filter, and the accepted gap of R26; the rejected alternatives to record are a `kind` field in the capability format (rejected: changes specs 0047 and 0049 for one consumer), `paths-ignore: specs/**` on the Windows capabilities (rejected: forbidden by `docs/ci-reference-format.md` and 0283 R3), a `paths:` filter on the callee jobs (rejected: the `windows` capabilities have none by design), and an `if:` on every group (rejected: a skipped dependency would then be able to skip a required check).
- **Scenario "Fast failure stops the Linux stages".** The Given clause "while `windows` jobs that began at t=0 are cancelled with the run" is replaced by "while `windows` jobs that began once `pr-scope` completed are cancelled with the run" on a run where Windows runs.
- **Out of scope, "Changing any command, path filter, runtime or trigger of a capability".** Replacement: "Changing any command, path filter, runtime or trigger of a capability other than the addition of `pr-scope`; the `windows-*` capabilities themselves are not edited."
- **Open question "Which rulesets exist beyond ..."** is already removed by delta-01 and stays removed.

## REMOVED

- **R4 sentence, "No caller job SHALL carry an `if:` that skips a group".** Removed as a blanket ban, and replaced by the one permitted `if:` of R23 together with the prohibition on every other caller job in R4 above.
- **R9 clause, "no group is skipped by an `if:`" as a flat assertion.** Removed and replaced by the assertion of the single permitted `if:` and its exact text, with every other group still asserted unskipped.

## Scenarios (of this delta)

These scenarios are added to the parent scenarios.

**Scenario:** Spec-only pull request skips Windows

Given a pull request whose changed files are all under `specs/`
When the `Build & Validate` run completes
Then `pr-scope` reports `spec-only` as `true`, the `windows` caller job is skipped and none of the 24 `windows-*` jobs exists, `ratchet`, `lint-typescript` and every Linux group run and succeed, and the pull request is mergeable under the unchanged rulesets.

**Scenario:** One file outside `specs/` runs Windows

Given a pull request that changes `specs/0287-staged-reusable-workflows.delta-02.md` and one file under `scripts/`
When the run starts
Then `pr-scope` reports `false` and the 24 Windows jobs run.

**Scenario:** A rename out of `specs/` runs Windows

Given a pull request that moves `specs/a.md` to `docs/a.md`
When `pr-scope` classifies the change
Then both paths are counted, one is outside `specs/`, the output is `false` and Windows runs.

**Scenario:** Push to main stays unfiltered

Given a merge to `main` whose commit changed only files under `specs/`
When the push-triggered run starts
Then `github.event_name` is `push`, the condition of R23 is true, and the `windows` group and every other capability run unfiltered.

**Scenario:** The scope job fails

Given `pr-scope` cannot compute the changed-file list and fails
When the condition of the `windows` job is evaluated
Then the `pr-scope` job is failed, the run is not cancelled (no `cancel-on-failure` step ran), the 24 Windows jobs start, the failed `pr-scope` check stays visible, and no job is skipped silently.

**Scenario:** The file list reaches the API cap

Given a pull request whose changed-file list has 3,000 entries, all under `specs/`
When `pr-scope` classifies the change
Then the job fails instead of reporting `true`, and Windows runs.

**Scenario:** A second caller job gains an `if:`

Given a change that adds an `if:` to the `integration` caller job, or edits the text of the `windows` condition
When the wiring test runs
Then it fails naming the job.

**Scenario:** The target is missed

Given three spec-only runs whose median is 182 s because a Linux job ends at 181 s
When the report is written
Then it names that Linux critical path, shows the median within 10 s of it, states the 2 s gap to the 180 s goal, does not relax the criterion, and raises the finding as a new ticket.

**Scenario:** GitLab is untouched

Given the change is implemented
When `node scripts/build-ci.ts` runs
Then `.gitlab-ci.yml` has no `pr-scope` job, no Windows job and no new `changes:` rule.

## Out of scope (of this delta)

- Any other group skipped on a spec-only pull request, and any other pull-request kind (documentation-only, markdown-only): the `windows` group is the only one that may be skipped (R23).
- Per-pull-request-kind reporting (`kinds.ts`, `ci-pr-kinds.ts`) and any "PR kind" field in the capability format of specs 0047 and 0049.
- Any change to the rulesets or to branch protection (R5, R25).
- A GitLab equivalent (`rules:changes`) (R26).
- Shortening the Linux critical path to reach the target (R27 raises it as a new ticket).
- Reverting the unfiltered push to `main` and release branches of #2034 and #2035.

## Open questions (of this delta)

- [AUTO-PARKED] The baseline run's last non-Windows job (`governance / ci-pre-push-replay`) ended at 180 s, so skipping Windows alone is borderline against the 180 s target of R27, and a run on a busier runner pool may exceed it. R27 states the measurement and the escalation; the owner decides whether a Linux critical-path reduction (for example `ci-pre-push-replay`) belongs in a follow-up ticket.
- [AUTO-PARKED] Hosting `pr-scope` in group `gate` changes the group counts (20 and 109) and extends the R21 exception to a third job; hosting it in a new seventh group was not chosen because 0287 fixes six group names. Confirm in the spec PR.
- [AUTO-PARKED] The `ci-job` composite action exposes no step output today, and spec 0283 asks that a capability's command be `task ci:<id>`; how `pr-scope` publishes `spec-only` while honouring that contract (or recording a 0283 R2 exception) is left to the PLAN.
