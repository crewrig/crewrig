---
id: "0306"
slug: subagent-conventions-block
status: approved
complexity: standard
interaction-mode: AUTO
related-issue: 1989
version: 1.0.0
---

# Subagent conventions block inlined into every emitted agent

## Intent

A CrewRig subagent running on Claude Code stops loading the project and user memory files, which removes roughly 23,000 tokens from the fixed context of every subagent API call. The six rules that a subagent still needs (edit guard, Gitmoji titles, English project content, no merge or push to the primary branch, no secrets plus version-bump and build-output hygiene, report a denied action to the caller) exist once in a single committed source file and appear, byte for byte, at the end of every compiled agent body on every CLI that receives agent bodies. No copy is maintained manually, a committed check proves every compiled body carries the current text, and the CLI parity matrix records what each CLI does with it. This spec qualifies follow-up F2 of ADR-0025 (option O1, Decision 2); the worker settings profile, the rules-file slimming and the tools allowlist are separate tickets.

## Requirements

1. The repository SHALL hold exactly one source of the conventions block, the file `artifacts/core/fragments/subagent-conventions.md`, read from the core tier whatever the tier of the agent being built.
2. The fragment SHALL be plain Markdown with no frontmatter, LF line endings, exactly one trailing LF, and a first line that is its own level-2 heading (`## ...`). It SHALL state the six rules of ADR-0025 *O1* and nothing else: Pre-Edit Guard (issue, feature branch `<prefix>/<NNNN>-<slug>` never `main`, ticket worktree as working directory); Gitmoji only for commit, issue and PR titles; English for project content with the user's language for dialogue; no merge, no push to `main`, forge operations through `gh`, no `git reset --hard`, `git stash` or `git clean` in a shared worktree; no secrets or `.env` in the repository, a change to a shipped skill or agent bumps `metadata.provenance.version`, a change under `artifacts/` runs the build and stages its outputs; report a denied action to the caller instead of re-running it elsewhere.
3. The fragment SHALL NOT exceed 1,500 characters. The build and the check of R17 SHALL both enforce this ceiling, so a growing fragment fails loudly instead of eroding the saving.
4. The fragment SHALL contain no `${KEY}` build placeholder, no `<!-- provenance:` or `crewrig-provenance` comment and no line that is exactly `---`, so that what the build writes is byte-identical to the file read.
5. No agent source under `artifacts/*/agents/*/AGENT.md` SHALL carry a copy of the block; the fragment is the only place the text lives. The zone `artifacts/core/fragments/` SHALL be ignored by every component build, as a directory without an `AGENT.md`, `SKILL.md` or command file already is, with no new skip rule.

6. For every agent of every tier, and for each of the four CLIs, the compiled body SHALL be the source body (its trailing line feeds removed), then exactly one blank line, then the fragment bytes verbatim, then a single trailing LF. The compiled file therefore ends with a byte-exact copy of the fragment, preceded by `\n\n`. This holds for `.claude/agents/<name>.md`, `.gemini/agents/<name>.md`, `.github/agents/<name>.md` and `.agents/agents/<name>.md`, and for the same four paths under `dist/<tier>/` for every non-core tier.
7. Nothing before the appended block SHALL change: frontmatter lines other than the one added by R8, the provenance carrier of each CLI (Gemini HTML comment, spliced `metadata` block elsewhere) and the source body remain byte-identical to the output before this change.
8. The Claude Code emitter, and only that emitter, SHALL emit the frontmatter line `omitClaudeMd: true` on every agent. It is the last line the emitter assembles: immediately after the `tools` line (or after the last directed or `license` line when the agent declares no tools) and immediately before the `metadata` provenance block that the build splices ahead of the closing fence. It is emitted exactly once and with that literal value.
9. No Gemini, Copilot or Antigravity agent file SHALL carry an `omitClaudeMd` key or any other key that exists only for Claude Code. The Claude Code compiled-agent layout check (`check-claude-agent-layout`) SHALL keep exiting 0 on the new output; it constrains only the flat `*.md` layout and SHALL NOT be loosened or tightened by this change.

