---
id: "0296"
slug: pr-reviewer-modernization
status: draft
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 1892
version: 2.0.0
---

# Modernize the pr-reviewer skill and agent with frozen evals, bundled scripts and a measured delta

*Delta 01 of `specs/0296-pr-reviewer-modernization.md`. Source: the cold plan review of issue #1892 (finding v1-F1) and the wave coordinator's decision recorded on the wave issue #1852. A skill that ships `evals/evals.json` is protected by `check-skill-quality`, which runs on every skill in continuous integration; `pr-reviewer` has nine warnings today, all of which become errors the moment the evals land. An evals-only pull request (R1) would therefore be red and would leave `main` red. The delta lands the evals, the rewrite and the results in one pull request that is pushed only once the skill is clean, and keeps the before/after comparison by measuring the baseline locally on a commit of that branch.*

## ADDED

<!-- markdownlint-disable MD029 -->

25. **R25 (no red push).** The branch SHALL NOT be pushed while its head fails `task check-skill-quality -- pr-reviewer`; the intermediate commits (1) and (2) of R1 carry findings by design and are pushed only as part of a head that is clean. The pre-push hook SHALL NOT be bypassed.
26. **R26 (existing linters: precedence and goldens).** The six existing scripts SHALL check every input before linting any of them: an input that is not a readable regular file (a missing path, a directory, an empty name, `-`) makes the script exit `3` with nothing linted, and this takes precedence over a finding and over a tool-absent note. An unknown option exits `2` and is never forwarded to an external tool. The differential cases of `scripts/tests/fixtures/skill-scripts/pr-reviewer/` whose status or output this requirement moves are updated as **base goldens** in the same change; these are base goldens, not overlays, and no deviation letter is added, as `specs/0258-skill-extension-bundled-scripts-typescript.delta-04.md` R47 did when the shell leg was retired. The moved cases are listed in the plan and every other case stays byte-identical. The Windows expectations in `scripts/tests/lib/windows-skill-cases.ts` are updated for the same cases.

## MODIFIED

**R1 (two implementation pull requests).** Original: "The work SHALL land as two implementation pull requests, in this order. The *evals PR* SHALL carry R2 to R6 … The *rewrite PR* SHALL carry R7 to R24 …". Replacement: **R1 (one implementation pull request).** The work SHALL land as one implementation pull request carrying R2 to R6 and R7 to R24. Its branch SHALL hold, in this order: (1) a commit that adds only `evals/evals.json` and the fixtures under `evals/files/`; (2) a commit that adds only the `evals/results.json` of the baseline run of R5, measured on the unchanged skill; (3) the commits of the scripts, the rewritten skill and agent and the final `evals/results.json`. The branch SHALL NOT be pushed until the skill passes `task check-skill-quality -- pr-reviewer` with zero findings, because shipping `evals/evals.json` makes every finding an error.

**R5 (baseline).** Original: "Before the evals PR is merged, the contributor SHALL run `task skill-evals -- pr-reviewer` once … and commit its `evals/results.json` in the evals PR. … The evals PR therefore has to be merged before the final measurement of R20, or no comparison exists. …". Replacement: the contributor SHALL run `task skill-evals -- pr-reviewer` once without mock mode on the unchanged skill, at the commit (1) of R1, in a fresh output directory, and commit its `evals/results.json` as the commit (2) of R1. The logbook SHALL record the baseline's `status`, `eval_pass_rate`, `probe_pass_rate`, `skill_loaded`, `executor_runs`, `judge_calls` and `cost_usd`. The final measurement of R20 SHALL run with `--base <commit (2)>`, so that the runner compares with the recorded figures of that commit instead of reporting `not compared`. When the runner refuses a local base ref, the contributor SHALL record the baseline figures on the logbook, apply the gate of R20 to them by hand, and tell the wave coordinator. The rest of R5 stands, including the owner's cap of three paid measurements.

**R6 (frozen cases).** Original: "From the merge of the evals PR, `evals/evals.json` and the fixtures SHALL stay byte-identical until the ticket ends. …". Replacement: from the commit (1) of R1 until the ticket ends, `evals/evals.json` and the fixtures SHALL stay byte-identical. A defect found in a case is recorded on the logbook, the unpushed commits (1) and (2) of R1 are rewritten with the fixed cases and the baseline is measured again on the unchanged skill; this is allowed because R25 forbids pushing them, and it consumes the retry of the cap in R5.

**R20 (acceptance).** The base of the gate, `base_eval_pass_rate`, is the one recorded in the results file of the commit (2) of R1 and selected with `--base`. The rest of R20 stands, read with "the pull request" for "the rewrite PR".

**R21 (retry path).** Original: "… and measure once more (the third and last paid measurement of R5). …". Replacement: the second paid measurement is the final one, taken when the scripts are tested locally and the diff has been self-reviewed; the cold REVIEW follows it on the pushed branch. A REVIEW fix in `SKILL.md`, `references/` or `scripts/` changes the content hash and uses the third measurement, so a failing gate after such a fix has no retry. Every measurement after the third, including one needed only to refresh a stale content hash, needs the owner's approval, asked through the wave coordinator. The rest of R21 stands.

**Scenario *Happy path — a required check fails*, and the other script scenarios,** stand unchanged.

**Scenario *Failure path — gate failed after the retry*.** Read "the rewrite PR" as "the pull request".

## REMOVED

- The ordering sentences of R1 that require the evals PR to be merged before the rewrite PR is opened, and the sentence of R5 requiring that merge before the final measurement.
- The *evals PR* and *rewrite PR* vocabulary throughout; the delta's R1 replaces it.
