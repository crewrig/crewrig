---
id: "0313"
slug: web-pack-to-website
status: implemented
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 2085
version: 1.0.0
---

# Move the web and SEO pack into the website repository

## Intent

The eleven web and SEO agents and the four web skills have exactly one consumer, the CrewRig website repository, yet spec 0307 placed them in the `library` tier, whose contract is "installed by default on every adopter's machine". Every adopter and every maintainer session outside the website therefore pays the listing cost of components only the website uses. The fifteen components leave CrewRig entirely and live from then on in the project tree of `crewrig/crewrig-website`, where only the sessions that need them load them. Adopters who received them through the library install get a documented way to remove the stale home copies, and the saving is measured on a machine whose home carried the library, the case spec 0307 did not measure.

## Requirements

1. The fifteen components, the agents `accessibility-auditor`, `accessibility-tester`, `astro-developer`, `copywriter`, `designer`, `frontend-developer`, `regression-sentinel`, `scenario-author`, `seo-specialist`, `visual-regression-tester` and `web-conformity-checker`, and the skills `astro`, `copywriting`, `frontend` and `web-tester`, SHALL have no source under `artifacts/` (any tier), no source under `extensions/` (any extension), and no committed built output in `.claude/`, `.gemini/`, `.github/` or `.agents/`. Default setup of every supported CLI SHALL install none of them, which follows from the absence of any source and requires no setup code change.
2. Delivery form: the website repository SHALL receive the pack as rendered Claude Code output committed in its own tree, the agents as `.claude/agents/<name>.md` and the skills as `.claude/skills/<name>/`, taken from the `library` tier build of CrewRig at the commit just before the removal (`dist/library/.claude`). The files SHALL be copied as built, including the `metadata.provenance` block, with no CrewRig build pipeline, no render step and no upstream sync added to the website. Rationale: the website has no CLI tree today and no CrewRig tooling, the maintainer works there with Claude Code, and the output already works as a project-scoped component; a source-plus-render form would import the build pipeline for one consumer. Trees for Gemini CLI, Copilot CLI and Antigravity CLI are not delivered; the website repository adds them itself if it ever needs them.
3. Everything inside the four skill directories SHALL move with the skills: `SKILL.md`, `references/`, `scripts/`, `assets/` and `evals/` including `evals/files/`. The bundled scripts are self-contained (they import no CrewRig module and load only Node built-ins), so no dependency on `scripts/lib` is to be cut; the implementer SHALL confirm that claim with a search for `scripts/lib` and `scripts/tests` under the four directories before the copy and SHALL report any hit on issue #2085 instead of copying a script that needs CrewRig. No test under `scripts/tests/` is carried over: every test or fixture that names one of the fifteen components leaves CrewRig with the removal.
4. Ordering: the website SHALL receive the pack before CrewRig removes it. The pull request that removes the pack from CrewRig SHALL NOT be merged until the website change is merged on the default branch of `crewrig/crewrig-website`, and the implementer SHALL verify it by reading that branch through `gh` (the eleven agent files and the four skill directories are present under `.claude/`) and SHALL record the website pull request link and the verification on issue #2085. The website change itself follows that repository's own conventions (its `specs/` lifecycle, branch and review rules) and is not specified here. If the verification fails, the CrewRig removal SHALL wait; it SHALL NOT proceed on the strength of an unmerged website branch.
5. This spec supersedes spec 0307 in full. Once the removal has merged, spec 0307 SHALL be recorded as `status: superseded` with `superseded-by: "0313"` by a metadata-only edit of its frontmatter, in its own commit inside the implementation pull request, touching no other line (`docs/spec-format.md` → *Recording a post-merge transition*). This spec-PR SHALL NOT touch spec 0307, per the one-file rule. Historical specs other than 0307, and the ADRs including ADR-0025, SHALL be left as they are.
6. The check that replaces spec 0307's requirement 18 SHALL be an automated absence check: none of the fifteen names exists as an agent or skill entry under `artifacts/`, `extensions/`, or the four committed project trees, and the worker and coordinator Claude profiles under `artifacts/core/claude-profiles/` name none of them. It SHALL run in the repository's normal test run, and it SHALL replace `scripts/tests/agent-profile-web-library-tier.test.ts`, whose presence and version-bump assertions are void. A name found anywhere SHALL fail the check and be reported with its path; an empty result passes. A later move back, or a partial removal, fails it.
7. The coordinator and worker profile sources SHALL drop the `Agent(<name>)` deny entries of the eleven agents and the `skillOverrides` entries of the four skills, and `docs/worker-profile.md` SHALL drop the matching sentence of its W3 part. A profile left without any such entry SHALL keep its remaining entries and stay valid JSON.
8. Core routing hints: the `tester` skill and agent descriptions SHALL stop naming `web-tester`, `web-conformity-checker` and `scenario-author`, since those components no longer exist in CrewRig. They SHALL keep declining web end-to-end tests with Playwright or RobotFramework and accessibility scans, worded without a component name (they belong to a project that supplies its own web testing components). Each of the two sources SHALL carry a PATCH bump of `metadata.provenance.version`, being a modified shipped source reworded, and their four committed built outputs SHALL be regenerated in the same commit.
9. Version policy: the deletion of the fifteen sources needs no version bump, because `scripts/check-skill-versions.ts` ignores added, deleted and renamed files and the sources no longer exist on the branch. No other shipped source is modified, so requirement 8 is the only bump.
10. Adopter migration: setup SHALL NOT be given a deletion step for the home copies. Rationale: several names are generic (`designer`, `frontend`, `copywriter`) and may collide with a user's own component of the same name, and setup has never deleted user-scope files for a retired tier component. Instead, the adopter documentation SHALL replace the spec 0307 section of `docs/adoption-guide.md` with a migration note that names the fifteen components, states that they left CrewRig and that a machine on which the library step ran still holds home copies that load in every session, and gives the exact paths to remove for each CLI: Claude Code `~/.claude/agents/` and `~/.claude/skills/`, Gemini CLI `~/.gemini/agents/` and `~/.gemini/skills/`, Antigravity CLI `~/.gemini/config/agents/` and `~/.gemini/config/skills/`, GitHub Copilot CLI `~/.copilot/skills/` (its agents were never installed), each entry named after the component. The note SHALL also tell a user who wants the pack to take it from the website repository, and SHALL state that stale project-tree copies from before spec 0307 are removed by `scripts/sync-from-upstream.ts` in a following fork and by hand elsewhere. Where a user removes only part of the set, the remaining components keep working; no all-or-nothing state exists.
11. The cli-matrix SHALL stay symmetric across CLIs: the statements added by spec 0307 for these fifteen components in the row sources `docs/cli-matrix/rows/3.md`, `4.md` and `10.md`, including the Copilot CLI agent parity gap of spec 0307 requirement 4, SHALL be removed from the row sources, and `docs/cli-matrix.md` SHALL be rebuilt from them in the same commit. No CLI keeps the pack, so no asymmetry remains to record.
12. The change SHALL update every file that names a removed component, the known set being: `README.md` (the library-tier mention near the layout listing), `docs/adoption-guide.md`, `docs/agent-profile-migration.md` (the eleven web rows), `docs/layers.md` (the web rows of the library table and any prose claiming the pack), `docs/skill-authoring-standard.md` (the names in the friction-reporting and finding-class tables, and any count that follows from them), `docs/worker-profile.md`, `docs/cli-matrix/rows/{3,4,10}.md`, the two Claude profile sources, the `tester` skill and agent, the `docs/authoring.md` hit (to be confirmed as a generic use of a word), the tests `agent-profile-baseline-doc`, `agent-profile-build`, `agent-profile-committed`, `agent-profile-web-library-tier`, `build-components-conformance` and `model-resolve-profile` and `rules-split-ab-scratch` under `scripts/tests/` (the last only if it asserts the pack), the fixtures `scripts/tests/fixtures/build-components/oracle-agents/tester/AGENT.md`, `component-resolve-oracle/*.golden` and `model-resolve-oracle/resolve-conformance.json.golden`, and the comment in `scripts/tests/lib/path-scrub.ts`. `docs/layers.md` SHALL be updated and `.crewrig/core-paths.txt` re-checked, remaining unchanged unless it names a component of the pack; `docs/index.json` SHALL be re-checked and updated if a document title or path changes. The implementer SHALL find any further hit with a repository search for the fifteen names outside `specs/`, the generated trees and `dist/`; hits beyond the known set SHALL be reported on issue #2085, and a materially larger set re-opens the tier of this change.
13. Built outputs: the commit SHALL run the build and stage every regenerated output in the same commit (the tester outputs of requirement 8 and `docs/cli-matrix.md`), and the built-components drift check SHALL pass.
14. Measurement: the change SHALL NOT be declared complete until the first-call token measurement of the ADR-0025 appendix probe is recorded on issue #2085 for a Claude Code worker session and a subagent session, before and after, on a scratch `HOME` that carries the spec 0307 library install (the fifteen home copies present before; the home copies removed per requirement 10 after), never an edit of the maintainer's `~/.claude/`. The figures of ADR-0025 are not reusable as the before arm, since they were taken without the library. The paid runs are capped at four Claude Code runs in total (worker and subagent, before and after). The record SHALL state whether the agent listing no longer carries the eleven agents and SHALL report a shortfall with its figures rather than hide it; a shortfall does not by itself block the merge.

