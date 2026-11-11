---
id: "0290"
slug: skill-eval-runner
status: draft
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 1884
version: 3.0.0
---

# Skill eval runner: grade a skill from its evals.json when SKILL.md changes

*Delta 04 of `specs/0290-skill-eval-runner.md`, building on delta-01 to delta-03. Source: the owner's decision at the spend gate of issue #1880 (recorded on issue #1884): the runner is heavier than the intended model of an LLM-as-a-judge check, and it never executes trigger probes. The owner's model, verbatim: "dans le fichier evals nous avons des tests, pour chaque tests, execution en mode non interactif et tu compare la réponse avec l'attendu. L'execution en mode non interactive doit s'effectuer avec le model sonnet 5.5 en effort medium sur mon poste". This delta realises it by removing machinery: one run per eval, one judge call per eval, the paired `without_skill` run and the base replay gone, trigger probes executed live. The version is a MAJOR bump: requirements are removed or changed incompatibly (paired runs, the three-call quorum, the replay-based regression, the `benchmark.json` contract, the results-file shape and the probe semantics), which invalidates any in-flight plan built on them. No results file exists on `main` yet (no skill carries `evals/`), so no committed attestation goes stale. Requirements added: R45 to R47. Requirements modified: R5, R9, R10, R12, R13, R15, R19, R20, R22, R23, R24, R25, R32, R34, R35, R36, R37, and the Intent. Requirements removed: R14. Skill-creator results-viewer compatibility (base R10) is dropped on purpose: the viewer reads a paired `with_skill`/`without_skill` benchmark, and keeping it would force paired runs back. This delta opens no question.*

## ADDED

<!-- markdownlint-disable MD029 -->

45. **Probes are executed.** For each `trigger_probes` entry the runner SHALL perform one non-interactive run with the skill installed as for an eval (R32), whose prompt is the probe's `query`, and SHALL observe in that run's event stream whether the agent loaded this skill: a `tool_use` block named `Skill` whose `skill` input equals the skill's directory name, in an assistant message. A probe SHALL pass if and only if the observed decision equals `should_trigger`. No judge call is made for a probe. The run SHALL have no tool other than `Skill`, so that it cannot have a side effect, and SHALL be bounded to one assistant turn, because the decision is known from the first assistant message: a `Skill` call naming this skill is a trigger, and a message without one is a non-trigger. The turn bound is the early stop (the run ends when the first message has been produced, without a second model call, and still leaves its result record with the measured cost), and reaching it SHALL NOT be tagged as a limit under R27 nor counted as an executor failure. Every other limit of R27 applies to a probe. Each probe SHALL write `<out>/<skill>/probe-<n>/` (`n` the 1-based position in `trigger_probes`) holding `transcript.md`, `metrics.json` and `probe.json` (`query`, `should_trigger`, `observed`, `passed`).
    Acceptance: with a stub `claude` that emits a `Skill` call naming the skill, a `should_trigger: true` probe passes and a `should_trigger: false` probe fails; with a stub that emits plain text, the reverse; the recorded argv of a probe run holds `--tools Skill` and `--max-turns 1`; a probe run whose result is `error_max_turns` after the `Skill` call is a pass for `should_trigger: true`, is not tagged with a limit and is not an `error`; no judge call is made for any probe.

46. **Pass criterion.** The *pass rate* of a skill SHALL be the number of evals and probes that passed divided by the number of evals and probes (0 when there are none). An eval passes when every one of its checks and every one of its expectations passes; a probe passes under requirement 45. A skill SHALL be `pass` when its pass rate is at least the threshold, which SHALL be one declared, documented setting, `pass-threshold`, defaulting to 0.8 and changeable in one line; otherwise it SHALL be `fail`. A `fail` SHALL be reported and SHALL NOT make the run exit non-zero by default; whether it does SHALL be controlled by exactly one declared, documented setting, `fail-blocking`, defaulting to false, following the pattern of `regression-blocking` (R20) and `missing-evals-blocking` (R21): flipping it SHALL be a one-line change and SHALL make the same condition exit non-zero. A skill whose `fail` condition and `regression` condition (R19) both hold SHALL be reported as `fail`, with the regression line printed as well, and each condition blocks only under its own setting.
    Acceptance: 4 evals and 4 probes with 6 passing give 0.75 and status `fail` with exit 0; with 7 passing, 0.875 and `pass`; with exactly 80 percent (4 of 5) the status is `pass`; with `fail-blocking` true the 0.75 case exits non-zero naming the skill; a skill with no probes is graded on its evals alone.

