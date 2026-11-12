---
id: "0294"
slug: spec-author-modernization
status: draft
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 1894
version: 1.0.0
---

# Modernize the spec-author skill and agent to the authoring standard

## Intent

The `spec-author` skill and its agent are rewritten to the skill authoring standard (`docs/skill-authoring-standard.md`), following the `pr-logbook` pilot. The fixed-outcome steps of authoring a spec (the ticket-pickup check, the id reservation, the slug, the frontmatter and the five mandatory headings) run as one bundled script instead of prose that the agent re-derives, and the preflight that the agent prompt carries today moves into the skill. The runtime prompt loses its spec and issue citations and its capitalised rule walls, and the duplicated friction and finding-taxonomy text is replaced by pointers to the shared references. The effect is measured with the eval runner: evaluation cases are written first and the rewrite is kept only when its pass rate does not fall below the baseline by more than the runner's tolerance.

## Requirements

1. **R1 (order of work).** The work SHALL land as one implementation pull request whose commits are ordered: first `evals/` (cases and fixtures) with no change to the skill or agent, then the baseline measurement on the unchanged skill, then the script and the rewrite, then the final measurement. Cases and fixtures SHALL stay byte-identical after the first commit.
2. **R2 (cases).** `artifacts/core/skills/spec-author/evals/evals.json` SHALL be valid under the eval schema of `docs/skill-evals.md`, SHALL hold at least five evals and SHALL cover at least: a spec for a described intent in a repository with a `specs/` directory; a delta-spec for a parent spec that exists; a spec whose open question the user did not resolve (parked, not dropped); and a spec whose every requirement answers its null case and names a permitted path. The ticket-ownership refusal is not an eval, because it needs a forge. Every expectation SHALL be stated on observable output (files and their content), never on how the output was produced, so the same cases measure the skill before and after the script exists.
3. **R3 (no forge, no repository tool).** No eval prompt SHALL ask the agent to create, edit, comment on or close a forge artifact, to reserve a spec id on a remote, or to push. An eval that needs a repository SHALL use a local fixture built from `evals/files/` with no remote, and its prompt SHALL give the id to use. No eval SHALL use an `exit_code` check on the script, so the same cases run against the unchanged skill.
4. **R4 (probes).** The file SHALL carry at least six trigger probes, at least 40 percent positive and at least 40 percent negative. The negatives SHALL be near-misses that share vocabulary: writing an implementation plan, an ADR, a PR body, a local commit message, reviewing a spec-PR.
5. **R5 (measurement).** The contributor SHALL run `task skill-evals -- spec-author` once on the unchanged skill and once on the rewritten skill, and SHALL report both pass rates, the probe results, the cost and the number of runs on the logbook. The rewrite SHALL be kept only when the final status is not `regression`. A probe failure SHALL be fixed by revising the description before the body. The pull request SHALL commit the `evals/results.json` of a non-mock run on the final skill.
6. **R6 (script).** The skill SHALL bundle `scripts/scaffold-spec.ts`, a single-file TypeScript program that follows the script contract of the standard (Node.js 24, no import, `--help`, `--json` object `{ok, data, findings}`, exit codes 0/1/2/3, `--dry-run`). Given `--issue <N>`, `--slug <kebab-case>`, `--complexity <tier>` and `--mode <mode>`, it SHALL run the preflight of R7, then write `specs/<NNNN>-<slug>.md` with the frontmatter of `docs/spec-format.md` (`status: draft`, `version: 1.0.0`, the slug matching the filename) and the five mandatory headings, verbatim and in order. It SHALL refuse a slug that is not ASCII kebab-case of at most 40 characters, a complexity or a mode outside the allowed values, and an existing target file, each as a finding with exit 1.
7. **R7 (preflight in the script).** When it is not in `--dry-run` and not in delta mode, `scaffold-spec.ts` SHALL first run the repository's ticket-pickup check and stop on any non-zero exit with a finding that relays the check's reason, then reserve the id through the repository's reservation tool and read its exit code: `0` use the id, `3` use the id and write the line `unsecured-id: true` into the frontmatter, `1` stop and relay the reason. It SHALL never compute `max(existing) + 1` over the local tree, never pass `--id` or `--corpus` to the reservation tool, and never assign or unassign a ticket. When the repository does not ship these tools, it SHALL exit 3 with a message naming the manual equivalent (read the issue's assignees and stop when it is assigned to someone else; take the next unused number after fetching the default branch and checking open pull requests and branches).
8. **R8 (delta mode).** With `--delta`, `scaffold-spec.ts` SHALL make no preflight call and no reservation, SHALL find the parent spec of the issue's id, and SHALL write `specs/<NNNN>-<slug>.delta-<NN>.md` with `<NN>` the next free two-digit delta number and the three headings `## ADDED`, `## MODIFIED` and `## REMOVED`, all present even when empty. With no parent spec it SHALL exit 1 with a finding.
9. **R9 (dry run).** With `--dry-run` the script SHALL write nothing, run neither the pickup check nor the reservation, use the placeholder `NNNN` for the id, and print the path and the file it would write.
10. **R10 (script tests).** The script SHALL have automated tests that run with no network and cover its success path, each refusal of R6, the three reservation exits of R7 against a fake tool, the missing-tool precondition, the delta path, `--dry-run`, the `--json` shape and `--help`. A test SHALL run the script from a copy of the built skill directory outside the repository.
11. **R11 (skill body).** `SKILL.md` SHALL tell the model when to run `scaffold-spec.ts` and what each exit code means, and SHALL keep in prose what the script cannot decide: the interview, the pre-write grounding, the content of each section, the open-questions discipline, the null-case and permitted-path self-check, and the mode choice. The ticket-pickup and reservation text of `references/output-contract.md` SHALL be replaced by the script's exit-code table. Every behaviour of the current skill SHALL remain, in prose or as a script call; a behaviour dropped on purpose SHALL be listed on the logbook with its reason.
12. **R12 (prompt style).** The `SKILL.md` body and its `references/` SHALL carry no spec, requirement or issue citation and no more than five capitalised `MUST`, `NEVER`, `CRITICAL`, `ALWAYS` or `IMPORTANT` outside code; every rule SHALL state its reason. Citations of the project's documents by path and section remain allowed. The body SHALL stay under 500 lines and every reference longer than 100 lines SHALL open with a `Contents` heading.
13. **R13 (description).** The skill's `description` SHALL be third person, state what the skill does, a `Use when` clause with trigger terms, and a `Not for` clause (plans, ADRs, PR bodies), within 1,024 characters.
14. **R14 (shared references).** The skill SHALL replace its finding-class taxonomy section and its harness-friction section with pointers to `references/shared-finding-class-taxonomy.md` and `references/shared-friction-reporting.md`, keeping only the spec-author-specific friction triggers. The skill and the agent SHALL NOT cite `config/TOOLS.md`.
15. **R15 (agent).** `AGENT.md`'s `description` SHALL state when to delegate (a new non-trivial ticket needs a spec, a `spec`-class review finding needs a delta-spec) with trigger terms. Its body SHALL drop the ticket-pickup and id-reservation preflight, now in the skill, and keep the role, the single deliverable, the handoff boundaries, the pointer to the skill and a one-line pointer to `harness-report`.
16. **R16 (packaging).** `compatibility` SHALL name Node.js 24 alongside `git`. Both sources SHALL bump `metadata.provenance.version`, the built components SHALL be regenerated in the same change, and every built `spec-author` skill directory SHALL contain `scripts/` and `references/` and no `evals/`. `task check-skill-quality -- spec-author` SHALL report no error and the bundled-script citation check SHALL pass.

