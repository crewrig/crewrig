---
id: "0215"
slug: shell-to-typescript-migration
status: draft
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 1509
version: 4.3.0
---

# Shell-to-TypeScript migration (parent spec)

*Delta 06 of `specs/0215-shell-to-typescript-migration.md`. Source: ticket #1509,
a row-independent follow-up of epic #1231. Requirement 15 makes every sub-spec
that migrates a CLI integration point set a latency budget and fail the
`windows-latest` job "when the budget is exceeded". Each sub-spec then wrote its
own calibration rule — `max(3 x the largest observed run, 300 ms)` from the
first green run, and a budget that "may only lower" — and the harness of spec
0240 requirement 13 (`scripts/check-timing-budget.ts`) fails a step as soon as
any one of its 10 runs exceeds the budget. On a shared GitHub-hosted Windows
runner that rule fails pull requests that touch no hook at all. The owner
decided on 2026-10-09 to replace it, once, at the level of requirement 15, for
every budget of the epic. This delta runs under the release-branch regime of
`specs/0215-shell-to-typescript-migration.delta-04.md`, and its spec-PR targets
`release/1231-ts-migration`. The version is a MINOR bump: requirement 15 gains
a verdict and a calibration rule, and no in-flight implementation is
invalidated; the budget clauses of the sub-specs are overridden by requirement
42 and not edited.*

## ADDED

### Evidence

The figures below come from the report lines `scripts/check-timing-budget.ts`
prints, read from the job logs of the 400 most recent `Build & Validate`
(`build.yml`) runs on 2026-10-09 — pushes on the release branch and pull
requests of every branch. 224 of those runs reached at least one Windows timing
step between 2026-10-01T21:33Z and 2026-10-09T21:11Z and gave 1,556 step
reports. Two kinds of jobs are left out: the 72 jobs of an earlier attempt of
a re-run run, because `gh run view --job` served the log of the latest attempt
for them; and a failed step, because the current harness prints no median when
a step fails. A report is one step, that is 10 runs; "median" and "max" are the
values that report prints.

| Step (`build.yml` line, rule) | Current budget (ms) | Reports | P50 of medians | P95 of medians | Max median | P95 of max | Max of max |
|---|---|---|---|---|---|---|---|
| C0 floor guard, `scripts/lib/node-floor-guard.js` (`:1709`, spec 0240 R14) | 750 | 200 | 46.5 | 53.5 | 62.0 | 66.3 | 232.8 |
| C1 `usage-capture` fast path (`:1751`, spec 0243 R15(a)) | 400 | 153 | 97.3 | 113.9 | 123.5 | 152.2 | 263.7 |
| C1 `usage-capture` slow path (`:1758`, spec 0243 R15(b)) | 1000 | 150 | 181.3 | 229.9 | 390.6 | 495.3 | 991.6 |
| C1 statusline shim (`:1765`, spec 0243 R15(c)) | 550 | 148 | 169.9 | 191.3 | 204.3 | 294.8 | 496.0 |
| C2 guard fast path (`:1830`, spec 0248 R33(a)) | 750 | 140 | 89.4 | 98.8 | 430.4 | 112.7 | 498.0 |
| C2 guard slow path, refused (`:1836`, spec 0248 R33(b)) | 2000 | 139 | 201.2 | 219.7 | 1090.6 | 246.0 | 1593.4 |
| C2 guard slow path, allowed (`:1841`, spec 0248 R33(b)) | 2000 | 138 | 201.0 | 229.2 | 1307.5 | 251.8 | 1520.8 |
| C3 case (a) `PostToolUse` direct (`:1884`, spec 0247 R19(a)) | 300 | 123 | 90.3 | 105.5 | 110.6 | 123.6 | 148.6 |
| C3 case (b) legacy form disabled (`:1895`, spec 0247 R19(b)) | 300 | 123 | 83.5 | 99.1 | 167.9 | 120.5 | 230.0 |
| C3 case (c) `Stop`, 50 MB transcript (`:1907`, spec 0247 R19(c)) | 550 | 121 | 188.7 | 218.0 | 241.9 | 250.9 | 485.9 |
| C3 case (d) nothing listening (`:1919`, spec 0247 R19(d)) | 550 | 121 | 188.5 | 218.0 | 241.0 | 265.3 | 457.1 |

