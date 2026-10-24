---
id: "0264"
slug: windows-timing-budget-calibration
status: approved
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 1776
version: 1.1.0
---

# Windows timing-budget calibration

*Delta-01 of `specs/0264-windows-timing-budget-calibration.md`, raised by issue #1776
(a second family of Windows CI failures after the original calibration). It amends
requirements 3, 5, 15 and 16 of the parent and adds requirements 18 to 20. Every
requirement of the parent not named here is unchanged. The release-branch regime the
parent states no longer applies: this delta-spec and its implementation target `main`.*

## ADDED

### Requirements

<!-- markdownlint-disable MD029 -->

18. **Timeout presence test.** A test SHALL fail when any job of
    `.github/workflows/build.yml` that runs on `windows-latest` lacks `timeout-minutes`,
    or sets a `timeout-minutes` below the floor of 10. The limit values are re-derived
    by requirement 15 (as modified below) at the next recalibration; the test checks
    presence and the floor, not the derived value.
19. **CI line ratchet.** The implementation PR SHALL bump the pin of the CI line ratchet
    in `scripts/tests/ci-shrink-report.test.ts` (`PIN`, currently 8631) by exactly the
    number of lines the PR adds to the ratcheted CI surfaces, SHALL keep the total at or
    under the floor of 8880, and SHALL state the reason for the bump in the PR body.
20. **GitLab parity unaffected.** The Windows jobs are `portability: specific`
    (GitHub-only), so neither the job limits nor the confirmation run change any GitLab
    surface, and the implementation PR SHALL say so.

### Scenarios

**Scenario:** A one-off stall on the ceiling run does not fail the step

Given a step with a 550 ms budget, 10 runs, the default tolerance, nine runs near
235 ms, and one run (run 2) of 2954.9 ms
When the confirmation run of that command takes 240 ms
Then the step exits 0, and the log carries one line
`timing-budget: <script> [case <label>] ceiling run re-measured: 2954.9 ms then 240.0 ms (run 2/10)`

**Scenario:** A stall that reproduces still fails

Given the same distribution
When the confirmation run takes 2900 ms
Then the step exits 1 and the same re-measure line shows both numbers

**Scenario:** A confirmation run with a different exit status fails

Given a run over the ceiling
When the confirmation run exits with a status other than `--expect-exit`
Then the step exits 1

**Scenario:** A confirmation run that hangs is killed and fails

Given a ceiling run and a hook that then never exits
When the confirmation run reaches the wall-clock limit of `max(10 s, 5 x budget)`
Then the run is killed, the step exits 1, and the failure line names the script, the
case, the budget and the run index

**Scenario:** A confirmed outlier still counts toward the tolerance

Given 10 runs where run 2 is over the ceiling with a confirmation run within the budget,
and run 7 is 40 ms over the budget
When the default tolerance of 1 applies
Then two runs are over the budget, the step exits 1, and both are printed

**Scenario:** A job without a limit is caught

Given a `windows-latest` job of `build.yml` with no `timeout-minutes`
When the test of requirement 18 runs
Then it fails and names the job

**Scenario:** A limit below the floor is caught

Given a `windows-latest` job with `timeout-minutes: 5`
When the test of requirement 18 runs
Then it fails and names the job

## MODIFIED

### Requirement 3 (ceiling)

Original:

> 3. **Ceiling.** The ceiling SHALL be three times the budget. A run over the ceiling is a
>    hang or a regression, never a slow start, and fails the step whatever K is, including
>    `--tolerate` values above 1.

Replacement:

3. **Ceiling.** The ceiling SHALL be three times the budget. A run over the ceiling SHALL
   be re-measured ONCE immediately, the confirmation run: the same command, the same
   stdin, cwd and environment, and a fresh `--env-tmpdir`. The step SHALL fail when the
   confirmation run is also over the budget, or when its exit status differs from
   `--expect-exit`. When the confirmation run is within the budget, the ceiling run is
   NOT a ceiling failure; it still counts as one run over the budget toward K
   (requirement 1a), and requirement 4 applies to it unchanged (label `tolerated` when
   K covers it). Whatever K is, including `--tolerate` values above 1, a hang
   reproduces on the confirmation run and still fails; a one-off runner stall does not.
   The harness SHALL bound every run, the confirmation run included, with a wall-clock
   limit of `max(10 s, 5 x budget)`: a run killed by that limit has no exit status, so
   it fails requirement 1(c) and prints the failure line of requirement 4. A hang
   therefore costs at most two bounded runs, whatever the hook.
   Visibility: the harness SHALL print both measurements on one line,
   `timing-budget: <script>[ [case <label>]] ceiling run re-measured: <t1> ms then <t2> ms (run <i>/<N>)`,
   for every re-measured run, whatever the outcome. Requirement 1(b) is read
   accordingly: a run over the ceiling fails the step only through this requirement.

