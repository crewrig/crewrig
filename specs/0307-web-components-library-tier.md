---
id: "0307"
slug: web-components-library-tier
status: draft
complexity: small
interaction-mode: AUTO
related-issue: 1992
version: 1.0.0
---

# Web components move to the library tier

## Intent

The eleven web and SEO agents and the four web skills stop being part of the project tree that CrewRig commits and that every adopter repository carries: they are delivered instead to each user's home directory by the automatic library install of setup, on the CLIs that can load a home-scope agent, and the one CLI that cannot is named rather than left silent. The saving is therefore scoped honestly: sessions opened in a project tree, in CrewRig's own repository and in any session whose home does not carry the library (a worker profile that hides home-scope components, continuous integration, a fresh machine) no longer pay the listing cost of these components, whereas a machine where setup ran still loads them in every project from its home directory. CrewRig's own workspace follows the same rule as an adopter and no longer deploys these components to its project trees.

## Requirements

1. The eleven agents `accessibility-auditor`, `accessibility-tester`, `astro-developer`, `copywriter`, `designer`, `frontend-developer`, `regression-sentinel`, `scenario-author`, `seo-specialist`, `visual-regression-tester` and `web-conformity-checker`, and the four skills `astro`, `copywriting`, `frontend` and `web-tester`, SHALL have their sources under `artifacts/library/` and none under `artifacts/core/`. After the move `artifacts/core/agents/` holds 11 agents and `artifacts/core/skills/` holds 13 skills; `artifacts/library/` gains 11 agents and 4 skills, keeping its existing members.
2. Each moved source SHALL keep its directory contents unchanged apart from the version field of requirement 14, so that the component built from `library` is identical in behaviour to the one built from `core`.
3. A default setup run of Claude Code, Gemini CLI and Antigravity CLI SHALL install the fifteen components, skills and agents, into that CLI's home scope through the automatic library step, with no prompt and no flag. When the library staging output is absent, setup SHALL build it first, as it does today for the other library components.
4. A default setup run of GitHub Copilot CLI SHALL install the four skills into the Copilot home skills directory through the automatic library step. The eleven agents SHALL NOT be installed for Copilot CLI, because the library agent install for that CLI is declined by design (cli-matrix rows 4 and 10, `[GAP-confirmation]`); this SHALL be recorded as a named parity gap in the cli-matrix, never left implicit.
5. An adopter whose project tree held the fifteen components before the move SHALL NOT have the stale project-tree copies removed by setup, which only installs and never deletes them. In a fork that follows upstream, `scripts/sync-from-upstream.ts` SHALL remove them through its orphan cleanup of upstream-deleted tracked files on `strict` and `regenerable` paths (spec 0064); an adopter outside that flow SHALL delete them by hand. The migration note of requirement 16 SHALL state both facts.
6. A user who wants only some components SHALL be able to install a single moved component through the existing component-management commands, which already serve the `library` tier first. The pin-and-launcher distribution model of ADR-0022 and spec 0288 SHALL NOT alter this delivery: the launcher runs the same `setup` from the pinned release, so the library install it triggers is the one this spec describes.
7. CrewRig's repository SHALL NOT deploy the fifteen components to its own project trees `.claude/`, `.gemini/`, `.github/` or `.agents/`. The maintainer receives them as any adopter does, from the home install of the library tier. Rationale: the saving this move exists to deliver is the removal of their listing from every project session, and a repository that kept them would keep paying it while its adopters did not; the library tier already means "useful within CrewRig and across projects" (ADR-0011).
8. The committed built outputs of the fifteen components SHALL be removed from the four project trees in the same change that moves the sources: 11 agent files and 4 skill directories under each of `.claude/`, `.gemini/`, `.github/` and `.agents/` (the agent trees as flat `<name>.md` files, the skill trees as `<name>/` directories).
9. The built-components drift check SHALL pass on the resulting tree: it compares only the `core` tier with the committed trees, so no committed file of a moved component remains and none is expected. Building the `library` tier SHALL still succeed and SHALL write only to its gitignored `dist/library/` staging root.
10. Every document, script, test fixture and table that enumerates or locates a moved component by its core path or counts core agents or skills SHALL be updated in the same change to its library location or new count. The known set is: `README.md` (role skills listing), `tests/copilot-cli-integration.md` (home and project skill listings), `docs/skill-authoring-standard.md` (tables naming the moved components), the agent profile baseline documents and their tests (`docs/agent-profile-migration.md`, `scripts/tests/agent-profile-baseline-doc.test.ts`, `scripts/tests/agent-profile-committed.test.ts`: the 22-row baseline becomes the 11 core rows plus the 11 library rows, still all checked), the model-resolution golden fixtures that key on `core agent <name>` for the moved agents, and the `docs/index.json` entry of any document whose title or path changes. The implementation SHALL find any further hit with a repository search for the fifteen names outside `specs/`, the generated trees and `dist/`. If the repository search finds hits beyond the known set above, the implementer SHALL report them on issue #1992, and a materially larger set re-opens the tier of this change instead of being absorbed silently.
11. Historical specs under `specs/` and ADRs SHALL be left as they are.
12. Core components that remain in core and mention a moved component (the `tester` skill and agent, whose "Not for" clauses name `web-tester`, `web-conformity-checker` and `scenario-author`) SHALL keep those mentions as routing hints; they only decline a task and remain correct whether or not the library tier is installed, so no wording such as "when installed" is added. The moved components reference each other and SHALL keep doing so, since they move together; a moved component SHALL NOT be given a reference to a core component that tells it to delegate as a required step to a component absent from the library tier.
13. Where `docs/layers.md` and `.crewrig/core-paths.txt` are concerned: the rows listing the fifteen components in `docs/layers.md` SHALL move from the core tables to the library table of *Artifact zones*, and the prose describing `core` as holding illustrative role skills SHALL be reworded so that it does not claim the web skills. `.crewrig/core-paths.txt` SHALL be re-checked in the same change; it classifies the whole `artifacts/core` and `artifacts/library` zones as `strict` rather than naming components, so it SHALL remain unchanged unless that check finds a per-component entry, in which case it SHALL be updated in the same diff.
14. Each of the fifteen moved sources SHALL carry a `metadata.provenance.version` raised by one MINOR step in the same change (for example `1.2.0` to `1.3.0` for `copywriter`). Rationale: a moved shipped source is a modified shipped source under the version-bump convention, and the change is additive in contract (the component still exists and is installed) while changing where it lands; it is not MAJOR because no behaviour of the component changes. The CI check ignores renames, so the check of requirement 18 SHALL enforce this requirement.
15. The same change SHALL regenerate and stage, in one commit, every output the build derives from `artifacts/`: the four project trees (deletions of requirement 8), `docs/cli-matrix.md` rebuilt from `docs/cli-matrix/rows/`, and `docs/index.json` when requirement 10 touches an indexed document.
16. The change SHALL add a migration note to the adopter-facing documentation that names the fifteen components, states that they moved from the project tree to the library home install, gives the command that restores them (`node scripts/setup-<cli>-interactive.ts` for the CLI in use, or the component-management command for one component), states the Copilot CLI agent gap of requirement 4, and states which tool removes stale project copies (requirement 5).
17. The cli-matrix row sources under `docs/cli-matrix/rows/` that describe the tier routing and the agent and skill directories (rows 3, 4 and 10) SHALL carry one statement per CLI of what lands at home scope for these fifteen components: Claude Code (`~/.claude/skills` and `~/.claude/agents`), Gemini CLI (`~/.gemini/skills` and `~/.gemini/agents`), Antigravity CLI (`~/.gemini/config/skills` and `~/.gemini/config/agents`) deliver skills and agents; GitHub Copilot CLI (`~/.copilot/skills`) delivers skills only and names the agent gap. `docs/cli-matrix.md` SHALL be rebuilt from them.