47. **Model and effort.** The executor of every run and the judge, when it is made through `claude` (the default, R33), SHALL use the model of R31 (`claude-sonnet-5-5`) at the effort level given by one declared, documented setting, `effort`, defaulting to `medium` and passed as `--effort <level>` (`claude` 2.1.322 accepts `low`, `medium`, `high`, `xhigh` and `max`). The results file records it (R36). Under `--use-api-key` the judge uses the `anthropic` driver, which has no effort level; the documentation SHALL say so.
    Acceptance: the recorded argv of an executor run, of a probe run and of a judge call each contain `--model claude-sonnet-5-5` and `--effort medium`; changing the setting changes the value in all three.

## MODIFIED

**Intent.** Original: "A maintainer who changes a skill's `SKILL.md` learns, before the change merges, whether the skill still makes an agent behave better than the same agent without it. ... and a change that makes the skill measurably worse than the base branch is reported to its author." Replacement: a maintainer who changes a skill's `SKILL.md` learns, before the change merges, whether an agent with the skill passes the skill's own evaluation cases and loads the skill when it should and only then. Each case is run once, non-interactively, and its answer is compared with what was expected; a change that lowers the pass rate against the base branch's recorded result is reported to its author. The rest of the Intent (versioned cases next to the skill, one command for one skill, cost capped and attributed, never silently counted as a pass when the judge could not run) stands.

**R5 (trigger probes), as modified by delta-01.** Original (delta-01 replacement): "Probes SHALL NOT be counted in `grading.json` or in the `pass_rate` of R14. Until live trigger execution exists (see Out of scope), probes SHALL be validated under R5 and R6 and counted, and the report SHALL show the number of probes per skill with no match fraction; no trigger decision is observed or scored." Replacement: probes SHALL still be validated under R5 and R6 and SHALL NOT appear in any eval's `grading.json`; they are executed and scored under requirement 45 and counted in the pass rate of requirement 46, and the report SHALL show the number of probes passed and total.

**R9 (paired runs in fresh context), as modified by delta-03.** Original: the title and the sentence "For each eval the runner SHALL perform two runs: `with_skill` ... and `without_skill`, which has the `prompt` and `files` only." and "the `with_skill` and `without_skill` arms differ only by the presence of the installed skill." Replacement: for each eval the runner SHALL perform exactly one run, in which the skill is installed as a whole directory (requirement 32) together with the eval's `prompt` and `files`; there is no `without_skill` run and no run on the base revision of the skill. The sentences on reading the skill's references and assets, executing its scripts, installing it as a real skill under the flags of requirement 40, the environment of requirement 42 and the empty conversation that shares no state with any other run stand. The agent under test is non-interactive.
    Acceptance: a skill with 3 evals gives 3 executor runs, each workspace holds `.claude/skills/<name>/`, and no run has a workspace without it.

**R10 (output layout), as modified by delta-01.** Original (delta-01 replacement): "`<out>/<skill>/eval-<id>/<with_skill|without_skill>/` containing `transcript.md` and `grading.json` ... and every file the run produced under its `outputs/` subdirectory. The `with_skill` replay on the base `SKILL.md` (R19) SHALL write under `<out>/<skill>/base/` ... The skill-level `benchmark.json` is unchanged." and the base sentence "The layout and file formats SHALL load unchanged in skill-creator's results viewer." Replacement: each eval run SHALL write to `<out>/<skill>/eval-<id>/` containing `transcript.md`, `grading.json`, `metrics.json` and every file the run produced under `outputs/`; each probe writes under `<out>/<skill>/probe-<n>/` (requirement 45). There is no `base/` directory, no configuration level and no `benchmark.json`. Loading in skill-creator's results viewer is dropped. A check `path` stays relative to `outputs/`.