10. When the fragment file is missing, empty, has a first line that is not a `##` heading (this includes a frontmatter block), exceeds the ceiling of R3 or violates R4, a build that emits at least one agent SHALL stop with a non-zero status and a message naming the fragment path and the rule broken, before any agent file is written. A build that emits no agent (for example a skills-only target) SHALL NOT read the fragment.
11. When an agent source body contains a line equal to the fragment's heading line, the build SHALL stop with a non-zero status naming the source file, and write nothing for that agent. The permitted route is to delete the copy from the source: the build appends the block itself.
12. The build in `--check` mode SHALL report as drift any committed agent file that differs from the output described by R6 to R9, exactly as it reports any other stale compiled output.

13. The block and the key SHALL reach every compiled agent the component build writes: the 22 core agents committed to the four project trees and, for the library tier and every other non-core tier, the staged trees under `dist/<tier>/`.
14. Plugin and extension packaging (`scripts/lib/extension/plugin-claude.ts`, `plugin-copilot.ts`, `plugin-antigravity.ts`, and the Gemini extension build) copies hand-authored extension agent sources (`extensions/<tier>/<name>/agents/`) and does not pass through the component agent emitter; those outputs SHALL stay unchanged by this ticket, and that boundary SHALL be recorded in the parity matrix row of R19.

15. `docs/cli-matrix/rows/4.md` (agent definitions directory), and `docs/cli-matrix.md` rebuilt from the rows in the same diff, SHALL state the situation per CLI in evidence-of-search wording per `docs/cli-matrix-maintenance.md`: Claude Code receives the key and the block (key verified as file frontmatter by ADR-0025 probe P11); Gemini CLI receives the block, its subagents already running without memory files (source reading of `agents/local-executor.js` in 0.28.2, not a run), so they gain the six rules they currently lack; Copilot CLI receives the block with no per-agent switch found in `copilot --help` or `copilot help config`, and the block duplicates about 300 tokens when instructions are present; Antigravity CLI receives the block with no per-agent frontmatter surface found (row 33) and behaviour not verified. None of the three non-Claude cells SHALL be recorded as a confirmed gap, since "not found" is evidence-of-search.
16. The row SHALL also record the boundary of R14 (extension-packaged agents carry neither the key nor the block) and the asymmetry deliberately kept: the key is a Claude Code feature, the block is for all.

17. A new script `scripts/check-subagent-conventions.ts` SHALL verify, without reusing the emitter's code (so the check is not a tautology of the build), that: (a) the fragment satisfies R2 to R4; (b) every file under the four committed agent trees, and under any `dist/*/` agent trees present, ends with `\n\n` plus the fragment bytes; (c) every Claude Code agent file has `omitClaudeMd: true` exactly once inside its frontmatter; (d) no Gemini, Copilot or Antigravity agent file has an `omitClaudeMd` key; (e) no agent source carries the block (R11's line test). On an absent agent tree the check SHALL pass that tree (nothing to verify) and print an OK line.
18. Exit codes: 0 everything holds (an OK line on stdout); 1 one or more findings, each on stderr as `- <path>: <rule>` with `<rule>` one of `fragment-invalid`, `missing-block`, `stale-block`, `missing-omit-key`, `foreign-omit-key`, `source-carries-block`; 2 the fragment file is absent or the repository root cannot be resolved. `CREWRIG_REPO_DIR` overrides the root as in the sibling checks.
19. The check SHALL be wired as the sibling `check-*` scripts are: a capability entry in `ci/ci-capabilities.yml` (group `governance`, pull-request and push triggers on `main` and `release/**`, path filter covering the script, its tests, `artifacts/core/fragments/**`, `artifacts/*/agents/**`, the four agent trees and `scripts/lib/build-components/**`), the matching `taskfiles/ci/` task and local mirror in `taskfiles/governance.yml`, the job in `.github/workflows/_ci-governance.yml`, the regenerated `.gitlab-ci.yml`, a `check-subagent-conventions-ci-wiring.test.ts` asserting that wiring, and unit tests with committed passing and breaching fixtures, one per finding rule.
20. The existing tests that pin the shape of compiled agent files (for example `agent-profile-committed.test.ts`, `build-components-output-agents.test.ts`) SHALL be updated for R6 and R8 in the same diff, and a new test SHALL assert that the built `.claude/agents/` output keeps `omitClaudeMd: true` (the verification the ADR appendix reserves for this ticket).

