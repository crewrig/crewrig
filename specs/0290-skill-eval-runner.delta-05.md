---
id: "0290"
slug: skill-eval-runner
status: draft
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 1902
version: 3.1.0
---

# Skill eval runner: grade a skill from its evals.json when SKILL.md changes

*Delta 05 of `specs/0290-skill-eval-runner.md`, building on delta-01 to delta-04. Source: issue #1902. The evidence rule of R13 accepts a judge `PASS` only when its quoted evidence is an exact substring of the transcript or of a produced file. A judge that supports an expectation but quotes it with an ellipsis, a bullet list joined onto one line or a trimmed line is therefore recorded `passed: false` ("the PASS verdict was unsupported"). With evals sets of 5, one such flake moves the eval pass rate by 0.20 and a whole status band: the `spec-author` migration (#1894) measured 0.80, then 0.60 and 0.60 on identical skill content. The version bump is MINOR: one requirement is modified and nothing is removed. Requirements added: R49. Requirements modified: R13. This delta opens no question.*

## ADDED

<!-- markdownlint-disable MD029 -->

49. **Evidence matching is tolerant of formatting, not of invention.** Evidence given for a `PASS` SHALL be matched against the run's `transcript.md` and against each produced file (the *material*) by three rules tried in this order; the first that holds makes the evidence valid, and none holds means unsupported (R13). All three are deterministic string operations: no model call, no network.
    1. *Exact.* The evidence is an exact substring of the material with line endings normalised. This is the rule of delta-01 and delta-04, unchanged.
    2. *Normalised.* Both the evidence and the material are normalised by replacing every maximal run of characters that are neither a Unicode letter nor a Unicode digit with one space, after Unicode NFKC normalisation, and trimming. Case is kept. The evidence is first split on the ellipsis markers `...`, `…`, `[...]` and `[…]`; every non-empty piece SHALL contain at least `EVIDENCE_MIN_CHARS` (12) letters and digits, and every piece SHALL occur in the normalised material, in the same order and without overlap, the first piece at or after the start and each next piece after the end of the previous one. Pieces match on whole words (a piece never starts or ends inside a word of the material).
    3. *Contiguous window with a coverage floor.* Let *W* be the longest run of consecutive words of the normalised evidence that occurs, as a run of whole words, in the normalised material. The evidence is valid when *W* holds at least `EVIDENCE_WINDOW_CHARS` (40) letters and digits AND at least `EVIDENCE_WINDOW_SHARE` (0.30) of the letters and digits of the whole normalised evidence. This accepts a judge that wraps a verbatim excerpt in its own commentary, and refuses one that wraps a real 40-character run (a heading, a boilerplate line) in a claim that is mostly invented: the invented part may not exceed 70 percent of the evidence.

    The at-least-12-non-whitespace-characters gate and the `path:line` reference of R13 stay as they are and apply first and last respectively. `EVIDENCE_WINDOW_CHARS` and `EVIDENCE_WINDOW_SHARE` SHALL be declared settings in `scripts/lib/skill-evals/settings.ts`, next to `EVIDENCE_MIN_CHARS`. The rule only widens acceptance: whatever rule 1 accepted is accepted, and the validator SHALL NOT reject any evidence that the exact rule accepts. The matching rule that held is not recorded in `grading.json` (R11 is unchanged).
    Acceptance: each of the recorded judge answers of the fixtures (Scenarios) that the exact rule rejected is accepted by rule 2 or 3 as the Scenario states; a quote that changes one word of a real excerpt, a quote whose pieces occur out of order, a piece shorter than 12 letters and digits next to an ellipsis, a 39-letter-and-digit verbatim run inside invented text, a verbatim run of 76 letters and digits inside an invented claim of about 300 letters and digits (a share of about 0.20), and a paraphrase that shares no 40-character run with the material are all rejected; a 40-letter-and-digit run that is 30 percent or more of the evidence is accepted at the boundary, and the same run at 29 percent is rejected; the existing evidence tests pass unchanged.

## MODIFIED