**R12 (assertion order), as modified by delta-01.** Original: "The judge SHALL be called only for `expectations` entries, and SHALL NOT be called for a run whose output directory cannot be read." Replacement: the runner SHALL evaluate all `checks` of an eval before the judge call; the judge SHALL be called once per eval, for all of that eval's `expectations` together, and SHALL NOT be called for an eval with no expectation or whose output directory cannot be read (every expectation is then recorded `passed: false` with evidence saying the judge was not called). A failed check does not prevent the judge call. The rest of R12 stands.

**R13 (judge evidence), as modified by delta-01.** Original: the delta-01 replacement ("An expectation SHALL be recorded `passed: true` only when the verdict is PASS and the evidence is valid. Evidence is valid when ... Any other PASS SHALL be recorded `passed: false` with evidence stating that the verdict was unsupported.") and "The UNCERTAIN rule is unchanged." Replacement: the judge's single answer SHALL carry, for each expectation, a verdict `PASS` or `FAIL` and evidence. The evidence rule is kept unchanged, because checking it is local and costs no model call: an expectation SHALL be recorded `passed: true` only when its verdict is `PASS` and its evidence is valid (at least 12 non-whitespace characters, and either an exact substring of the run's `transcript.md` or of a produced file with line endings normalised, or a `path:line` reference naming a produced file and an existing line of it); any other `PASS` SHALL be recorded `passed: false` with evidence stating that the verdict was unsupported. An expectation for which the answer holds no entry, or an entry that is neither `PASS` nor `FAIL`, SHALL be recorded `passed: false` with evidence stating that the judge gave no verdict for it. The `UNCERTAIN` verdict and the confidence figure no longer exist. An answer that yields no entry at all for the eval, after the transport retries, is a judge failure under R24.
    Acceptance: with 3 expectations and an answer that gives a `PASS` with valid evidence, a `FAIL` and nothing for the third, `grading.json` holds passed, failed and failed with the three evidences in order; the judge was called once.

**R14 (benchmark.json)** is removed (see REMOVED).

**R15 (judge reuse), as modified by delta-01.** Original: "judging still goes through `tests/e2e/lib/llm_judge.ts` and inherits its quorum, its `max_calls` cap and its mock mode, with behaviour unchanged for its existing callers." Replacement: judging still goes through `tests/e2e/lib/llm_judge.ts`, inherits its drivers, its `max_calls` cap and its mock mode, and leaves the behaviour for its existing callers unchanged (their three-call quorum, output and exit behaviour included); the runner SHALL NOT use the quorum: it SHALL make exactly one model call per eval, counted against `max_calls`, plus the driver's transport retries. Adding to the library a single-call entry point, or a quorum size that defaults to the present three, is permitted; the end-to-end goldens that pin the existing behaviour SHALL still pass. The other sentences of R15 stand.
    Acceptance: a judge for an eval with 4 expectations makes one call (the counter file reads 1); an existing end-to-end judge call still makes up to three.

