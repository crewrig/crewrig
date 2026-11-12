---
id: "0292"
slug: pr-logbook-pilot
status: implemented
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 1880
version: 1.0.0
---

# Pilot the pr-logbook modernization with frozen evals, bundled scripts and a measured delta

## Intent

The `pr-logbook` skill and its agent are rewritten along the two principles of epic #1856: the steps whose outcome is fixed (the PR body layout, the title rule, the choice of the logbook target, the spec status transition, the executable-bit check) run as scripts bundled with the skill, and the prompt keeps only the judgement those scripts cannot make. The effect of the rewrite is measured, not asserted: evaluation cases are written and merged before the skill changes, a baseline is measured on the unchanged skill, including how much it varies from one run to the next, and the same frozen cases measure the rewritten skill. The rewrite is kept only when it does not score worse than the baseline beyond the tolerance. The before/after figures, their cost and the lessons learned are published for the authoring standard (#1848) before that standard is frozen. The skill stays generic: a project whose pull-request conventions differ from CrewRig's keeps using it without editing a script.

## Requirements

1. **R1 (two implementation pull requests).** The work SHALL land as two implementation pull requests, in this order: the first (the *evals PR*) SHALL carry R2 to R6 and R25 (the evaluation cases, the baseline and the tolerance) and SHALL change no file of the skill or the agent outside `artifacts/core/skills/pr-logbook/evals/`; the second (the *rewrite PR*) SHALL carry R8 to R24 and SHALL NOT change `TOLERANCE`, and it SHALL be opened only after the evals PR is merged to `main`. An evals PR that changes only files under `evals/` needs no `metadata.provenance.version` bump (spec 0290 R8).
2. **R2 (cases).** `artifacts/core/skills/pr-logbook/evals/evals.json` SHALL be valid under spec 0290 R1 to R6 and SHALL hold at least three evals that together cover at least these behaviours of the current skill: (a) composing a PR title and body for a described change, (b) choosing where a logbook entry goes and writing it, and (c) recording a spec's `approved` to `implemented` transition. Every expectation SHALL be stated on the observable output of the run (files produced, their content), never on how the output was produced, so that the same cases measure the skill before and after its steps move into scripts. Fixtures SHALL live under `evals/files/`.
3. **R3 (no check that presumes the rewrite).** No eval SHALL use a `checks` entry of type `exit_code`, because the skill measured as the baseline has no `scripts/` directory; `file_exists` and `file_contains` checks are permitted.
4. **R4 (no forge write during an eval).** An eval run executes with the contributor's real credentials (`docs/skill-evals.md` → *Filesystem reach*). No eval prompt SHALL ask the agent to create, edit, comment on or close a pull request, an issue or any other forge artifact; a case that exercises a forge action SHALL ask for the text and the command the agent would run to be written to files in the run's output directory instead. When a case needs a repository, its fixture SHALL be a local repository built from files under `evals/files/` with no remote configured.
5. **R5 (trigger probes).** The file SHALL carry at least six trigger probes, of which at least half are positive and the negatives are near-misses that share vocabulary with the skill's domain (for example reviewing a pull request, writing a spec, writing a commit message for an unpushed change) rather than unrelated requests.
6. **R6 (baseline and its spread).** Before the evals PR is merged, the contributor SHALL run `task skill-evals -- pr-logbook` without mock mode three times on the unchanged skill, each run in a fresh output directory. The evals PR SHALL commit the `evals/results.json` of the run whose `with_skill` mean is the median of the three (the earliest of them when two or more share the median value), and the logbook of issue #1880 SHALL record, for each of the three runs, the `with_skill` and `without_skill` means, the delta, `executor_runs`, `judge_calls` and `cost_usd`, plus the spread of the three `with_skill` means (maximum minus minimum, and population standard deviation). A run that ends with status `error` or `skipped` SHALL NOT count as one of the three.
7. **R7 (frozen cases).** From the merge of the evals PR until the end of this ticket, `evals/evals.json` and every fixture under `evals/files/` SHALL stay byte-identical. A defect found in a case after that merge SHALL be recorded on the logbook and fixed by a separate pull request that re-measures the baseline per R6 before the rewrite PR is measured again.
8. **R8 (bundled scripts).** The skill SHALL bundle these scripts under `artifacts/core/skills/pr-logbook/scripts/`, each a single-file TypeScript program that runs on Node.js 24 from the installed skill directory with no file outside it and no import (built-ins through `process.getBuiltinModule`, as spec 0289 established): `compose-pr-body.ts`, `lint-pr-body.ts`, `resolve-logbook-target.ts`, `flip-spec-status.ts` and `check-exec-bits.ts`.
9. **R9 (provisional script contract).** Every script of R8 SHALL: answer `--help` with its usage on stdout and exit 0; with `--json`, print exactly one JSON object `{ok, data, findings}` on stdout, where `ok` is a boolean, `data` is the script's result (or `null`) and `findings` is an array of objects each carrying at least `rule` and `message`, and print human-readable text on stderr only; without `--json`, print human-readable text; exit `0` when it succeeded with no finding, `1` when it reports at least one finding, `2` on a usage error (unknown option, missing or extra argument) and `3` when a precondition or the environment fails (an unreadable input, a missing `git`, not a git repository); and accept `--dry-run` when it can write anything, reporting what it would write and writing nothing. This contract SHALL be stated in `references/script-contract.md` of the skill and labelled provisional, pending its ratification or amendment by the authoring standard (#1848).
10. **R10 (template as data).** The PR body template SHALL be data: `assets/pr-body.template.md` SHALL hold the body template of `docs/pr-format.md`, and `compose-pr-body.ts` and `lint-pr-body.ts` SHALL accept `--template <file>`, using the bundled asset when the option is absent. The set of required sections SHALL be derived from the second-level headings of the active template, in template order; no section heading SHALL be written in the scripts' code. Template text before the first second-level heading is the *preamble* (in the bundled template, the purpose sentences); template text under a heading, including a labelled line such as `Folded bugs:`, is placeholder guidance for that section. The scripts SHALL treat both as placeholders to be replaced by content and SHALL NOT check their wording; a rule on such a line (for example what `Folded bugs:` must list) stays in the skill's prose.
11. **R11 (compose).** Given the content of the preamble and of some or all sections, `compose-pr-body.ts` SHALL print a body that starts with the supplied preamble when the active template has one, followed by second-level headings exactly those of the active template, in template order, each followed by its supplied content, and SHALL report one finding per section left without content, naming the heading, plus one finding when the template has a preamble and none was supplied. With no content at all it SHALL print the template unchanged and report the preamble and every section.
12. **R12 (lint).** Given a title and a body, `lint-pr-body.ts` SHALL report a finding, naming the rule, for: a title longer than 70 characters counted in Unicode code points, a title ending with a period, a required section of the active template that is missing, duplicated or out of order, an empty preamble when the active template has one, and a literal CI skip directive (`[skip ci]`, `[ci skip]`, `[skip actions]`, `[no ci]`, matched case-insensitively) anywhere in the title or in the body outside inline code spans and fenced code blocks (`docs/pr-format.md` → *Continuous Integration directives*). With `--title-style gitmoji` it SHALL also report a title that does not start with exactly one emoji followed by a space, where one emoji is one extended grapheme cluster whose first code point has the Unicode `Extended_Pictographic` property, or that carries a conventional-commit prefix (a lowercase word, optionally followed by a parenthesised scope, then `:`, at the start of the text after the emoji or at the start of the title); without the option it SHALL apply no title-prefix rule. A title and body that break no rule SHALL exit 0.
13. **R13 (logbook target).** Given a PR body, `resolve-logbook-target.ts` SHALL return `data` of the form `{mode, issue, issues, label_required}`: when the body carries, outside inline code spans and fenced code blocks, at least one closing reference of the form `<keyword> #<N>` or `<keyword>: #<N>`, where `<keyword>` is one of GitHub's closing keywords (`close`, `closes`, `closed`, `fix`, `fixes`, `fixed`, `resolve`, `resolves`, `resolved`, matched case-insensitively as a whole word), `mode` SHALL be `feature-issue`, `issues` SHALL list every referenced number once in order of first appearance, `issue` SHALL be the first of them and `label_required` SHALL be `false`; when it carries none, `mode` SHALL be `standalone`, `issue` SHALL be `null`, `issues` SHALL be empty and `label_required` SHALL be `true`. A reference to another repository (`owner/repo#N`) SHALL NOT count. The script SHALL make no network call and SHALL exit 0 in both modes.
14. **R14 (spec status flip).** Given the path of a spec file, `flip-spec-status.ts` SHALL rewrite the value of the frontmatter `status` key from `approved` to `implemented` and SHALL leave every other byte of the file unchanged, the line ending, any quoting of the value (`'approved'`, `"approved"`) and any trailing whitespace or `#` comment on that line included. On a spec already `implemented` it SHALL write nothing and exit 0 with `data.changed` false. On any other status it SHALL write nothing and exit 1 with a finding naming the status found. On a file with no frontmatter `status` line it SHALL exit 3. It SHALL NOT stage, commit or push anything.
15. **R15 (executable bits).** Given paths, or by default the files changed between `HEAD` and its merge base with a base ref (default `origin/main`, overridable with `--base`), `check-exec-bits.ts` SHALL report a finding for each file whose working-tree copy is executable or starts with a `#!` line while the index records mode `100644`, and SHALL name the command that restores the bit. A deleted path SHALL be skipped. It SHALL change nothing.
16. **R16 (script tests).** Each script SHALL have automated tests that run with no network and cover its success path, at least one finding path, the usage error (exit 2), a precondition failure (exit 3) where one exists, the `--json` shape of R9 and `--help`. A test SHALL run every script from a copy of the built skill directory placed outside the repository, proving R8's self-containment.
17. **R17 (skill body).** `SKILL.md` SHALL tell the model when to run each script of R8 and what each of its exit codes means, and SHALL keep in prose only what the scripts cannot decide: reading the project's own conventions, choosing the content of each section, writing the logbook entry and the squash commit message, and the single-writer and grounding disciplines. Every behaviour of the current skill (its sections 1 to 7, *single writer per forge artifact* and *Grounding discipline*) SHALL remain, either as a script call or in prose; a behaviour dropped on purpose SHALL be listed with its reason in the rewrite PR body.
18. **R18 (prompt style).** The `SKILL.md` body and its `references/` SHALL NOT cite a spec or requirement number (`spec NNNN`, `R<N>`) or an issue number; a rule SHALL state the reason it exists instead of resting on capitalised emphasis (`MUST`, `NEVER`, `CRITICAL`); the body SHALL stay under 500 lines. Citations of the project's own documents by path and section (for example `AGENTS.md` → *Logbook Issues*) remain allowed.
19. **R19 (description).** The skill's `description` SHALL be written in the third person and SHALL state what the skill does, a `Use when` clause, and the trigger terms a delegating model looks for, within the description length limit in force when the rewrite PR merges (300 characters today, spec 0269 R11).
20. **R20 (friction pointer).** The skill and the agent SHALL point to the `harness-report` skill in one sentence for friction reporting and SHALL NOT cite `config/TOOLS.md`, which does not ship to adopters.
21. **R21 (agent).** `AGENT.md`'s `description` SHALL state when to delegate to the agent, with trigger terms. Its body SHALL keep the agent's role, its handoff boundaries and a pointer to the skill, and SHALL NOT restate rules the skill carries (the title rule, the body sections, the logbook entry layout, the grounding checks).
22. **R22 (packaging).** `compatibility` SHALL name Node.js 24 alongside `git` and the forge CLI. Both sources SHALL bump `metadata.provenance.version` (at least MINOR) and the built components SHALL be regenerated in the same change; every built `pr-logbook` skill directory, the Copilot user-scope install included, SHALL contain `scripts/`, `references/` and `assets/` and SHALL NOT contain `evals/` (spec 0290 R7). The bundled-script citation check of spec 0289 R8 SHALL pass.
23. **R23 (acceptance).** The rewrite PR SHALL commit the `evals/results.json` of a non-mock run on the rewritten skill, against the frozen cases of R7. The comparator is the runner's own base replay: the `base_mean` that the same invocation measures on the skill as of the merge base with `main`, in the same conditions as the head run (spec 0290 R19). The rewrite PR SHALL be merged only when that run's status is not `regression`, that is when its `with_skill` mean is not lower than its `base_mean` by more than the `TOLERANCE` set on `main` by the evals PR (R25). The baseline committed under R6 serves the spread, the tolerance and the report of R26; it is not the comparator. An improvement is not required.
24. **R24 (regression path).** When a run on the rewritten skill ends with status `regression` (R23), the contributor SHALL revise the skill, the agent or the scripts, never the cases or fixtures, and measure again, within three measurement runs in total for the rewrite PR. If the third run still ends with status `regression`, the rewrite PR SHALL NOT be merged; the figures of the three runs SHALL be presented to the user, who decides between shipping the scripts with the original prose, abandoning the rewrite, or changing the tolerance by a separate pull request that records the reason in `docs/skill-evals.md`, and the decision SHALL be recorded on the logbook of issue #1880.
25. **R25 (tolerance calibration).** The evals PR, before any measurement of the rewritten skill exists, SHALL set `TOLERANCE` in `scripts/lib/skill-evals/settings.ts` from the spread measured under R6 and SHALL record the reasoning in `docs/skill-evals.md`; when that spread does not justify a change, it SHALL keep `0.05` and say so there. These two files are the only ones outside `evals/` that the evals PR MAY change. `REGRESSION_BLOCKING` and `MISSING_EVALS_BLOCKING` SHALL stay `false`.
26. **R26 (report to the standard).** Whatever the outcome of R23 or R24, a comment on issue #1848 SHALL report: the baseline figures and spread of R6, the rewritten skill's figures, the delta, the total cost and model runs, the tolerance decided under R25, which steps moved into scripts and which stayed in prose with the reason, and every point where the provisional contract of R9 proved awkward or insufficient.