Percentiles are nearest-rank. Line numbers are `.github/workflows/build.yml` at
`release/1231-ts-migration @ 19d9cede`. The three C2 budgets still hold the
initial values of spec 0248 requirement 33, and the C0 budget the initial value
its workflow comment calls "to be recalibrated"; neither was recalibrated.

Every failure in the window, plus the two the ticket reports, is a spike in a
minority of the 10 runs; no median of a failed step is known, but in every case
at least 6 runs stayed within the budget:

| Run (attempt) | Step | Budget (ms) | Runs over budget (ms @ run) |
|---|---|---|---|
| 37681891450 (1) | C1 statusline shim | 550 | 2539 @ 1, 1084 @ 2 |
| 37686008700 (1) | C1 fast path | 400 | 703 @ 7, 1218 @ 8, 911 @ 9, 483 @ 10 |
| 37950330350 (1) | C3 case (c) | 550 | 1020 @ 10 |
| 37954448293 (1), from #1509 | C1 statusline shim | 550 | 681 @ 4 |
| 37954448293 (2), from #1509 | C1 slow path | 1000 | 1195 @ 1 |
| 37968135333 (1) | C1 fast path | 400 | 683 @ 1 |
| 37968252426 (1) | C1 statusline shim | 550 | 976 @ 2 |
| 37978984883 (1) | C1 slow path | 1000 | 1197 @ 4 |

A second, rarer pattern slows a whole job, not one run: in run 37985064350
(a pull request that touches no hook), the C2 job reported medians of 430.4,
1090.6 and 1307.5 ms against usual medians near 89, 201 and 201 ms, a factor
of about 5 to 6.5 on every run, while the three other Windows timing jobs of
the same run were normal. One such job was seen in about 1,000.

Replayed on this window, a factor of 3 on the 95th percentile of the medians
would catch a slowdown only from about 3.5 times a step's usual median; a
factor of 2 catches it from 2.2 to 3.1 times, and adds no failure the window
did not already contain (only the whole-slow-runner job above fails under
either). The factor of requirement 40 is 2 for that reason. Its limit is
stated rather than hidden: the slow path of `usage-capture`, which loads the
full module graph and does the capture work, has a median about 1.9 times the
fast path's (181.3 against 97.3 ms), so a regression that only adds the module
graph to the fast path stays under its 300 ms budget, held there by the 300 ms
floor. The budgets catch gross regressions; the lazy `import()` that
requirement 15 demands is still enforced by review and by each sub-spec's
tests, not by the timing step alone.

### Requirements

1. **New requirement (R39) — Verdict on the median, measured twice at most.**
    A timing step SHALL pass when the median of its runs is at most its
    budget, and SHALL NOT fail because one run, or any minority of runs,
    exceeds the budget. The median of an even number of runs is the mean of
    the two middle values, as `scripts/check-timing-budget.ts` computes it
    today; for a single run it is that run. When the median exceeds the
    budget, the harness SHALL measure the same number of runs once more,
    straight away and in the same step, and the step SHALL fail only when the
    second median also exceeds the budget; there SHALL be no third series.
    Every outcome SHALL print, for each series measured, its minimum, median
    and maximum; the maximum is reported and never blocking. A failure SHALL
    name the script, the case label when one is given, the budget and both
    medians. A run whose exit status differs from the expected one SHALL fail
    the step at once, without a second series, because it is a correctness
    failure and not a latency one. The harness's arguments and exit codes stay
    as they are (0 pass, 1 fail, 2 usage error); only the verdict and the
    report lines change.

