---
id: "0284"
slug: alert-red-scheduled-run
status: implemented
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 1781
version: 1.0.0
---

# Alert on a red scheduled run

## Intent

A scheduled run that fails today is only a red entry in the Actions tab: nobody is told. The exhaustive run (`.github/workflows/changeset-coverage.yml`, workflow name "Exhaustive Run", cron `17 3 * * *`, `workflow_dispatch`) is the only scheduled workflow, and it is the one that catches regressions no pull request exercised, so a silent red there defeats its purpose. `docs/ci-reference-format.md` (*The exhaustive run*) says a failure "is never reported only in a log (R22)", yet nothing sends it to a human. This is slice 4 of `specs/0280-task-ci-contract.md` (R5): add the simplest portable mechanism that notifies a human when a scheduled run fails. Decision: the notification is an issue opened, or commented on if one is already open, through `gh` (forge access is CLI-only), driven by one task `ci:alert-scheduled-failure` wrapping one small TypeScript script, and triggered by one extra job in the scheduled workflow itself. Task is kept, which settles the open question of 0280 (does slice 4 need Task at all): the contract of ADR-0021 is that every CI command is a `task ci:<id>`, and the task is what lets a maintainer reproduce the alert locally with `--dry-run` and what keeps the command identical on both engines. The mechanism adds no secret, no third-party action and no new framework. Predecessors: `specs/0280-task-ci-contract.md` (parent), `specs/0283-ci-jobs-run-task.md` (slice 3; its PR families #1798, #1799 and #1800 are merged and the fourth family PR is in flight), `specs/0282-verified-task-provisioning.md` (the verified `task` the alert job installs) and `specs/0281-split-checker-selftests.md` (check and self-test as separate capabilities). 0280 R7 orders slice 4 after slice 3 but lets the coordinator revise the order; slice 4 starts before slice 3 completes by the coordinator's ruling, recorded on the logbook of issue #1777 as a decision under 0280 R7. The slice has no technical dependency on slice 3: it adds one job to a workflow that slice 3 does not touch. Complexity stays `small`, justified by the measured blast radius: one script, one task, one job in one workflow, two capabilities (with their generated entries), one reference paragraph, and no change to any shared contract (no new reference-format field, no generator change, no change to `ci-job`, `setup-task` or the parity guards). Rationale: `docs/adr/0021-task-is-the-ci-contract.md`.

## Requirements

1. **R1 (the alert task and script).** A new task `ci:alert-scheduled-failure` SHALL exist only in `taskfiles/ci.yml`, never in the root `Taskfile.yml`, with a stable name and commands that satisfy the Windows-command rule of spec 0266. It SHALL run one TypeScript script, `scripts/ci-alert-scheduled-failure.ts`, under the shell-allowlist ratchet (no new shell file). The script SHALL read its context from the standard GitHub environment (`GITHUB_WORKFLOW`, `GITHUB_RUN_ID`, `GITHUB_SERVER_URL`, `GITHUB_REPOSITORY`, `GITHUB_SHA`, `GITHUB_EVENT_NAME`) and the needed job result from `--result <value>`, and SHALL call only the `gh` binary found on `PATH`, with no network client of its own. Acceptance: `scripts/check-taskfile-tree.ts` and `scripts/check-taskfile-commands.ts` pass; the task exists; the shell-allowlist ratchet is unchanged.
2. **R2 (open or update, deduplicated).** On `--result failure` the script SHALL open one issue titled `Scheduled run failed: <workflow name>` whose body begins with the stable marker `<!-- crewrig:scheduled-failure workflow="<workflow name>" -->`, or, when an open issue with that exact title and marker already exists, SHALL add one comment to it and open nothing. The lookup SHALL be `gh issue list --state open --limit 200 --search "<title> in:title" --json number,title,body` (an explicit `--limit`, because `gh` returns 30 results by default and a busy search must not hide the matching open alert and cause a duplicate), filtered in code on exact title and marker, so it needs no pre-created label and no search syntax over an HTML comment. A closed issue never matches, so a failure after a human closed the previous alert opens a fresh one. The issue body and the comment SHALL contain only the workflow name, the run URL, the commit sha, the event and the UTC date. Acceptance: the forced-failure test of R5 proves an open on the first failure, a comment on the second with no second issue, and a new issue after the first is closed.
3. **R3 (no notification unless failed).** The script SHALL make no `gh` call, print one line saying why, and exit `0` for `--result` equal to `success`, `skipped` or `cancelled`, and SHALL exit non-zero without calling `gh` for any value it does not know. A cancelled run is a human action, not a failure; it cannot reach the script anyway, because `if: failure()` of R4 is false for a cancelled run, so the quiet branch for `cancelled` and `skipped` is defence in depth for a local or future caller, not a path CI exercises. Acceptance: the test of R5 shows an empty `gh` call log for each of the three quiet results and a non-zero exit for an unknown one.
4. **R4 (GitHub wiring, least privilege).** `.github/workflows/changeset-coverage.yml` SHALL gain one job `alert` with `needs: changeset-coverage`, `if: failure() && github.event_name == 'schedule'`, job-level `permissions: { contents: read, issues: write }` and no other permission, a checkout, `actions/setup-node` with `node-version: 24`, `npm ci --omit=dev --workspaces=false` (the production install that provides `js-yaml` for `scripts/lib/yq-accessors`), `node scripts/lib/node-floor-guard.js`, `./.github/actions/setup-task` (spec 0282), and `task ci:alert-scheduled-failure -- --result ${{ needs.changeset-coverage.result }}` with `GH_TOKEN: ${{ github.token }}`. Node is provisioned inline rather than through `./.github/actions/ci-job`, the simplest choice that works: the default `ubuntu-latest` Node 22 fails the Node 24 floor of the `.ts` script, and `ci-job` brings a path gate designed for `pull_request` and `push` triggers that a scheduled, `specific` capability with no `paths:` does not need; the inline steps are the same ones `changeset-coverage.yml` already uses. The workflow-level permissions stay `contents: read`, so the gated job gains no write access. A manual `workflow_dispatch` failure does not alert: the person who dispatched it is looking at the run. The job fails visibly when `gh` fails (for example issues disabled on the repository); it never swallows an error. No secret other than the built-in `GITHUB_TOKEN` is used. Acceptance: the check of R6 proves the job, its `needs`, its `if`, its permissions, the Node 24 setup, the production install and the floor guard before the task call, and the absence of any `secrets.` reference in the workflow.
5. **R5 (acceptance test against a forced failure, host safe).** A test SHALL run the script against a forced failure and a passing run with a fake `gh` executable placed first on `PATH`, both created under an `mkdtemp` directory (host safety; it SHALL touch no path it did not create and SHALL never run the real `gh`). The fake `gh` appends each argument vector to a call log in the temp directory and serves canned `issue list` JSON from a fixture file. The script SHALL also accept `--dry-run`, which prints the `gh` commands it would run and runs none; the test covers it. Cases: failure with no open issue (one list call, one create call, marker in the body); failure with an open matching issue (one list call, one comment call, no create); failure with only a closed or differently titled issue (a create); success, skipped and cancelled (no call at all); unknown result (non-zero, no call); `--dry-run` (no call); the body contains no environment variable value other than the allowed fields (a canary `GH_TOKEN=canary-secret` in the child environment never appears in any logged argument). Acceptance: the test fails against a script that notifies on success and passes against the specified one (replacement-first mutation proof).
6. **R6 (separate check and self-test capabilities).** Per spec 0281, two capabilities SHALL be added to `ci/ci-capabilities.yml`, `build.yml` and the regenerated `.gitlab-ci.yml`: `alert-scheduled-failure-selftest` (runs the test of R5, `task ci:alert-scheduled-failure-selftest`) and `alert-scheduled-failure-check` (a static wiring check, `task ci:alert-scheduled-failure-check`, over the workflow of R4: the job, its `needs`, its `if`, least-privilege permissions, no `secrets.` reference, and the task name it calls existing in `taskfiles/ci.yml`). The check SHALL read the workflow with the existing `yq` accessors (`scripts/lib/yq-accessors`) and SHALL add no YAML parser. Both are portable, carry a `paths:` list that names the script, the test, the workflow, `taskfiles/ci.yml` and the task wiring, and are wired in `scripts/check-test-wiring.ts`. Acceptance: both run green in CI on a pull request that touches the script, each has a failing fixture, and `check-ci-parity` and `scripts/check-test-wiring.ts` pass.
7. **R7 (GitLab side).** The alert job is a GitHub-hosted construct: the neutral format of `docs/ci-reference-format.md` expresses `scheduled` and `manual` triggers but has no failure-conditional or `needs`-on-failure construct, and the generated GitLab pipeline is produced and drift-checked but not executed on a live GitLab (*Operational prerequisites*, item 2). Adding such a construct to the reference format and the generator is a larger change than the whole slice and would grow the generators that slice 5 shrinks. Therefore the alert job SHALL be recorded in the reference as a capability `alert-scheduled-failure` with `trigger: [{on: scheduled}]`, `portability: specific`, `exception.engine: github-actions`, an `exception.evidence` that states those two facts, no `changeset-gated` key (so the exhaustive run never executes it, which would open a spurious issue), and `command: [task ci:alert-scheduled-failure]` (a `specific` capability has no `requires:`; the command is carried so the GitLab generator and `check-ci-parity` can read it), so `check-ci-parity` knows the job and rejects an unrecorded one (the closed exception set of 0283 R2). A GitLab adopter who runs the scheduled pipeline live gets the same effect from GitLab's own pipeline-failure notification to the schedule owner, which the exception text SHALL name. `docs/ci-reference-format.md` (*The exhaustive run*) SHALL gain one paragraph describing the alert, its dedup marker, the dispatch exemption and this exception. Acceptance: the reference carries the capability with its evidence, `check-ci-parity` is green, and the paragraph exists.
8. **R8 (invariants, 0280 R9).** At each merge: CI green; reversible by reverting the PR (the job, task, script, test and capabilities are additive, and the alert is the only thing that disappears); `.gitlab-ci.yml` regenerated and `check-ci-parity` green; `cancel-on-failure`, `changeset-coverage` and `path-ownership` working (the alert job SHALL NOT change the behaviour of the gated job, and the exhaustive run still executes every changeset-gated command); task names stable; new tasks only in `taskfiles/ci.yml`; no new framework, no new YAML parser, no new third-party action and no new shell file; every new test wired in `build.yml`, `ci/ci-capabilities.yml`, `.gitlab-ci.yml` and `scripts/check-test-wiring.ts`; every new test uses `mkdtemp` directories only. Acceptance: the PR shows each green.
9. **R9 (measurement).** The PR SHALL report line counts per surface before and after (`.github/workflows/build.yml`, `ci/ci-capabilities.yml`, `.gitlab-ci.yml`, `.github/workflows/changeset-coverage.yml`, and the total of the first three), and the line counts of the new script, the new test and the growth of `taskfiles/ci.yml`. Baseline on the branch point of this spec (commit `8deb574e`, 2026-10-24): `build.yml` 3,919; `ci/ci-capabilities.yml` 4,396; `.gitlab-ci.yml` 2,982; total 11,297; `changeset-coverage.yml` 50; `taskfiles/ci.yml` 331 (re-measured at the PR, since slice 3 keeps moving them). The growth of the three counted surfaces SHALL be at most 150 lines, the new script at most 120 lines and `changeset-coverage.yml` at most 30 lines of growth. The slice-5 end target of 0280 R10 (at most 8,880 lines for the three surfaces) is unchanged and this growth is included in it, not exempt from it: the slice 5 sub-spec inherits the new total as its starting point. Acceptance: the PR body carries the table, and a PLAN or DEV re-measurement that exceeds a cap is reported to the coordinator before merge.
10. **R10 (rejected alternatives and the riskiest decision).** Rejected: a Slack, mail or chat webhook, because it needs a secret and a destination to rotate, which 0280 forbids adding for this purpose; a third-party "create issue on failure" action, because it adds an unreviewed supply-chain dependency to the one workflow that holds the whole command set; GitHub's native notification of a failed scheduled workflow, because it goes only to the last committer of the cron line (or the last editor of the workflow) and not to the team, and is lost when that person has left or muted it, so it is insufficient on its own; a GitHub Actions `workflow_run` listener workflow, because it needs a second trigger and a separate permission model for one condition a job `if` already expresses; inline `gh` calls in the workflow YAML, because they would be shell in YAML outside the task contract and untestable without a runner; a new `on_failure` construct in the reference format, see R7. Devil's advocate: an issue is a weaker page than a pager, and an alert that fails to open (issues disabled, token revoked) is a silent red again. Mitigation: the alert job itself fails visibly (R4), the dedup keeps a persistent failure to one comment per day instead of an issue per day, and the static check of R6 stops the wiring from rotting unnoticed. A second risk is a stale open alert hiding a new, different failure; the comment carries the run URL and sha of each failure so each one stays visible on the thread. Acceptance: this section exists and names each alternative with its reason.

## Scenarios

**Scenario:** A red scheduled run notifies

Given the Exhaustive Run fails on its schedule and no alert issue is open
When the `alert` job runs
Then it opens one issue titled `Scheduled run failed: Exhaustive Run` whose body carries the marker, the run URL and the sha.

**Scenario:** A second red run adds a comment

Given an open alert issue with that title and marker
When the next scheduled run fails
Then one comment with the new run URL is added and no second issue is opened.

**Scenario:** A green run is silent

Given the Exhaustive Run passes
When the workflow ends
Then the `alert` job is skipped, and the script, run with `--result success`, makes no `gh` call.

**Scenario:** A manual failure does not alert

Given a `workflow_dispatch` run of the Exhaustive Run fails
When the workflow ends
Then the `alert` job is skipped because the event is not `schedule`.

**Scenario:** A closed alert is not reused

Given the previous alert issue was closed by a human
When the next scheduled run fails
Then a new issue is opened.

**Scenario:** The wiring cannot rot

Given the `alert` job loses its `if` or gains a `secrets.` reference
When `alert-scheduled-failure-check` runs
Then it exits non-zero naming the missing or extra element.

**Scenario:** The test never touches the host

Given the forced-failure test
When it runs
Then every `gh` call goes to the fake under its `mkdtemp` directory, and the real `gh` is never started.

## Out of scope

- Alerting on pull-request or push failures (branch protection and review already surface them), on cancelled runs, or on a failed manual dispatch.
- Any new scheduled workflow, or changing the cron, the checkout or what the exhaustive run executes.
- A notification channel other than a forge issue (chat, mail, pager); a new construct in the reference format or the generator for failure-conditional jobs.
- The migration of the other jobs to `task ci:<id>` (slice 3) and the shrink of the generators (slice 5).

## Open questions

None. The one open question inherited from 0280 (whether slice 4 needs Task at all) is settled in the Intent: it does, for the contract and for the local `--dry-run`.
