---
id: "0300"
slug: github-actions-modernization
status: approved
complexity: standard
interaction-mode: AUTO
related-issue: 1939
version: 1.2.0
---

# Modernize the github-actions skill and the ci-configurator agent to the authoring standard

*Delta 02 of `specs/0300-github-actions-modernization.md`. Source: issue #1939, the paid measurements of the implementation pull request. Rationale: in three final runs two expectations failed identically although the skill output was correct. The eval runner voids a judge PASS whose quoted evidence is shorter than 12 non-whitespace characters or is not found verbatim in the transcript or the produced files (`docs/skill-evals.md`, grading and evidence rules; the `grading.json` entries "the PASS verdict was unsupported"). The two expectations were phrased on an absence ("nothing else changes meaning", "no longer references") or on a short token, so the judge had nothing quotable to cite. This is a runner evidence rule, not a defect of the skill, and a separate harness friction ticket covers the runner. The owner authorised exactly this delta and the decision is not reopened here: reword ONLY evals 4 and 6, each expectation testing the same behaviour at the same or higher strictness and pointing the judge at an artifact it can quote. Requirements modified: R1 (freeze sentence), R2 (the two expectations), R5 (budget and measurement). The scenario "rewrite regresses or the budget is spent" is modified. Every other requirement is unchanged. This delta opens no question.*

## ADDED

### Happy path — reworded cases measured on both sides

- **Given** `evals.json` carrying the reworded expectations of eval 4 and eval 6 and no other change, and a budget of four paid runs already spent,
- **When** the contributor measures the unchanged skill and then the rewritten skill, once each, on those same cases,
- **Then** both pass rates are reported side by side on the logbook with the probe results, the cost and the run counts, the two figures come from identical cases, and the `evals/results.json` of the final non-mock run is committed.

## MODIFIED

<!-- markdownlint-disable MD029 -->

1. **R1 (order of work), freeze sentence, original:** "Cases and fixtures SHALL stay byte-identical after the first commit."

**Amended (R1, freeze sentence only):** Cases and fixtures SHALL stay byte-identical after the first commit, with one exception: a single commit SHALL reword the `expectations` text of eval 4 (expectation 4) and eval 6 (expectation 3) of `evals.json` to the texts of R2 below, and touch nothing else in `evals/` (no other eval, no check, no fixture, no probe, no prompt). That commit comes before the two measurements of R5 as amended. After it, `evals/` is frozen again, byte-identical to that commit until the work ends; a further edit of a case is a new delta of this spec. The rest of R1 is unchanged. The content hash covers `evals/evals.json` (`docs/skill-evals.md`, *Content hash*), so this commit changes the hash and the committed `evals/results.json` is stale from that commit until the final non-mock run of R5 (on the reworded cases) is committed. The stale attestation is expected in the meantime, and only that final file is valid. Fixtures stay outside the hash, and this commit touches none.

2. **R2 (cases), expectations of evals 4 and 6, original:** eval 4, expectation 4: "Nothing else in the workflow changes meaning: the tag trigger, the `contents: write` permission and the `body_path` input are kept." Eval 6, expectation 3: "The workflow no longer references AWS_ACCESS_KEY_ID or AWS_SECRET_ACCESS_KEY, nor the aws-access-key-id and aws-secret-access-key inputs."

**Amended (R2, these two expectations only):** the two expectations SHALL read exactly as follows, and each stays stated on observable output (the workflow file written), never on how it was produced.

- Eval 4, expectation 4: "The written .github/workflows/release-notes.yml still contains the whole trigger block (the on: key with push: and tags: holding the glob 'v*'), the line contents: write under permissions:, and the body_path: input line."
- Eval 6, expectation 3: "The written .github/workflows/deploy.yml contains no line mentioning AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, aws-access-key-id or aws-secret-access-key, and the step that uses aws-actions/configure-aws-credentials shows a role-to-assume: line, quoted from the file."

Strictness: each rewording checks every element of the original and adds at least one. Eval 4 now requires the complete trigger block and the two literal lines to be present in the written file, where the original named them without saying where they must appear. Eval 6 keeps the four forbidden names and adds the positive proof that the replacement step carries `role-to-assume:`. Neither expectation accepts a weaker output than before. The other expectations of evals 4 and 6, all other evals, every check, fixture and probe, and the rest of R2 are unchanged, including the case count, the five covered situations and the rule that no expectation depends on how the output was produced.

5. **R5 (measurement), budget sentence, original:** "The contributor SHALL measure the unchanged skill (baseline) and the rewritten skill (final) with `task skill-evals -- github-actions`, SHALL make at most four paid measurements for this skill in total (for example two baselines to record the spread, then two finals), and SHALL report both pass rates, the probe results, the cost and the run counts on the logbook. ... When the budget of four is spent without a clean final status, the figures go to the user for decision; the contributor SHALL NOT measure a fifth time on their own."

