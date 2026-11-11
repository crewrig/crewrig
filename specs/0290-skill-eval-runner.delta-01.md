---
id: "0290"
slug: skill-eval-runner
status: draft
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 1849
version: 1.1.0
---

# Skill eval runner: grade a skill from its evals.json when SKILL.md changes

*Delta 01 of `specs/0290-skill-eval-runner.md`. Source: the approved PLAN of issue #1849 (v2 and v3), which found places where the base spec cannot be implemented as written or leaves a cost and layout decision open: R5 asks for an observed trigger decision that no part of the spec produces, R10 and R14 do not match the shapes skill-creator's results viewer loads, R23 is silent on a single run's cost, on several changed skills in one invocation and on measured spend, and R26's premise fails for the executor. This delta resolves each. Nothing is implemented yet, so the version is a MINOR bump. This delta opens no question.*

## ADDED

<!-- markdownlint-disable MD029 -->

27. **Per-run executor limits.** The runner SHALL apply three declared, documented per-run settings to every executor run: a turn limit (default 25), a wall-clock limit (default 300 seconds) and a per-run budget (default 1 US dollar). A run that hits a limit SHALL be graded on the output it produced so far, SHALL be tagged with the limit reached in its `metrics.json`, SHALL be counted in `pass_rate` like any other run, and SHALL NOT be reported as `error`.
    Acceptance: a run killed at the wall-clock limit leaves a `metrics.json` naming that limit, a `grading.json` graded on the partial output, and does not turn the skill's status into `error`.

28. **Aggregate cost bound.** The runner SHALL declare one documented setting, `max-invocation-usd`, defaulting to 100. After the credential check of R24 and before the first model call, the runner SHALL compute the worst-case executor cost as the planned executor runs across all selected skills multiplied by the per-run budget of requirement 27. When that cost exceeds `max-invocation-usd`, the runner SHALL make no model call, SHALL exit non-zero with status `error`, and SHALL report the planned cost versus the cap and the text "split the PR".
    Acceptance: 210 planned runs at a 1 dollar per-run budget against the default of 100 make no model call, exit non-zero and print 210, 100 and "split the PR".

29. **Bounded concurrency.** The runner SHALL execute executor runs through a pool bounded by one documented setting, `executor-concurrency`, defaulting to 4. The executor-run cap of R23 SHALL be reserved before each run starts, so concurrent runs cannot exceed it, and a runtime cap breach SHALL start no new run and terminate the runs in flight.
    Acceptance: with `executor-concurrency` of 4 no more than 4 executor runs are in flight at once, and a cap breach with 4 in flight starts no fifth run.

30. **Measured executor cost.** The runner SHALL read the total cost in US dollars and the token usage from the executor's result record of every run and SHALL write them to that run's `metrics.json`. The report and the job summary of R22 SHALL show the measured executor cost per skill and per invocation. A run whose executor produced no result record SHALL record its cost as unknown and SHALL count as an executor failure under R24.
    Acceptance: for two skills of 6 and 4 runs, the summary lists the sum of each skill's run costs and the sum over all 10 runs; deleting a run's result record from the mock executor's output makes that run's cost `unknown` and the status `error`.

31. **Executor model pinned.** The executor's model SHALL be a Sonnet-class model selected through one declared, documented setting, and a run SHALL NOT silently use any other model. The rationale for the choice is recorded in an ADR, not in this spec.
    Acceptance: the model identifier given to the executor of every run equals the setting's value, and changing the setting changes it.

32. **Skill install contents.** For a `with_skill` run the runner SHALL install the skill into the agent under test by copying `SKILL.md` and the `scripts/`, `references/` and `assets/` directories of the skill when they exist, and SHALL NOT copy `evals/` or any other path, so the agent under test cannot read the expectations it is graded on.
    Acceptance: for a skill holding `SKILL.md`, `scripts/`, `evals/` and a stray `notes.md`, the installed skill directory contains the first two and neither of the others.

## MODIFIED

**R5 (trigger probes).** Original: "Probes SHALL NOT be counted in `grading.json` or in the `pass_rate` of R14; they are reported separately as the fraction of probes whose observed trigger decision matched `should_trigger`." Replacement: "Probes SHALL NOT be counted in `grading.json` or in the `pass_rate` of R14. Until live trigger execution exists (see Out of scope), probes SHALL be validated under R5 and R6 and counted, and the report SHALL show the number of probes per skill with no match fraction; no trigger decision is observed or scored."

**R10 (output layout).** Original: "Each run SHALL write to its own directory `<out>/<skill>/eval-<id>/<with_skill|without_skill>/` containing the produced files, a `transcript.md` of the run, and `grading.json`." Replacement: "Each run SHALL write to its own directory `<out>/<skill>/eval-<id>/<with_skill|without_skill>/` containing `transcript.md` and `grading.json` at that directory's top level and every file the run produced under its `outputs/` subdirectory. The `with_skill` replay on the base `SKILL.md` (R19) SHALL write under `<out>/<skill>/base/` with the same per-eval layout. The skill-level `benchmark.json` is unchanged." R4's "run's output directory" is thereby the run's `outputs/` subdirectory: a check `path` SHALL be relative to it and SHALL NOT escape it.

