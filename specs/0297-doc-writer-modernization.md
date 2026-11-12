---
id: "0297"
slug: doc-writer-modernization
status: draft
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 1903
version: 1.0.0
---

# Modernize the doc-writer skill and agent to the authoring standard

## Intent

The `doc-writer` skill and its agent are rewritten to the skill authoring standard (`docs/skill-authoring-standard.md`), following the `pr-logbook` pilot. The two fixed-outcome steps of writing an ADR, minting the next number with the right template and checking that a written ADR has the required shape, run as bundled scripts instead of prose the model re-derives. The prompt keeps what a script cannot decide: who the reader is, what the decision and its consequences are, and whether a document should exist at all. Its description separates documentation work from the neighbouring tasks that share its vocabulary, its friction text points to the shared reference, and the effect is measured with the eval runner.

## Requirements

1. **R1 (order of work).** The work SHALL land as one implementation pull request whose commits are ordered: first `evals/` (cases and fixtures) with no change to the skill or agent, then a baseline measurement on the unchanged skill, then the scripts and the rewrite, then the final measurement. Cases and fixtures SHALL stay byte-identical after the first commit.
2. **R2 (cases).** `artifacts/core/skills/doc-writer/evals/evals.json` SHALL be valid under the eval schema of `docs/skill-evals.md` and SHALL hold at least five evals covering: a new ADR in a directory that already holds numbered ADRs; an ADR that supersedes an accepted one; a README for an external integrator; docstrings that state a contract; and a request for documentation nobody needs (a recap of work just done), where the correct output is no new document. Every expectation SHALL be stated on observable output (files and their content), never on how the output was produced, so the same cases measure the skill before and after the scripts exist.
3. **R3 (no forge, no script check).** No eval prompt SHALL ask the agent to create, edit, comment on or close a forge artifact. Fixtures SHALL be plain files under `evals/files/`. No eval SHALL use an `exit_code` check on a bundled script, so the same cases run against the unchanged skill.
4. **R4 (probes).** The file SHALL carry at least six trigger probes, at least 40 percent positive and at least 40 percent negative. The negatives SHALL be near-misses that share vocabulary: a pull request description, an inline code comment, a local commit message, an implementation plan, a spec.
5. **R5 (measurement).** The contributor SHALL measure the unchanged skill and the rewritten skill with `task skill-evals -- doc-writer`, report both pass rates, the probe results, the cost and the run counts on the logbook, and commit the `evals/results.json` of a non-mock run on the final skill. The rewrite SHALL be kept only when the final status is not `regression`. A probe failure SHALL be fixed by revising the description before the body.
6. **R6 (new-adr script).** The skill SHALL bundle `scripts/new-adr.ts`, a single-file TypeScript program that follows the script contract of the standard (Node.js 24, no import, `--help`, `--json` object `{ok, data, findings}`, exit codes 0/1/2/3, `--dry-run`). Given `--title <text>` and optionally `--dir <path>` (default `docs/adr`) and `--status <value>`, it SHALL compute the next ADR number as one more than the highest four-digit prefix of the files in the directory (`0001` for an empty or missing directory), derive a kebab-case ASCII slug from the title, and write `<dir>/<NNNN>-<slug>.md` from the bundled template `assets/adr.template.md` with the heading, the status and the section headings in place. It SHALL refuse an empty title, an unknown status and an existing target as findings with exit 1, and write nothing under `--dry-run`.
7. **R7 (lint-adr script).** The skill SHALL bundle `scripts/lint-adr.ts` with the same contract. Given one or more ADR files, it SHALL report a finding, naming the rule, for: a heading that is not `# ADR-<NNNN>: <title>`, a missing, duplicated or misordered section among Status, Context, Decision and Consequences, a Status that is not one of Proposed, Accepted, Deprecated or `Superseded by ADR-<MMMM>`, an unfilled template placeholder, and a Consequences section that lacks one of its Positive, Negative and Neutral bullets. It SHALL report an unmodified bundled template as findings, so that placeholder text cannot pass for content. A Context of more than five sentences SHALL be a warning, not an error.
8. **R8 (script tests).** Each script SHALL have automated tests that run with no network and cover its success path, each refusal or finding of R6 and R7, the usage error, the `--json` shape and `--help`, and SHALL run from a copy of the built skill directory outside the repository.
9. **R9 (skill body).** `SKILL.md` SHALL tell the model when to run each script and what each exit code means, and SHALL keep in prose what the scripts cannot decide: naming the reader, the content of each section, the README section order, docstring contracts, the six-month ageing check, and the rule to write no document nobody asked for. Every behaviour of the current skill SHALL remain, in prose or as a script call; a behaviour dropped on purpose SHALL be listed on the logbook with its reason. The skill SHALL allow `Bash` so that it can run the scripts.
10. **R10 (prompt style and description).** The `SKILL.md` body and its references SHALL carry no spec, requirement or issue citation and no more than five capitalised `MUST`, `NEVER`, `CRITICAL`, `ALWAYS` or `IMPORTANT` outside code; every rule SHALL state its reason; the body SHALL stay under 500 lines. The `description` SHALL be third person, state what the skill does, a `Use when` clause with trigger terms and a `Not for` clause, within 1,024 characters, and `compatibility` SHALL name Node.js 24.
11. **R11 (shared references and agent).** The skill SHALL replace its friction paragraph with a pointer to `references/shared-friction-reporting.md` and SHALL NOT cite `config/TOOLS.md`. `AGENT.md`'s `description` SHALL state when to delegate with trigger terms; its body SHALL drop what the skill carries (the ADR sections, the README order, the docstring rule) and keep the role, the handoff boundaries, a pointer to the skill and a one-line pointer to `harness-report`.
12. **R12 (packaging).** Both sources SHALL bump `metadata.provenance.version`, the built components SHALL be regenerated in the same change, and every built `doc-writer` skill directory SHALL contain `scripts/`, `assets/` and no `evals/`. `task check-skill-quality -- doc-writer` SHALL report no error and the bundled-script citation check SHALL pass.

