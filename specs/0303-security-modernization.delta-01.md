---
id: "0303"
slug: security-modernization
status: approved
complexity: standard
interaction-mode: AUTO
related-issue: 1941
version: 1.1.0
---

# Modernize the security skill and agent, and give the secrets check one engine

*Delta 01 of `specs/0303-security-modernization.md`. Source: issue #1941, the paid measurements of the implementation pull request. Rationale: the final measurement of the `security` skill gave 0.67 (4 of 6), and the three failing expectations belong to evals 5 and 6. The judge verdicts (`grading.json` of those two evals) say that no single line combines the several facts each expectation asks for. The expectations were written against free prose, before the script-enforced report format existed. That format (R9, `security-finding.ts`) puts the facts on separate labelled lines (`Where:`, `Threat:`, `Evidence:`, `Fix:`), with one of each per finding, and a label given twice is the error `field-duplicate`. An expectation that asks for one line to carry the file name, the line number and the threat, or both remedies of two findings, can therefore not be satisfied by a correct report. This is a defect of the case wording, not of the skill. The owner authorised exactly this delta and the decision is not reopened here: reword ONLY evals 5 and 6, splitting each combined expectation so that every fact of the old wording becomes its own expectation quotable on one whole line of the written file, and drop no fact. Requirements modified: R1 (freeze sentence), R2 (the expectations of evals 5 and 6), R5 (budget and measurement for `security`). The scenario "a measurement regresses or the budget is spent" is modified. Every other requirement is unchanged. This delta opens no question.*

## ADDED

### Happy path: reworded cases measured on both sides

- **Given** `evals.json` carrying the reworded expectations of eval 5 and eval 6 and no other change, and three paid runs of the `security` skill already spent,
- **When** the contributor measures the unchanged skill (security 1.1.2 as on `main`) and then the rewritten skill, once each, on those same cases,
- **Then** both pass rates are reported side by side on the logbook with the probe results, the cost and the run counts, the two figures come from identical cases, the printed `base=` of the final run equals the `eval_pass_rate` of the baseline `results.json`, and the `evals/results.json` of the final non-mock run is committed.

## MODIFIED

<!-- markdownlint-disable MD029 -->

1. **R1 (order of work), freeze sentence, original:** "Cases and fixtures SHALL stay byte-identical after the first commit."

**Amended (R1, freeze sentence only):** Cases and fixtures SHALL stay byte-identical after the first commit, with one exception: a single commit SHALL reword the `expectations` text of eval 5 and eval 6 of `artifacts/core/skills/security/evals/evals.json` to the texts of R2 below, and touch nothing else in `evals/` (no other eval, no probe, no check, no fixture, no prompt, no `expected_output`). That commit comes before the two measurements of R5 as amended. After it, `evals/` is frozen again, byte-identical to that commit until the work ends; a further edit of a case is a new delta of this spec. The rest of R1 is unchanged. The content hash covers `evals/evals.json` (`docs/skill-evals.md`, *Content hash*), so this commit changes the hash and the committed `evals/results.json` is stale from that commit until the final non-mock run of R5 (on the reworded cases) is committed. The stale attestation is expected in the meantime, and only that final file is valid. Fixtures stay outside the hash, and this commit touches none.

2. **R2 (cases), expectations of evals 5 and 6, original:**
   - Eval 5, expectations 2 and 3: "The threat model has a line that says the client-supplied original file name is used to build the destination path and allows path traversal or overwriting another file, citing upload-endpoint.js.txt and a line number; quote that whole line." and "The threat model has a line that says the file type, content or size is not validated so a script or oversized file can be published under the public uploads directory; quote that whole line."
   - Eval 6, expectation 4: "The review has a full Fix line that says to remove ignoreExpiration and to set the expected audience in the verify options; quote that whole line."

**Amended (R2, these expectations only):** each stays stated on observable output (the file written), never on how it was produced, and each is quotable on one whole line of that file (at least 12 non-whitespace characters, at least 12 letters and digits).

Eval 5 now holds six expectations. Expectation 1 (the trust-boundary line) and the last one (the concrete mitigation) are unchanged, word for word. Expectations 2 and 3 of the original are replaced by these four, in this order:

- Eval 5, expectation 2: "The threat model has a Threat: line that says the client-supplied original file name is used to build the destination path, which allows path traversal or overwriting another file; quote that whole Threat: line."
- Eval 5, expectation 3: "The threat model has a full Where: line, for the finding about the original file name, that names upload-endpoint.js.txt and a line number of the whole file; quote that whole Where: line."
- Eval 5, expectation 4: "The threat model has a line (a Threat: line or a finding summary line) that says the file type or content is not validated, so a script can be published under the public uploads directory; quote that whole line."
- Eval 5, expectation 5: "The threat model has a line (a Threat: line or a finding summary line) that says the file size is not validated, so an oversized file can be published under the public uploads directory; quote that whole line."

Eval 6 keeps expectations 1, 2 and 3 (the two finding lines and the `Where:` line) unchanged, word for word. Expectation 4 is replaced by two. Because `security-finding.ts` allows one `Fix:` per finding and rejects a label given twice (`field-duplicate`), the two remedies are asked of the two findings, each with its own `Fix:`:

- Eval 6, expectation 4: "The review has a Fix: line, in the finding about ignoreExpiration, that says to remove ignoreExpiration from the verify options; quote that whole Fix: line."
- Eval 6, expectation 5: "The review has a Fix: line, in the finding about the token audience, that says to set the expected audience in the verify options; quote that whole Fix: line."

