---
id: "0264"
slug: windows-timing-budget-calibration
status: implemented
complexity: small
interaction-mode: MINIMAL
related-issue: 1509
version: 1.0.0
---

# Windows timing-budget calibration

*Row W of the `large`-tier ticket #1231, under the release-branch regime of
`specs/0215-shell-to-typescript-migration.delta-04.md` (requirements 27-38): this
spec-PR and its implementation pull request target `release/1231-ts-migration`,
"shipped" means merged there, and the base ref wherever a protocol names `main` is
`origin/release/1231-ts-migration` (requirement 34). It amends, by reference, the
budget rule carried by `specs/0243-usage-capture-hooks-typescript.md` (requirement 15),
`specs/0247-mempalace-transcript-hook-typescript.delta-01.md` (requirement 19),
`specs/0248-worktree-git-guard-typescript.md` (requirement 33),
`specs/0240-runtime-foundations-shared-ts-modules.md` (requirements 13-14),
`specs/0258-skill-extension-bundled-scripts-typescript.md` (requirement 18) and
`specs/0261-e2e-harness-probes-typescript.md` (requirement 20). Parent requirement:
`specs/0215-shell-to-typescript-migration.md` requirement 15.*

## Intent

A maintainer whose pull request has nothing to do with the hooks no longer sees its
`windows-latest` jobs go red, and its seven sibling jobs cancelled, because one spawn
out of ten met a slow shared runner. The same checks still fail, and name the script,
the case, the budget and the measured time, when a change makes a hook slower for
real: a regression moves the whole distribution of runs, a stalled runner moves one
sample. Wall-clock bounds in the Windows-run tests follow the same distinction, and a
job time limit states what it guards against.

<!-- markdownlint-disable MD029 -->

## Requirements

### Verdict of the timing harness

1. **Verdict rule.** Over the N runs of one timing step, `scripts/check-timing-budget.ts`
   SHALL fail the step when any of the following holds, and SHALL pass it otherwise:
   (a) more than K runs took longer than the budget; (b) any run took longer than the
   ceiling of requirement 3; (c) any run's exit status differs from `--expect-exit`.
   Condition (c) is unchanged by this spec: the exit status stays strict on every run.
2. **Tolerance option.** The harness SHALL accept a new optional `--tolerate <K>` option,
   a non-negative integer. Without it, K SHALL be 1 when N is at least 5 and 0 when N is
   below 5. A K at or above N leaves only the ceiling of requirement 3 and the exit status
   to fail the step; the harness SHALL print a one-line notice saying so. `--tolerate 0` SHALL restore the verdict that held before this spec: one run
   over the budget fails the step. A malformed value SHALL be a usage error with exit
   code 2, like every other malformed option.
3. **Ceiling.** The ceiling SHALL be three times the budget. A run over the ceiling is a
   hang or a regression, never a slow start, and fails the step whatever K is, including
   `--tolerate` values above 1.
4. **Visibility of tolerated runs.** Every run over the budget SHALL be printed. A run
   the verdict tolerated SHALL carry the label `tolerated`; a run that fails the step
   SHALL be printed exactly as before this spec:
   `timing-budget: <script>[ [case <label>]] exceeded <M> ms: measured <t> ms (run <i>/<N>)`.
   The success line SHALL keep its min, median and max and SHALL add the second-worst
   run, so a slow runner stays visible without failing the job.
5. **Real regressions still fail.** A change that slows a hook shifts the whole
   distribution, so the second-worst run crosses the budget as well and the step fails.
   The harness test SHALL prove this with a distribution in which every run is 1.5 times
   the budget.

### Calibration of the budgets

6. **Recalibration rule.** A budget SHALL be derived from at least 5 green
   `windows-latest` runs of its step as `max(3 x S, 300 ms)` rounded up to the next 50 ms,
   where S is the largest second-worst run over those runs. A budget MAY be lowered or
   raised by that rule on the evidence recorded in the pull request that changes it (a
   table of the observed distribution: runs, median of the medians, worst single run,
   largest second-worst run), and SHALL NOT exceed the initial value its carrier spec
   states (750 ms, 2000 ms and the other initial values stay hard caps).