**R13 (judge evidence), as modified by delta-01 and delta-04.** Original (delta-04): "...an expectation SHALL be recorded `passed: true` only when its verdict is `PASS` and its evidence is valid (at least 12 non-whitespace characters, and either an exact substring of the run's `transcript.md` or of a produced file with line endings normalised, or a `path:line` reference naming a produced file and an existing line of it); any other `PASS` SHALL be recorded `passed: false` with evidence stating that the verdict was unsupported." Replacement: the evidence is valid when it has at least 12 non-whitespace characters and either matches the material under requirement 49 or is a `path:line` reference naming a produced file and an existing line of it. Every other sentence of R13 as modified by delta-04 stands, including the unsupported-`PASS` record and the no-verdict record.
    Acceptance: as requirement 49; a `PASS` with a fabricated excerpt is still recorded `passed: false` with evidence stating that the verdict was unsupported, whatever its length.

## REMOVED

None.

## Decision and rejected alternatives

The exact-substring check exists to stop a judge from passing an expectation on text that is not in the run's output. It proves that the judge grounded its verdict in real text; it has never proved that the text entails the expectation, and this delta does not change that. The chosen rule keeps the grounding guarantee and removes the dependence on how the judge happened to lay the quote out.

- **Whitespace and markdown normalisation only.** Rejected as insufficient: it fixes the joined-markdown case and the trimmed line, but not an ellipsis, and not a judge that adds a clause of its own to a real quote. Rule 2 is this option, plus ellipsis pieces.
- **Accept a quote of at least N characters that matches a contiguous region.** Adopted as rule 3, but only as the last resort and with N = 40, because used alone it admits a short generic phrase ("the command prints a clear error") that occurs in nearly any output. Rule 2 stays first so that short, faithful quotes are held to the stricter whole-quote match.
- **Re-ask the judge once to quote verbatim.** Rejected: it adds a paid model call per unsupported `PASS` (against `max-judge-calls`, R23, and the budget of R15), makes the grading depend on a second non-deterministic answer, and cannot be tested offline with the recorded flakes. A prompt change asking for verbatim single-line quotes is also out: the judge library's prompt is byte-pinned by goldens that guard its other callers (R15).
- **A coverage floor of 50 percent on rule 3.** Rejected after measuring: it would reject two of the three recorded flakes that rule 3 exists for (m5 eval 1 expectation 4 at 0.38 and m2 eval 3 expectation 2 at 0.35). The floor is 0.30, the highest round figure that admits both with a margin; the fabricated fixtures sit at 0.20 and below.

## Impact on committed results files

None. The content hash of R35 covers `SKILL.md`, the skill's `scripts/`, `references/`, `assets/` and `evals/evals.json`, never the runner, so no hash changes. `runner_version` is recorded in `results.json` but compared by no check (`scripts/lib/skill-evals/attest.ts` reads the hash, the status and the figures only), so no file becomes `stale`. The rule widens acceptance only, so a recorded `pass` cannot have been a pass that the new rule would reject; a recorded `fail` or `regression` measured under the stricter rule remains a valid attestation of that measurement, and an author who wants the benefit re-measures at the next change of the skill, as for any change. No refresh is required. `RUNNER_VERSION` is bumped to 2.1.0 by the implementation, so that results written after this change say so; the files already committed keep 2.0.0 and stay valid.

## Verified against the code and the fixtures

Read before writing this delta. `scripts/lib/skill-evals/evidence.ts` `validateEvidence` is the only evidence check: `grade.ts` calls it once per expectation with the transcript and the files produced by the run, and nothing else in `scripts/` or in `tests/e2e/lib/llm_judge.ts` decides the support of a `PASS`. `EVIDENCE_MIN_CHARS` (12) is in `settings.ts`. `attest.ts` does not read `runner_version`.

The recorded judge answers of the `spec-author` measurements of #1894 (`judge.txt`, `grading.json`, the produced `outputs/` and `transcript.md`) were read without modification. Findings, by the judge's expectation number:

- m5 eval 1, expectation 3: the evidence joins `### Failure path: service error mid-export`, the `Given` line and a truncated `When` line onto one line with ` - ` between them. The file holds them on separate lines and the `When` line continues after the quote. Rule 2 accepts it (markdown markers and line breaks collapse; the quote ends inside a line, which whole-word matching allows).
- m5 eval 1, expectation 4: the evidence opens with a sentence of the judge's own (`The only columns are ... both from the ticket.`) that is in no file, then quotes the out-of-scope bullet verbatim. Rule 1 and rule 2 reject it; rule 3 accepts it through the 61-letter-and-digit run of the bullet, which is 61 of the 159 letters and digits of the evidence, a share of 0.38. This is the paraphrase flake of the issue.
- m4 eval 3, expectation 2: the evidence quotes requirement 2 verbatim inside commentary (85 of 158, a share of 0.54). Rule 3 accepts it.
- m4 eval 3, expectation 3: the evidence is `### Failure path: service failure ... **Then** the command prints ...` with an ellipsis and the markdown markers. Rule 2 accepts it.
- Measured shares (the longest verbatim run over the whole evidence, in letters and digits): 0.38, 0.54 and 0.35 for the three cases rule 3 admits, hence the floor of 0.30. A synthetic fabricated case built on the same material, the paraphrase of the next Scenario with a real 34-letter-and-digit run, measures 0.20 and is below both the 40-character floor and the share floor.
- m2 eval 3, expectation 2: the evidence quotes the open question with its quotation marks escaped one level too many, and the quote of requirement 1 inside it (59 of 170, a share of 0.35). Rule 3 accepts it.

## Scenarios

**Scenario:** a bullet list joined onto one line is accepted

```text
Given a produced spec holds "### Failure path: service error mid-export", then a blank line, then the bullets "- **Given** the widgets service fails after part of the list has been retrieved" and "- **When** the caller runs `widgets export --out widgets.csv` and no such file existed"
And   the judge answers PASS with the evidence "### Failure path: service error mid-export - **Given** the widgets service fails after part of the list has been retrieved - **When** the caller runs `widgets export --out widgets.csv`"
When  the evidence is validated against the run
Then  it is valid by rule 2 and the expectation is recorded passed: true
```

**Scenario:** an ellipsis between two real excerpts is accepted

```text
Given a produced spec holds "### Failure path: service failure" and, a few lines later, "- **Then** the command prints a clear error, exits with a non-zero status, and no `widgets.csv` exists (or, if one existed before, it is unchanged)."
And   the judge answers PASS with the evidence "### Failure path: service failure ... **Then** the command prints a clear error, exits with a non-zero status, and no `widgets.csv` exists (or, if one existed before, it is unchanged)."
When  the evidence is validated
Then  it is valid by rule 2
```

**Scenario:** a real excerpt inside commentary is accepted, a pure paraphrase is not

```text
Given a produced spec whose out-of-scope list holds "Extra columns, column selection, filtering, sorting or date-range options."
When  the judge's evidence is "The only columns are `id,name,owner,created_at` and the only option is `--out`, both from the ticket. The out-of-scope list states 'Extra columns, column selection, filtering, sorting or date-range options.'"
Then  it is valid by rule 3 (the longest verbatim run is 61 of 159 letters and digits, 0.38)
But   when the evidence is only "The spec adds no extra columns, no column selection, no filtering, sorting or date-range options beyond the ticket"
Then  it is unsupported
```

**Scenario:** a fabricated quote is rejected

```text
Given the recorded fixtures of the three flakes above
When  one word of a real excerpt is changed, or the second piece of an ellipsis quote is invented, or the pieces are put in the wrong order, or a verbatim run of 39 letters and digits is surrounded by invented text
Then  the validator reports the evidence as unsupported and the expectation is recorded passed: false with evidence stating that the verdict was unsupported
```

**Scenario:** a real run inside a much longer invented claim is rejected

```text
Given a produced spec holding the heading "### Failure path: existing file preserved" and the line "- **Given** `widgets.csv` already exists with prior content", 76 letters and digits in all as one run of the file
When  the judge's evidence is that run followed by about 300 letters and digits of invented claims about behaviour the spec does not state
Then  the run is at least 40 letters and digits but about 0.20 of the evidence, below EVIDENCE_WINDOW_SHARE, and the evidence is unsupported
```

**Scenario:** nothing the exact rule accepted is rejected

```text
Given the evidence test suite of delta-01 and delta-04
When  it runs against the new validator
Then  every case passes unchanged, including "abcdefghijkl and nothing else" and "twelve chars" being unsupported
```

## Out of scope

- A second judge call to obtain a verbatim quote, a change to the judge prompt, and any change to the judge library `tests/e2e/lib/llm_judge.ts`.
- Recording in `grading.json` which matching rule held, and any change to the shape of `grading.json` or `results.json`.
- Proving that a quoted excerpt entails the expectation: the rule checks grounding, as before.
- Re-measuring any skill, and refreshing any committed results file.