**R13 (judge evidence).** Original: "An expectation SHALL be recorded `passed: true` only when the verdict is PASS and the evidence is non-empty and, when it is an excerpt, occurs verbatim in the run's output." Replacement: "An expectation SHALL be recorded `passed: true` only when the verdict is PASS and the evidence is valid. Evidence is valid when it contains at least 12 non-whitespace characters and is either an exact substring of the run's `transcript.md` or of a file the run produced, line endings normalised, or a `path:line` reference naming a produced file and an existing line of it. Any other PASS SHALL be recorded `passed: false` with evidence stating that the verdict was unsupported." The UNCERTAIN rule is unchanged.

**R14 (benchmark.json).** Original: "`runs` ... one entry per run carrying `eval_id`, `configuration` ... and that run's `summary` from `grading.json` ... plus a `delta` entry equal to the `with_skill` mean minus the `without_skill` mean." Replacement: each `runs` entry SHALL carry `eval_id`, `configuration`, that run's `summary` from `grading.json`, and a `result` object carrying the same figures in the shape skill-creator's results viewer reads. `run_summary` SHALL carry `delta` as an object `{"pass_rate": "<signed decimal>"}`, for example `"+0.10"` or `"-0.05"`, and SHALL carry the same difference, `with_skill` mean minus `without_skill` mean, as the number `delta_value`. Mean and population standard deviation are unchanged.

**R19 (regression metric).** Original: "...for the head revision of `SKILL.md` and for the base revision of `SKILL.md`, both over the evals file of the head revision..." Replacement: the base replay SHALL run the base revision of `SKILL.md` installed over the head revision's other skill resources (`scripts/`, `references/`, `assets/`), per requirement 32. When the head `SKILL.md` is byte-identical to the base `SKILL.md`, as in a local run of an unchanged skill, the runner SHALL skip the base replay, run two executor runs per eval instead of three, and compare no means. Every other sentence of R19 is unchanged.

**R23 (budget, cost guard and attribution).** Original: "Per invocation the runner SHALL enforce two caps ... `max-executor-runs` ... and the judge's `max_calls` (R15)." Replacement: the two caps SHALL apply per selected skill, not per invocation: each skill is planned, checked and enforced against its own `max-executor-runs` (default 30) and judge `max_calls` (default 300). The pre-flight plan, the runtime enforcement and the `error` outcome of R23 apply to each skill on that basis. Those two defaults SHALL be documented as provisional, to be recalibrated from the measured costs of requirement 30 on the `pr-logbook` pilot (issue #1852). The usage declaration of R23 is unchanged. The runner reports the measured executor cost from the executor's result record, per requirement 30, and the aggregate bound and concurrency are requirements 28 and 29.

**R26 (CLI matrix finding).** Original: "...the work SHALL NOT add or change a row under `docs/cli-matrix/rows/`; if the plan finds that a per-CLI difference does arise, it SHALL record the evidence per `docs/cli-matrix-maintenance.md` and add the row in the same change." Replacement: the judge drivers remain independent of any installed agent CLI, but the executor of R9 is Claude Code only. The eval measures a skill on Claude Code, not on each of the four CLIs the skill ships to, and the documentation of the runner SHALL say so. No row is added or changed under `docs/cli-matrix/rows/`, because the runner is a repository development tool and deploys nothing to a CLI target.

## REMOVED

None.

## Scenarios

**Scenario:** a limit hit is graded on partial output

```text
Given an executor run that reaches the 300 second wall-clock limit after producing part of its output
When  the runner grades that run
Then  grading.json reflects the partial output
And   metrics.json names the wall-clock limit
And   the run counts in pass_rate and the skill's status is not error
```

**Scenario:** an over-cost plan is refused before any call

```text
Given three changed skills whose planned executor runs total 210 and the default max-invocation-usd of 100
When  the runner computes its plan
Then  no model call is made
And   the status is error with 210 dollars planned, the cap of 100 and the text "split the PR"
And   the run exits non-zero
```

**Scenario:** measured cost is reported

```text
Given a changed skill whose executor result records report 0.40 and 0.35 dollars
When  the runner prints its summary
Then  each run's metrics.json holds its cost and token usage
And   the report and the job summary show 0.75 dollars for the skill and the invocation total
```

**Scenario:** the unchanged skill skips the base replay

```text
Given a local run of a skill whose SKILL.md equals its base revision, with 2 evals
When  the runner plans the run
Then  it plans 4 executor runs and no base replay
```

**Scenario:** evals are not installed with the skill

```text
Given a skill with SKILL.md, scripts/ and evals/
When  the runner installs it for a with_skill run
Then  the installed directory holds SKILL.md and scripts/ and no evals/ path
```

**Scenario:** short evidence is unsupported

```text
Given the judge returns PASS with the evidence "ok"
When  the runner records the expectation
Then  passed is false and the evidence states the verdict was unsupported
```
