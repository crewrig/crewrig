---
id: "0304"
slug: skill-evals-sampling-gate
status: approved
complexity: standard
interaction-mode: AUTO
related-issue: 1958
version: 1.1.0
---

# Make the skill-evals gate statistically sound: a pre-declared sampling plan, a regression test and an honest evidence rule

*Delta 01 of `specs/0304-skill-evals-sampling-gate.md`. Source: the seat review of the implementation pull request (#1960), findings i1-F1 and i1-F5. Requirements modified: R3 (a `fail` is final only when no pool is pending), R10 (a residual risk is stated), R21 (the per-skill unit costs and the one-run column), R8(a) (refusal to resume on an edited case), R22 (runs in flight at the runtime cap), and the parent Intent ("on one branch"). Three scenarios are added. Every other requirement is unchanged. This delta opens no question.*

## ADDED

### A rejected pool does not finalise the file while the other pool is pending

- **Given** a skill whose two evals fail every run, so the evals pool is rejected at stage 1, and whose probe executor fails twice on the same slot (R9), so the probe pool has no recorded run,
- **When** the runner stops (after the rejection, after the second failure, or on an interrupt between the last eval run and the last probe run),
- **Then** `evals/results.json` is `in-progress`, never `fail`; the verifier reports it valid (not the invalid status "`fail` while the probe pool has not run its first stage"); a second invocation resumes the missing probe slots (R8(a)) instead of refusing with "measurement complete"; and the ledger holds no final entry for the hash.
- **Given** the same measurement resumed until the probe pool is decided (accepted, rejected or, after stage 2, decided on the cumulative rate),
- **When** the last slot of the last pending pool is graded,
- **Then** the status becomes `fail` (the evals pool is rejected), the ledger entry is final (R8(f)), and the verifier reports it valid.

### A resume refuses an edited case

- **Given** an `in-progress` file for the current hash, the same ticket and an equal plan, whose recorded `case_hash` of eval 3 no longer matches the case in the working tree (a fixture or the case was edited between the interruption and the resume, which leaves `content_hash` unchanged),
- **When** the runner is invoked,
- **Then** it exits 1 with a message naming eval 3, makes no model call, leaves `evals/results.json` byte-identical, and the message names the two ways out: restore the case, or change the skill content (a new hash, so a new measurement).
- **Given** the same file with the recorded case hashes matching the tree and the same eval list,
- **When** the runner is invoked,
- **Then** it resumes as in "Resume runs only the missing slots".

### Runs in flight at the runtime cap finish and are counted

- **Given** an `EXECUTOR_CONCURRENCY` of 4, a measurement whose recorded cost reaches `MAX_MEASUREMENT_USD` when the first of four concurrent runs completes, and three runs still in flight,
- **When** the cap is reached,
- **Then** the three in-flight runs finish and are recorded and counted, no further run starts, the skill ends with status `error` and a non-zero exit, the file stays `in-progress`, and the recorded spend may exceed `MAX_MEASUREMENT_USD` by at most the cost of those runs, each bounded by its per-run limit.
- **Given** a budget that the preflight refuses (R22(a) to (d)),
- **When** the runner is invoked,
- **Then** it refuses before any model call, as before: the in-flight rule applies only to runs already started.

## MODIFIED

<!-- markdownlint-disable MD029 -->

1. **R3 (skill status), original:** "The status of a measured skill SHALL be `fail` when either pool is rejected; otherwise `regression` when the test of R12 holds; otherwise `pass`. A measurement that has not finished has the status `in-progress` (R5), which is never `pass`."

**Amended (R3, the first two sentences):** A pool is *pending* while a run of its current stage is missing or the stage that decides it has not run, and a measurement is *finished* only when no pool is pending, that is, every pool is decided (accepted, or rejected after the stage that decides it). A stop that leaves a pool pending keeps the file `in-progress`: the second failure of a slot (R9) and the runtime cap of R22 are such stops, and neither finalises the file. While any pool is pending, whatever the other pool decided, the status SHALL be `in-progress` and the file SHALL stay resumable (R8(a)). Once no pool is pending the status SHALL be `fail` when either pool is rejected; otherwise `regression` when the test of R12 holds; otherwise `pass`. `in-progress` is never `pass` and never `fail`. R9 is unchanged: an executor or judge error that ends the skill with status `error` keeps the file `in-progress`, and the verifier and the runner SHALL read one decision from `plan.ts` (R4).

2. **R10 (the ledger), residual risk, appended after the existing residual-risk sentence:** Residual risk, stated and not removed (a documented limit of the trust model, spec 0290 R38, not a defect): the per-skill cap, `measurements on this branch` and the refusal of R8(f) read only the working-tree file and the history of `<merge-base>..HEAD`. A parallel branch, or a fresh clone, cut from the same base therefore does not see the measurements made elsewhere, and can re-measure the same content once per branch. The bound is per branch, `MAX_SKILL_USD`, and the reroll stays visible in review through the ledger of each branch. The documentation SHALL state this limit where it describes the ledger and the anti-gaming rules, and SHALL NOT claim that a re-run cannot shop for a pass across branches.

3. **R21 (cost model and caps), the unit-cost sentence and the first column, original:** "The documentation SHALL state the unit costs measured on the pilot (about 0.065 USD per eval run and 0.02 per probe run) ..." and the row "`github-actions` (6 evals, 8 probes) 0.71, 1.30, about 1.7, 2.60, 3.32", the row "`gitlab-ci` (6 evals, 12 probes) 0.96, 1.60, about 2.1, 3.21, 3.93".

**Amended (R21):** the documentation SHALL state the per-skill unit costs measured on the pilot, per run and before the judge: `github-actions` 0.065 USD per eval run and 0.021 per probe run; `gitlab-ci` 0.081 and 0.023; `security` 0.065 and 0.019. "About 0.065 and 0.02" is the generic pilot figure and is not the figure that reproduces every row. Every row of the table derives from the per-skill costs with a judge call at 0.03 (judge calls on eval runs only): stage 1 is 6 evals x 2 runs x eval cost + probes x 1 run x probe cost + 12 judge calls; for `gitlab-ci` 0.972 + 0.276 + 0.36 = 1.61, for `security` 0.78 + 0.228 + 0.36 = 1.37, for `github-actions` 0.78 + 0.168 + 0.36 = 1.31; the worst case with both stages doubles stage 1, and one re-ask per eval run adds 0.72. The stage-1, worst-case and re-ask figures of the three rows are unchanged (each reproduces within two cents, the `gitlab-ci` and `security` rows within a cent), and so are the typical figures. Only the first column (one measurement of one run: 6 evals x 1 run x eval cost + probes x 1 run x probe cost + 6 judge calls) changes where it did not reproduce: `github-actions` 0.74 (was 0.71) and `gitlab-ci` 0.94 (was 0.96); `security` stays 0.80. The rows read: `github-actions` 0.74, 1.30, about 1.7, 2.60, 3.32; `gitlab-ci` 0.94, 1.60, about 2.1, 3.21, 3.93; `security` 0.80, 1.37, about 1.8, 2.74, 3.46. All figures remain to be re-checked against recorded costs.

4. **Intent (parent), second sentence of the first paragraph, original:** "... and that re-running cannot shop for."

**Amended (Intent):** "... and that re-running on one branch cannot shop for." Across branches and fresh clones the residual risk of R10 applies.

5. **R8(a), original:** "(a) the same `content_hash`, status `in-progress`, a plan equal to `SAMPLING_PLAN` and the same ticket: the measurement is *resumed*, the recorded runs count, only the missing slots of the stage the recorded runs reach are run, and the stage decisions are recomputed by `plan.ts`;"

**Amended (R8(a)):** the resume additionally requires that every recorded `case_hash` and the recorded eval list match the working tree. A resume for which they do not match (a fixture or a case edited between the interruption and the resume, which leaves `content_hash` unchanged and would leave the finished file permanently `stale` under R14 and, being final for its hash, unmeasurable under R8(b)) SHALL be refused: exit 1 with a message naming the eval, no model call, `evals/results.json` untouched. The message SHALL name the way out: restore the case, or change the skill content, which gives a new hash and a new measurement. The refusal is checked after the ticket and plan conditions of (a) and before any slot runs.

6. **R22 (runtime cap), the runtime sentence, original:** "At runtime, when the measured cost of the measurement (executor and judge) reaches `MAX_MEASUREMENT_USD` the runner SHALL start no new run, SHALL end the skill with status `error` and a non-zero exit and SHALL keep the file `in-progress`."

**Amended (R22):** at runtime, when the recorded cost of the measurement (executor and judge) reaches `MAX_MEASUREMENT_USD`, the runner SHALL start no new run; runs already in flight SHALL finish and SHALL be recorded and counted (a paid run is never discarded); then the runner SHALL end the skill with status `error` and a non-zero exit and SHALL keep the file `in-progress`. Hence the recorded spend of a measurement, and so the spend of a skill against `MAX_SKILL_USD`, can exceed the cap by at most `EXECUTOR_CONCURRENCY` runs, each bounded by its per-run limit; the aggregate bound of R22 already carries that term. The preflight refusals (a) to (d) are unchanged and still happen before any model call.

## REMOVED

Nothing is removed as a requirement. Removed from the original text and replaced under MODIFIED: the generic unit-cost sentence of R21, the one-run figures 0.71 and 0.96, the unqualified "cannot shop for" of the Intent, the first two sentences of R3, the unconditional resume of R8(a) and the runtime sentence of R22.

### Out of scope

Added to the Out of scope list of the parent spec:

- Any change to the thresholds, the stage sizes or the caps of R21, and any change to its stage-1, worst-case and re-ask figures.
- Closing the parallel-branch and fresh-clone residual risk of R10 with a shared ledger or any network service.