## Scenarios

### Happy path — new ADR

- **Given** a directory holding `0001-a.md` to `0003-c.md`,
- **When** the model runs `new-adr.ts --title "Use PostgreSQL for the ledger"`,
- **Then** `0004-use-postgresql-for-the-ledger.md` exists with the heading `# ADR-0004: Use PostgreSQL for the ledger`, the four sections in order, and the script exits 0.

### Happy path — a filled ADR lints clean

- **Given** an ADR with the heading form, an `Accepted` status, the four sections and the three consequence bullets,
- **When** `lint-adr.ts` runs on it,
- **Then** it reports no finding and exits 0.

### Failure path — unmodified template

- **Given** the file that `new-adr.ts` just wrote and nothing else,
- **When** `lint-adr.ts` runs on it,
- **Then** it reports the placeholders and exits 1.

### Failure path — bad status or section order

- **Given** an ADR whose Status is `Done` and whose Decision precedes its Context,
- **When** `lint-adr.ts` runs,
- **Then** it reports the status and the order as two findings and exits 1.

### Failure path — empty title or existing target

- **Given** an empty title, or a title whose number and slug already exist,
- **When** `new-adr.ts` runs,
- **Then** it writes nothing and exits 1 with a finding.

### Failure path — rewrite regresses

- **Given** the final measurement is below the baseline by more than the tolerance,
- **When** the contributor revises the description, then the body,
- **Then** the cases stay unchanged and, if the run still regresses, the figures go to the user for decision.

## Out of scope

- The other wave-1 skills and agents.
- Changing the eval runner, its settings or the spec linter.
- Making the agent's tools read-only: it writes documents.
- Normalising the repository's existing ADRs, which carry other formats and two duplicate numbers: `lint-adr.ts` applies to ADRs written with the skill's template.
- Scripts for README structure or docstrings: their outcome is a judgement.

## Open questions
