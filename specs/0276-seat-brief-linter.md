---
id: "0276"
slug: seat-brief-linter
status: approved
complexity: small
interaction-mode: AUTO
related-issue: 1754
version: 1.0.0
---

# Seat brief linter

## Intent

Today a seated-pass brief that carries authoring context is only discovered after the pass has run: the verdict is voided on the forge and a full pass is wasted, because nothing mechanical observes the brief. After this spec, the orchestrator checks every seated-pass brief for form before the pass is spawned, a breaching brief is rejected with the offending lines named, and a conforming brief is produced from a template. The references-only rule is unchanged; only its enforcement moves. This is option d of ADR-0020, work package WP6 of epic #1724 (child of #1733).

## Requirements

1. **R1 (command).** `scripts/check-seat-brief.ts` SHALL read a brief from a file path argument or from stdin. It SHALL exit 0 and print `OK: seat <key>` on a conforming brief, exit 1 and print one `BREACH <rule>: <line n>: <excerpt>` per violation on stderr on a breach, and exit 2 on an unreadable input or a usage error. Its logic SHALL live in a `scripts/lib/governance/` module, following `scripts/check-comment-size.ts`.
2. **R2 (template).** `--template <specs|plan|review>` SHALL print a conforming skeleton brief for that surface and exit 0. Each template, fed back to the linter, SHALL exit 0 once its placeholders are replaced by values of the right kind, and its placeholder lines SHALL name the kind each value takes.
3. **R3 (grammar).** A brief SHALL be line-based `key: value`, blank lines allowed. Required keys: `seat` (`<surface>/<ticket>[#<generation>]`, surface one of `specs|plan|review`, ticket a decimal), `artifact` (one of `PR #N`, `issue #N`, a repo-relative path, a forge URL), `examined` (a 7 to 40 hex sha, a plan ordinal such as `v2`, or one of the literals `reconstruct from the dossier` and `none`), `prior-verdicts` (a location: forge URL, `issue #N`, `PR #N` or `issuecomment-<id>`, or the literal `none`), `disposition` (a location of the same kinds or the literal `none`; on the `plan` surface the literal `plan finding traceability table` is also allowed). The literal `none` is the first-pass form of `docs/reviewer-seat.md` (pass 1 has no prior revision, verdict or disposition). Optional: `ledger` (a location, or the literal `none`, which is equivalent to omitting the key). A value is exactly one reference: a parenthetical or trailing prose after the reference is a pattern mismatch (R5), so the canonical form is `artifact: PR #1755`, or the URL alone.
4. **R4 (procedural whitelist).** Only these optional procedural keys SHALL be accepted, each with a value pattern: `time-budget` (`<n> minutes`), `home` (an absolute path), `diary-agent-name` (an identifier), `pass-scope` (only `full (owner request)`). A brief carrying scratch `HOME`, a diary `agent_name` and a time budget SHALL pass.
5. **R5 (structural breaches).** The linter SHALL report a breach for: an unknown key; a missing required key; a duplicate key; a value over 200 characters or not matching its key's pattern (a value carrying sentence prose is a pattern mismatch); any line that is neither `key: value` nor blank; diff content (a line starting `diff --git`, `@@`, `+++` or `---`, or any fenced code block).
6. **R6 (vocabulary breach).** R6 is a diagnostic refinement: a line carrying prose already breaches R5, and R6 adds the named vocabulary rule so the report says why. The linter SHALL report a breach for any of these phrases, case-insensitive, on every line that is not a pattern-valid `key: value` line (a reference value that matches its key's pattern is never searched, so a path or URL containing `summary` or `background` is legal): `check in particular`, `focus on`, `pay attention`, `background`, `summary`, `summarise`, `summarize`, `supersede`, `superseded by`, `this pr implements`, `the delta`, `rationale`, `assessment`, `note that`, `in particular`.
7. **R7 (rule text).** The rule text of `docs/reviewer-seat.md` → *Instantiating a seated pass* SHALL be unchanged. That section SHALL gain one short paragraph requiring the orchestrator to run `check-seat-brief.ts` on every seated-pass brief before the spawn and not to spawn on a non-zero exit. `docs/agent-team-protocol/orchestrator.md` SHALL carry the same one-line requirement next to its *Handoff reference rule* (the passage that already distinguishes non-seat from seated spawn briefs), since the file has no dedicated seated-spawn section.
8. **R8 (limit, stated in the docs).** The paragraph of R7 SHALL state the ADR-0020 trade-off: the linter checks form only and cannot prove a brief is semantically clean; a conforming result is necessary, not sufficient, and the orchestrator remains responsible for intent. Voiding a discarded pass per *What counts as a dossier entry* is unchanged.
9. **R9 (fixtures and tests).** Committed fixtures under `scripts/tests/fixtures/seat-brief/` SHALL include: a conforming brief per surface; a first-pass brief (`examined: none`, `prior-verdicts: none`, `disposition: none`) per surface; the legitimate procedural-constraint brief of R4; one breach fixture per rule of R5 and R6; and the real breach pattern of #1410 (a background paragraph plus a "check in particular" focus list). A unit test `scripts/tests/check-seat-brief.test.ts` SHALL assert the exit code and the `BREACH` rule name for each fixture, and the template round trip of R2. The R2 templates are the canonical forms.
10. **R10 (task target and CI).** `Taskfile.yml` SHALL gain a `check-seat-brief` target taking `{{.CLI_ARGS}}`, shaped like `check-comment-size`. A CI job `check-seat-brief` SHALL be added to `ci/ci-capabilities.yml` with a paths filter, running the script on a conforming fixture (expects success) and a breaching fixture (expects failure, `!` prefix), and the unit test SHALL be added to the governance test job. The per-engine workflows (`.github/workflows/build.yml`, `.gitlab-ci.yml`) SHALL be regenerated with `scripts/build-ci.ts`. A `scripts/tests/check-seat-brief-ci-wiring.test.ts` SHALL mirror `check-comment-size-ci-wiring.test.ts`.
11. **R11 (author-side tool).** As with the comment size tool, the linter is run by the orchestrator before the spawn; CI cannot read a brief that exists only in a spawn prompt, so CI proves the script against committed fixtures only and is not a gate on live briefs.
12. **R12 (four-CLI symmetry).** The linter SHALL be a plain `node` script with no CLI-specific code path, run identically by the orchestrator on Claude Code, Gemini CLI, GitHub Copilot CLI and Antigravity CLI. Symmetry SHALL be proven by the orchestrator doc line of R7 being compiled unchanged to every CLI output, and by the CI job running on the same Node 24 floor; no `docs/cli-matrix/rows/` row is needed unless a CLI-specific integration point is touched, in which case the row and `docs/cli-matrix.md` are updated in the same diff.
13. **R13 (component wiring).** `artifacts/core/agents/pr-reviewer/AGENT.md` and the `pr-reviewer` skill, which restate the references-only brief, SHALL be checked, the Activation template of `AGENT.md` SHALL be aligned with the R2 templates and R3 key names (with its `metadata.provenance.version` bumped and compiled outputs rebuilt), and any `artifacts/` component that restates the seated-spawn procedure SHALL be updated with its `metadata.provenance.version` bumped, and compiled outputs rebuilt in the same commit. `scripts/` and `docs/` are already covered by directory entries in `.crewrig/core-paths.txt`, so no manifest change is required; if a new path is not covered, the manifest and `docs/layers.md` SHALL be updated in the same diff. The docs index SHALL be rebuilt if `docs/` frontmatter changes, and the path-ownership and test-wiring checks SHALL pass with the new script, tests and fixtures.
14. **R14 (invariants).** This spec adds a control and removes none (ADR-0020 4.1.1, 4.1.2), ships on all four CLIs together (4.1.5), and lands as its own PR, not bundled with another WP6 option.
15. **R15 (rollback and measurement).** The rollback trigger SHALL be: a rejected-but-legitimate brief blocks a pass more than once per ticket. After 2 to 3 comparable tickets, the voided-pass count (E4) and Q2 SHALL be measured and a keep or rollback entry SHALL be recorded as a logbook comment on #1733. This is a process obligation, not a script.

## Scenarios

**Scenario:** conforming brief passes

Given a brief with `seat: review/1754`, `artifact: PR #1760`, `examined: reconstruct from the dossier`, `prior-verdicts: issue #1760`, `disposition: issuecomment-4412`
When the orchestrator runs `check-seat-brief.ts` on it
Then the output is `OK: seat review/1754` and the exit code is 0

**Scenario:** first-pass brief passes

Given a brief with `seat: specs/1754`, `artifact: PR #1755`, `examined: none`, `prior-verdicts: none`, `disposition: none`
When the linter runs
Then the output is `OK: seat specs/1754` and the exit code is 0

**Scenario:** the #1410 breach is caught

Given a brief with a background paragraph and a "check in particular" list
When the linter runs
Then it exits 1 and stderr carries a `BREACH` line for the free-prose line and one for the vocabulary match

**Scenario:** legitimate procedural brief passes

Given a conforming brief plus `home: /tmp/seat-home`, `diary-agent-name: pr-reviewer` and `time-budget: 10 minutes`
When the linter runs
Then it exits 0

**Scenario:** unreadable input

Given a path that does not exist
When the linter runs
Then it exits 2 and stderr names the path

**Scenario:** template round trip

Given `--template plan` output with each placeholder replaced by a value of the named kind
When the linter runs on it
Then it exits 0

## Out of scope

- Judging semantic cleanliness or intent of a brief (named limit, R8).
- Changing the references-only rule text, the voiding procedure, or the dossier and ledger contracts of `docs/reviewer-seat.md`.
- Non-seat `Agent` spawn briefs (developer, architect, tester); only seated passes are linted.
- A CI gate on live briefs, or a hook that intercepts the `Agent` call.
- Other WP6 options (b, g, f, a) and the REJECT options (c, e).

## Open questions

- Resolved: vocabulary matching (R6) is whole-word and phrase based and never searches a pattern-valid reference value, so a path such as `docs/summary.md` is a legal reference.
- Resolved: `home` accepts any absolute path; restricting it to scratch directories is not derivable from the repo and would reject legitimate briefs (rollback trigger of R15).
- Resolved: `pass-scope` accepts only `full (owner request)`; widening it is a later delta-spec if `docs/reviewer-seat.md` evolves.
