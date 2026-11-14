---
id: "0304"
slug: skill-evals-sampling-gate
status: approved
complexity: standard
interaction-mode: AUTO
related-issue: 1958
version: 1.0.0
---

# Make the skill-evals gate statistically sound: a pre-declared sampling plan, a regression test and an honest evidence rule

## Intent

The skill-evals gate of spec 0290 decides a pass, a fail or a regression from a single run of six evals, where one flip moves the rate by 0.17. The same skill content measured 1.00, 0.83, 0.83 and 0.67 in four runs, a tolerance of 0.05 turns any single flip into a regression, and a judge pass is voided when its quoted evidence is a short line or an absence, so contributors re-ran until a run passed and spent the paid-run budget on noise. This spec replaces that rule with a verdict that depends on the skill and not on the luck of one run, and that re-running cannot shop for. The sampling plan is declared once, before the first model call, every run is recorded and nothing is discarded; the pass decision follows fixed thresholds over two sampling stages, and a regression against the committed baseline at the merge-base is a statistical test over the evals both sides share. The evidence rule stops voiding sound passes, absences on files become deterministic checks, an authoring guard catches an expectation that no conforming output can satisfy before any baseline is paid, and the cost of a measurement, of a skill and of a ticket is bounded, recorded for every measurement and enforced before any model call. The local-only, self-declared trust model, the content hash, the judge, the attestation job and the pre-push check stay as they are.

## Requirements