7. **No value changes here.** This spec's implementation SHALL change no budget value
   in any workflow. The observed distribution it is based on, 12 green push runs of
   *Build and Validate* on `release/1231-ts-migration` on 2026-10-15 and 2026-10-16, is
   recorded in *Evidence* below; every budget stays below its carrier's cap, and the
   tightest observed ratio of worst run to budget is 0.79 (mempalace case a, 237.9 ms
   against 300 ms, a budget at the 300 ms floor). The rule of requirement 6 applies from
   the next recalibration onward.
8. **Amendment by reference.** From the merge of this spec, the following clauses of the
   carriers are replaced, and nothing else in them changes:
   - spec 0243 requirement 15: "A run that exceeds a budget SHALL fail its job" is
     replaced by requirements 1 to 4; "the rule that follows may only lower them" and the
     recalibration sentence `max(3 x the largest observed run, 300 ms)` rounded up to the
     next 50 ms "when that is lower than the initial value" are replaced by requirement 6;
   - spec 0247 requirement 19 as reworded by delta-01: "A run that exceeds a budget SHALL
     fail its job" is replaced by requirements 1 to 4; "which the rule below may only lower"
     and the recalibration sentence "when that value is lower" are replaced by requirement 6;
   - spec 0248 requirement 33: "a run that exceeds it fails its job" is replaced by
     requirements 1 to 4; the recalibration sentence "when that is lower" is replaced by
     requirement 6;
   - spec 0258 requirement 18: "A run over its budget SHALL fail the job" is replaced by
     requirements 1 to 4; "never lowered again by a later run" and the formula
     `max(5 x the largest observed run, 750 ms)` are replaced by requirement 6, with the
     2000 ms initial value as the cap;
   - spec 0240 requirement 13: "fail the build ... when the measured time exceeds that
     budget" is replaced by requirements 1 to 4.

   The initial values, the per-job budgets and the naming of script, case, budget and
   measured time on failure stay with the carriers. Spec 0261 requirement 20's "generous
   bound" remains a hang guard and is not a budget of this spec.
9. **Documentation.** The harness header comment, the usage line it prints and any
   document that states the budget rule SHALL describe the verdict of requirements 1 to
   4 and the recalibration of requirement 6. If a hook budget row of `docs/cli-matrix.md`
   changes, that file SHALL be updated in the same diff (AGENTS.md, *CLI Matrix
   Maintenance*); since requirement 7 changes no value, the expected diff to that file
   is empty and the implementation PR SHALL say so.

### Wall-clock bounds in tests

10. **Shared helper.** A shared test helper `scripts/tests/lib/bounded-wall-clock.ts`
    SHALL export `bestOf(attempts, measure)`, default `attempts` 3, which passes when any
    attempt meets the bound and otherwise fails with the message of every attempt. The
    `measure` callback SHALL be free of side effects that a repeat would corrupt: it
    builds its own state or cleans up after itself, so attempts are independent. A
    stall of the runner hits one attempt; a regression hits all of them.
11. **Upper bounds only.** Only an upper bound on elapsed time SHALL go through
    `bestOf`. A lower bound (a timeout that must not fire early) SHALL stay strict and
    single-shot; where an existing assertion combines a lower and an upper bound, it
    SHALL be split into two assertions, the lower one outside `bestOf`.
12. **Targeted tests.** The following single-sample upper bounds SHALL go through
    `bestOf`, each keeping its present bound: `scripts/tests/service-probe.test.ts`
    `timeoutMs + 800` (line 105) and the slow-drip bound of 1100 ms (line 115);
    `scripts/tests/mempalace-transcript-daemon.test.ts` upper bound of 9000 ms (line 170);
    `scripts/tests/mempalace-transcript-stop-summary.test.ts` 500 ms on a 50 MB tail
    (line 200); `scripts/tests/service-windows.test.ts` 5000 ms state read (line 83),
    the owner's bound of 2026-10-09. `BOUND_MS` (10 000 ms) in
    `scripts/tests/lib/windows-e2e-run.ts` stays a hang guard and keeps its value; the
    implementation PR SHALL record the observed maximum next to it.
13. **Hang detection unharmed.** For a test whose guarded failure is "no timeout at all"
    (a call that never returns), the three attempts SHALL still end: each attempt keeps
    its own abort, so `bestOf` cannot turn a hang into a pass.
14. **Out of scope bounds.** The wall-clock bounds of the `service-exec` and
    `worktree-claim` tests that are skipped on `win32` SHALL NOT change.