1. **New requirement (R40) — Calibration rule.** A budget SHALL be
    `max(2 x P95, 300 ms)`, rounded up to the next multiple of 50 ms, where
    P95 is the nearest-rank 95th percentile of the medians of at least 20
    reports of that step on `windows-latest`. The reports are the most recent
    ones from `build.yml` runs on the branch the step guards and on pull
    requests targeting it — `release/1231-ts-migration` while delta-04 is in
    force, `main` after its final merge — failed steps included, since the
    harness of requirement 39 prints a median on failure. Several reports may
    come from re-runs of the same job on one head, so a pull request that
    introduces a budget can collect its 20 reports on itself. A budget SHALL
    change, upward or downward, only by applying this rule to a fresh window;
    the pull request that changes it SHALL carry, in its body, the window's
    table (step, number of reports, first and last run id, P50, P95 and
    maximum of the medians, resulting budget), and the workflow comment next
    to the step SHALL name the rule and the window. With fewer than 20
    reports the budget SHALL NOT change. A later sub-spec that adds a budgeted
    step states an initial value as today; its implementation pull request
    replaces it by this rule, or names a follow-up ticket that will, and until
    then the initial value applies.

1. **New requirement (R41) — Budgets set by this delta.** The implementation
    pull request of #1509 SHALL set the following budgets, which requirement
    40 gives on the window of *Evidence* above, each stated in
    `.github/workflows/build.yml` next to its script with a comment naming
    this delta and that window: C0 floor guard 300 ms; C1 fast path 300 ms,
    slow path 500 ms, statusline shim 400 ms; C2 fast path 300 ms, slow path
    refused 450 ms, slow path allowed 500 ms; C3 cases (a) 300 ms, (b) 300 ms,
    (c) 450 ms, (d) 450 ms. The number of runs per step stays 10. Every value
    stays inside the 5-second timeout the Antigravity CLI manifest declares
    for the guard (spec 0248 requirement 33). When a step's wrapper checks a
    count that depends on the number of runs — case (c) runs the harness
    under `scripts/tests/lib/with-stub-daemon.ts --expect-requests 10`, which
    fails on any other count — a step that passes on its second series SHALL
    still pass, the expected count matching the runs actually executed (10 or
    20), and a request count that matches neither SHALL still fail.