Strictness: no fact is dropped and none is weakened. The file name, the line number, the path-traversal or overwrite threat, the type and content gap, the size gap, the removal of `ignoreExpiration` and the setting of the expected audience each remain a required, separately graded fact. The case still requires both remedies of eval 6 to appear, one per finding. Splitting only changes where the judge looks for each fact, from one line that the format cannot produce to the labelled line that carries it. The other expectations of evals 5 and 6, all other evals, every check, fixture, probe and prompt, and the rest of R2 are unchanged, including the case count, the covered situations and the rule that the prompt names the file to write.

5. **R5 (measurement), budget for `security`, original:** "At most four paid measurements SHALL be made for each of the three skills (for `security`: baseline, final and at most two re-measurements ...), ... and when a skill is still below the bar after its four runs the figures go to the user for decision, with no further run and no check bypassed."

**Amended (R5, `security` only):** The budget for the `security` skill is five paid measurements in total: three are spent, and exactly two more are authorised by this delta, no more. The two are one baseline and one final, both run on the reworded cases of R2, after the commit of R1 as amended:

- **Baseline.** The unchanged skill is measured again on the reworded cases. The run SHALL start from a throwaway tree that holds the skill sources of `main` (security 1.1.2, the pre-rewrite `SKILL.md`, `scripts/`, `references/` and `assets/`) together with the reworded `evals.json` and the fixtures of this branch; a dirty tree is allowed because the hash is over content. The runner reads the base figure from the `results.json` at the ref given to `--base` (resolved through `git merge-base HEAD <ref>`), so the baseline commit SHALL be an ancestor of the HEAD of the final run:
  - The baseline commit SHALL contain only the baseline `evals/results.json` (copied from the throwaway tree) and SHALL be created on the feature branch after the commit of R1 as amended and before the final run.
  - A baseline made in a throwaway tree or on a separate lineage is valid only once it is made reachable from the feature branch, for example by `git merge -s ours <baseline-branch>`, which keeps the branch tree. Otherwise `--base` silently resolves to an older common ancestor.
  - Before the final run the contributor SHALL check `git merge-base --is-ancestor <baseline-sha> HEAD` and proceed only on exit 0.
  - The final run SHALL compare with the baseline commit through `--base <baseline-sha>`, and the printed `base=` figure SHALL equal the `eval_pass_rate` of the baseline `results.json`. If it differs, or reads `n/a`, the contributor SHALL stop and report to the user: no extra paid run is made without the owner's decision.
  - The logbook records the tree, the baseline commit and the printed `base=` figure. The earlier baseline is superseded for the comparison because it was measured on different expectation texts.
- **Final.** The rewritten skill is measured on the same reworded cases. Baseline and final SHALL use identical `evals.json` content, so the two pass rates stay comparable; a run on any other case content is not admissible as either figure.
- **Cap.** The total for `security` SHALL never exceed five, whatever the outcome. If a run fails for an infrastructure reason before producing a graded result, the contributor SHALL report it to the user instead of spending an extra run.
- **Report.** Both pass rates, the probe results, the cost, the run counts and the per-expectation failures go on the logbook, with the earlier three runs listed as spent and superseded.
- **Result file.** The `evals/results.json` of the final non-mock run is committed. The rewrite is kept only when the final eval pass rate is at least the baseline minus the runner tolerance (0.05) and the final status is `pass`, as before.
- **Final still below 0.80.** If the final pass rate is below 0.80 there is no further run and no override of the check: the pull request stays open, the check is not bypassed or relaxed, and the figures (baseline, final, per-expectation failures, cost) are reported to the user for decision. The contributor SHALL NOT measure a sixth time, nor a fourth or fifth beyond the two authorised above, on their own.

A probe failure is still fixed by revising the description before the body, but any such revision changes the content hash and is only admissible when it happens before the final measurement and costs no run beyond the cap; otherwise it goes to the user with the figures. The budget of `github-actions` and `gitlab-ci` and the rest of R5 are unchanged.

Scenario "Failure path: a measurement regresses or the budget is spent", original:

> - **Given** a final measurement below the baseline by more than the tolerance or below 0.80, or four paid measurements spent for one skill,
> - **When** the contributor revises the description, then the body, within the cap,
> - **Then** the cases stay unchanged and, if the criteria still fail, no further run is made, no check is bypassed and the figures go to the user for decision.

**Amended (scenario, for the `security` skill):**

### Failure path: a measurement regresses or the budget is spent

- **Given** the final measurement of `security` on the reworded cases is below the baseline by more than the tolerance or below 0.80, or five paid measurements have been made for it in total (three spent before this delta plus the two it authorises),
- **When** the contributor has used the two authorised runs,
- **Then** the cases stay unchanged since the commit of R1 as amended, no further measurement is run, no check is overridden, the pull request stays open and the figures go to the user for decision.

## REMOVED

Nothing is removed as a requirement. Removed from the original text, quoted above and replaced under MODIFIED: the expectations 2 and 3 of eval 5 and expectation 4 of eval 6, and, for `security` only, the budget of four paid measurements (now five in total) together with its re-measurement allowance.

### Out of scope

Added to the Out of scope list of the parent spec:

- Any change to the eval runner, its evidence rule (12 non-whitespace characters, verbatim quote) or its grading prompt.
- Any edit of an eval other than evals 5 and 6, of any check, fixture, probe or prompt of the `security` skill, and any further reopening of the frozen cases without a new delta.
- Any change to `security-finding.ts` or to the report format of R9: the cases are aligned to the format, not the reverse.
- Any paid measurement of `security` beyond the five authorised in total.