**Amended (R5, budget and measurement):** The budget is six paid measurements for this skill in total: four are spent, and exactly two more are authorised by this delta, no more. The two are one baseline and one final, both run on the reworded cases of R2, after the commit of R1 as amended:

- **Baseline.** The unchanged skill is measured again on the reworded cases. The run SHALL start from a throwaway worktree or tree that holds the skill sources of `main` before the rewrite (the unmodified original skill, as of the commit preceding the rewrite) together with the reworded `evals.json` and the fixtures of this branch; a dirty tree is allowed because the hash is over content. The runner reads the base figure from the `results.json` at `git merge-base HEAD <ref>`, not at the ref itself, so the baseline commit SHALL be an ancestor of the HEAD of the final run:

  - The baseline commit SHALL contain only the baseline `evals/results.json` (copied from the throwaway tree) and SHALL be created on the feature branch after the commit of R1 as amended and before the final run.
  - A baseline made in a throwaway tree, or on a separate lineage, is valid only once it is made reachable from the feature branch, for example by a merge commit `git merge -s ours <baseline-branch>` on the feature branch, which keeps the branch tree. Otherwise `--base` silently resolves to an older common ancestor, whose file is the superseded baseline or absent.
  - Before the final run the contributor SHALL check `git merge-base --is-ancestor <baseline-sha> HEAD` and proceed only on exit 0.
  - The final run SHALL pass that commit with `--base <baseline-sha>`, and the printed `base=` figure SHALL equal the `eval_pass_rate` of the baseline `results.json`. If it differs, or reads `n/a`, the contributor SHALL stop and report to the user: no extra paid run is made without the owner's decision.
  - The logbook records the tree, the baseline commit and the printed `base=` figure. The earlier baseline is superseded for the comparison, because it was measured on different expectation texts.
- **Final.** The rewritten skill is measured on the same reworded cases. Baseline and final SHALL use identical `evals.json` content, so the diff between the two pass rates stays comparable; a run on any other case content is not admissible as either figure.
- **Cap.** The total SHALL never exceed six, whatever the outcome. If a run fails for an infrastructure reason before producing a graded result, the contributor SHALL report it to the user instead of spending an extra run.
- **Report.** Both pass rates, the probe results, the cost and the run counts go on the logbook, with the earlier four runs listed as spent and superseded.
- **Result file.** The `evals/results.json` of the final non-mock run is committed. The rewrite is kept only when that final status is not `regression`, as before.
- **Final still below 0.80.** If the final pass rate is below 0.80 there is no further run and no override of the check: the pull request stays open, the check is not bypassed or relaxed, and the figures (baseline, final, per-expectation failures, cost) are reported to the user for decision. The contributor SHALL NOT measure a seventh time, nor a fifth or sixth beyond the two authorised above, on their own.

A probe failure is still fixed by revising the description before the body, but any such revision changes the content hash and is only admissible when it happens before the final measurement and costs no run beyond the cap; otherwise it goes to the user with the figures. The rest of R5 is unchanged.

Scenario "Failure path — rewrite regresses or the budget is spent", original:

> - **Given** the final measurement is below the baseline by more than the tolerance, or four paid measurements have been made without a clean final status,
> - **When** the contributor revises the description, then the body, within the budget,
> - **Then** the cases stay unchanged and, if the run still regresses, the figures go to the user for decision.

**Amended (scenario):**

### Failure path — rewrite regresses or the budget is spent

- **Given** the final measurement on the reworded cases is below the baseline by more than the tolerance or below 0.80, or six paid measurements have been made in total (four spent before this delta plus the two it authorises),
- **When** the contributor has used the two authorised runs,
- **Then** the cases stay unchanged since the commit of R1 as amended, no further measurement is run, no check is overridden, the pull request stays open and the figures go to the user for decision.

## REMOVED

Nothing is removed as a requirement. Removed from the original text, quoted above and replaced under MODIFIED: the two original expectation texts of eval 4 and eval 6, the budget of four paid measurements together with the ban on a fifth, and the "four paid measurements" trigger of the failure scenario (now six in total).

### Out of scope

Added to the Out of scope list of the parent spec:

- Any change to the eval runner, its evidence rule (12 non-whitespace characters, verbatim quote) or its grading prompt, which a separate harness friction ticket covers.
- Any edit of an eval other than evals 4 and 6, of any check, fixture, probe or prompt, and any further reopening of the frozen cases without a new delta.
- Any paid measurement beyond the six authorised in total.