1. **New requirement (R42) — Precedence over the sub-spec budget clauses.**
    Requirements 39 to 41 SHALL govern the verdict, the calibration and the
    values of every timing budget of epic #1231, notwithstanding the wording
    of: spec 0240 requirement 13 (the harness "fail[s] the build … when the
    measured time exceeds that budget",
    `specs/0240-runtime-foundations-shared-ts-modules.md:150-155`) and
    requirement 14 (the floor guard's budget, `:157-162`); spec 0243
    requirement 15 (`specs/0243-usage-capture-hooks-typescript.md:214-228`);
    spec 0247 requirement 19 as replaced by its delta-01
    (`specs/0247-mempalace-transcript-hook-typescript.delta-01.md:192-212`);
    and spec 0248 requirement 33
    (`specs/0248-worktree-git-guard-typescript.md:442-457`). In each of these,
    "a run that exceeds a budget SHALL fail its job" reads as the verdict of
    requirement 39, and the first-green-run rule `max(3 x the largest
    observed run, 300 ms)` with "may only lower" reads as requirement 40. What
    those clauses state otherwise — the cases, the payloads, the measured
    shapes, the initial values, the 10 runs and the case label of spec 0247 —
    is unchanged. Those specs are not edited and need no delta of their own.

### Scenarios

**Scenario:** One slow run no longer fails an unrelated pull request

Given the statusline shim step has a budget of 400 ms
And a pull request that touches no hook
When nine runs take about 170 ms and one takes 2539 ms
Then the median is about 170 ms, the step passes, and its report line shows
the 2539 ms maximum.

**Scenario:** A minority of slow runs passes

Given the C1 fast path step has a budget of 300 ms
When four of its ten runs take 703, 1218, 911 and 483 ms and six take about
100 ms
Then the median is within the budget and the step passes without a second
series.

**Scenario:** A transient slowdown is measured again

Given a step whose first median exceeds its budget because the runner is
briefly slow
When the harness measures the ten runs again in the same step and the second
median is within the budget
Then the step passes, and both series are printed.

**Scenario:** A hook regression breaks its budget

Given a pull request that makes the `usage-capture` hook do work before its
guard that raises its fast-path median from about 97 ms to over 300 ms on
every run
When the C1 job runs the fast-path step
Then both medians exceed the 300 ms budget, the job fails naming the hook, the
budget and both medians, and the pull request cannot merge.

**Scenario:** A wrong exit status fails at once

Given the C2 refused step expects exit status 1
When one run exits 0
Then the step fails on that run's exit status, and no second series is
measured.

**Scenario:** The stub daemon count follows a second series

Given case (c) runs under `with-stub-daemon.ts` with a request count check
When its first median exceeds the budget and its second median does not
Then the step passes with 20 requests logged, and a run that logs neither 10
nor 20 requests still fails.

**Scenario:** A whole slow runner fails, and does not move the budget

Given a C2 job whose runner is about six times slower on every run, as in run
37985064350
When both medians exceed the budget
Then the job fails and is re-run by hand, and a later recalibration over 20 or
more reports keeps the budget, because one slow report does not move the 95th
percentile of the medians.

**Scenario:** A budget is raised on evidence

Given a window of at least 20 recent reports of a step whose P95 of medians
has risen, for example after a runner image change
When a pull request applies requirement 40 to that window
Then the budget rises to `max(2 x P95, 300 ms)` rounded up to 50 ms, and the
pull request body carries the window's table.

**Scenario:** Too few reports change nothing

Given a step with 12 reports since its last change
When someone proposes to recalibrate it
Then the budget does not change until at least 20 reports exist.

### Out of scope

- The `cancel-on-failure` step common to every job of `build.yml`, which
  cancels the sibling jobs when one fails and leaves the failing job itself
  `cancelled`: unchanged. The rule above makes a budget failure rare and
  meaningful, which makes that cascade acceptable again.
- Normalising a measurement by a reference process timed on the same runner
  (a bare `node` start, for example), which would neutralise a whole slow
  runner: not adopted; a whole slow runner remains a failure re-run by hand.
- Timing on Linux or macOS runners, and the number of runs per step (10).
- Re-wording the budget clauses of specs 0240, 0243, 0247 and 0248: they stay
  as merged, read through requirement 42.

## MODIFIED

Requirement 15 — the sentence that makes a timing assertion fail the build,
pointed at the verdict and the calibration of requirements 39 to 41:

Original:

> Each sub-spec that migrates such a script
> SHALL set a per-script latency budget — stated as an upper bound on
> wall-clock time from process start to exit, Node.js start-up included, over
> a stated number of runs — and a timing assertion in that script's
> `windows-latest` CI job SHALL fail the build when the budget is exceeded.

Replacement:

> Each sub-spec that migrates such a script
> SHALL set a per-script latency budget — stated as an upper bound on
> wall-clock time from process start to exit, Node.js start-up included, over
> a stated number of runs — and a timing assertion in that script's
> `windows-latest` CI job SHALL fail the build when the budget is exceeded,
> under the verdict of requirement 39 (the median of the runs, measured a
> second time before failing), with a value set and changed only by the rule
> of requirement 40 (delta-06).

The scenario "A hook regression breaks its budget" — the regression is one
that moves the median past the budget, which a module graph loaded early does
not do by itself on the evidence of delta-06, and the failure line names the
medians, not one measured time:

Original:

> Given a pull request that makes a migrated hook load its full module graph
> before its guard runs
> When the hook's `windows-latest` CI job runs the timing assertion
> Then the job fails, naming the hook, its budget and the measured time, and the
> pull request cannot merge.

Replacement:

> Given a pull request that makes a migrated hook do work before its guard
> runs that moves the median of its runs past its budget
> When the hook's `windows-latest` CI job runs the timing assertion
> Then the job fails, naming the hook, its budget and the medians of both
> series (delta-06, requirement 39), and the pull request cannot merge.

## REMOVED

None.