## Scenarios

### Happy path — evals merged first, rewrite accepted

- **Given** the evals PR adds `evals/evals.json` with three evals and six trigger probes, none using an `exit_code` check,
- **When** the contributor runs the evals three times on the unchanged skill, commits the `evals/results.json` of the median run and sets `TOLERANCE` from the measured spread,
- **Then** the attestation check of the pull-request pipeline passes, the three runs and their spread are on the logbook of #1880, and no file outside `evals/`, `scripts/lib/skill-evals/settings.ts` and `docs/skill-evals.md` changed.
- **Given** the evals PR is merged and the rewrite PR leaves `evals/` untouched except `results.json`,
- **When** the run on the rewritten skill gives a `with_skill` mean that is not lower than the `base_mean` the same run measures on `main`'s skill by more than the tolerance,
- **Then** the rewrite PR may be merged and a comment on #1848 reports the before/after figures, the cost, the tolerance and the lessons.

### Happy path — a project with its own template

- **Given** a project whose PR body template has the headings `## Summary` and `## Testing`,
- **When** the model runs `lint-pr-body.ts --template <that file>` on a body that has both headings in that order,
- **Then** the script exits 0, and no CrewRig heading is required.

### Happy path — logbook target

- **Given** a PR body containing `Fixes #12` and later `closes #40`,
- **When** `resolve-logbook-target.ts --json` reads it,
- **Then** it prints `{"ok": true, "data": {"mode": "feature-issue", "issue": 12, "issues": [12, 40], "label_required": false}, "findings": []}` and exits 0.

