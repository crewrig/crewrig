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

*Delta 01 of `specs/0304-skill-evals-sampling-gate.md`. Source: the seat review of the implementation pull request (#1960), findings i1-F1 and i1-F5. Requirements modified: R3 (a `fail` is final only when no pool is pending), R10 (a residual risk is stated), R21 (the `gitlab-ci` row). One scenario is added. Every other requirement is unchanged. This delta opens no question.*

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

**Amended (R3, the first two sentences):** A measurement is *finished* when every pool is decided (accepted or rejected after the stage that decides it) or its slots are exhausted by a stop that R8 defines as final, and a pool that still has a missing run of its current stage is *pending*. While any pool is pending, whatever the other pool decided, the status SHALL be `in-progress` and the file SHALL stay resumable (R8(a)). Once no pool is pending the status SHALL be `fail` when either pool is rejected; otherwise `regression` when the test of R12 holds; otherwise `pass`. `in-progress` is never `pass` and never `fail`. R9 is unchanged: an executor or judge error that ends the skill with status `error` keeps the file `in-progress`, and the verifier and the runner SHALL read one decision from `plan.ts` (R4).

2. **R10 (the ledger), residual risk, appended after the existing residual-risk sentence:** Residual risk, stated and not removed (a documented limit of the trust model, spec 0290 R38, not a defect): the per-skill cap, `measurements on this branch` and the refusal of R8(f) read only the working-tree file and the history of `<merge-base>..HEAD`. A parallel branch, or a fresh clone, cut from the same base therefore does not see the measurements made elsewhere, and can re-measure the same content once per branch. The bound is per branch, `MAX_SKILL_USD`, and the reroll stays visible in review through the ledger of each branch. The documentation SHALL state this limit where it describes the ledger and the anti-gaming rules, and SHALL NOT claim that a re-run cannot shop for a pass across branches.

3. **R21 (cost model and caps), the `gitlab-ci` row, original:** "`gitlab-ci` (6 evals, 12 probes) 0.96, 1.60, about 2.1, 3.21, 3.93".

**Amended (R21, the `gitlab-ci` row only):** `gitlab-ci` (6 evals, 12 probes) 0.96, 1.38, about 1.8, 2.76, 3.48. The figures follow from the stated unit costs and the plan: stage 1 is 6 evals x 2 runs x 0.065 + 12 probes x 0.02 + 6 evals x 2 runs x 0.03 = 0.78 + 0.24 + 0.36 = 1.38 USD, the worst case with both stages doubles it to 2.76, and one re-ask per eval run adds 12 x 0.03 x 2 = 0.72 for 3.48. The `github-actions` and `security` rows are unchanged: they reproduce from the same formula. The first column (one run) and the typical column are unchanged in kind, kept as figures to be re-checked against recorded costs, and the typical figure of `gitlab-ci` follows its stage-1 figure.

## REMOVED

Nothing is removed as a requirement. Removed from the original text and replaced under MODIFIED: the `gitlab-ci` figures 1.60, about 2.1, 3.21 and 3.93, and the first two sentences of R3.

### Out of scope

Added to the Out of scope list of the parent spec:

- Any change to the thresholds, the stage sizes, the caps or the unit costs of R21: only the `gitlab-ci` row is corrected.
- Closing the parallel-branch and fresh-clone residual risk of R10 with a shared ledger or any network service.
