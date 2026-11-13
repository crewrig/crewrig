---
id: "0299"
slug: architect-modernization
status: draft
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 1915
version: 1.0.0
---

# Modernize the architect skill and agent with frozen evals, a byte-accounting script and a measured delta

## Intent

The `architect` skill and its agent are rewritten to the skill authoring standard (spec 0293, `docs/skill-authoring-standard.md`), the way `pr-logbook` (spec 0292) and `pr-reviewer` (spec 0296) were. The one fixed-outcome step of the skill, the byte accounting that decides whether a size-constrained plan really fits its budget, runs as a bundled script; the prompt keeps the judgement a script cannot make (framing, alternatives, blast radius, the choice of output) and points to shared references for the text every skill repeats. The effect is measured, not asserted: evaluation cases are written first, a baseline is measured on the unchanged skill, and the same frozen cases measure the rewritten skill, which is kept unless it scores worse than the baseline beyond the tolerance.

## Requirements

1. **R1 (one implementation pull request).** The work SHALL land as one implementation pull request whose branch holds, in this order: (1) a commit that adds only `evals/evals.json` and the fixtures under `evals/files/`; (2) a commit that adds only the `evals/results.json` of the baseline run of R3, measured on the unchanged skill; (3) the commits of the script, the rewritten skill and agent and the final `evals/results.json`. The branch SHALL NOT be pushed while its head fails `task check-skill-quality -- architect`, because shipping `evals/evals.json` makes every finding an error, and the pre-push hook SHALL NOT be bypassed.
2. **R2 (cases).** `evals/evals.json` SHALL be valid under spec 0290 and hold at least five evals and at least six trigger probes, at least three positive, the negatives being near-misses that share the skill's vocabulary (implementing a change, writing a spec, reviewing a pull request, writing documentation). The evals SHALL cover at least: (a) a design question where the answer must state the goal, the constraint and the non-goal, at least two alternatives with their trade-off and a recommendation; (b) a change to a shared contract where the answer must list the blast radius, including the regenerated built copies; (c) an Architecture Decision Record for a one-way change, with the sections Context, Decision, Status and Consequences, each short; (d) a plan that must fit a byte budget, where the answer must use measured figures for the moved spans and state a margin; (e) a plan review whose verdict carries `### Verdict: …`, the `seat:` line right after it, `v<N>-F<M>` identifiers and one `class:` line per finding; (f) a brief that names an environment variable and a command that appear in no file, where the ADR must not present them as facts. Expectations SHALL be stated on observable output only, no eval SHALL use an `exit_code` check, and no prompt SHALL ask for a forge write: any text for a forge is written to a file. Fixtures live under `evals/files/`.
3. **R3 (baseline).** The contributor SHALL run `task skill-evals -- architect` once without mock mode on the unchanged skill at the commit (1) of R1, in a fresh output directory, check `skill_loaded` for every eval (an eval whose skill never loads is revised before the cases are frozen), and commit the resulting `evals/results.json` as the commit (2). The logbook SHALL record `status`, `eval_pass_rate`, `probe_pass_rate`, `skill_loaded`, `executor_runs`, `judge_calls`, `cost_usd` and the evidence window. The owner caps the paid measurements of this ticket at three: this baseline, the final measurement and one retry.
4. **R4 (frozen cases).** From the commit (1) of R1, `evals/evals.json` and the fixtures SHALL stay byte-identical until the ticket ends. A defect found in a case is recorded on the logbook, the unpushed commits (1) and (2) are rewritten with the fixed cases and the baseline is measured again; this consumes the retry of R3.
5. **R5 (byte accounting script).** The skill SHALL bundle `scripts/measure-span.ts`, a single-file TypeScript program for Node.js 24 with no import, following the script contract of `docs/skill-authoring-standard.md`. `measure-span.ts <file> <first>-<last>...` SHALL print the exact UTF-8 byte count of each inclusive line range of the file, newline included, and their total. With `--current <bytes>` and `--budget <bytes>` it SHALL also report the projected size (current minus the total) and the margin (budget minus projected); with `--margin <bytes>` (default 0) it SHALL report a finding when the margin is smaller than that threshold, and a finding when the projected size is over the budget. `data` SHALL be `{ranges: [{first, last, bytes}], total, projected, margin}`, the last two `null` without `--current` and `--budget`. It SHALL exit `0` with no finding, `1` with a finding, `2` on a usage error (a malformed or reversed range, a missing option value, an unknown option) and `3` when the file is unreadable or a range reaches beyond its last line. A last line with no trailing newline counts the bytes it has, and a line ending in CRLF counts both bytes. Ranges that overlap or repeat count each line once in `total`, while each `ranges[].bytes` stays the count of its own range. `--current` without `--budget`, or the reverse, is a usage error. It SHALL write nothing and make no network call.
6. **R6 (skill body).** `SKILL.md` SHALL tell the model when to run `measure-span.ts` and what each exit code means, and keep in prose what no script decides: framing, alternatives, blast radius, the choice between inline summary, ADR and RFC, and the briefing of sub-agents. A plan or verdict comment SHALL be checked, where the `pr-reviewer` skill is installed, with the `lint-verdict.ts` script of that skill on the `plan` surface, and by its byte count otherwise; the skill SHALL NOT bundle a copy of that script.
7. **R7 (shared references and seat pointer).** The skill SHALL replace its grounding, finding-class and friction text by citations, as code spans, of `references/shared-grounding-discipline.md`, `references/shared-finding-class-taxonomy.md` and `references/shared-friction-reporting.md`. It SHALL replace its reviewer-seat section by a pointer to `docs/reviewer-seat.md` and keep only what is specific to the architect: on the plan surface the `seat:` line goes right after the `### Verdict: …` line and identifiers are `v<N>-F<M>`; on the specs surface identifiers are `s<N>-F<M>` and a delta-spec pull request is a replaced artifact.
8. **R8 (prompt style).** The skill SHALL pass `scripts/check-skill-quality.ts` with zero findings: a description of at most 1,024 characters stating what the skill does, a `Use when` clause, the trigger terms and a `Not for` clause; a `compatibility` field naming Node.js 24 (the runtime of the script) and `gh` (the posting and checking commands the skill points to); no spec, requirement or issue citation; capitalised emphasis within the limit; a body under 500 lines.
9. **R9 (agent).** `AGENT.md` SHALL state in its description when to delegate (a design, an ADR, a design review, a ripple-effect analysis, a plan review) with trigger terms; keep the role, its default mode of review and propose, the handoff to the developer agent and a pointer to the skill; not restate the skill's grounding rules; and point to the `harness-report` skill in one sentence without citing `config/TOOLS.md`.
10. **R10 (no tool allowlist).** `AGENT.md` SHALL NOT declare `metadata.tools`: the agent runs `gh` and scripts, the `execute` class, `docs/authoring.md` admits an allowlist only for agents without `execute`, and an allowlist withholds the `Skill` tool the agent needs. The reason SHALL be recorded in the pull request body.
11. **R11 (packaging).** Both sources SHALL bump `metadata.provenance.version`, the built components SHALL be regenerated in the same change, and the stale built copies of any removed file SHALL be removed from the four CLI trees. Every built `architect` skill directory SHALL contain `scripts/` and `references/` and SHALL NOT contain `evals/`.
12. **R12 (acceptance).** The pull request SHALL commit the `evals/results.json` of a non-mock final run taken with `--base <commit (2)>` and SHALL be merged only when that run prints no `regression` line and, when the baseline recorded `pass`, its status is `pass`; when the baseline itself recorded `fail`, the absence of a `regression` line is the whole gate.
13. **R13 (retry and cap).** The final run is the second paid measurement. A cold REVIEW fix in `SKILL.md`, `references/`, `scripts/` or `evals/` changes the content hash and uses the third; every measurement after the third, a stale-hash refresh included, needs the owner's approval, asked through the wave coordinator.
14. **R14 (tests).** `measure-span.ts` SHALL have automated tests that run with no network, are wired into the `skill-scripts-ts` task of `taskfiles/ci/modules.yml`, run the script from a copy of the built skill directory placed outside the repository, and cover the success path, the thin-margin and over-budget findings, the usage error (exit `2`), the unreadable file and the range past the end (exit `3`), the `--json` shape, `--help`, the unterminated last line, CRLF and overlapping ranges.
15. **R15 (report).** Whatever the outcome, the logbook SHALL record both runs' figures and cost, which steps became a script and which stayed in prose with the reason, and the noise of the gate (one flipped eval moves the pass rate by 1/N).