### Failure path — regression after three attempts

- **Given** a run on the rewritten skill gives a `with_skill` mean 0.15 below its `base_mean` and the tolerance on `main` is 0.05,
- **When** two revisions of the skill text still leave it more than 0.05 below its `base_mean` on the third measurement run,
- **Then** the rewrite PR is not merged, the three runs are presented to the user with the three choices of R24, and the cases are unchanged.

### Failure path — spec in the wrong state

- **Given** a spec whose frontmatter says `status: draft`,
- **When** `flip-spec-status.ts` runs on it,
- **Then** the file is unchanged, a finding names the status `draft`, and the script exits 1.

### Failure path — missing section and skip directive

- **Given** the bundled template and a body that lacks `## How to test this PR?` and contains `[skip ci]`,
- **When** `lint-pr-body.ts` runs,
- **Then** it reports two findings, one naming the missing heading and one naming the skip directive, and exits 1.

### Failure path — an eval that would write to the forge

- **Given** a draft eval whose prompt asks the agent to open the pull request,
- **When** the evals PR is reviewed,
- **Then** the case breaks R4 and is rewritten to ask for the title, the body and the `gh pr create` command as files.

### Failure path — script run outside a repository

- **Given** the built skill directory copied to an empty temporary directory that is not a git repository,
- **When** `check-exec-bits.ts` runs there,
- **Then** it exits 3 with a message stating that no git repository was found, and it writes nothing.

## Out of scope

- The authoring standard and its linter (#1848): the 1,024-character description cap, the shared boilerplate reference (the idle and shutdown sections of the skill stay as they are), and `check-skill-quality.ts`. Ratifying the provisional contract of R9 is #1848's decision.
- The other six skills and agents of wave 1 (#1852), including removing the executable-bit step that `developer` duplicates: `developer` is unchanged by this ticket.
- A `metadata.tools` allowlist on the `pr-logbook` agent: the agent edits files (the spec status flip) and runs the forge CLI, so a least-privilege list would not remove a class.
- Making a regression or a missing evals directory blocking (`REGRESSION_BLOCKING`, `MISSING_EVALS_BLOCKING`).
- Changes to the eval runner other than the `TOLERANCE` value and its documentation, and repeated runs per eval inside the runner; the three baseline runs of R6 are three invocations.
- Scripts for steps with no fixed outcome: the squash commit message and the logbook entry text stay in prose.

## Open questions