**R19 (regression metric), as modified by delta-01.** Original: "...the runner SHALL compute the `with_skill` mean `pass_rate` (R14) for the head revision ... and for the base revision ... The `without_skill` run does not depend on `SKILL.md`, so it SHALL be run once per eval ... only the `with_skill` run SHALL be replayed on the base `SKILL.md`. A skill SHALL be a regression when the head mean is lower than the base mean by more than the tolerance ..." Replacement: the runner SHALL NOT execute anything on the base revision. It SHALL compare the head pass rate (requirement 46) with the pass rate recorded in `evals/results.json` as committed at the merge-base with the base ref, read from the merge-base tree and valid under R37 apart from its content hash (a current-format file, not a mock, naming this skill, holding a numeric `pass_rate`). A skill SHALL be a regression when the head pass rate is lower than that base pass rate by more than the tolerance, a single declared, documented constant defaulting to 0.05, to be calibrated on the `pr-logbook` pilot (issue #1880) before regression is made blocking. A skill that has no valid results file at the merge-base (new, never attested, or a file of an older format) SHALL be reported as new and not compared (`base=n/a` and a line saying so); this is not a status. The two rates may be over different sets of evals and probes, because the base's cases are not re-run; the documentation SHALL say so.
    Acceptance: head 0.70 against a recorded base 0.80 with tolerance 0.05 is a regression; head 0.76 against 0.80 is not; a skill whose merge-base holds no `evals/results.json`, a mock file or a file lacking `pass_rate` makes no regression and prints `new`; no model call is made for the base.

**R20 (blocking outcomes), as modified by delta-01.** Replacement: unchanged, and extended by requirement 46: an invalid `evals.json` blocks always; a `regression` blocks only under `regression-blocking` (default false); a `fail` blocks only under `fail-blocking` (default false); a `stale` attestation blocks always. The runner and the attestation check SHALL decide the `fail` and `regression` conditions from the same recorded figures with the same function.

**R22 (report), as modified by delta-01.** Original: "the runner SHALL print a per-skill summary (status, `with_skill` and `without_skill` means, delta, base mean, executor runs used, judge calls used, measured cost) ... The status SHALL be one of `pass`, `regression` ..., `invalid`, `no-evals`, `new`, `stale`, `mock`, `error`." Replacement: the summary SHALL show the status, the pass rate with evals passed/total and probes passed/total, the threshold, the base pass rate (`n/a` when not compared) and the difference, executor runs used, judge calls used and measured cost. The status SHALL be one of `pass`, `fail`, `regression`, `invalid`, `no-evals`, `stale`, `mock`, `error`; `new` is removed as a status, because a new skill still needs a `pass` or `fail` verdict, and is shown as the not-compared line of R19. The attestation check prints one line per skill as before.

**R23 (budget, cost guard and attribution), as modified by delta-01.** Original (delta-01): the planned executor runs "are, for each eval, three ... or two ..." and the judge's worst case "(expectations, times runs, times the quorum, plus retries)". Replacement: the planned executor runs of a skill are its evals plus its probes (one run each); the worst-case judge calls are the number of evals that have at least one expectation, plus the retry allowance; both are checked against the per-skill caps `max-executor-runs` and the judge `max_calls`, whose defaults become 20 and 20 (provisional, to be recalibrated from the measured costs of the `pr-logbook` pilot, issue #1880). The aggregate bound `max-invocation-usd` (R28) and the concurrency (R29) apply to the new run counts unchanged. The rest of R23 stands.
    Acceptance: a skill with 3 evals (2 with expectations) and 5 probes plans 8 executor runs and at most 3 judge calls; with 21 evals and probes the pre-flight refuses against `max-executor-runs` 20 before any model call.

**R24 (backend unavailable), as modified by delta-01.** Replacement: the sentence "Mock mode SHALL ... mark every written `grading.json` and `benchmark.json` with `"mock": true`" reads `grading.json` and `probe.json`, there being no `benchmark.json`; a judge that returns no entry for the eval after its retries is `error` under R13. The rest stands.

**R25 (offline tests), as modified by delta-01 and delta-03.** Replacement: the covered areas change as follows. Removed: the benchmark layout and formats, the base replay and the paired runs. Added: the single judge call and its answer parsing (requirement 13), the probe observation with a stub `claude` (requirement 45), the pass criterion and the `fail-blocking` knob (requirement 46), the effort flag (requirement 47), and the regression arithmetic against a recorded base. The tests run with no key and no network, in mock mode.

**R32 (skill install contents), as modified by delta-03.** Replacement: the clause "the base replay of R19 SHALL install the merge-base skill in the same place and the same way" is removed; every other clause stands, and requirement 45 uses it for probes.

**R34 (changed-skill selection), as modified by delta-01.** Replacement: the sentence "A selected skill is planned as R19 and R23 state: three executor runs per eval, or two with no base replay when ..." reads: a selected skill is planned under R23, one executor run per eval and per probe. Selection by content hash is unchanged.
    Acceptance: a branch that edits one line of a skill's `scripts/` selects it and plans one run per eval and per probe; a branch that edits only its `evals/evals.json` selects it and plans the same.

**R35 (content hash), as modified by delta-01.** Replacement: the *installed-content hash*, which decided whether the base replay could be skipped, is removed; the content hash and its acceptance, except the clause on the installed-content hash, stand.

**R36 (results file), as modified by delta-01.** Original: "a JSON object with exactly these keys: ... `benchmark`, an object with `with_skill_mean`, `without_skill_mean`, `base_mean` ..., `delta_value` and `tolerance`; ..." and "A skill whose installed content equals the base's (R19) is planned with two runs per eval ...". Replacement: a non-mock run whose status is `pass`, `fail` or `regression` SHALL write `evals/results.json` with exactly these keys, in this order: `skill_name`, `content_hash`, `runner_version`, `executor_model`, `judge_model`, `effort` (requirement 47), `date`, `status`, `pass_rate`, `base_pass_rate` (null when not compared, R19), `threshold`, `tolerance`, `evals_passed`, `evals_total`, `probes_passed`, `probes_total`, `executor_runs`, `judge_calls`, `cost_usd`. A run with any other status, and every mock run, SHALL NOT write or modify it. The other sentences stand; the file is still never shipped and needs no version bump. `RUNNER_VERSION` is bumped to 2.0.0 by the implementation.
    Acceptance: a real run with 4 of 5 units passing and no base file writes `status` `pass`, `pass_rate` 0.8, `base_pass_rate` null and every key above; a run with a recorded base of 0.9 and a head of 0.8 writes `regression`; a mock run leaves the file untouched.

**R37 (attestation check), as modified by delta-01.** Original: "`stale` when ... records a `status` other than `pass`, `regression` or `new` ...; otherwise the recorded `status`." and the outcome rule for recorded `regression`. Replacement: the keys of requirement 36 replace the former ones; a recorded `status` other than `pass`, `fail` or `regression` makes the file `stale`; a file of the former shape (a `benchmark` key, or the status `new`) is therefore `stale` and is regenerated by one run. Otherwise the check reports the recorded status. A recorded `fail` and a recorded `regression` SHALL be reported and SHALL block only under `fail-blocking` and `regression-blocking` respectively, decided from the recorded figures under R20.
    Acceptance: a fresh file recording `fail` exits 0 and names the skill, the pass rate and the threshold; with `fail-blocking` true it exits non-zero; a file with a `benchmark` key is `stale`.

**Settings (no requirement change).** `scripts/lib/skill-evals/settings.ts` gains `PASS_THRESHOLD` (0.8), `FAIL_BLOCKING` (false) and `EFFORT` ("medium"), and loses `JUDGE_QUORUM`; `MAX_EXECUTOR_RUNS` and `JUDGE_MAX_CALLS` become 20 and 20. `docs/skill-evals.md`, ADR 0023 (decisions 2 and 5) and the CI capability text that cite paired runs, the quorum or the replay are updated in the implementation.

**Scenarios and Out of scope, restated.** Base Out of scope: "Measuring real skill-trigger behaviour in a live agent CLI; probes are stored and reported (R5) and their live execution is a later spec." is removed: probes are executed, on Claude Code only, under requirement 45. "A nightly or scheduled run, a stored baseline of past results, and trend dashboards." now reads: no scheduled run, no history of results and no dashboards; the one committed `evals/results.json` is the baseline of R19. "Changing the judge's three-call quorum, its drivers or the end-to-end suites that call it, beyond R15." stands for the library's other callers; the runner simply does not use the quorum. "Flipping `missing-evals-blocking` or `regression-blocking` to true" also covers `fail-blocking`. The base scenarios *changed skill with healthy evals passes*, *regression versus base*, *the regression-blocking knob*, *drop within tolerance*, *a with_skill run can execute the skill's scripts*, *deterministic checks run before the judge*, *an unsupported PASS*, the delta-01 scenarios *a local run writes the attestation*, *recorded regression is reported*, *the regression knob blocks recorded regressions*, *a scripts-only change gets a real comparison*, *an evals-only change plans two runs per eval*, *the executable bit is part of the content hash* (its "installed-content hash"), *identical installed content skips the base replay*, *an over-cost plan is refused before any call* (run counts), *measured cost is reported* and *short evidence is unsupported*, and the delta-03 scenarios *the skill is installed at project scope in the workspace* and *the base replay installs the merge-base skill the same way*, are replaced by the scenarios below or removed as stated; every other scenario stands, with "with_skill run" read as "run".

## REMOVED

- R14 (benchmark.json), as modified by delta-01: the per-run `benchmark.json`, its `runs`/`run_summary`/`delta` shape, the `with_skill`/`without_skill` means and the standard deviation. Nothing replaces it: the printed report and the committed results file carry the pass rate.
- The `without_skill` run and every statement that depends on it (R9, R10, R14, R19, R22, R23, R34, the delta-03 statement that the two arms differ only by the installed skill).
- The base replay and the installed-content hash (R19, R34, R35, delta-01 requirement 36's `base_mean` and the delta-03 R32 clause).
- The judge's three-call quorum and the `UNCERTAIN` verdict for this runner (R13, R15, the `JUDGE_QUORUM` setting).
- The status `new` (R22, R36, R37), replaced by the not-compared line of R19.
- Skill-creator results-viewer compatibility of the output layout (base R10).

## Verified against the code and the tool

Read before writing this delta. The executor runs one `claude -p --output-format stream-json` child per run, counts assistant messages, maps a result subtype containing `max_turns` to the turn limit and passes `--model` but no `--effort` (`scripts/lib/skill-evals/executor/claude-code.ts`, `buildArgs`); the judge driver's argv has `--model`, `--tools ""` and no effort (`tests/e2e/lib/llm_judge_drivers/claude-cli.ts`, `buildJudgeArgs`); the judge makes one `llmJudgeEvidence` call per expectation and that library function runs `runQuorum` of up to three calls (`scripts/lib/skill-evals/judge.ts`, `tests/e2e/lib/llm_judge.ts`); `planSkill` multiplies by `JUDGE_QUORUM` and by three runs per eval (`scripts/lib/skill-evals/budget.ts`); `run.ts` runs `with_skill`, `without_skill` and the base replay and computes the regression from the replay; `buildBenchmark` writes `benchmark.json`; `results.ts` fixes the `benchmark` object and the statuses `pass`, `regression`, `new`; `readRevision` reads only the hashed file set, so the base `evals/results.json` is read from the merge-base tree separately (the hash never includes it); no `evals/` directory exists under `artifacts/`, so no committed results file is affected.

Run on `claude` 2.1.322 with `claude-sonnet-5-5` and a project-scope skill in a workspace outside the repository and `HOME`: `claude --help` lists `--effort <level>` with `low, medium, high, xhigh, max`; with `--tools Skill --max-turns 1`, a matching query emits one assistant message holding `tool_use` `Skill` with input `{"skill": "<name>", "args": ...}` and the run ends with result subtype `error_max_turns`, `is_error` true and `total_cost_usd` 0.015 (cost known, no kill, no second model call), and an unrelated query emits one text message and ends with subtype `success` and cost 0.0145; the same positive query with `--max-turns 2` took a second turn and cost 0.0245. UNVERIFIED: that `--effort medium` lowers the cost of an eval run (accepted by the flag and used in the probe runs above; the effect on cost is for the pilot to measure) and whether the `anthropic` driver can pass an effort level (not examined, so requirement 47 only promises the `claude` path).

## Scenarios

**Scenario:** one run and one judge call per eval

```text
Given a skill with 3 evals, two of them with expectations, and no probes, logged in to Claude Code
When  the contributor runs task skill-evals -- pr-logbook
Then  3 executor runs are made, each with the skill installed, and no run without it or on the base revision
And   the judge is called twice, once per eval with expectations, each call carrying all that eval's expectations
And   every claude argv holds --model claude-sonnet-5-5 and --effort medium
```

**Scenario:** the judge answer maps to each expectation

```text
Given an eval with three expectations and a judge answer that passes the first with a verbatim excerpt, fails the second and says nothing of the third
When  the runner records the eval
Then  grading.json holds passed, failed and failed in file order, the third saying the judge gave no verdict
And   the eval fails
```

**Scenario:** a probe that should trigger observes the skill load

```text
Given a probe {query, should_trigger: true} and a stub claude that emits a Skill call naming the skill
When  the runner executes the probe
Then  the run has only the Skill tool and a turn bound of one
And   probe.json records observed true and passed true, and no judge call is made
```

**Scenario:** a probe that should not trigger passes on plain text

```text
Given a probe {query, should_trigger: false} and a stub claude that answers with text only
When  the runner executes the probe
Then  probe.json records observed false and passed true
```

**Scenario:** the turn bound is the early stop, not a failure

```text
Given a should_trigger probe whose run ends with the result error_max_turns after the Skill call and carries a cost
When  the runner records the probe
Then  the probe passes, its metrics.json carries no limit tag and its cost, and the skill's status is not error
```

**Scenario:** the pass rate decides pass or fail

```text
Given a skill with 4 evals and 4 probes of which 6 pass, and fail-blocking at its default
When  the runner reports it
Then  the pass rate is 0.75 against the threshold 0.8 and the status is fail
And   the run exits 0 and evals/results.json is written with status fail
```

**Scenario:** the threshold boundary passes

```text
Given 5 evals and probes of which 4 pass
When  the runner reports the skill
Then  the status is pass
```

**Scenario:** the fail-blocking knob flips the same condition

```text
Given the same skill and fail-blocking set to true
When  the runner reports it, or the attestation check reads the recorded fail
Then  the run or the check exits non-zero naming the skill
```

**Scenario:** regression is a free comparison with the recorded base

```text
Given the merge-base holds an evals/results.json recording pass_rate 0.90 for the skill, and the head pass rate is 0.80
When  the runner compares them with the default tolerance of 0.05
Then  the status is regression, naming the skill, 0.90, 0.80, the difference and the tolerance
And   no run is made on the base revision, and the run exits 0 unless regression-blocking is true
```

**Scenario:** a skill with no base results is new

```text
Given the merge-base holds no evals/results.json for the skill, or one of the former shape
When  the runner reports the skill
Then  the base pass rate is n/a and a line says the skill is new and not compared
And   the status is pass or fail on the threshold alone
```

**Scenario:** a with-skill run can execute the skill's scripts

```text
Given a skill whose scripts/ holds a script and an eval whose expectation can only be met by running it
When  the runner performs the run
Then  the agent runs the script and the expectation passes
```

**Scenario:** deterministic checks run before the one judge call

```text
Given an eval with a file_exists check that fails and two expectations
When  the runner grades the run
Then  the failed check appears first in grading.json with its observed value as evidence
And   the judge is called once, for the two expectations together
```

**Scenario:** an unsupported PASS is rejected

```text
Given the judge answers PASS for an expectation with an excerpt absent from the run's output, or with the evidence "ok"
When  the runner records the expectation
Then  passed is false and the evidence states the verdict was unsupported
```

**Scenario:** the plan counts evals and probes

```text
Given a skill with 3 evals, two with expectations, and 5 probes
When  the runner plans it
Then  8 executor runs and at most 3 judge calls are planned, against max-executor-runs 20 and max_calls 20
And   with 21 evals and probes the plan is refused before any model call
```

**Scenario:** an evals-only change plans one run per case

```text
Given a skill whose only change is evals/evals.json, with 2 evals and 1 probe
When  the contributor runs task skill-evals -- --changed
Then  the skill is selected and 3 executor runs are planned
And   evals/results.json is written
```

**Scenario:** the attestation reads the new shape

```text
Given a changed skill whose results file carries the current content hash, the keys of requirement 36 and status pass
When  the attestation check runs with no credential variable set
Then  the status is pass and the check exits 0
And   a results file with a benchmark key or the status new is stale and the check exits non-zero
```

**Scenario:** the executable bit still changes the content hash

```text
Given a skill with a tracked script at index mode 100644 whose mode is changed to 100755 with the bytes unchanged
When  the content hash is computed
Then  it changes, and a results file recording the previous hash is stale
```

**Scenario:** the skill is installed at project scope in the workspace

```text
Given a skill with SKILL.md, scripts/, references/, assets/ and evals/
When  the runner performs an eval run or a probe run
Then  the workspace holds .claude/skills/<name>/ with SKILL.md, scripts/, references/ and assets/ and no evals/ path
And   the workspace is a temporary directory outside any repository and outside HOME
And   the run's outputs/ holds no path under .claude/
```