### Job time limits

15. **Rule.** A job `timeout-minutes` SHALL be a hang guard: at least 10 times the
    median green duration observed for the job, and never lower than 10 minutes. A job that
    declares none keeps GitHub's default, and this spec adds none.
16. **Recorded durations.** The implementation PR SHALL record in its description the
    green duration of each `windows-latest` job that declares a limit, and the limit.
    As checked on `.github/workflows/build.yml`: `windows-chroma-trio` 30 minutes
    (green steps about 45 s in total), `windows-mcp-daemon` 30, `windows-doctor-repair`
    30 and `windows-service-task` 45 (median green about 4 minutes, so 40 minutes are required and 45 are set). A limit below the
    10x margin SHALL be raised to meet it; no value is expected to change.

### Proof

17. **Windows proof.** The implementation PR SHALL show, on `windows-latest`, one green
    run of every job that runs `scripts/check-timing-budget.ts` with the new harness
    (`windows-node-floor-guard`, `windows-usage-capture`, `windows-worktree-git-guard`,
    `windows-mempalace-transcript`, `windows-extension-hooks`) and one green run of
    the test suites of requirement 12, each with the tolerated runs of the step visible
    in the log. Linux and macOS jobs stay green.

<!-- markdownlint-enable MD029 -->

## Scenarios

**Scenario:** One slow spawn among ten does not fail the job

Given a step with a 550 ms budget, 10 runs, the default tolerance and nine runs near 150 ms
When one run takes 681 ms
Then the step passes, the 681 ms run is printed with the label `tolerated`, and the
success line names the second-worst run

**Scenario:** Two runs over budget fail the job

Given a step with a 550 ms budget, 10 runs and the default tolerance
When two runs take 600 ms and 700 ms
Then the step exits 1 and prints, for each offending run, a line naming the script, the
case when there is one, the budget, the measured time and the run index

**Scenario:** A run over three times the budget fails the job

Given a step with a 550 ms budget and 10 runs
When one run takes 1700 ms and every other run is within budget
Then the step exits 1, whatever the tolerance

**Scenario:** A wrong exit status in one run fails the job

Given a step that expects exit status 1
When one of the 10 runs exits 0 and every run is within budget
Then the step exits 1 and names the run

**Scenario:** `--tolerate 0` restores the strict verdict

Given a step run with `--tolerate 0`
When exactly one run is over the budget
Then the step exits 1

**Scenario:** A short step is strict by default

Given a step with `--runs 4` and no `--tolerate`
When exactly one run is over the budget
Then the step exits 1

**Scenario:** A real slowdown is caught

Given a hook that has become 1.5 times slower than its budget on every run
When the step runs
Then the second-worst run is over the budget as well and the step exits 1

**Scenario:** A malformed tolerance is a usage error

Given the option `--tolerate abc`
When the harness starts
Then it exits 2 with a usage line

**Scenario:** A tolerance at or above the run count is announced

Given `--runs 5 --tolerate 5` and every run within three times the budget
When the harness finishes
Then it prints a one-line notice that only the ceiling and the exit status can fail the step, and exits 0

**Scenario:** A stalled attempt does not fail a wall-clock test

Given a measurement wrapped in `bestOf` with a bound of 950 ms and three attempts
When the first attempt takes 1326 ms and the second takes 160 ms
Then `bestOf` passes, and does not run the third attempt

**Scenario:** A slowdown on every attempt fails a wall-clock test

Given a measurement wrapped in `bestOf` with a bound of 950 ms and three attempts
When every attempt takes more than 950 ms
Then `bestOf` fails and its message lists the time of each attempt

**Scenario:** A lower bound is not softened

Given the timeout test of `service-probe.test.ts` for a 150 ms timeout
When the probe returns after 100 ms
Then the test fails on its lower bound, whatever the upper-bound attempts did

## Out of scope

- Changing the behaviour of any hook, or any budget value (requirement 7), or any initial
  value or cap of a carrier spec.
- Raising the budgets by a factor, or deriving a budget from a baseline kept across CI
  runs (see *Rejected alternatives*).
- Retrying a failed job or step in CI.
- Wall-clock tests that do not run on `windows-latest`, including the `service-exec` and
  `worktree-claim` bounds that are skipped on `win32`.