18. The change SHALL include an automated check that the fifteen names are present under `artifacts/library/`, absent under `artifacts/core/`, and absent from the four committed project trees, and that each of the fifteen library sources carries a `metadata.provenance.version` strictly greater than the one the same name carried on the base branch, so that a later move back, a partial move or a missing bump fails a test.
19. The change SHALL NOT be declared complete until the before and after first-call token measurement of a Claude Code worker session and a subagent session is recorded on issue #1992, with the probe method of the appendix of ADR-0025, in at most two Claude Code runs in total (one worker, one subagent) for the after arm; the baseline figures of the ADR (worker 73,071 and subagent 59,366 tokens) MAY be reused for the before arm. The probe SHALL run against a project tree without the library loaded: a scratch `HOME` or a `--settings` override that hides home-scope components, and never an edit of the maintainer's `~/.claude/`; the record SHALL state which of the two was used. The record SHALL state whether the estimated saving (about 3.4k for the worker session and 1.1k for the subagent session) was reached; a shortfall SHALL be reported with its figures and SHALL NOT be hidden, and it does not by itself block the merge.
20. Implementation of this spec SHALL start only after issue #1989 has merged, because both changes touch `artifacts/core/agents/**`; this is a sequencing dependency of this change and places no requirement on #1989.

## Scenarios

