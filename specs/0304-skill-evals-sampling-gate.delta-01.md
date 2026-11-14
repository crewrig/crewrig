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

*Delta 01 of `specs/0304-skill-evals-sampling-gate.md`. Source: the seat review of the implementation pull request (#1960), findings i1-F1 and i1-F5. Requirements modified: R3 (a `fail` is final only when no pool is pending), R10 (a residual risk is stated), R21 (the per-skill unit costs and the one-run column), and the parent Intent ("on one branch"). One scenario is added. Every other requirement is unchanged. This delta opens no question.*

## ADDED

### A rejected pool does not finalise the file while the other pool is pending

- **Given** a skill whose two evals fail every run, so the evals pool is rejected at stage 1, and whose probe executor fails twice on the same slot (R9), so the probe pool has no recorded run,
- **When** the runner stops (after the rejection, after the second failure, or on an interrupt between the last eval run and the last probe run),
- **Then** `evals/results.json` is `in-progress`, never `fail`; the verifier reports it valid (not the invalid status "`fail` while the probe pool has not run its first stage"); a second invocation resumes the missing probe slots (R8(a)) instead of refusing with "measurement complete"; and the ledger holds no final entry for the hash.
- **Given** the same measurement resumed until the probe pool is decided (accepted, rejected or, after stage 2, decided on the cumulative rate),
- **When** the last slot of the last pending pool is graded,
- **Then** the status becomes `fail` (the evals pool is rejected), the ledger entry is final (R8(f)), and the verifier reports it valid.

## MODIFIED

<!-- markdownlint-disable MD029 -->

1. **R3 (skill status), original:** "The status of a measured skill SHALL be `fail` when either pool is rejected; otherwise `regression` when the test of R12 holds; otherwise `pass`. A measurement that has not finished has the status `in-progress` (R5), which is never `pass`."

**Amended (R3, the first two sentences):** A pool is *pending* while a run of its current stage is missing or the stage that decides it has not run, and a measurement is *finished* only when no pool is pending, that is, every pool is decided (accepted, or rejected after the stage that decides it). A stop that leaves a pool pending keeps the file `in-progress`: the second failure of a slot (R9) and the runtime cap of R22 are such stops, and neither finalises the file. While any pool is pending, whatever the other pool decided, the status SHALL be `in-progress` and the file SHALL stay resumable (R8(a)). Once no pool is pending the status SHALL be `fail` when either pool is rejected; otherwise `regression` when the test of R12 holds; otherwise `pass`. `in-progress` is never `pass` and never `fail`. R9 is unchanged: an executor or judge error that ends the skill with status `error` keeps the file `in-progress`, and the verifier and the runner SHALL read one decision from `plan.ts` (R4).

2. **R10 (the ledger), residual risk, appended after the existing residual-risk sentence:** Residual risk, stated and not removed (a documented limit of the trust model, spec 0290 R38, not a defect): the per-skill cap, `measurements on this branch` and the refusal of R8(f) read only the working-tree file and the history of `<merge-base>..HEAD`. A parallel branch, or a fresh clone, cut from the same base therefore does not see the measurements made elsewhere, and can re-measure the same content once per branch. The bound is per branch, `MAX_SKILL_USD`, and the reroll stays visible in review through the ledger of each branch. The documentation SHALL state this limit where it describes the ledger and the anti-gaming rules, and SHALL NOT claim that a re-run cannot shop for a pass across branches.

3. **R21 (cost model and caps), the unit-cost sentence and the first column, original:** "The documentation SHALL state the unit costs measured on the pilot (about 0.065 USD per eval run and 0.02 per probe run) ..." and the row "`github-actions` (6 evals, 8 probes) 0.71, 1.30, about 1.7, 2.60, 3.32", the row "`gitlab-ci` (6 evals, 12 probes) 0.96, 1.60, about 2.1, 3.21, 3.93".

**Amended (R21):** the documentation SHALL state the per-skill unit costs measured on the pilot, per run and before the judge: `github-actions` 0.065 USD per eval run and 0.021 per probe run; `gitlab-ci` 0.081 and 0.023; `security` 0.065 and 0.019. "About 0.065 and 0.02" is the generic pilot figure and is not the figure that reproduces every row. Every row of the table derives from the per-skill costs with a judge call at 0.03 (judge calls on eval runs only): stage 1 is 6 evals x 2 runs x eval cost + probes x 1 run x probe cost + 12 judge calls; for `gitlab-ci` 0.972 + 0.276 + 0.36 = 1.61, for `security` 0.78 + 0.228 + 0.36 = 1.37, for `github-actions` 0.78 + 0.168 + 0.36 = 1.31; the worst case with both stages doubles stage 1, and one re-ask per eval run adds 0.72. The stage-1, worst-case and re-ask figures of the three rows are unchanged (each reproduces within two cents, the `gitlab-ci` and `security` rows within a cent), and so are the typical figures. Only the first column (one measurement of one run: 6 evals x 1 run x eval cost + probes x 1 run x probe cost + 6 judge calls) changes where it did not reproduce: `github-actions` 0.74 (was 0.71) and `gitlab-ci` 0.94 (was 0.96); `security` stays 0.80. The rows read: `github-actions` 0.74, 1.30, about 1.7, 2.60, 3.32; `gitlab-ci` 0.94, 1.60, about 2.1, 3.21, 3.93; `security` 0.80, 1.37, about 1.8, 2.74, 3.46. All figures remain to be re-checked against recorded costs.

4. **Intent (parent), second sentence of the first paragraph, original:** "... and that re-running cannot shop for."

**Amended (Intent):** "... and that re-running on one branch cannot shop for." Across branches and fresh clones the residual risk of R10 applies.

## REMOVED

Nothing is removed as a requirement. Removed from the original text and replaced under MODIFIED: the generic unit-cost sentence of R21, the one-run figures 0.71 and 0.96, the unqualified "cannot shop for" of the Intent, and the first two sentences of R3.

### Out of scope

Added to the Out of scope list of the parent spec:

- Any change to the thresholds, the stage sizes or the caps of R21, and any change to its stage-1, worst-case and re-ask figures.
- Closing the parallel-branch and fresh-clone residual risk of R10 with a shared ledger or any network service.
