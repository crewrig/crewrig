---
id: "0292"
slug: pr-logbook-pilot
status: draft
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 1880
version: 2.0.0
---

# Pilot the pr-logbook modernization with frozen evals, bundled scripts and a measured delta

*Delta 01 of `specs/0292-pr-logbook-pilot.md`. Source: the owner's decision of 2026-11-11, given at the plan gate of bug #1882 and recorded on issue #1880, that the pilot was over-engineered for its goal. The goal is to apply the current skill-authoring practice to one skill and to check a simple behaviour with an LLM judge, with three or four evals and four or five trigger probes. The delta drops the multi-run baseline, the tolerance calibration and the second pull request, and narrows the scripts to three. Version 2.0.0, a MAJOR bump: requirements are removed and the approved plan (PLAN v1 and v2 on #1880) is invalidated, though nothing is implemented yet. Requirements modified: R1, R2, R5, R8, R10, R17, R23, R24, R26. Requirements removed: R6, R7, R11, R15, R25. Bug #1882 no longer blocks this ticket. This delta opens no question.*

## ADDED

<!-- markdownlint-disable MD029 -->

27. **R27 (settings unchanged).** The work SHALL NOT change `scripts/lib/skill-evals/settings.ts` or the eval runner. `TOLERANCE` stays at the value on `main` when the pull request is measured (0.05 today), and `REGRESSION_BLOCKING` and `MISSING_EVALS_BLOCKING` stay `false`.
28. **R28 (one approval for the spend).** Before the first non-mock run, the owner SHALL approve the spend once for the ticket, on the plan the runner prints for one measurement (executor runs and judge calls) and on the cap of R24. The owner launches each non-mock run in their own terminal; agents run mock mode only.

## MODIFIED

**R1 (two implementation pull requests).** Original: "The work SHALL land as two implementation pull requests, in this order: the first (the *evals PR*) …". Replacement: **R1 (one implementation pull request).** The work SHALL land as one implementation pull request that adds the evaluation cases (R2 to R5), the scripts and the rewritten skill and agent (R8 to R22), and the results of R23. It needs a `metadata.provenance.version` bump because it changes the skill and agent sources (R22).

**R2 (cases).** Original: "… SHALL hold at least three evals that together cover at least these behaviours …". Replacement: the file SHALL hold three or four evals that together cover at least behaviours (a), (b) and (c) of the original R2. The rest of the original R2 stands: expectations on the observable output only, fixtures under `evals/files/`.

**R5 (trigger probes).** Original: "The file SHALL carry at least six trigger probes, of which at least half are positive …". Replacement: the file SHALL carry four or five trigger probes, at least two positive and at least two negative, and the negatives SHALL be near-misses that share vocabulary with the skill's domain.

**R8 (bundled scripts).** Original list: "`compose-pr-body.ts`, `lint-pr-body.ts`, `resolve-logbook-target.ts`, `flip-spec-status.ts` and `check-exec-bits.ts`". Replacement list: `lint-pr-body.ts`, `resolve-logbook-target.ts` and `flip-spec-status.ts`. The rest of R8 stands.

**R10 (template as data).** Original: "`compose-pr-body.ts` and `lint-pr-body.ts` SHALL accept `--template <file>` …". Replacement: `lint-pr-body.ts` SHALL accept `--template <file>`, using the bundled asset when the option is absent. The rest of R10 stands, with "the scripts" read as `lint-pr-body.ts`.

**R17 (skill body).** Addition to the original: composing the PR body and checking executable bits before a push stay in the skill's prose; the skill tells the model to run `lint-pr-body.ts` on the body it composed.

**R23 (acceptance).** Original: "The rewrite PR SHALL commit the `evals/results.json` of a non-mock run on the rewritten skill, against the frozen cases of R7. … the `TOLERANCE` set on `main` by the evals PR (R25). The baseline committed under R6 serves the spread, the tolerance and the report of R26; it is not the comparator. …". Replacement: the pull request SHALL commit the `evals/results.json` of a non-mock run on its head. The comparator is the runner's base replay, the `base_mean` that the same invocation measures on the skill as of the merge base with `main` (spec 0290 R19), against the same `evals.json`. The pull request SHALL be merged only when that run's status is not `regression` under the `TOLERANCE` on `main` (R27). An improvement is not required.

**R24 (regression path).** Original: "… within three measurement runs in total for the rewrite PR. … or changing the tolerance by a separate pull request …". Replacement: "rewrite PR" reads "the pull request". Every non-mock run on the pull request counts toward the three, whatever its cause. `evals.json` and the fixtures SHALL NOT change after the first non-mock run; a change to them restarts the count and needs the owner's approval of R28 again. The rest of R24 stands.

**R26 (report to the standard).** Original: "… the baseline figures and spread of R6, the rewritten skill's figures, the delta, the total cost and model runs, the tolerance decided under R25, …". Replacement: the comment on issue #1848 SHALL report the `base_mean`, the `with_skill` and `without_skill` means of the measured head, the delta, the cost and model runs of every non-mock run, which steps moved into scripts and which stayed in prose with the reason, and every point where the provisional contract of R9 proved awkward or insufficient.

**Scenarios, restated.** The scenario *Happy path — evals merged first, rewrite accepted* is replaced by: **Given** one pull request with four evals, five trigger probes, three scripts and the rewritten skill, **When** the owner runs the evals once and the run reports a `with_skill` mean not lower than its `base_mean` by more than 0.05, **Then** the pull request commits that `evals/results.json`, may be merged, and a comment on #1848 reports the figures. The scenario *Failure path — regression after three attempts* reads "the pull request" for "the rewrite PR".

**Out of scope, added.** A script to compose the PR body and a script to check executable bits (both stay in prose); a multi-run baseline and any calibration of `TOLERANCE`; bug #1882, which no longer blocks this ticket.

## REMOVED

- **R6 (baseline and its spread):** "Before the evals PR is merged, the contributor SHALL run `task skill-evals -- pr-logbook` without mock mode three times on the unchanged skill …". The base replay of R23 is the only baseline.
- **R7 (frozen cases):** "From the merge of the evals PR until the end of this ticket, `evals/evals.json` and every fixture under `evals/files/` SHALL stay byte-identical. …". Replaced by the no-change rule in the modified R24.
- **R11 (compose):** "Given the content of the preamble and of some or all sections, `compose-pr-body.ts` SHALL print a body …".
- **R15 (executable bits):** "Given paths, or by default the files changed between `HEAD` and its merge base …, `check-exec-bits.ts` SHALL report a finding …".
- **R25 (tolerance calibration):** "The evals PR, before any measurement of the rewritten skill exists, SHALL set `TOLERANCE` …". Replaced by R27.
- **Scenario *Failure path — script run outside a repository*** (it exercised `check-exec-bits.ts`).