Relation to the parent's rejected alternative "Retry the whole step once" and to its
Out of scope item "Retrying a failed job or step in CI", both unchanged. The confirmation
run is neither: it starts no job and no step, adds at most one measurement of a
millisecond-scale command, and only for a run over three times the budget. The parent
rejected the step retry for three reasons: it doubles Windows minutes on every red, it
samples the same heavy-tailed distribution, and "passes on the second try" masks
regressions. Here the cost is one extra spawn on a lone outlier; the confirmation run
does not erase the outlier, which still counts toward K (requirement 1a); and a
regression, which shifts the whole distribution, makes the second-worst run cross the
budget and fails the step whatever the confirmation run measures (requirement 5).

Evidence. Run 40027615389, job `windows-mempalace-transcript`, case
`d-nothing-listening`: run 2 of 10 measured 2954.9 ms while the step total was about 5 s,
so the other nine ran about 235 ms. The tolerance of 1 sample was unused, and the ceiling
of 1650 ms failed the step. The logs do not prove the cause of the 3 s stall; it is
consistent with a one-off OS-level connect stall on loopback. No `windows-extension-hooks`
timing failure exists in the last 150 `build.yml` runs.

### Requirement 5 (real regressions still fail)

Requirement 5 is unchanged in text; this heading only records that it is read together with
requirement 3 as modified. A change that slows a hook shifts the whole distribution, and
a distribution in which every run is 1.5 times the budget still fails the step, because
the second-worst run crosses the budget (requirement 1a). The scenarios above add the two
cases the confirmation run distinguishes: a lone stall that does not reproduce passes, and
a lone stall that reproduces fails.

### Requirement 15 (job time limits)

Original:

> 15. **Rule.** A job `timeout-minutes` SHALL be a hang guard: at least 10 times the
>     median green duration observed for the job, and never lower than 10 minutes. A job that
>     declares none keeps GitHub's default, and this spec adds none.

Replacement:

15. **Rule.** EVERY job that runs on `windows-latest` in `.github/workflows/build.yml`
    SHALL declare `timeout-minutes`, because GitHub offers no shared default and a
    composite-action step cannot carry one. The value SHALL be
    `max(10, ceil(3 x W / 60))` minutes, where W is the longest green duration
    (`started_at` to `completed_at`, in seconds) of that job over at least 20 green runs
    of `build.yml`.

    Rationale. The 10 x median rule produced 45 minutes for `windows-service-task`
    (median 262 s), so a hang of 44 minutes (job 120706839878, run 40039460107, step
    `Restart proof and refusal legs`) was not bounded. Three times the worst observed
    duration keeps at least 3x headroom while turning a hang into a named failure within
    minutes.

### Requirement 16 (recorded durations)

Original:

> 16. **Recorded durations.** The implementation PR SHALL record in its description the
>     green duration of each `windows-latest` job that declares a limit, and the limit.
>     As checked on `.github/workflows/build.yml`: `windows-chroma-trio` 30 minutes
>     (green steps about 45 s in total), `windows-mcp-daemon` 30, `windows-doctor-repair`
>     30 and `windows-service-task` 45 (median green about 4 minutes, so 40 minutes are required and 45 are set). A limit below the
>     10x margin SHALL be raised to meet it; no value is expected to change.

Replacement:

16. **Recorded durations.** The implementation PR SHALL record in its description, for
    each `windows-latest` job of `build.yml`, the worst green duration (W of requirement
    15) and the limit. The recorded values are: `windows-service-task` worst 307 s, so
    16 minutes; the 23 other Windows jobs worst at most 124 s, so 10 minutes (the floor).
    The four existing limits (`windows-chroma-trio`, `windows-mcp-daemon`,
    `windows-doctor-repair` at 30 minutes, `windows-service-task` at 45) change to
    10, 10, 10 and 16. Of the 24 Windows jobs, 20 declare no limit today; all 24 declare
    one after the implementation. The measurement is 23 green `build.yml` runs, as
    recorded in the logbook of #1776; the 20-run minimum of requirement 15 is met.

<!-- markdownlint-enable MD029 -->

## REMOVED

The following sentence of requirement 15 of the parent is deleted:

> A job that declares none keeps GitHub's default, and this spec adds none.

The parent's Out of scope items about job limits are untouched for jobs that do not run on
`windows-latest`; for `windows-latest` jobs they no longer apply, since requirement 15
now adds a limit to each.

The 10x rule is not retained for any job. Jobs that do not run on `windows-latest` keep
their present limits, or none, and this delta-spec does not touch them.

Out of scope for this delta-spec:

- Root-causing the `windows-service-task` hang beyond the bound of requirement 15. The log
  of the hung run is not retained, because the job was cancelled. A follow-up issue
  records the hypothesis (a `spawnSync` `timeout` on Windows does not release the call
  while a grandchild still holds the inherited stdio pipes) and the evidence needed to
  confirm it.
