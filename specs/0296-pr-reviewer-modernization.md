---
id: "0296"
slug: pr-reviewer-modernization
status: draft
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 1892
version: 1.0.0
---

# Modernize the pr-reviewer skill and agent with frozen evals, bundled scripts and a measured delta

## Intent

The `pr-reviewer` skill and its agent are rewritten to the skill authoring standard (spec 0293, `docs/skill-authoring-standard.md`), the way `pr-logbook` was (spec 0292). The steps of a review whose outcome is fixed (classifying the required checks, finding or applying the iteration label, choosing how the verdict is posted, validating the verdict's finding tags and identifiers) run as scripts bundled with the skill; the six existing linter scripts follow the common script contract; and the prompt keeps only the judgement a script cannot make: reading the change, deciding what is wrong, and writing the verdict. The effect is measured, not asserted: evaluation cases are merged before the skill changes, a baseline is measured on the unchanged skill, and the same frozen cases measure the rewritten skill. The rewrite is kept only when it does not score worse than the baseline beyond the tolerance. The skill stays generic: a project whose conventions differ from CrewRig's keeps using it without editing a script.

## Requirements

1. **R1 (two implementation pull requests).** The work SHALL land as two implementation pull requests, in this order. The *evals PR* SHALL carry R2 to R6 and SHALL change no file of the skill or the agent outside `artifacts/core/skills/pr-reviewer/evals/`. The *rewrite PR* SHALL carry R7 to R22, SHALL be opened only after the evals PR is merged, and SHALL NOT change `TOLERANCE` or any case or fixture.
2. **R2 (cases).** `evals/evals.json` SHALL be valid under spec 0290 and SHALL hold at least five evals covering at least: (a) a change with one seeded defect that the verdict must find, cite by file and line and tag; (b) a change whose required check is failing, where the verdict must not approve and must state the CI status; (c) a clean change with passing checks, where the verdict approves without invented objections; (d) a shared-identity posting (the authenticated login equals the PR author), where the verdict is a plain comment opening with `## Verdict:` and no review event is used; (e) a second pass, where the verdict opens with a prior-finding audit of the findings it is given. Every expectation SHALL be stated on the observable output (files produced and their content), never on how the output was produced, so that the same cases measure the skill before and after its steps move into scripts. Fixtures live under `evals/files/`.
3. **R3 (no forge access during an eval).** The data a review reads (the diff, the pull-request metadata, the checks, the authenticated login) SHALL be supplied as fixture files and the prompt SHALL tell the agent not to run `gh`, `glab`, `tea` or `git push`; the verdict and the command the agent would run to post it are written to files. No eval SHALL use an `exit_code` check, because the measured baseline has no `scripts/`.
4. **R4 (trigger probes).** The file SHALL carry at least six trigger probes, at least three positive, and the negatives SHALL be near-misses that share the skill's vocabulary: writing a pull-request body, reviewing one's own uncommitted work, writing a spec, composing a local commit message.
5. **R5 (baseline).** Before the evals PR is merged, the contributor SHALL run `task skill-evals -- pr-reviewer` without mock mode at least twice on the unchanged skill, each in a fresh output directory, and a third time when the first two `with_skill` means differ by more than `TOLERANCE`. The evals PR SHALL commit the `evals/results.json` of the median run (the earliest on a tie) and the logbook SHALL record, per run, the `with_skill` and `without_skill` means, `executor_runs`, `judge_calls` and `cost_usd`. A run ending `error` or `skipped` does not count.
6. **R6 (frozen cases).** From the merge of the evals PR, `evals/evals.json` and the fixtures SHALL stay byte-identical until the ticket ends. A defect found in a case is recorded on the logbook and fixed by a separate pull request that re-measures the baseline.
7. **R7 (bundled scripts).** The skill SHALL bundle, under `artifacts/core/skills/pr-reviewer/scripts/`, these new scripts: `ci-preflight.ts`, `iter-label.ts`, `post-verdict.ts` and `lint-verdict.ts`. Every script of the skill, new or existing (`lint-markdown.ts`, `lint-skill.ts`, `lint-python.ts`, `lint-json.ts`, `lint-typescript.ts`, `check-comment-size.ts`), SHALL follow the script contract of `docs/skill-authoring-standard.md` → *The script contract*: single-file TypeScript on Node.js 24, no import, `--help`, `--json` with `{ok, data, findings}`, exit codes `0`/`1`/`2`/`3`, and `--dry-run` for any write.
8. **R8 (existing linters).** Moving the existing scripts onto the contract SHALL keep what they check and the line they print without `--json`, except that an unreadable input or a missing tool the script cannot degrade around exits `3` instead of `1`. `lint-typescript.ts`, `lint-skill.ts` and `check-comment-size.ts` keep their existing behaviours that repository tests pin; those tests are updated, never deleted, where the exit code of an unreadable input changes. The repository-root `scripts/check-comment-size.ts` keeps delegating to the skill's file.
9. **R9 (ci-preflight).** `ci-preflight.ts <pr>` SHALL classify each check of the pull request as `pass`, `fail` or `pending` (a cancelled check is `fail`, a skipped check is `pass`) and SHALL return `data` of the form `{overall, checks: [{name, bucket}], verdict_ceiling}`, where `overall` is `fail` when any check fails, else `pending` when any is pending, else `pass`, and `verdict_ceiling` is `REQUEST_CHANGES` when failing, `COMMENT` when pending and `APPROVE` when passing. It SHALL exit `0` when `overall` is `pass`, and `1` with one finding per failing or pending check otherwise. With `--required` it SHALL consider only required checks. With `--wait <attempts> --interval <seconds>` it SHALL repeat the query while the result is pending, at most the given number of attempts, and the result it reports is always that of one final direct query. With `--checks-file <file>` it SHALL read the checks from that JSON instead of calling `gh`, and then make no call.
10. **R10 (iter-label).** `iter-label.ts <pr>` SHALL read the pull request's labels and return `data` `{iter, applied}`: when exactly one label matches `iter:<N>` it SHALL return that `N` with `applied` false and change nothing; when several match it SHALL return the highest `N` and report a warning finding; when none matches it SHALL add `iter:1` through `gh pr edit --add-label` and return `{iter: 1, applied: true}`. When adding the label fails it SHALL exit `3` with `data.iter` null and a finding, so that no identifier is minted under an assumed number. `--dry-run` SHALL print the command and run none; `--labels-file <file>` SHALL read the labels from JSON and make no call.
11. **R11 (post-verdict).** `post-verdict.ts <pr> --event <approve|request-changes|comment> --body-file <file>` SHALL resolve the authenticated login and the pull-request author, and choose the posting rung: distinct identities post a formal review with `gh pr review <pr> --approve|--request-changes|--comment --body-file <file>`; equal identities post `gh pr comment <pr> --body-file <file>` and never a review event. For equal identities it SHALL refuse, with a finding and exit `1`, a body whose first non-empty line is not `## Verdict: APPROVE`, `## Verdict: REQUEST CHANGES` or `## Verdict: COMMENT` matching `--event`. For any body it SHALL refuse one over 12,288 bytes. When `gh` refuses the post it SHALL exit `3` with `data.rung` `"denied"` and a finding saying the verdict must be returned to the orchestrator, never posted by another agent. `--dry-run` SHALL print the resolved rung and the command and run no write; `--login` and `--author` SHALL take the two identities from the command line and make no lookup.
12. **R12 (lint-verdict).** `lint-verdict.ts <file> --surface <review|specs|plan>` SHALL check a verdict body and report a finding for: a missing or malformed `seat: <surface>/<ticket>[#<generation>]` line, or one whose surface differs from `--surface`; a finding header (a line carrying a reviewer-minted identifier in bold or in parentheses after the word `Finding`) that is not followed in its block by exactly one `class:` line with the value `tech`, `arch` or `spec`; an identifier that does not match the surface's format (`i<N>-F<M>` on `review`, `s<N>-F<M>` on `specs`, `v<N>-F<M>` on `plan`), a duplicated identifier, or, with `--ordinal <N>`, an identifier whose `<N>` differs. With `--prior-ids <id,id,...>` it SHALL also report a prior identifier that the body's audit does not mention. Text inside code fences SHALL be ignored. A body with no finding SHALL pass.
13. **R13 (scripts as designed for tests).** Each script SHALL have automated tests that run with no network and cover its success path, one finding path, the usage error (exit `2`), a precondition failure (exit `3`) where one exists, the `--json` shape and `--help`; a test SHALL run every script from a copy of the built skill directory placed outside the repository.
14. **R14 (skill body).** `SKILL.md` SHALL tell the model when to run each script and what each exit code means, and SHALL keep in prose only what no script decides: reading the project's conventions, judging the diff for correctness, convention compliance and test coverage, the bounded reading of a later pass, the prior-finding audit, the folded-bugs check, the spec-review tier challenge, and the grounding and fresh-observation disciplines. Every behaviour of the current skill SHALL remain, as a script call or in prose; one dropped on purpose SHALL be listed with its reason in the rewrite PR body.
15. **R15 (prompt style).** The skill's `SKILL.md` and `references/` SHALL pass `scripts/check-skill-quality.ts` with zero findings: description within 1,024 characters as what, `Use when` and trigger terms, with a `Not for` clause; no spec, requirement or issue citation; capitalised emphasis kept to what the standard allows; the body under 500 lines.
16. **R16 (shared references).** The skill SHALL replace its copies of the finding-class taxonomy, the grounding discipline and the friction reporting by citations of `references/shared-finding-class-taxonomy.md`, `references/shared-grounding-discipline.md` and `references/shared-friction-reporting.md`, keeping in the body only what is specific to a review (the identifier formats and the rule on a finding on an unchanged surface).
17. **R17 (agent).** `AGENT.md` SHALL describe when to delegate to it (a cold review of a pull request, a spec pull request, a verdict with a seat line) with trigger terms; keep its role, the cold-start brief, the handoff to the orchestrator and a pointer to the skill; and SHALL NOT restate the skill's six-step protocol, the check-wait and posting logic, or the idle text (replaced by a pointer to `references/shared-idle-behavior.md`'s rule or a one-line statement). The posting-identity ladder SHALL live only in `post-verdict.ts`. Friction reporting SHALL be one sentence pointing to the `harness-report` skill and SHALL NOT cite `config/TOOLS.md`.
18. **R18 (no tool allowlist).** `AGENT.md` SHALL NOT declare `metadata.tools`: the agent runs `gh` and the bundled scripts, which are the `execute` class, and `docs/authoring.md` → *metadata.tools* admits an allowlist only for an agent without `execute` or `edit`. The reason SHALL be recorded in the rewrite PR body, and the read-only intent is carried by the agent's out-of-scope statement (it comments only and never edits the change).
19. **R19 (packaging).** Both sources SHALL bump `metadata.provenance.version` (at least MINOR) and the built components SHALL be regenerated in the same change. Every built `pr-reviewer` skill directory SHALL contain `scripts/` and `references/` (shared copies included) and SHALL NOT contain `evals/`. `compatibility` SHALL name Node.js 24, `git` and `gh`.
20. **R20 (acceptance).** The rewrite PR SHALL commit the `evals/results.json` of a non-mock run on the rewritten skill, and SHALL be merged only when that run's status is not `regression` against the `base_mean` the same invocation measures on `main`'s skill. An improvement is not required.
21. **R21 (regression path).** When a run ends `regression`, the contributor SHALL revise the description first, then the body, the references or the scripts, never the cases or fixtures, within three measurement runs in total. When the third still ends `regression`, the rewrite PR is not merged and the figures are presented to the owner, who chooses between shipping the scripts with the original prose, abandoning the rewrite or changing the tolerance by a separate pull request.
22. **R22 (report).** Whatever the outcome, the logbook SHALL record the baseline and rewrite figures, their cost, which steps moved into scripts and which stayed in prose with the reason, and every place the script contract proved awkward.