## Scenarios

### Happy path — scaffold a spec

- **Given** a repository with the ticket-pickup and reservation tools and an issue the user owns,
- **When** the model runs `scaffold-spec.ts --issue 1894 --slug demo --complexity standard --mode INTERMEDIATE`,
- **Then** the id comes from the reservation tool, `specs/<NNNN>-demo.md` exists with `status: draft` and the five headings in order, and the script exits 0.

### Happy path — unsecured id

- **Given** the reservation tool exits 3 (offline),
- **When** the script runs,
- **Then** the frontmatter carries `unsecured-id: true`, the result reports `unsecured: true` and the exit code is 0.

### Happy path — delta

- **Given** a parent spec `specs/0100-demo.md` and `specs/0100-demo.delta-01.md`,
- **When** the script runs with `--delta` for that id,
- **Then** it writes `specs/0100-demo.delta-02.md` with `## ADDED`, `## MODIFIED` and `## REMOVED`, and calls no tool.

### Failure path — ticket owned by someone else

- **Given** the ticket-pickup check exits non-zero,
- **When** the script runs,
- **Then** it writes nothing, reserves nothing, exits 1 and relays the check's reason.

### Failure path — invalid slug or existing file

- **Given** the slug `Bad Slug` or a target file that already exists,
- **When** the script runs,
- **Then** it writes nothing and exits 1 with a finding naming the rule.

### Failure path — tools absent

- **Given** a repository that ships neither tool,
- **When** the script runs without `--dry-run`,
- **Then** it exits 3 and names the manual equivalent.

### Failure path — rewrite regresses

- **Given** the final measurement is below the baseline by more than the tolerance,
- **When** the contributor revises the description, then the body,
- **Then** the cases stay unchanged and, if still regressing after revision, the figures go to the user for decision.

## Out of scope

- The other wave-1 skills and agents, and the `doc-writer` skill (a separate ticket).
- Changing the eval runner, its settings, the spec linter, `reserve-spec-id.ts` or `ticket-pickup.ts`.
- Making the agent's tools read-only: it writes the spec file.
- Moving the interview and grounding steps into scripts: their outcome is a judgement.

## Open questions