- Adding a `timeout-minutes` to a job that has none, and the 10x rule for job limits on
  non-Windows jobs.
- Other flaky tests and CI failures: #1599, #1545, #1601, #1611, J2 (#1343) and J4 (#1344).
  Issue #1494 is closed as obsolete.

## Open questions

- None. The caps, the values kept and the tolerance default are fixed by requirements 2, 6
  and 7.

## Evidence

Failures on `windows-latest` with no hook change in the diff:

- Run 37954448293 (pull request #1505, 2026-10-09). Attempt 1 failed the statusline shim
  step, 681.0 ms against 550 ms (run 4 of 10); attempt 2 failed the slow-path step,
  1195.0 ms against 1000 ms (run 1 of 10). Same head, hook-unrelated pull request. Each
  failure ran the cancel-on-failure action and left about seven sibling jobs
  `cancelled`.
- Run 38006409617, job 114076112415: `service-probe.test.ts`, "the timeout is the caller's
  parameter and bounds a silent server", `1326 ms for 150` against the bound
  `timeoutMs + 800`. The rerun passed on the same head.

Observed distribution, step by step (n runs of the step, each of 10 spawns; "median" is
the median of the step medians, in ms):

| Job, script and case | Budget | n | Median (low to high) | Worst single run |
|---|---:|---:|---|---:|
| windows-usage-capture, `usage-capture.ts` fast | 400 | 11 | 85 (65 to 106) | 117.7 |
| windows-usage-capture, `usage-capture.ts` slow | 1000 | 11 | 165 (126 to 207) | 394.2 |
| windows-usage-capture, `antigravity-statusline-shim.ts` | 550 | 11 | 154 (120 to 189) | 199.8 |
| windows-mempalace-transcript, case a-posttooluse-direct | 300 | 10 | 95 (73 to 123) | 237.9 |
| windows-mempalace-transcript, case b-legacy-disabled | 300 | 10 | 84 (67 to 97) | 128.0 |
| windows-mempalace-transcript, case c-stop-50mb-transcript | 550 | 10 | 186 (147 to 208) | 299.3 |
| windows-mempalace-transcript, case d-nothing-listening | 550 | 10 | 188 (147 to 227) | 237.3 |
| windows-worktree-git-guard, fast | 750 | 11 | 88 (60 to 108) | 119.4 |
| windows-worktree-git-guard, slow (refused and allowed) | 2000 | 22 | 214 (139 to 269) | 320.9 |
| windows-node-floor-guard | 750 | 11 | 48 (38 to 59) | 94.1 |
| windows-extension-hooks, three cases | 750 | 11 each | 82 to 83 (59 to 111) | 136.3 |

The two red outliers of run 37954448293 are 4.4 and 7.2 times the median of their step: a
heavy tail of single runs, not a shift of the distribution. No green run of the table
comes within 0.79 of its budget.

## Rejected alternatives

- **Median-only verdict.** It ignores a regression that touches only the tail of a hook
  that runs on every tool call, and hides a slow start in one run of three. The median
  stays in the report instead.
- **A percentile against a baseline kept across CI runs** (an artifact or a cache). The
  stored baseline drifts and becomes the flaky component, and the first run of a pull
  request has nothing to compare with.
- **Retry the whole step once.** It doubles Windows minutes on every red, a retry samples
  the same heavy-tailed distribution, and "passes on the second try" masks regressions.
  The in-step rule of requirements 1 to 3 carries the same information without a second
  job start.
- **Raise every budget (for example by 2 times).** The red cases were 1.2 times over; to
  absorb an outlier 7 times the median a budget would sit at 10 times the median and stop
  catching a regression of 3 to 4 times.
- **Keep "only lower" and rerun red jobs by hand** (`gh run rerun`). That is the status
  quo; each red cancels about seven sibling jobs through cancel-on-failure.
- **A fake monotonic clock in the wall-clock tests.** It removes the flake but stops
  proving that the real timer fires in real time, which is what the probe test exists to
  show. `bestOf` keeps the real clock.
- **One delta-spec per carrier.** The rule lives in six specs; one delta each would be as
  many one-file spec-PRs for a single rule, and the carriers would keep drifting apart.
  Requirement 8 amends them by reference instead, and the carrier files stay as merged.