## Scenarios

### Happy path — a required check fails

- **Given** a pull request with one failing required check and a clean diff,
- **When** the model runs `ci-preflight.ts --json`,
- **Then** `data.overall` is `fail`, `data.verdict_ceiling` is `REQUEST_CHANGES`, one finding names the failing check, and the exit code is `1`.

### Happy path — shared identity

- **Given** the authenticated login equals the pull-request author and a verdict body opening with `## Verdict: APPROVE`,
- **When** `post-verdict.ts 12 --event approve --body-file verdict.md --dry-run` runs,
- **Then** it prints a `gh pr comment 12 --body-file verdict.md` command, no `gh pr review`, and exits `0`.

### Happy path — a well-formed verdict

- **Given** a `review` verdict with a seat line and two findings `i2-F1` and `i2-F2`, each followed by one `class:` line,
- **When** `lint-verdict.ts verdict.md --surface review --ordinal 2` runs,
- **Then** it exits `0` with no finding.

### Failure path — untagged finding

- **Given** a verdict whose finding `i1-F2` has no `class:` line,
- **When** `lint-verdict.ts` runs on it,
- **Then** it reports a finding naming `i1-F2` and exits `1`.

### Failure path — label cannot be applied

- **Given** a pull request with no `iter:N` label and a forge that refuses the label edit,
- **When** `iter-label.ts` runs,
- **Then** it exits `3` with `data.iter` null, and the review states the failure instead of minting an identifier.

### Failure path — posting denied

- **Given** a forge that refuses even the plain comment,
- **When** `post-verdict.ts` runs,
- **Then** it exits `3` with `data.rung` `"denied"`, and the agent returns the verdict to the orchestrator without asking anyone else to post it.

### Failure path — regression after three attempts

- **Given** a run on the rewritten skill ends `regression` three times,
- **When** the third run is reported,
- **Then** the rewrite PR is not merged, the three runs are presented to the owner with the three choices of R21, and the cases are unchanged.

## Out of scope

- The other wave-1 skills and agents. `architect` is the next ticket and reuses `lint-verdict.ts` with the `plan` surface (R12).
- A `metadata.tools` allowlist on the agent (R18).
- Wiring the verdict linter into continuous integration: the seat contract states that nothing mechanical observes the seat line, and this change adds a tool for the reviewer, not a gate.
- Changes to the eval runner or `TOLERANCE`.

## Open questions

- None.