## Scenarios

### Happy path — a plan that fits its budget

- **Given** a 52,000-byte file against a 51,200-byte budget and two spans of 600 and 900 bytes,
- **When** `measure-span.ts file 10-20 30-45 --current 52000 --budget 51200 --margin 200 --json` runs,
- **Then** `data.total` is the exact measured byte total of the two ranges, `data.margin` is `budget - (current - total)`, and it exits `0` when that margin is at least 200.

### Failure path — a thin margin

- **Given** the same file and spans that leave the projected size 3 bytes under the budget,
- **When** the script runs with `--margin 200`,
- **Then** it reports a finding naming the margin and exits `1`.

### Failure path — a range past the end of the file

- **Given** a 40-line file,
- **When** `measure-span.ts file 30-50` runs,
- **Then** it exits `3` with `data` null and a finding naming the last line.

### Failure path — a failing gate after the retry

- **Given** a final run that fails the gate of R12 and a retry that fails it too,
- **When** the second run is reported,
- **Then** the pull request is not merged and the two runs are presented to the owner, with the cases unchanged.

## Out of scope

- A `metadata.tools` allowlist on the agent (R10).
- A copy of `lint-verdict.ts` or `check-comment-size.ts` in the skill.
- Changes to the eval runner, its settings or the tolerance.

## Open questions

- None.
