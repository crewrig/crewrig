---
id: "0292"
slug: pr-logbook-pilot
status: draft
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 1880
version: 3.0.0
---

# Pilot the pr-logbook modernization with frozen evals, bundled scripts and a measured delta

*Delta 02 of `specs/0292-pr-logbook-pilot.md`, building on delta-01. Source: spec 0290 delta-04 (issue #1884, merged in PR #1886), which the owner decided after rejecting, at the spend gate of this ticket, the paired runs and the judge quorum of the eval runner. The runner now makes one run per eval with the skill installed and one run per trigger probe. It sends one judge call per eval, grades a skill `pass` when its eval pass rate and its probe pass rate each reach `pass-threshold` (0.8), and has no `base_mean` or `without_skill` mean any more. The acceptance and the report of this pilot named those removed figures, so they are realigned here. Version 3.0.0, a MAJOR bump: the acceptance criterion changes. Requirements modified: R3, R23, R24, R26, R27, R28, the Intent as restated by delta-01, and two scenarios. This delta opens no question.*

## ADDED

None.

## MODIFIED

**R3 (no check that presumes the rewrite).** Original reason: "because the skill measured as the baseline has no `scripts/` directory". Replacement reason: because an `exit_code` check runs the head's script directly and says nothing about the agent's behaviour. The rule itself, no `exit_code` check, stands.

**R23 (acceptance), as modified by delta-01.** Original (delta-01): "The comparator is the runner's base replay, the `base_mean` that the same invocation measures on the skill as of the merge base with `main` (spec 0290 R19), against the same `evals.json`. The pull request SHALL be merged only when that run's status is not `regression` under the `TOLERANCE` on `main` (R27)." Replacement: the pull request SHALL commit the `evals/results.json` of a non-mock run on its head. It SHALL be merged only when that run's status is `pass` under spec 0290 as amended by delta-04: the eval pass rate and, since the file carries probes, the probe pass rate each at least `pass-threshold` on `main`. No `evals/results.json` for this skill exists on `main`, so the run reports the base as not compared, and no regression can arise. The delta-01 sentence "An improvement is not required" is superseded: with no comparison, acceptance is the threshold alone.

**R24 (regression path), as modified by delta-01.** Original: "When a run on the rewritten skill ends with status `regression` (R23)". Replacement: when a run ends with a status other than `pass` (R23). The rest stands: revise the skill, agent or scripts, never the cases or fixtures; three non-mock runs at most, all counted; after the third, the owner decides. The option "changing the tolerance" reads "changing the pass threshold".

**R26 (report to the standard), as modified by delta-01.** Original: "the `base_mean`, the `with_skill` and `without_skill` means of the measured head, the delta". Replacement: the eval pass rate and the probe pass rate of each non-mock run, how many evals ran with the skill loaded (`skill_loaded`), and per run the executor runs, judge calls and `cost_usd`. The rest of delta-01's R26 stands.

**R27 (settings unchanged), as added by delta-01.** Original: "`TOLERANCE` stays at the value on `main` when the pull request is measured (0.05 today), and `REGRESSION_BLOCKING` and `MISSING_EVALS_BLOCKING` stay `false`." Replacement: no setting of `scripts/lib/skill-evals/settings.ts` changes. That includes `pass-threshold` (0.8), `effort` (`medium`) and the blocking knobs, which all stay `false`.

**R28 (one approval for the spend), as added by delta-01.** Addition: the plan shown to the owner gives the executor runs, which are the evals plus the probes, and the judge calls, which are the evals with expectations plus the driver retry allowance. These are the figures the runner prints in mock mode.

**Intent, as restated by delta-01.** Original (delta-01): "one run measures the rewritten skill against the skill on `main`, replayed by the runner in the same invocation". Replacement: "one run measures the rewritten skill against the pass threshold". The rest of the Intent as restated by delta-01 stands.

**Scenario restated by delta-01.** Original: "**When** the owner runs the evals once and the run reports a `with_skill` mean not lower than its `base_mean` by more than 0.05". Replacement: "**When** the owner runs the evals once and the run reports status `pass`, with eval and probe pass rates each at least 0.8,". The scenario *Failure path — regression after three attempts* is replaced by: **Given** a run on the pull request that reports status `fail` with an eval pass rate of 0.6 against the threshold 0.8, **When** two revisions of the skill text still leave a rate below 0.8 on the third measurement run, **Then** the pull request is not merged, the three runs are presented to the user with the three choices of R24, and the cases are unchanged.

## REMOVED

None.