21. `docs/layers.md` SHALL list `artifacts/core/fragments/` as a core build-input zone (not installed to any user home, not mirrored into MemPalace, never read by an agent at run time), and `.crewrig/core-paths.txt` SHALL carry `artifacts/core/fragments` with the `strict` policy as a nested entry under `artifacts/core`, in the same diff; `scripts/check-core-paths.ts` SHALL exit 0 on the result.
22. The implementation commit SHALL regenerate and stage every build output affected by the change in the same commit (`node scripts/lib/node-floor-guard.js`, then `node scripts/build-components.ts`), per the repository's built-components rule.

23. No `metadata.provenance.version` bump on an agent source SHALL be required by this change. `docs/version-bump-convention.md` and `scripts/check-skill-versions.ts` act on a modified skill, command or agent source, and this change edits no source: the compiled output changes because the emitter changed, and the provenance version each output carries is read from the unchanged source. A later edit of the fragment likewise modifies no agent source and requires no bump; a later edit of any agent source follows the convention as usual. If the implementation finds it must touch an agent source, it SHALL bump that source per the convention and say why on the issue.

24. Before closing the ticket, the issue #1989 logbook SHALL record the measured first-API-call token count of a CrewRig developer subagent in a vanilla session (baseline 59,366) and in a session passing the ADR-0025 P9-style settings through `--settings`, using the probe method of the ADR appendix. This is a recorded verification step, not a CI gate; the ticket targets of 30,000 (subagent) are reported as measured, met or not.

## Scenarios

### Happy path

- **Given** the fragment is valid and the 22 core agent sources carry no copy of the block,
- **When** the component build runs for all CLIs,
- **Then** every `.claude/agents/<name>.md` has `omitClaudeMd: true` between `tools` (or the last directed line) and the `metadata` block, every file of the four agent trees ends with a blank line and the fragment bytes, and `scripts/check-subagent-conventions.ts` exits 0.

### Happy path: the fragment changes once

- **Given** the sole fragment file is edited and the build is rerun,
- **When** the check runs,
- **Then** all 88 committed agent files carry the new text and the check exits 0; and without the rebuild it exits 1 with a `stale-block` line per file and no agent source needed an edit or a version bump.

### Happy path: skills-only build

- **Given** the fragment file is missing,
- **When** the build is run with a target selection that emits no agent,
- **Then** it succeeds and never reads the fragment.

### Failure path: invalid fragment

- **Given** the fragment starts with a frontmatter block, or is empty, or exceeds 1,500 characters,
- **When** the build is run for any CLI that emits agents,
- **Then** it exits non-zero naming the fragment path and the broken rule, and no agent file is written; the check exits 1 with `fragment-invalid` (or 2 when the file is absent).

### Failure path: hand copy in a source

- **Given** an `AGENT.md` body contains the fragment's heading line,
- **When** the build runs,
- **Then** it exits non-zero naming that source, and the check reports `source-carries-block` for it.

### Failure path: key on the wrong CLI

- **Given** a compiled `.gemini/agents/<name>.md` (or Copilot or Antigravity file) holds an `omitClaudeMd` line, or a `.claude/agents/<name>.md` lacks it,
- **When** the check runs,
- **Then** it exits 1 with `foreign-omit-key` or `missing-omit-key` for that path.

## Out of scope

- The worker settings profile and its launch recipe (#1988), the slimming of `artifacts/core/rules/60-tools.md` (#1990), the tools allowlist vocabulary (#1991) and the probe task (#1994).
- Any change to files in user homes (`~/.claude`, `~/.gemini`, `~/.copilot`) and to the repository's `.claude/` outside what the build regenerates.
- Adding the block or the key to extension-packaged agents (`extensions/*/agents/`) and to the Claude, Copilot and Antigravity plugin trees built from them (R14).
- A per-agent memory switch on Copilot CLI or Antigravity CLI, or any run-time probe of their behaviour; recorded as evidence-of-search only (R15).
- Any change to the wording of the six rules beyond their transcription from ADR-0025 into the fragment, and any additional rule.
- Editing the 22 core agent sources, including their `metadata.provenance.version`.

## Open questions

- [AUTO-PARKED] Extension-packaged agents (R14 and out of scope) keep neither the block nor `omitClaudeMd`; `extensions/core/hello-world/agents/reference-guide` is the only committed instance today. Confirm that this boundary is acceptable or open a follow-up that gives the extension packagers the same fragment.
