# ADR-0024: Skill evals sampling gate

<!-- crewrig-doc: section=architecture-adr nav_order=240 published=true title="ADR 0024 — Skill evals sampling gate" -->

## Status

Accepted

## Context

The skill-evals gate of spec 0290 decided each skill from one run of its evals, where one flipped eval moves a six-eval rate by 0.17. The same skill content measured 1.00, 0.83, 0.83 and 0.67 in four runs, so one run could not tell a skill from its luck. A judge pass was voided when its quoted evidence was a short line or an absence, and the tolerance of 0.05 turned any single flip into a regression, so contributors re-ran until a run passed and the paid-run budget went to noise.

## Decision

Each skill is measured under a sampling plan that is declared before its first model call: every eval runs twice per stage and every probe once per stage, and stage 2 runs only for a pool that stage 1 leaves open. A pool is accepted at 0.90 or more after stage 1, rejected below 0.60, and otherwise accepted at 0.75 or more over both stages. A skill is `fail` when a pool is rejected, `regression` when the head eval rate falls by at least 0.10 against the base file at the merge-base and a one-sided Fisher exact test gives p below 0.10 (the absolute bar acts first), and `pass` otherwise. Every run is recorded in a schema-2 results file, an interrupted measurement resumes but is never repeated, identical content is never measured twice, and the spend is capped per run, per measurement, per skill and per ticket. Evidence rules accept a location followed by commentary and a short whole line of one produced file, a judge `PASS` gets one re-ask, and a deterministic `file_not_contains` check covers absences. The sampling plan is one constant, and the decision is one pure module shared by the runner and the attestation check.

## Consequences

- Positive: the verdict depends on the skill rather than on one run; identical content is measured once, and the ledger counts every measurement of a skill; sound quotes are no longer voided; the attestation recomputes the status from the recorded runs and rejects a file that does not follow from them.
- Negative: a measurement costs more, about 1.3 to 2.6 USD for the three wave skills (spec 0304 R21, to be re-checked against recorded costs); a skill is limited to 6 evals that carry expectations; the regression test has low power for small drops (about 113 runs per side for 80 percent power on a 0.10 drop), so the absolute thresholds carry the floor, and against the nine schema-1 bases the absolute bar is the only gate in practice; the ledger grows on `main` by about 250 bytes per measurement.
- Neutral: the trust model is unchanged, so the attestation remains self-declared and a rewritten branch history still removes ledger entries; the content hash, the judge and the pre-push check are unchanged; the nine schema-1 results files stay valid until their content changes and are never rewritten.

## Alternatives rejected

- **Fixed number of runs with a pooled threshold.** It cannot stop early, so a clear pass and a boundary case cost the same. The two-stage plan spends the second stage only on open pools.
- **Expectation-level decision units.** The pass criterion of an eval is that all its checks and expectations pass (spec 0290 R46, unchanged), so the eval is the unit a verdict is about. Rates over expectations would not match it, and the regression comparison pairs evals by `case_hash`.
- **Majority of judge samples.** Spec 0304 lists it only as rejected and gives no reason. The cost is the one the cap model shows: each extra judge sample is one more call against `JUDGE_MAX_CALLS`, and it leaves the executor runs, where the variance is, unsampled.
- **Seeded sampling.** Claude Code 2.1.323 exposes no seed or temperature option: `claude --help` of that version lists none (checked by running the command, with no match for seed, temperature or random), so a seed cannot make a run reproducible.

## Operating characteristics

For six evals and the plan above, a skill at a true per-run pass rate of 0.65 is accepted in one measurement with probability about 0.21, and at least one of three measurements passes with probability about 0.51, which is why the reroll bound of the budget matters. The indifference zone runs from 0.70 to 0.85. These figures are computed from the plan's functions, under an independent-runs model, and are not a measurement.