1. **R1 (the plan is one constant).** `scripts/lib/skill-evals/settings.ts` SHALL declare one constant, `SAMPLING_PLAN`, with exactly these members and values: `id` `"two-stage-1"`; `evalRunsPerStage` `[2, 2]` (runs of every eval in stage 1 and in stage 2); `probeRunsPerStage` `[1, 1]`; `acceptStage1` `0.90`; `rejectStage1` `0.60`; `acceptFinal` `0.75`; `regression` `{ test: "fisher-one-sided", alpha: 0.10, minDrop: 0.10 }`. There SHALL be no third stage. `TOLERANCE` and `PASS_THRESHOLD` SHALL be removed from `settings.ts`, and no other file SHALL hold a copy of any value of the plan. `FAIL_BLOCKING`, `REGRESSION_BLOCKING` and `MISSING_EVALS_BLOCKING` SHALL keep their names and their current value `false`; this spec flips none of them, and the gate binds through the wave specs that require the status `pass`. `RUNNER_VERSION` SHALL become `"3.0.0"`.
2. **R2 (decision per pool).** The evals and the probes are two pools, decided separately and never mixed. The *rate* of a pool is its passed runs divided by its recorded runs, pooled across the evals (or across the probes); an eval run passes when all its checks and expectations pass (spec 0290 R46, unchanged) and a probe run passes when the observed decision equals `should_trigger` (spec 0290 R45, unchanged). After stage 1 (2 runs of each eval; 1 run of each probe) a pool is *accepted* when its rate is at least `acceptStage1`, *rejected* when its rate is below `rejectStage1`, and otherwise *continues* to stage 2. A pool that continues receives stage 2 (2 more runs of each eval; 1 more run of each probe), and is then accepted when its cumulative rate over both stages is at least `acceptFinal`, and rejected otherwise. There is no stage 3. A skill with no probe has no probe pool, and its probe rate is absent as under spec 0290 R46. Comparisons SHALL be exact: they SHALL be made on integer counts, or with a tolerance of at most 1e-9 where a rate is compared, so that 9 of 10 meets 0.90 and 11 of 12 does too.
3. **R3 (skill status).** The status of a measured skill SHALL be `fail` when either pool is rejected; otherwise `regression` when the test of R12 holds; otherwise `pass`. A measurement that has not finished has the status `in-progress` (R5), which is never `pass`. The stage-2 trigger of a pool SHALL depend on the head data of that pool only, never on the base.
4. **R4 (one pure plan, shared).** A new module `scripts/lib/skill-evals/plan.ts` SHALL hold, as pure functions with no file, clock, network or environment access: the remaining slots of the current stage for given recorded runs, the per-pool decision of R2, the skill status of R3, the exact one-sided Fisher test of R12 (the exact hypergeometric distribution, computed with no dependency) and the expected number of runs of a stage path. The runner and the attestation check SHALL both import it and SHALL NOT re-implement any of it, so that one set of recorded runs yields one decision in both.
5. **R5 (declared first).** Before the first model call of a measurement, the runner SHALL write `evals/results.json` with `status: "in-progress"`, the plan (a copy of `SAMPLING_PLAN`), the ticket, the base reference and `declared_at`, and no recorded run. After every graded run (and after every recorded error, R9) the runner SHALL rewrite the file atomically (a temporary file renamed over the target) with the run appended. When the runner cannot write the file it SHALL make no model call, SHALL exit non-zero with status `error` and SHALL name the path. A file whose status is `in-progress` SHALL always be `stale` for the attestation (R25).
6. **R6 (results schema 2).** `evals/results.json` SHALL be a JSON object with `schema_version` `2` and exactly these keys, in this order: `schema_version`, `skill_name`, `content_hash`, `runner_version`, `executor_model`, `judge_model`, `effort`, `plan`, `ticket`, `declared_at`, `date`, `status` (`in-progress`, `pass`, `fail` or `regression`), `stage_reached` (an object `{evals, probes}` holding the stage, 1 or 2, each pool reached; `probes` is `null` without probes), `evals` (one entry per eval: `id`, `case_hash`, `runs`), `probes` (one entry per probe: `index`, `should_trigger`, `runs`), `eval_passes`, `eval_runs`, `eval_pass_rate`, `probe_passes`, `probe_runs`, `probe_pass_rate` (`null` without probes), `base` (`{merge_base, schema_version, passes, runs, common_evals}`, or `null` when not compared), `regression` (`{drop, p_value}`, or `null` when not computed), `errors`, `executor_runs`, `judge_calls`, `cost_usd`, `judge_cost_usd`, `ledger`. `date` is the ISO 8601 UTC time of the last write. A run of an eval SHALL be recorded as `{passed, assertions, skill_loaded, cost_usd, cost_assumed, reasked}` (`cost_assumed` present, as `true`, only for a run whose cost is assumed under R23), where `assertions` is a string of `1` and `0`, one character per check and then per expectation in the order of `grading.json`, so that a flaking expectation is visible; a run of a probe is a boolean. `cost_usd` of a run is its measured executor cost, or `null` when unknown (spec 0290 R30), in which case the run counts at `PER_RUN_USD` for the caps; a run record carries `cost_assumed: true` when its cost is assumed under R23, and no such key otherwise. A mock run SHALL write no results file, as today.
7. **R7 (every run is recorded, nothing is discarded).** Every graded run SHALL appear in `evals` or `probes`, in the order it ran. The runner SHALL NOT delete, overwrite or omit a recorded run, and SHALL NOT start a second measurement of the same content that replaces the first (R8). The decision SHALL be computed from all recorded runs by `plan.ts`. The per-skill report and the results file SHALL show the run counts of each eval, so a flaky eval is visible in review.
8. **R8 (resume, refuse, restart).** Given an existing `evals/results.json` for the selected skill, the runner SHALL act on its content hash and status: (a) the same `content_hash`, status `in-progress`, a plan equal to `SAMPLING_PLAN` and the same ticket: the measurement is *resumed*, the recorded runs count, only the missing slots of the stage the recorded runs reach are run, and the stage decisions are recomputed by `plan.ts`; (b) the same `content_hash` and a status other than `in-progress`: the measurement is final, the runner SHALL make no model call, SHALL exit 1 and SHALL print `measurement complete for <content_hash>`, followed by the permitted way forward (change the skill content for a new measurement, or read the recorded status); (c) the same `content_hash` and `in-progress` under another ticket: the runner SHALL refuse with exit 1 naming both tickets; (d) a different `content_hash`, or an `in-progress` file whose plan differs from `SAMPLING_PLAN`: a new measurement starts and the previous file moves into `ledger` (R10), an unfinished one with the status `abandoned`; (e) no results file, an unparseable one or a schema-1 file: a new measurement starts, and a schema-1 file is not carried into the ledger; at every start the runner SHALL read the working-tree file, the copy at the merge-base and every revision of the file committed in `<merge-base>..HEAD` (the commits that touch the path, listed with `git log --format=%H <merge-base>..HEAD -- <path>` and read with `git show`, a commit that deletes the file contributing nothing but not hiding the others), and the previous ledger SHALL be the union, by entry identity (R10), of the ledgers and the own measurements of those of them that are of schema 2; the previous file is the working-tree one when it is parseable, else the latest committed revision of schema 2, else the merge-base copy, and a file that is not the working-tree one is never resumed, so that neither a deletion, nor a restore of the file (`git checkout <base> -- evals/results.json`), nor a committed restore followed by an edit drops an entry; (f) a new measurement whose `content_hash` equals the `content_hash` of any entry of that union with a final status (`pass`, `fail` or `regression`): the runner SHALL refuse with exit 1, make no model call and print `content already measured: <content_hash>`, because measuring identical content again is a reroll. There SHALL be no flag, setting or environment variable that allows it; the permitted way forward is a change of the skill content. An `abandoned` entry does not block a new measurement of its hash. A mock run SHALL ignore these rules, SHALL read no results file and SHALL change nothing.
9. **R9 (infrastructure errors are not samples).** A failure of the executor or of the judge that leaves no gradable run SHALL be appended to `errors` (the slot, the kind, the message, the time) and SHALL NOT count in any rate. Its slot SHALL be retried once in the same invocation. A second failure of the same slot SHALL end the skill with status `error` and a non-zero exit, with the results file kept `in-progress`. A run that ends at a turn, time or cost limit of the executor is graded on the output it produced, as under spec 0290 R27, and is a sample. A retry costs against the caps of R22 like any run.
10. **R10 (the ledger).** `ledger` SHALL hold one entry per earlier measurement of the skill: `content_hash`, `ticket`, `declared_at`, `date`, `status` (including `abandoned`), `eval_pass_rate`, `probe_pass_rate`, `executor_runs`, `judge_calls`, `cost_usd`, `judge_cost_usd`, `cost_assumed` (true when no run of the measurement reported a cost), with no nested ledger and no per-run detail. An entry is identified by `content_hash`, `ticket` and `declared_at`. When a new measurement starts (R8(d), R8(e)) its ledger SHALL be the union defined in R8(e) of the previous ledgers and own measurements, each as one entry, whatever its status and including a file identical to the merge-base's, so that no entry is ever dropped. The *merge-base set* is the entries of the merge-base file's ledger plus one entry for the merge-base file's own measurement (a schema-2 file; a schema-1 or absent file gives none). The *branch entries* of a skill are the entries of the union of R8(e) (the working-tree file, every revision committed in `<merge-base>..HEAD` and the current measurement) that are not in the merge-base set; they are what R8(f), R22(c) and R22(d) count. The report and the attestation SHALL print `measurements on this branch: <n>` with *n* the number of branch entries. A ledger entry whose `cost_usd` is `null` SHALL be counted, wherever spend is summed, at `executor_runs` times `RUN_ASSUMED_USD` when `cost_assumed` is true and otherwise at `executor_runs` times `PER_RUN_USD` (the entry keeps no per-run detail, so the count is conservative), and one whose `judge_cost_usd` is `null` at `judge_calls` times `JUDGE_ASSUMED_USD`. A head file whose entries do not include every entry of the merge-base set or of any revision committed in `<merge-base>..HEAD`, or whose recorded spend (summed as above) is lower than theirs, SHALL be reported by the check as `invalid` (R25), the reason naming the first missing entry; this covers restoring the merge-base file, deleting the file, a committed restore followed by an edit and a ledger rewritten to a smaller one. The check compares the working-tree file with the merge-base copy and with every committed revision in the range; the job of the pull-request pipeline has the full history that spec 0290 R18 already requires for the merge-base, so CI, the runner at every start and the pre-push check all make the full comparison. Residual risk, stated and not removed (spec 0290 R38): a contributor who edits `results.json` by hand is detected by the recompute-from-runs rule of R11 and by this rule, and in review by the git history of the file; what remains invisible is an entry that was never committed (uncommitted work) and an entry removed by a rewrite of the branch history (rebase, squash or force-push of the range), which is tampering under the trust model, visible in review and not prevented. Each entry is about 250 bytes, and the growth of the ledger on `main` is accepted.
11. **R11 (the recorded status must follow from the recorded runs).** The verifier of the results file SHALL recompute from the recorded runs, with `plan.ts`: the per-pool counts and rates, `eval_passes`, `eval_runs`, `probe_passes`, `probe_runs`, `stage_reached`, and the status, taking the recorded `base` block as the base figures. A file is `invalid` for the attestation when any recorded figure or the recorded status differs from the recomputation, when the number of runs of an eval or of a probe is not the number the stage path prescribes (2 or 4 runs per eval, 1 or 2 per probe, the same count for every eval of the pool, and 4 or 2 only when stage 1 left the pool continuing), when a status other than `in-progress` is recorded while a stage that the plan requires has not run, or when a key of R6 is missing or of the wrong type. More runs and fewer runs than the path prescribes are both `invalid`; the reason names the first difference. A file of schema 1 is not verified here (R26).
12. **R12 (regression).** A skill SHALL have the status `regression` when both hold: the base eval rate minus the head eval rate is at least `regression.minDrop`, and the one-sided Fisher exact test of the null hypothesis that the head pass probability is not lower than the base's gives p below `regression.alpha`. With *a* head passes over *n* head runs and *b* base passes over *m* base runs, p is the probability that a hypergeometric variable (population *n+m*, *a+b* successes, *n* draws) is at most *a*. Both conditions SHALL be evaluated exactly against the decimal constants of the plan, with no floating-point tolerance: the drop condition on integers (for `minDrop` 0.10, `(b*n - a*m) * 10 >= m*n`), and p as an exact rational number compared to `alpha` (for 0.10, numerator times 10 below denominator), in arbitrary-precision integer arithmetic. The figures SHALL cover only the evals present on both sides with equal `case_hash` (R14); the head side is the pooled runs of those evals over both stages. The test SHALL be evaluated whenever the pools are not rejected, at whatever stage the measurement ended, and its figures SHALL be recorded in `base` and `regression`. A skill whose base is absent, unreadable or has no eval in common SHALL NOT be compared (`base` is `null`), which is not a status; its status comes from R3 alone. The absolute bar acts first: a head pool below `acceptFinal` is rejected before the test runs, so over 24 head runs the test can fire only for heads of 18 to 20 passes against a base of 24 of 24, 18 or 19 against 23 of 24 or 16 of 16, and 18 against 12 of 12, and never against 22 of 24, 20 of 24 or a legacy base of 6 of 6, 5 of 6 or 4 of 6. Against the nine schema-1 bases of R26 the absolute bar is therefore the only gate in practice; this is a documented property of the statistic, not a defect, and R28 SHALL state it.
13. **R13 (the base is the file at the merge-base).** The base SHALL be the `evals/results.json` committed at the merge-base with the base ref, read from that tree (the read of spec 0290 R19 as modified by delta-04), never from the working tree and never re-measured. A schema-2 base that is not a mock and names the skill contributes the recorded runs of the common evals. A schema-1 base (the keys of spec 0290 R36 as modified by delta-04, not a mock, naming the skill) is *legacy* and contributes `evals_passed` over `evals_total` as one run each, over all its evals, and the head side then covers all head evals; the test therefore widens by itself, with no rewriting of the base file and no bulk re-measurement. A base file whose status is `in-progress` or that cannot be read as either schema is absent. No file of schema 1 SHALL be rewritten or re-measured by the implementation of this spec. The attestation SHALL recompute the regression against the merge-base file as it stands when the check runs, so a sibling skill landing on `main` never strands a branch, and the "base equals the printed base" stop of spec 0303 R5 no longer applies.
14. **R14 (case hash).** Each recorded eval SHALL carry `case_hash`, a SHA-256 written as `sha256:` and 64 lowercase hexadecimal digits, over: the canonical JSON of the eval entry (keys sorted at every level, no insignificant whitespace, UTF-8), a NUL byte, then for each entry of its `files` sorted by path: the path in UTF-8, a NUL byte, the file size in decimal ASCII, a NUL byte, the file's bytes unmodified and a NUL byte. Two evals are *the same case* when their `case_hash` are equal. An eval whose prompt, expectations, checks or fixture bytes changed between two measurements is thereby excluded from the comparison of R12. The recorded `case_hash` does not by itself protect an edit made after the measurement: the attestation of R25 SHALL recompute the `case_hash` of every recorded eval from the working tree and make a mismatch `stale`, so that a fixture edited after the measurement is caught for any selected skill; the same recomputation SHALL compare the list of eval ids, and an eval present in the tree but not recorded, or recorded but absent from the tree, makes the file `stale`, naming the eval. The `content_hash` of spec 0290 R35 is unchanged, and the limitation that a fixture edit alone does not select a skill stays: a skill that is not selected is not checked.
15. **R15 (evidence: a location followed by commentary).** Evidence that begins with a `path:line` token (a path, a colon and a decimal line number, followed by whitespace or the end of the string) SHALL be accepted, with `evidence_match` `path_line`, when the path names a produced file (matched as spec 0290 R13 matches it today), the line number lies within that file's line count, and the `path:line` token itself holds at least `EVIDENCE_MIN_CHARS` non-whitespace characters. Whatever follows the token is commentary: it is not checked and does not count toward the floor. The rule is therefore exactly as strict as today's bare `path:line` reference, whose token has to reach the floor, and only stops refusing a reference for the sake of a trailing remark. A short token (such as `ci.yml:5`) followed by commentary, however long, SHALL be refused, as it is today when bare; a line number beyond the file SHALL be refused; and the other rules SHALL be unchanged.
16. **R16 (evidence: a short whole line).** Evidence of 6 to 11 non-whitespace characters SHALL be accepted, with `evidence_match` `short_line`, when after trimming it equals one whole trimmed line of exactly one produced file, and of no more than one produced file. The transcript SHALL never serve as the source of a short line, because it echoes the prompt and the fixtures. Evidence of fewer than 6 non-whitespace characters SHALL be refused as today. A short line that occurs in two produced files, or only as part of a longer line, SHALL be refused. `EVIDENCE_MIN_CHARS` (12) and the three rules of spec 0290 R49 SHALL be unchanged, and a new setting `EVIDENCE_SHORT_MIN_CHARS` (6) SHALL be declared beside them.
17. **R17 (evidence: one re-ask).** When at least one judge `PASS` of an eval run is refused for unsupported evidence, the runner SHALL make one further judge call for that run, asking only for those expectations, and stating to the judge why each was refused. The answer SHALL be recorded `passed: true` only when it is `PASS` with valid evidence under R15, R16 and spec 0290 R13 and R49; any other answer, a second unsupported `PASS` included, SHALL be recorded `passed: false`. A judge `FAIL` SHALL never be re-asked. At most one re-ask SHALL be made per eval run. An expectation resolved by the re-ask SHALL carry `reasked: true` in its `grading.json` entry, and the run SHALL carry `reasked: true` in `results.json`. The re-ask counts as a judge call against the caps of R22. The per-skill report SHALL print `evidence_reask: <n> of <m>`, with *m* the eval runs that were judged and *n* those that were re-asked, and the line SHALL be printed even when *n* is 0.
18. **R18 (a deterministic absence check).** The closed set of check types of spec 0290 R4 SHALL gain `file_not_contains`, taking `path` (relative to the run's `outputs/` directory, not escaping it) and `pattern` (a regular expression), written and validated like `file_contains`. It SHALL pass when the produced file exists and does not match the pattern. When the file was not produced it SHALL fail with the observed value `file not produced`, because a run that wrote nothing has not shown an absence. A `pattern` that is not a valid regular expression, or an unknown field, SHALL make the evals file invalid under spec 0290 R6, naming the eval and the field.
19. **R19 (the skill linter).** `scripts/check-skill-quality.ts` SHALL gain three warnings, neither of which changes its exit code unless `--strict` is given: (a) an eval expectation worded as an absence (a whole-word, case-insensitive match of `does not`, `do not`, `never`, `no longer`, `none`, `without` or `no` followed by a noun, as the rule's message documents), whose message states the fix: write the absence as a `file_not_contains` check when it concerns a produced file, or quote the lines that enumerate the inspected content; (b) an eval for which no `evals/samples/<id>/` directory exists, whose message names the authoring guard of R20; (c) a file with more than 6 evals that carry expectations, or whose plan maximum (R22(a)) exceeds `MAX_EXECUTOR_RUNS`, whose message says that the judge cap of R21 refuses such a skill and that it must be split or its evals reduced. The nine skills attested on `main` SHALL stay free of errors from these three rules (none has more than 6 evals or more than 48 plan-maximum runs).
20. **R20 (the authoring guard: dry-run against a sample).** `task skill-evals -- <skill> --dry-run [--eval <id>]` SHALL read, per eval, a hand-written sample output under `evals/samples/<id>/` (any files, at the paths the run would produce, plus an optional `transcript.md`), and SHALL: (a) run every deterministic check of the eval on the sample, a script of an `exit_code` check running from the skill directory as in a real run; a sample that fails any check of its own eval SHALL be reported `sample-invalid`, naming the eval and the check, and the command SHALL exit 1; (b) then make one judge call per eval that has expectations, with no executor run, applying R15 to R17, and print PASS or FAIL per expectation (no judge call under `--mock`); a FAIL on a conforming sample SHALL be printed as a defect of the case or of the sample and SHALL NOT change the exit code. An eval with no sample SHALL be skipped with the line `no sample for eval <id>`; when no selected eval has a sample the command SHALL exit 1 with `dry-run: no sample for <skill>`, because nothing was checked. `--eval` SHALL be accepted only with `--dry-run` (otherwise exit 2), and an unknown eval id SHALL exit 2. A dry-run SHALL write no `results.json` and no ledger entry, SHALL NOT count as a measurement, and SHALL write nothing under `evals/` of the skill. `evals/samples/` SHALL stay out of the content hash and out of every shipped output, as `evals/` is under spec 0290 R7. Its judge cost is bounded by R22, and it SHALL print one line `dry-run spend: <usd> (<n> judge calls, measured|assumed)`; that spend is checked against the ticket caps but not persisted, which is accepted as decided.
21. **R21 (cost model and caps).** `settings.ts` SHALL declare, one constant each and with no command-line, environment or file override (a raise is a reviewed diff): `MAX_EXECUTOR_RUNS` `60` (was 20); `JUDGE_MAX_CALLS` `60` (was 20); `MAX_MEASUREMENT_USD` `5`; `MAX_SKILL_USD` `10` (per skill, over the spend since the merge-base, whatever the ticket label); `MAX_TICKET_USD` `25` (per ticket label, across skills); `JUDGE_ASSUMED_USD` `0.03`, the cost assumed for one judge call whose cost is not recorded; `RUN_ASSUMED_USD` `0.10`, the cost assumed for each run of a measurement in which no run reported a cost (R23); `MAX_INVOCATION_USD` `100`, unchanged in value. The documentation SHALL state the unit costs measured on the pilot (about 0.065 USD per eval run and 0.02 per probe run) and the resulting USD per measurement: stage 1 only, typical, worst case with both stages, and worst case with re-asks, as figures to be re-checked against recorded costs. The figures, in USD per measurement with a judge call at 0.03, for one measurement today (one run), stage 1 only, typical (a true pass rate about 0.9), worst case with both stages, and worst case with one re-ask per eval run, are: `github-actions` (6 evals, 8 probes) 0.71, 1.30, about 1.7, 2.60, 3.32; `gitlab-ci` (6 evals, 12 probes) 0.96, 1.60, about 2.1, 3.21, 3.93; `security` (6 evals, 12 probes) 0.80, 1.37, about 1.8, 2.74, 3.46. A skill with 7 or more evals that carry expectations cannot be measured under `JUDGE_MAX_CALLS` and is refused (R22(b)). The number of measurements of a skill that the per-skill cap allows since the merge-base is `floor((MAX_SKILL_USD - MAX_MEASUREMENT_USD) / c) + 1` for a measurement cost *c*, because each new measurement reserves `MAX_MEASUREMENT_USD`: 3 at a typical 2 USD (2 + 5, 4 + 5, then 6 + 5 above 10 refuses the fourth) and 4 at 1.5 USD, the cost of a measurement rejected at stage 1 (4.5 + 5 is below 10). A skill at a true pass rate of 0.65 passes any one measurement with probability about 0.21, so about 0.50 over three and 0.61 over four. This is accepted because the cap, not the hash, is the bound: every edit of `SKILL.md` or of `evals/evals.json` gives a new hash, and the ledger and `measurements on this branch` keep the reroll visible in review; the documentation SHALL state the bound.
22. **R22 (enforcement before any model call).** After the credential check and before the first model call, the runner SHALL refuse, with no model call, exit 1 and status `error`, printing the planned figure, the spent figure and the cap, when: (a) the plan maximum of executor runs of a skill (evals times the sum of `evalRunsPerStage` plus probes times the sum of `probeRunsPerStage`) exceeds `MAX_EXECUTOR_RUNS`; (b) the worst-case judge calls of a skill (the eval runs of the plan maximum that have expectations, times two, plus 25 percent of those runs rounded up, for the re-ask and the retries) exceed `JUDGE_MAX_CALLS`, which refuses every skill with 7 or more evals that carry expectations (7 x 4 x 2 + 7 = 63) with a message that names the limit and the way forward (split the skill's evals or reduce them); (c) for a skill, its recorded spend since the merge-base (the cost of its branch entries, R10, whatever ticket label they carry) plus the worst case of its new measurement exceeds `MAX_SKILL_USD`; (d) for the ticket label, the recorded spend of that label plus the worst cases of all the selected skills' new measurements, summed, exceeds `MAX_TICKET_USD`; checks (c) are made per skill first and then (d) once for the invocation. The *worst case of a new measurement* is `MAX_MEASUREMENT_USD`. A resumable file (R8(a)) whose plan has no remaining slot SHALL be finalised without any model call and SHALL NOT be refused, whatever its recorded cost; this takes precedence over the next rule. A measurement being resumed (R8(a)) with open slots SHALL be refused, with exit 1, no model call and a message that the measurement is at its cap, when its recorded cost (executor and judge) has reached `MAX_MEASUREMENT_USD`; otherwise its worst case is `MAX_MEASUREMENT_USD` minus its recorded cost, which is then above zero, and it enters (c) and (d) like a new one.  The *recorded spend of a ticket label* SHALL be summed over every `artifacts/*/skills/*/evals/results.json` of the working tree, the current measurement and each `ledger` entry that carries the label, with the cost of executor and judge, counting a run whose cost is unknown at `PER_RUN_USD` and a judge call whose cost is not recorded at `JUDGE_ASSUMED_USD`; the same counting applies at runtime to a measurement in which some runs reported a cost and others did not, so five runs of unknown cost among reported ones reach the cap of a measurement, which is intended; whether no run of a measurement reported a cost (R23, `RUN_ASSUMED_USD`) is decided over the runs recorded so far. A dry-run SHALL be checked against (c) and (d) with its own worst case (one re-asked judge call per eval with a sample) added. The aggregate bound `MAX_INVOCATION_USD` SHALL be checked against the sum over the selected skills of the minimum of two figures, the plan-maximum runs times `PER_RUN_USD` and `MAX_MEASUREMENT_USD` plus `EXECUTOR_CONCURRENCY` times `PER_RUN_USD`, the concurrency term being added once per skill (9 USD per skill with the values of R21). At runtime, when the measured cost of the measurement (executor and judge) reaches `MAX_MEASUREMENT_USD` the runner SHALL start no new run, SHALL end the skill with status `error` and a non-zero exit and SHALL keep the file `in-progress`. The `--ticket` value (else the number in the branch name) is a label for (d) and for the same-ticket guard of R8(c); the per-skill cap of (c) and the refusal of R8(f) do not depend on it, so a new label resets neither. The label is recorded in the file and in every ledger entry; with none the run exits 3 as today.
23. **R23 (the judge cost is recorded).** The runner SHALL read the cost of every judge call from the judge's result record when the driver reports one, and SHALL record `judge_cost_usd` as the measured sum for the skill, `null` when no call reported a cost. When it is `null` the caps and the report SHALL count each judge call at `JUDGE_ASSUMED_USD`, and the report SHALL say that the figure is assumed. When no run of a measurement reported a cost (the driver reports none), every run of it SHALL count at `RUN_ASSUMED_USD` and carry `cost_assumed: true`, so that the runner stays usable and the report says the figure is assumed; a single run without a cost among others that reported one counts at `PER_RUN_USD` as R22 states. The implementation SHALL verify `JUDGE_ASSUMED_USD` against recorded judge costs and SHALL either confirm it in the documentation or change the constant in the same diff; when the driver reports no cost, the documentation SHALL say that the figure is an assumption and where to re-check it.
24. **R24 (the report).** The per-skill report line of spec 0290 R22 as modified by delta-04 SHALL replace its `threshold`, `base` and `diff` figures with the figures of this spec: the status; the eval rate with `passes/runs` and the stage reached; the probe rate with `passes/runs` (`n/a` without probes); the base figure (`passes/runs`, `n/a` when not compared, and `legacy` when the base is of schema 1) with the drop and the p-value; `skill_loaded`; `executor_runs`, `judge_calls`, `cost_usd` and `judge_cost_usd`; followed by `measurements on this branch: <n>` (R10), `evidence_reask: <n> of <m>` (R17), and the `evidence_window` line of spec 0290 R50. The report SHALL also list, as a diagnostic that affects no status, the evals whose pass fraction fell by 0.5 or more against the base on the common evals.
25. **R25 (the attestation check and the pre-push check).** `task ci:skill-evals-attestation` and the pre-push task that mirrors it SHALL keep their wiring and SHALL stay free of any model call and credential (spec 0290 R39). For every selected skill (spec 0290 R34, unchanged) the check SHALL decide one status: `no-evals` and `invalid` as today; `invalid` also for a results file that fails the verification of R11 or the ledger rule of R10 (a head that drops an entry of the merge-base set or of a revision committed in the range, or records less spend); `stale` when the file is absent, unparseable, a mock, of another skill, of schema 1, `in-progress`, carries a plan that differs from `SAMPLING_PLAN`, records a `content_hash` different from the current one, or records for any eval a `case_hash` different from the one recomputed from the working tree, or an eval list that differs from the tree's (R14), the reason naming the eval; otherwise the status recomputed with `plan.ts` from the recorded runs and the current merge-base file of R13. `invalid` and `stale` SHALL block with no setting to relax them; `fail`, `regression` and `no-evals` SHALL block only under their own setting, as before. The check SHALL print `measurements on this branch: <n>` for each skill it reads, and SHALL print the reason for every non-`pass` status.
26. **R26 (migration of the existing files).** The nine skills that hold a results file of schema 1 on `main` (`architect`, `developer`, `doc-writer`, `pr-logbook`, `pr-reviewer`, `spec-author`, `tester`, `github-actions`, `gitlab-ci`) SHALL stay valid until their hashed content changes: a schema-1 file for a skill that is not selected is not read by the check; for a selected skill it is `stale` with the reason `schema 1: re-measure under the sampling plan`. Neither this spec nor its implementation SHALL rewrite a schema-1 file, make a paid run to refresh one, or change a hashed path of any skill, so the implementation stales no skill. A schema-1 file serves as a legacy base under R13.
27. **R27 (layout).** A graded eval run SHALL write to `<out>/<skill>/eval-<id>/run-<r>/` and a probe run to `<out>/<skill>/probe-<n>/run-<r>/`, with `r` the 1-based run number of the slot and the files that spec 0290 R10 as modified by delta-04 names, unchanged within each directory. A resumed measurement SHALL NOT overwrite the directory of a recorded run. The per-run `metrics.json` SHALL keep `skill_loaded` and the measured cost.
28. **R28 (documentation).** The implementation SHALL update `docs/skill-evals.md` (the Cost, Settings, Budget, Statuses, Regression, Attestation and judge sections, and the dry-run) and `docs/skill-authoring-standard.md` (the evals guidance, and the migration procedure: a step 1b that runs the dry-run of R20 so that every expectation passes on a conforming sample before any baseline is paid, and the steps that replace the single paired measurement and the 0.05 tolerance with the plan and the test of R12). The documentation SHALL state the plan and its reasons, that against a legacy base the absolute bar is the only gate in practice (R12), that a skill is limited to 6 evals that carry expectations and 60 plan-maximum runs, that a driver that reports no cost is assumed at `RUN_ASSUMED_USD` per run, the reroll bound of R21, the operating characteristics (the probability that a skill at a given true pass rate passes, and the expected number of runs), the indifference zone between 0.70 and 0.85, the limit of the statistic (power is honest, not high, and the absolute threshold carries the floor), the evidence rules, the cost model, the ledger and the trust model unchanged. The wave specs' wording of the "four paid measurements" stays with its own tickets (R32).
29. **R29 (the ADR).** The implementation SHALL add `docs/adr/0024-skill-evals-sampling-gate.md`, written by the `doc-writer` agent from the architect's design, recording the decision, the alternatives rejected (fixed k with a pooled threshold, expectation-level units, majority of judge samples, seeded sampling) with their reasons, the operating characteristics, and that the contract change is reversible.
30. **R30 (tests).** The implementation SHALL add or rewrite suites under `scripts/tests/skill-evals-*.test.ts` that run offline, with no key, no network and no model, deterministic through an injectable executor and judge, covering: the boundaries of R2 on both sides (9 of 10 and 8 of 10, 11 of 12, 7 of 12 and 8 of 12, 18 of 24 and 17 of 24, 7 of 8 and 8 of 8 probes); R3 and R12 including the Fisher figures of the scenarios, a legacy base and an old-format base file; the schema and the order of keys of R6; R5 (the file exists as `in-progress` before the first call of the injected executor); R8 (resume runs only missing slots, complete refuses with exit 1, another ticket refuses, a new hash moves the old file to the ledger, a differing plan restarts); R9; R10 including the first-measurement rule; R11 (each inconsistency is `invalid`); R15 to R17; R18; R19; R20 (sample-invalid exits 1, no sample exits 1, no file written); R22 (every refusal prints spent, worst case and cap and exits 1 before any call, and the runtime cap keeps the file `in-progress`); R23; and R25 (the attestation recomputes against a changed merge-base file, makes a post-measurement fixture edit `stale`, and makes a head that drops a merge-base ledger entry or records less spend `invalid`); R8(f), the per-skill cap that a new ticket label does not reset, the refusal of a resume at its cap the sum of several skills against the ticket cap, finalisation taking precedence over the at-cap refusal, the union of the working-tree, merge-base and every committed revision of the range after a restore or a committed restore (R8(e), R22), and the assumed-cost counting of runs and ledger entries (R6, R10, R23); the exact comparisons of R12 at a drop of exactly 0.10 and at p of exactly 0.10; and R15 (a short token with long commentary refused, a long token accepted). The existing pass-criterion, regression, attestation and budget suites SHALL be rewritten to the new rules, and every other existing suite SHALL pass unchanged. `plan.ts` SHALL be tested directly as a pure module.
31. **R31 (paid runs of the implementation).** The implementation SHALL NOT re-baseline any skill on `main`, and in particular SHALL NOT bulk re-measure `github-actions` or `gitlab-ci`: their schema-1 files stay and serve as legacy bases (R13). Every acceptance test of this spec SHALL run with stubs at zero cost. The implementation MAY make one real measurement of one small skill, chosen in its plan, to verify the cost figures of R21 and R23, within the caps of R21 and the ticket caps of R22, and SHALL report its figures on the logbook; it is not required, and its results file need not be committed. The re-measurement of `security`, `github-actions` and `gitlab-ci` for pull request #1954 is a later step under issue #1941, after a delta of spec 0303 re-binds its R5.
32. **R32 (what this spec supersedes).** This spec SHALL supersede or amend the following requirements, numbered as in `specs/0290-skill-eval-runner.md` and its deltas, and the implementation SHALL change the documentation, the settings, the code and the tests that state them: R4 (the closed set of check types gains `file_not_contains`, R18); R10 as modified by delta-04 (the layout gains `run-<r>/`, R27); R11 and R50 of delta-06 (`evidence_match` gains `short_line`, and an entry may carry `reasked`, R16 and R17); R13 as modified by delta-01, delta-04 and delta-05, and R49 (the evidence of a `path:line` followed by commentary, the short whole line and the single re-ask, R15 to R17; the three rules and the 12-character gate otherwise stand); R16 (the entry point gains `--dry-run` and `--eval`, R20); R19 as modified by delta-01 and delta-04 (the regression metric and its tolerance of 0.05 are replaced by R12 and R13); R22 as modified by delta-01, delta-04 and delta-06 (the report, R24, which keeps the `evidence_window` line of delta-06); R23 as modified by delta-01 and delta-04 (the default caps of 20 and 20 and their per-skill planning are replaced by R21 and R22); R28 (the aggregate formula, R22); R29 (the executor-run cap, now 60, and the runtime cost cap of a measurement are reserved before each run starts, so concurrent runs cannot exceed either; the pool bound is unchanged, R22); R34 as modified by delta-04 (its sentence "a selected skill is planned under R23, one executor run per eval and per probe" is replaced by the plan maximum and stage path of R1, R2 and R22; selection by content hash is unchanged); R30 (the judge cost is recorded and the results file records it, R23); R36 as modified by delta-04 (the results file, R5 to R7); R37 as modified by delta-04 (the attestation, R25); R45 (a probe runs once or twice, R2); R46 as modified by delta-04 (the pass criterion, `pass-threshold` and its 0.8 are replaced by R2 and R3); and the `tolerance` of R19, R36 and R37. R20, R21, R27, R35, R38 and R39 of spec 0290 stand unchanged. This spec also amends spec 0293 R14 (its migration procedure keeps the pass rate that "does not fall below the baseline by more than the tolerance"; that clause becomes the test of R12) and its R7 guidance (the number of evals is advised against the caps of R21 and R22, at most 6) and its R17 (the three warnings of R19), and changes `docs/skill-authoring-standard.md`, where step 2 ("record the spread") becomes the plan and a step 1b is added (R28). Spec 0303 R5 is not amended here.
33. **R33 (interplay with the wave and the rollout).** Pull request #1954 is blocked by this issue until the implementation has landed; this spec changes how R5 of spec 0303 is verified, and the re-binding of that requirement (the plan and the caps instead of "four paid measurements" and the tolerance of 0.05, and the wording of evals 1 and 5 of `security` if the dry-run confirms the defects) belongs to a later delta of spec 0303 on issue #1941, not to this spec. The implementation SHALL be one standard-tier pull request. If its non-test diff exceeds about 1500 lines, the plan MAY split it into two pull requests under this spec, the gate (R1 to R14, R21 to R27) first and the evidence rule and the authoring guard (R15 to R20) second, both landing before #1954 is re-measured. The implementation adds nothing under `artifacts/`, so it needs no build, no version bump and no CLI-matrix row. *Size and tier (AUTO-mode decisions, overturnable).* The tier `standard` comes from the text of issue #1958 ("Standard tier, architect-led design, through the full lifecycle") and from the architect's design ("one standard-tier PR with no sub-spec"). This spec exceeds the 40,960-byte threshold of `docs/spec-format.md` (*Splitting an oversized spec*), and the author, running in AUTO mode, decided to waive the split: it is one normative design (the plan, the file schema, the evidence rule, the budget and the attestation refer to each other in most requirements), and a split into sub-specs would add cross-references between ids; the implementation splits instead in commits, in the order of the design: `plan.ts` and its tests; schema 2, the legacy reader and the attestation; the staged runner, the budget and the ledger; the evidence rules and `file_not_contains`; the dry-run and the linter warnings; the documentation and the ADR. The waiver is a decision of the contributor, not of the owner, and the owner MAY overturn it, and may require a `large` decomposition (the gate and the evidence rule with the authoring guard are the natural cut), at the spec-PR gate. It SHALL be logged on issue #1958 as a `Decision (AUTO)` entry.

## Scenarios

### Happy path: a good skill passes at stage 1 for evals and continues for probes

- **Given** a skill of 6 evals and 8 probes, and an injected executor and judge under which every eval run passes and 7 of the 8 probes trigger as expected,
- **When** the runner measures it for the first time on a branch,
- **Then** the results file existed as `in-progress` with the plan before the first call, the evals pool is accepted after 12 runs at stage 1 (12 of 12), the probe pool is 7 of 8 (0.875, which continues) and receives stage 2 (8 more runs), the final probe rate is decided at `acceptFinal` over 16 runs, `stage_reached` is `{evals: 1, probes: 2}`, and the status is `pass` or `fail` as that cumulative probe rate is at least 0.75 or not.

### Boundaries of the stage-1 decision

- **Given** 6 evals run twice each (12 runs),
- **When** the eval runs pass 11, 8 and 7 of 12 in three separate measurements,
- **Then** 11 of 12 (0.917) is accepted at stage 1, 8 of 12 (0.667) continues to stage 2, and 7 of 12 (0.583) is rejected with no stage 2 and the status `fail`.
- **Given** 5 evals run twice each (10 runs) with 9 of 10 passing,
- **When** the stage is decided,
- **Then** 0.90 is met exactly and the pool is accepted.

### Stage 2 decides on the cumulative rate

- **Given** a pool that continued at 8 of 12 and then passed 10 of 12 more (18 of 24),
- **When** the final decision is computed,
- **Then** the cumulative rate 0.75 is accepted; with 17 of 24 it is rejected, and with a rejected pool the status is `fail`.

### The probe pool is decided apart from the evals

- **Given** 8 probes with 8 of 8 on stage 1 and evals at 8 of 12,
- **When** the measurement proceeds,
- **Then** the probes are accepted at stage 1, the evals alone receive stage 2, and `stage_reached` is `{evals: 2, probes: 1}`.
- **Given** a skill with no probe,
- **When** it is measured,
- **Then** there is no probe pool, `probe_pass_rate` and `stage_reached.probes` are `null`, and the status comes from the evals alone.

### Failure path: re-running does not replace a finished measurement

- **Given** a skill whose results file is final (status `pass`, `fail` or `regression`) for the current `content_hash`,
- **When** the runner is invoked again for that skill,
- **Then** it makes no model call, prints `measurement complete for <content_hash>` with the permitted way forward, exits 1, and leaves the file byte-identical.
- **Given** the skill's content is edited so its hash changes,
- **When** the runner measures it again,
- **Then** a new measurement starts, the previous file becomes a ledger entry, and the report prints `measurements on this branch: 2`.

### Resume runs only the missing slots

- **Given** an `in-progress` file for the current hash, the same ticket and an equal plan, holding 7 of the 12 stage-1 eval runs,
- **When** the runner is invoked,
- **Then** it runs only the 5 missing slots, keeps the 7 recorded runs, and decides stage 1 from all 12.
- **Given** the same file under another ticket,
- **When** the runner is invoked,
- **Then** it exits 1 naming both tickets and makes no model call.
- **Given** an `in-progress` file whose plan differs from `SAMPLING_PLAN`,
- **When** the runner is invoked,
- **Then** the file moves to the ledger with the status `abandoned` and a new measurement starts under the current plan.

### Failure path: a stale in-progress file is never attested

- **Given** a branch whose results file is `in-progress` because a measurement was interrupted,
- **When** the attestation check or the pre-push check runs on the selected skill,
- **Then** the status is `stale`, the reason names the interruption, and the check exits non-zero.

### Failure path: the recorded runs and the recorded status disagree

- **Given** a results file whose recorded runs give an eval rate of 6 of 12 (a rejected pool) and whose recorded status is `pass`,
- **When** the attestation check runs,
- **Then** the status is `invalid`, the reason names the status and the recomputed value, and the check exits non-zero with no setting to relax it.
- **Given** a file where one eval holds 3 runs, or holds 4 runs although stage 1 accepted the pool,
- **When** the check runs,
- **Then** the status is `invalid` and the reason names the eval and the prescribed count.

### An infrastructure error is not a sample

- **Given** an injected executor that fails the same slot twice,
- **When** the runner measures the skill,
- **Then** the first failure is recorded in `errors` and the slot retried, the second ends the skill with status `error` and a non-zero exit, no rate counts the failed slot, and the file stays `in-progress`.
- **Given** a run that ends at the turn limit with partial output,
- **When** it is graded,
- **Then** it is recorded as a sample like any other run.

### The regression test and its boundaries

- **Given** a base of 24 passes over 24 runs on the common evals,
- **When** the head (at stage 2, 24 runs) has 20 of 24, 21 of 24, 18 of 24 and 15 of 24 in four measurements,
- **Then** 20 of 24 has a drop of 0.167 and p = 10626/194580 = 0.055, which is below 0.10, so the status is `regression`; 21 of 24 has a drop of 0.125 and p = 2024/17296 = 0.117, so the status is `pass`; 18 of 24 meets the absolute bar exactly and is a `regression` with p = 134596/12271512 = 0.011; 15 of 24 (0.625) is rejected by the absolute bar, the status is `fail` and the test is not evaluated.
- **Given** a head whose drop is exactly 0.10 and whose p is exactly 0.10,
- **When** the test is evaluated with exact integer arithmetic,
- **Then** the drop condition holds and the p condition does not (p must be strictly below 0.10), so the status is not `regression`.
- **Given** a head whose drop is 0.083 against any base,
- **When** the test is evaluated,
- **Then** the drop is under `minDrop` and the status is not `regression`, whatever p is.

### A legacy base reads as a smaller base

- **Given** `main` holds a schema-1 file for `github-actions` with `evals_passed` 6 and `evals_total` 6, and the head measures 20 of 24,
- **When** the regression is evaluated,
- **Then** the base is 6 of 6 marked `legacy`, the drop is 0.167, p = 10626/27405 = 0.388 (all 4 failures falling in the 24 head runs of 30), so the status is `pass`, and the base file is neither rewritten nor re-measured.
- **Given** the same legacy base 6 of 6 and a head of 17 of 24,
- **When** the pools are decided,
- **Then** the pool is rejected by the absolute bar and the status is `fail`, because against a legacy base the absolute bar acts first.
- **Given** the merge-base holds no results file, an unparseable one, or an `in-progress` one,
- **When** the regression is evaluated,
- **Then** `base` is `null`, the report says `not compared`, and the status comes from the pools alone.

### Failure path: only the evals unchanged on both sides are compared

- **Given** a base schema-2 file of 6 evals, and a head in which eval 3's prompt was edited and eval 5's fixture bytes were changed,
- **When** the regression is evaluated,
- **Then** `common_evals` is 4, the runs of evals 3 and 5 enter neither side, and the comparison is over those four evals.
- **Given** no eval is in common,
- **When** the regression is evaluated,
- **Then** `base` is `null`.

### The attestation recomputes against the current merge-base

- **Given** a branch measured as `pass` against a base of 24 of 24, and then `main` advances with a base file at 12 of 24 for the same skill,
- **When** the attestation check runs after a rebase,
- **Then** it recomputes the regression against the file now at the merge-base, reports the recomputed status, and does not stop for a printed base that differs.

### An eval added or removed after the measurement

- **Given** a results file recording evals 1 to 6, and a tree in which eval 7 was added (or eval 4 removed) after the measurement,
- **When** the attestation check runs on the selected skill,
- **Then** the status is `stale`, the reason names eval 7 (or eval 4), and the check exits non-zero.

### The ledger makes a reroll visible and cannot be reset

- **Given** a skill whose merge-base file records one measurement, then measured on the branch, then re-measured after two content edits,
- **When** the third branch measurement is written,
- **Then** `ledger` holds the merge-base measurement and the two earlier branch measurements, none dropped, and the report prints `measurements on this branch: 3`.
- **Given** a branch with one committed measurement of hash H1 (status `fail`, 1.6 USD), then `git checkout <base> -- evals/results.json` and a content edit giving hash H2,
- **When** the runner starts the measurement of H2,
- **Then** the previous ledger is the union of the working-tree file, the merge-base copy and every committed revision in the range, so the H1 entry enters the ledger, `measurements on this branch` is 2, the per-skill cap counts the 1.6 USD, and a later request to measure H1 again is refused by R8(f).
- **Given** a branch that committed a measured H1, then committed the restore of the base file as its own commit, then edited the skill and starts the measurement of H2,
- **When** the runner starts,
- **Then** `HEAD` no longer holds H1 but the earlier commit does, so the union still contains H1 and the per-skill cap and R8(f) still count it; the attestation in CI reaches the same entry through the history and reports `invalid` if the head file lacks it.
- **Given** a head file whose ledger drops an entry present in the merge-base copy or in a revision committed in the range, or records less spend,
- **When** the attestation check (in CI, in the pre-push check) runs,
- **Then** the status is `invalid` naming the first missing entry.
- **Given** a content hash that has a final entry in the ledger (the content was reverted to an earlier measured state),
- **When** the runner is asked to measure it again, with any `--ticket` value,
- **Then** it refuses with exit 1 and `content already measured: <content_hash>`, and no flag allows it.
- **Given** the same skill measured under a new `--ticket` label after 6 USD recorded since the merge-base,
- **When** the runner plans the new measurement,
- **Then** the per-skill cap refuses it (6 + 5 is above 10): the new label resets only the ticket cap.

### Evidence: a location followed by commentary

- **Given** a produced `.github/workflows/ci.yml` of at least five lines and a judge `PASS` whose evidence is `.github/workflows/ci.yml:5 — the job sets contents: read`,
- **When** the evidence is validated,
- **Then** it is accepted with `evidence_match: path_line`, because the token reaches 12 non-whitespace characters and the line exists.
- **Given** the evidence `ci.yml:1 an unrelated remark of more than twelve characters` on a produced `ci.yml` (a token of 8 characters),
- **When** it is validated,
- **Then** it is refused, as the bare `ci.yml:1` is today, and a token that reaches the floor but names line 99 of a file of five lines is refused too.

### Evidence: a short whole line of one produced file

- **Given** a produced file holding the line `tags: ['v*']` (10 non-whitespace characters) and no other produced file holding it,
- **When** a judge `PASS` quotes `tags: ['v*']`,
- **Then** it is accepted with `evidence_match: short_line`.
- **Given** the same text occurs only in the transcript, or in two produced files, or as part of a longer line, or the quote is `on:` (3 characters),
- **When** it is validated,
- **Then** it is refused.

### One re-ask before a verdict is voided

- **Given** a judge `PASS` for two expectations of one eval run, one with valid evidence and one with a paraphrase,
- **When** the run is graded,
- **Then** one further judge call asks for the paraphrased expectation only, with the reason; a `PASS` with valid evidence records `passed: true` and `reasked: true`, and a second unsupported `PASS` records `passed: false`.
- **Given** a judge `FAIL`,
- **When** the run is graded,
- **Then** no re-ask is made, and `evidence_reask: 0 of <m>` is printed for a skill with no re-ask.

### The deterministic absence check

- **Given** an eval with `{type: "file_not_contains", path: "report.md", pattern: "AKIA[0-9A-Z]{16}"}` and a produced `report.md` that holds no such string,
- **When** the checks run,
- **Then** the check passes.
- **Given** a produced file that matches, or no `report.md` produced,
- **When** the checks run,
- **Then** it fails, with the observed value naming the match or `file not produced`.
- **Given** an eval whose `pattern` is `(unclosed`,
- **When** the file is validated,
- **Then** it is invalid under spec 0290 R6, naming the eval and the field.

### The linter warns on absence and on a missing sample

- **Given** an expectation `The report does not mention the key`,
- **When** `check-skill-quality.ts` runs,
- **Then** it warns with the `file_not_contains` fix and exits as before; with `--strict` the warning is an error.
- **Given** an eval with no `evals/samples/<id>/`,
- **When** it runs,
- **Then** it warns, naming the dry-run.

### The authoring guard

- **Given** `evals/samples/1/` holds a report whose format script of the eval's `exit_code` check exits 0, and the eval has two expectations,
- **When** `task skill-evals -- <skill> --dry-run --eval 1` runs,
- **Then** one judge call is made, PASS or FAIL is printed per expectation, no executor run is made, no `results.json` or ledger entry is written, and the exit code is 0 even when an expectation FAILs.
- **Given** a sample that fails its own `exit_code` check,
- **When** the dry-run runs,
- **Then** it reports `sample-invalid` naming the eval and the check and exits 1.
- **Given** no eval has a sample, or `--eval 99` names no eval, or `--eval` is given without `--dry-run`,
- **When** the command runs,
- **Then** the exits are 1 with `dry-run: no sample for <skill>`, 2, and 2.

### Failure path: the budget refuses before any model call

- **Given** a ticket whose recorded spend (current measurements and ledger entries) is 21 USD and a skill whose new measurement has a worst case of 5 USD,
- **When** the runner is invoked,
- **Then** it makes no model call, prints the spent (21), the worst case (5) and the cap (25), exits 1 with status `error`.
- **Given** a skill that already holds 6 USD since the merge-base,
- **When** a new measurement of it is planned,
- **Then** it is refused against `MAX_SKILL_USD` (6 + 5 is above 10).
- **Given** a skill of 7 evals that all carry expectations,
- **When** the judge worst case is computed,
- **Then** 7 x 4 x 2 plus 7 is 63, which exceeds 60, and the run is refused before any call.
- **Given** a skill of 6 evals and 12 probes,
- **When** the plan maximum is computed,
- **Then** 6 x 4 + 12 x 2 is 48, which fits 60.
- **Given** the three wave skills are selected in one invocation under a ticket whose recorded spend is 12 USD,
- **When** the bounds are computed,
- **Then** the aggregate bound is 9 per skill (the smaller of 48 and 5 + 4 x 1) and not refused, each skill passes the per-skill cap, and the ticket cap is checked once over 12 + 3 x 5 = 27, which exceeds 25, so the invocation is refused naming the spent, the summed worst case and the cap.
- **Given** a skill of 7 evals that all carry expectations,
- **When** `check-skill-quality.ts` runs,
- **Then** it warns that the skill exceeds the 6-eval limit, before any run is attempted.

### Runtime cap and resume of a capped measurement

- **Given** a measurement whose measured executor and judge cost reaches 5 USD after 30 runs,
- **When** the next slot is due,
- **Then** no new run starts, the skill ends with status `error` and a non-zero exit, and the file stays `in-progress`.
- **Given** that file,
- **When** the runner is invoked again,
- **Then** the resume is refused with exit 1, no model call and the message that the measurement is at its cap, whatever the ticket's remaining budget.
- **Given** an `in-progress` file with 3 USD recorded and slots remaining,
- **When** the runner is invoked,
- **Then** the worst case of the resume is 2 USD, it is checked against the per-skill and ticket caps, and the missing slots run.
- **Given** an `in-progress` file in which every slot of the plan is already recorded and whose last run took the recorded cost to 5 USD,
- **When** the runner is invoked,
- **Then** it finalises the status with no model call and does not refuse it as at its cap, because finalisation takes precedence.

### The judge cost is recorded or assumed

- **Given** a judge driver that reports a cost per call,
- **When** the skill is measured,
- **Then** `judge_cost_usd` is the measured sum.
- **Given** a driver that reports none,
- **When** the skill is measured,
- **Then** `judge_cost_usd` is `null`, the caps count each call at 0.03 USD, and the report says the figure is assumed.

### The assumed-cost path

- **Given** a driver that reports no cost for any run of a measurement of 24 eval runs and 8 probe runs,
- **When** the skill is measured,
- **Then** every run record carries `cost_usd: null` and `cost_assumed: true`, each run counts at 0.10 USD for the caps, the measurement is not refused as at its cap before it finishes (3.2 USD), and the report says the figure is assumed.
- **Given** one run among the others that reported a cost, with none of its own,
- **When** the caps are evaluated,
- **Then** that run counts at 1 USD and carries no `cost_assumed` key.
- **Given** a ledger entry with `cost_usd: null`, `cost_assumed: true` and 32 executor runs, and another with `cost_usd: null`, no assumption and 10 runs (a hand-edited or damaged entry, since the runner never writes one; the counting is deliberately conservative),
- **When** the spend of the skill is summed,
- **Then** the first counts 3.2 USD and the second 10 USD, and a `judge_cost_usd` of `null` counts `judge_calls` times 0.03.

### The implementation stales no skill

- **Given** the implementation branch, which changes no hashed file of any skill,
- **When** `task skill-evals -- --changed` and the attestation check run against `main`,
- **Then** no skill is selected, the schema-1 files of the nine skills are not read, and the check exits 0.

## Out of scope

- Flipping `FAIL_BLOCKING`, `REGRESSION_BLOCKING` or `MISSING_EVALS_BLOCKING`.
- Proving that a results file is genuine, or preventing tampering with the runs or the ledger (spec 0290 R38 is unchanged); an append-only check of the ledger across commits, which a rebase or a squash would defeat.
- Measuring on any CLI other than Claude Code, and any model call in CI (spec 0290 R39).
- Rewriting or re-measuring any schema-1 results file, and re-baselining `github-actions` or `gitlab-ci` on `main`.
- The re-measurement of `security`, `github-actions` and `gitlab-ci` for pull request #1954, and the delta of spec 0303 that re-binds its R5 and the wording of the `security` evals 1 and 5: both belong to issue #1941.
- A statistical power of 80 percent for a 0.10 drop, which needs about 113 runs per side; the absolute threshold carries the floor and the regression test catches large drops.
- A per-expectation decision unit, a majority of judge samples, a fixed number of runs, and seeded sampling (rejected alternatives, recorded in the ADR).
- Fixture files in `content_hash`; the recomputed `case_hash` of R25 covers a selected skill and does not select a skill whose fixture alone changed.
- A persisted account of dry-run spend, which is printed and checked but not recorded (accepted as decided).
- An override of any cap from the command line, the environment or a file.

## Open questions

- Decided (AUTO): dry-run spend is checked against the ticket caps at start but not persisted; repeated dry-runs can therefore exceed the ticket cap. Accepted: a dry-run costs only judge calls (about 0.2 to 0.4 USD), is not a measurement, and never writes a `results.json`.
- Decided (AUTO): the 0.70 to 0.85 indifference zone, the 5 USD cap per measurement and the absence of a paid re-baseline are the design's values; the owner can overturn them in the spec-PR review or in a later delta.
- Decided (AUTO): if the judge driver cannot report a per-call cost, R23's fallback (`JUDGE_ASSUMED_USD` per call) holds and the measurement records that the figure is assumed.