### Happy path

- **Given** a fresh checkout of the repository after the change and a machine with no prior library install,
- **When** the maintainer runs the Claude Code setup and accepts the defaults,
- **Then** the four skills appear in the home skills directory, the eleven agents appear in the home agents directory, and a Claude Code session opened in the repository lists none of them from the project tree.

### Happy path: drift check

- **Given** the change is applied and the committed trees were regenerated,
- **When** the built-components check runs,
- **Then** it exits zero, `.claude/agents/` holds 11 agents, `.claude/skills/` holds 13 skills, and the same counts hold for the other three project trees.

### Happy path: single component

- **Given** the library tier has been built,
- **When** a user installs `astro` alone through the component-management command,
- **Then** `astro` is placed at home scope and no other moved component is installed.

### Failure path: Copilot CLI agents

- **Given** an adopter who uses GitHub Copilot CLI and ran its setup after the change,
- **When** the adopter looks for `seo-specialist` or any of the other ten agents,
- **Then** they are not installed, the four skills are, and the cli-matrix and migration note state this gap by name.

### Failure path: library staging missing

- **Given** a machine where the library staging output has never been built,
- **When** setup reaches the library step,
- **Then** it builds the staging output first and then installs; when the build fails, setup stops with a non-zero status and names the failed build rather than reporting success with the fifteen components missing.

### Failure path: partial move

- **Given** a change that moves the sources but leaves one moved name in a committed project tree,
- **When** the check of requirement 18 runs,
- **Then** it fails and names that file.

## Out of scope

- The agent build emitter and the core fragments of agent bodies, owned by #1989; the worker settings profile, owned by #1988; the content of `60-tools.md`, owned by #1990.
- Files in a user's home directory beyond what setup already installs; no hand edit of a maintainer's `~/.claude/` is part of the change.
- A Copilot CLI home agent install: closing the gap of requirement 4 needs the home agent layout of that CLI confirmed and is a separate change.
- Removal of the stale project-tree copies on an adopter's machine (requirement 5: setup leaves them, `sync-from-upstream` removes them in a fork).
- Rejected alternative, hiding the agents from the worker profile with `permissions.deny` while keeping them in core: it saves the worker listing only, leaves the subagent listing and every interactive session paying, and keeps the components in the project tree.
- Rejected alternative, keeping the components in core and shipping them to CrewRig's own workspace only: it keeps the cost this change removes in the one repository where all CrewRig sessions run.
- Rewording the "Not for" clauses of the `tester` agent and skill (requirement 12 keeps them).

## Open questions

- [AUTO-PARKED] Version bump size: requirement 14 chooses MINOR; the owner may prefer MAJOR because adopters lose the components from their project tree.
- [AUTO-PARKED] The Copilot CLI agent gap of requirement 4 means Copilot users lose eleven agents outright; the owner may prefer to hold the eleven agents in core for Copilot only, which no build path supports today.
