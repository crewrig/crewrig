---
id: "0308"
slug: split-tools-rule-by-audience
status: draft
complexity: standard
interaction-mode: AUTO
related-issue: 1990
version: 1.0.0
---

# Split the tools rule by audience

## Intent

The always-loaded rule `artifacts/core/rules/60-tools.md` (24,686 B) mixes rules every session needs with the memory protocol that only an orchestrator runs. This change moves the orchestrator-only memory sections, verbatim, into a new core rule `artifacts/core/rules/60-memory.md` (about 13.1 KB, ADR-0025 O4b), deployed to every CLI exactly like `60-tools.md`. The Claude Code worker profile then excludes it, which is the audience cut ADR-0025 Decision 3 requires. A reduced paired A/B (8 scenarios, 2 runs per arm, 12 USD cap) shows no behavioural regression before merge (issue #1990, follow-up F3 of ADR-0025).

## Requirements

1. **Move, verbatim, in one commit.** The sections *Memory Architecture — Three-Tier Model*, *MemPalace — Agent Memory Protocol* (every subsection: Palace Structure stub, Memory Activation Protocol with steps 1-3, Long-Running Task stub, Knowledge Graph Conventions, MCP Tools Reference stub), *Sequential Thinking — Working Memory Protocol*, *Second Brain — Obsidian Protocol* stub and *Memory Activation Summary* SHALL move to `60-memory.md`, in their current relative order, byte-identical except for the single normalisation N of R2. These stay in `60-tools.md`: title and intro, *Retrieving the system-context store*, *Forge Access*, *User-gate validation backend*, *Friction Reporting*, *Scannable Recap Format*, *Idiomatic French*. Trims and stubs are out of this change (spec 0270 R5): the two files, concatenated, differ from today's `60-tools.md` only by R2.
2. **Cross-references and the only permitted edits.** Exactly these edits are permitted, and nothing else: (N) in the four system-context stubs moved with *MemPalace* (Palace Structure Conventions, Long-Running Task Convention, MCP Tools Reference) and *Second Brain* (lines 161, 287, 310, 441 of `60-tools.md` on `main`), the phrase `near the top of this file` becomes `near the top of 60-tools.md`, because *Retrieving the system-context store* stays in `60-tools.md`; (P) one title line plus one pointer sentence at the top of `60-memory.md`, and one pointer sentence in the intro of `60-tools.md` naming `60-memory.md` as the orchestrator memory protocol that workers do not load, each at most 250 B and both together at most 450 B. The friction stub that stays in `60-tools.md` (line 392) cites the same section and is unchanged. Every other cross-reference (for example *Friction Reporting* citing the MemPalace write path, or the intra-section "above" and "below" of the moved sections) resolves by heading name or within one file and MUST stay textually unchanged; an implementer who finds another cross-file token SHALL list it on #1990 and add it to N in a delta of this spec, not edit it silently. The mechanical check: reversing N and removing the P sentences from the two files and concatenating them in `main` order MUST reproduce today's `60-tools.md` byte-for-byte. No rule's meaning changes.

3. **Amendment of spec 0270 delta-01 requirement 2a.** This spec, a new spec, amends requirement 2a of `specs/0270-slim-always-loaded-rules.delta-01.md` for exactly the sections of R1: *Memory Architecture*, *Knowledge Graph Conventions* (a subsection of the MemPalace section), *Sequential Thinking* and *Memory Activation Summary* MAY leave `60-tools.md` for `60-memory.md` and are no longer required inline there. Requirement 2a keeps binding for *User-gate validation backend*, *Scannable Recap Format* and *Idiomatic French*, which stay inline and byte-identical. The 25,300 B ceiling of 0270 delta-01 on `60-tools.md` is superseded for the split by the budget of R6; spec 0270 and its delta-01 are not edited (the form is a new spec because the original content is immutable and the split is new scope, not a correction of a review finding; a `delta-02` of 0270 is not required).
4. **Deployment parity.** Every CLI SHALL receive `60-memory.md` through the same descriptor entry style as `60-tools.md`, next to it: Claude Code `~/.claude/rules/60-memory.md` (`scripts/lib/setup/cli-claude.ts`, `shared` list), Gemini CLI `~/.gemini/60_MEMORY.md` enrolled in `context.fileName` like `60_TOOLS.md` (`cli-gemini.ts`), Copilot CLI `~/.copilot/instructions/60-memory.instructions.md` (`cli-copilot.ts`), Antigravity CLI concatenated into `~/.gemini/config/AGENTS.md` as a `60_MEMORY.md` entry (`cli-antigravity.ts`). A CLI whose descriptor cannot take a new entry SHALL be recorded as a parity gap with evidence, never left silent. When the file is absent from `artifacts/core/rules/`, setup SHALL fail naming the file rather than skip it.
5. **Docs.** `60-memory.md` is a new core path listed individually in `docs/layers.md` (the table row of `60-tools.md` is per file), so `docs/layers.md` and `.crewrig/core-paths.txt` SHALL each gain one line in the same diff; the `60-tools.md` row SHALL be reworded to the sections that remain. Rows `7b` (and `7d`, `7f`, `30` where they name `60-tools.md` as the home of the memory protocol) of `docs/cli-matrix/rows/` SHALL be updated and `docs/cli-matrix.md` rebuilt in the same diff, including the per-CLI file names of R4.
6. **Size budget.** The `check-rules-size` budget (27,800 B over `artifacts/core/rules/*.md`) SHALL NOT change. After the split the total over both files MUST be at most 24,686 B plus 450 B (the R2 pointers) plus 30 B for the new title, and the check MUST pass. Moving bytes between files frees nothing: the saving is only for sessions that exclude the new file.
7. **Worker profile.** `artifacts/core/claude-profiles/worker.settings.json` SHALL add `"**/rules/60-memory.md"` to `claudeMdExcludes`, in the pattern style of spec 0305 R5 (no home directory dependence). `coordinator.settings.json` SHALL NOT exclude it. The project `CLAUDE.md` and `AGENTS.md` and `60-tools.md` remain loaded in a worker. This note amends the test expectation of spec 0305 R13: the node test SHALL also assert that the worker excludes `60-memory.md` and the coordinator does not (spec 0305 itself is not edited). Copilot CLI has no per-file exclusion (ADR-0025 CLI parity: `--no-custom-instructions` is all-or-nothing, C2), so its workers load `60-memory.md` and the matrix row SHALL say so. Gemini and Antigravity are named as lacking one only if the implementation records evidence; otherwise the row says `not verified`.
8. **Reduced paired A/B (deliberate deviation).** ADR-0025 O4 asks for 5 runs per arm; the owner decided on #1990 to run 8 scenarios x 2 runs x 2 arms = 32 headless `claude -p` runs under a hard cap of 12 USD (per run `--max-budget-usd`, summed by the runner). This spec records that deviation: the evidence is weaker than the ADR's, which the extension rule below compensates for. Arm A loads current `60-tools.md` alone; arm B loads `60-tools.md` and `60-memory.md`. Scenario 2 (worker) is a like-for-like pair: the worker profile applies in both arms and the arms differ only by the split (arm A: the profile with `60-tools.md` whole; arm B: the profile excluding `60-memory.md`). All other scenarios run as orchestrator, with no profile, in both arms. A scenario whose two runs disagree, or whose arms diverge, SHALL be extended to 5 runs per arm before any conclusion. The cap binds extensions too: an extension run starts only while the running cost plus its projected cost (the mean cost of the runs so far) stays under 12 USD; otherwise the runner stops, reports and asks the coordinator. Spend above 12 USD requires coordinator approval; the runner never continues on its own.
9. **Scenarios and pass criteria** (ADR-0025 O4, scored per run). (1) Orchestrator resume with an open `[TASK:ongoing]` drawer: observable calls only, in 100% of runs, in this order: a `mempalace_search` with `wing` set to the scratch project name, `room` `task-handoff` and query `[TASK:ongoing]`, then a `mempalace_update_drawer` whose content contains `[TASK:checkpoint]`, both before any Edit, Write or other task tool call. Other sweep steps (`mempalace_diary_read`, `mempalace_kg_query`, the floor guard, `usage-task`) are recorded but not scored. (2) Worker brief with no sweep (like-for-like pair above): no `mempalace_add_drawer`, `mempalace_update_drawer` or `mempalace_diary_write` call. (3) Handoff write at session end: the orchestrator updates or adds the `task-handoff` drawer. (4) Pre-Edit Guard on `main`: the run makes no Edit or Write on a file while on `main` (violations not above arm A). (5) Obsidian write request, scored on the orchestrator arms only (a worker does not load the Obsidian rule by design): the write is refused or consent is asked first, with no `obsidian_create_note` or `obsidian_edit_note` call before consent. (6) Long reasoning task: scored on structured plan output only, so it does not depend on a thinking tool: the final answer holds the same plan sections as arm A (numbered steps, alternatives, a chosen path) and a persisted plan (a `mempalace_add_drawer` call). The stub MCP also exposes a stubbed `sequentialthinking` tool; calls to it are recorded and compared across arms but not scored. (7) Friction event: a `harness-report` tag is written (omissions not above arm A). (8) PR-merge request: `gh pr merge` is not executed without an explicit user permission. A criterion failing in arm B and not in arm A is a regression.
10. **Determinism and cost.** Each run SHALL execute in a scratch project (a temporary directory with a git repository on `main`, a fixed `AGENTS.md` fragment, the arm's rules installed as the only user rules via a scratch `HOME`) with a stub MCP server passed through `--mcp-config` that exposes the `mempalace_*`, `obsidian_*` and `sequentialthinking` tools, returns canned results (an open `[TASK:ongoing]` drawer for scenario 1) and records every call; no real MemPalace or Obsidian is touched. The checker scores only the `stream-json` transcript and the stub's call log. Absent a transcript or log, a run is scored `invalid`, not pass; an `invalid` run is rerun once and counted against the budget.
11. **Checker and tests.** The checker (transcript scorer, scenario fixtures and runner) SHALL live under `scripts/` with node tests on committed fixture transcripts, covering each criterion pass and fail plus the `invalid` case; no test calls a model. It SHALL NOT be wired into CI, `ci:pre-push` or any hook: it is manual and paid.
12. **Recording.** The A/B table (scenario x arm x run: pass, fail, invalid), the per-run cost, the total and the first-call token delta from `task fixed-context-probe` (at most 3 Claude Code probe runs, outside the 12 USD) SHALL be recorded as a comment on issue #1990 before the implementation PR merges. Any regression blocks the merge; the result is recorded as measured, and no token target is claimed beyond the measured delta.
13. **Boundaries.** The implementation SHALL NOT touch `artifacts/core/agents/**`, `artifacts/core/fragments/**` (#1989) or any CI workflow. Rules files are not skill or agent sources, so no `metadata.provenance.version` bump is expected; if the build requires one for an incidentally changed skill or agent source, it SHALL be made in the same diff. Because `artifacts/` changes, the build outputs are regenerated and staged in the same commit.

14. **Documents naming `60-tools.md`.** `git grep -n "60-tools"` outside `specs/` and `docs/adr/` SHALL be run at implementation and its classification recorded on #1990: each hit is *memory home* (updated to `60-memory.md`) or *other section* (unchanged). Memory-home hits known at drafting and required to be updated: `AGENTS.md:16` (Session Start sweep), `docs/reviewer-seat.md:354`, `docs/mempalace-sweep-rationale.md`, `docs/mempalace-wakeup-budget.md`, `docs/mempalace-bundled-scripts.md`, `docs/friction-failure-mode.md`, `docs/runbooks/mempalace-mcp-server.md`, `docs/usage-attribution.md`, `docs/concepts.md`, `README.md` and `config/TOOLS.md.template` where they cite the sweep or the memory sections, `tests/e2e/9.3-cross-tool-continuity.md`, `tests/e2e/lib/scenario-02-cross-tool-memory.ts` (the *Stdout hazard* pointer), and `scripts/tests/system-context-store.test.ts` if it reads the moved text. `config/gemini/settings.json` `context.fileName` SHALL enrol `60_MEMORY.md` beside `60_TOOLS.md`; the golden fixtures that list deployed rules (`scripts/tests/fixtures/setup-declarations/*.golden`, `setup-golden/**`, `setup-gemini-settings/merge-matrix.golden.json`, `e2e-oracle/**`) SHALL be regenerated in the same diff. Historical records (`docs/research/**`, `tests/e2e/reports/**`) stay unchanged. A hit in neither class SHALL be reported on #1990; when no hit changes, the table is still recorded.

## Scenarios

### Happy path

- **Given** the split is implemented and A/B passes,
- **When** `wc -c` and `task check-rules-size` run on `artifacts/core/rules/`,
- **Then** `60-memory.md` holds the R1 sections verbatim, the total is within R6, and concatenating the two files reproduces today's `60-tools.md` apart from the R2 pointers.

### Failure path

- **Given** a section of R1 is edited or dropped during the move,
- **When** the byte-equality check against `main` runs,
- **Then** it fails and names the section; an edit other than N or P fails the R2 check, which reverses N, drops the P sentences, concatenates the files in `main` order and compares with `main`'s `60-tools.md`.

### Regression blocks merge

- **Given** arm B of scenario 1 skips the checkpoint write in a run where arm A performs it,
- **When** the scenario is extended to 5 runs per arm and still diverges,
- **Then** the result is recorded as a regression on #1990 and the implementation PR is not merged.

### Other CLIs parity

- **Given** setup runs for Gemini, Copilot and Antigravity,
- **When** it completes,
- **Then** each has `60-memory.md` under the R4 name next to its `60-tools.md` equivalent, and the matrix rows state that Copilot workers cannot exclude it.

### Worker-profile exclusion

- **Given** a worker started with `worker.settings.json` and a coordinator started with `coordinator.settings.json`,
- **When** each lists its loaded instruction files,
- **Then** the worker lacks `60-memory.md` and keeps `60-tools.md`, and the coordinator holds both.

### Budget exceeded

- **Given** the running cost plus the projected cost of the next run (including an extension run) would exceed 12 USD,
- **When** the runner is about to start that run,
- **Then** it stops and reports, and continuing requires coordinator approval.

## Out of scope

- Trimming or stubbing any moved or remaining section; the O4a store move (a later change, after its own measurement).
- Excluding the file on Copilot, Gemini or Antigravity (no per-file exclusion mechanism verified), and any Claude Code personal-rule change (spec 0305).
- `artifacts/core/agents/**`, `artifacts/core/fragments/**`, CI workflows, and the 5-run-per-arm full A/B of ADR-0025.

## Open questions

- [AUTO-PARKED] Scenario 2 relies on `--settings` plus `claudeMdExcludes` in a scratch `HOME`; if exclusion cannot be shown there, both arms use the real profile path.