## Scenarios

### Happy path: removal after the website received the pack

- **Given** the website change is merged and carries the eleven agents and four skills under `.claude/`,
- **When** the CrewRig removal is applied and the checks run,
- **Then** the absence check passes, the built-components drift check passes, default setup installs none of the fifteen, and a Claude Code session opened in the website repository lists the pack.

### Happy path: adopter cleanup

- **Given** an adopter whose home carries the fifteen copies from the spec 0307 library install,
- **When** the adopter follows the migration note for their CLI and removes the named entries,
- **Then** a session in any project other than the website no longer lists the pack.

### Failure path: website change not merged

- **Given** the website branch carrying the pack is open but not merged,
- **When** the removal pull request is ready to merge,
- **Then** the verification of requirement 4 fails and the removal waits, with the reason recorded on issue #2085.

### Failure path: a name survives

- **Given** a change that removes the sources but leaves `copywriter` in a committed project tree or `Agent(designer)` in a profile,
- **When** the absence check runs,
- **Then** it fails and names that path.

### Failure path: script depends on CrewRig

- **Given** a bundled skill script found to import a CrewRig module,
- **When** the implementer runs the search of requirement 3,
- **Then** the copy stops and the hit is reported on the issue.

## Out of scope

- The content of the website change and its own spec, ticket and review flow; the website repository owns them.
- Trees for Gemini CLI, Copilot CLI or Antigravity CLI in the website, and any CrewRig-side build of the pack for the website.
- An automated cleanup of home directories by setup (requirement 10 gives the reason).
- Content changes to the fifteen components; they move as built.
- Rewriting spec 0307's body or ADR-0025.
- Rejected alternatives: an opt-in `extensions/library/` extension (it is synced to every fork under the `strict` policy, so it still ships to adopters); a non-distributed CrewRig extension installed only into the website (no upstream location exempt from fork sync exists and building one for a single consumer is speculative); an opt-in flag on the library install (it contradicts the library contract "installed by default"); keeping the status quo.

## Open questions

- None. The Claude Code-only delivery of requirement 2 is decided here; the website maintainer MAY widen it in the website change.
