# CrewRig — Layer Taxonomy and Boundary Contract

This document is the **authoritative boundary contract** for the two-layer
adoption model introduced by spec 0012 (core framework separation). Every
path in this repository is classified as belonging to exactly one of three
layers. No path is left unclassified; an omission here is a documentation
gap, not an implicit assignment.

---

## Layer definitions

| Layer | Owner | Immutability contract |
|---|---|---|
| **`core`** | Upstream CrewRig project | Adopting organisations **SHALL NOT** modify these paths. Upstream updates land here cleanly. |
| **`overlay`** | Adopting organisation | Upstream updates **SHALL NOT** touch these paths. The organisation owns them entirely. |
| **`examples`** | Upstream CrewRig project (authoritative) | Illustrative templates. Adopting organisations may copy and adapt them but are not expected to extend them in place. |

---

## Core layer

Paths controlled exclusively by the upstream CrewRig project. An adopting
organisation that modifies a `core` path will receive a conflict on the next
upstream synchronisation; the sync mechanism (spec 0012, sub-spec D) will
refuse to proceed.

### Repository governance

| Path | Description |
|---|---|
| `AGENTS.md` | Normative working rules for every agent. Single source of truth for the lifecycle. |
| `CLAUDE.md` | Claude Code workspace bootstrap — imports `AGENTS.md`. |
| `LICENSE` | Project license. |
| `README.md` | Project overview and quick-start. |
| `CONTRIBUTING.md` | Contribution guide. |
| `DEVELOPMENT.md` | Local development setup guide. |
| `Taskfile.yml` | Task runner definitions. |
| `.gitignore` | Repository-wide ignore rules. |
| `.gitattributes` | Line-ending and diff attributes. |
| `.markdownlintrc` | Markdown lint configuration. |
| `renovate.json` | Automated dependency update configuration. |
| `package.json` | Node.js tooling manifest (linting, markdown tooling). |
| `package-lock.json` | Locked dependency tree for Node.js tooling. |

### Documentation and specifications

| Path | Description |
|---|---|
| `docs/` | All normative and reference documentation, including ADRs, format specs, and this file. The `docs/org/` subtree is carved out as overlay (spec 0020) — see the Overlay layer. |
| `specs/` | Immutable specification history. Spec **content** is append-only; existing files are not edited after merge except for lifecycle-metadata transitions (`status`, `superseded-by`) — see [`docs/spec-format.md`](spec-format.md). The `specs/org/` subtree is carved out as overlay (spec 0020) — see the Overlay layer. |

### Build and install tooling

| Path | Description |
|---|---|
| `scripts/` | All build, install, setup, and utility scripts. |
| `tests/` | Automated test suite. |
| `tests/fixtures/overlay/` | Fixture overlay components used by the assembly verification test (`scripts/tests/test-assembly-verification.sh`). Contains minimal skill and agent fixtures that are never deployed to production. |
| `docker/` | Docker infrastructure for end-to-end tests. |
| `config/.env.example` | Environment variable reference (gitignored `.env` is never committed). |
| `config/release-monorepo.json` | Monorepo release tooling configuration. |

### Artifact zones — core and library

`artifacts/FORMAT.md` is the normative format contract for all artifact
components (core).

The `artifacts/` directory is structured into four zones. Two zones are
core-owned (upstream immutable); two are overlay-owned (adopting organisation).

**`artifacts/library/`** — harness machinery. The friction-reporting and
curation system. Deployed to user home scope (e.g., `~/.claude/skills/`).

| Path | Description |
|---|---|
| `artifacts/library/skills/harness-report/` | Harness skill — friction tagging protocol. |
| `artifacts/library/skills/harness-curator/` | Harness skill — friction clustering and issue authoring. |
| `artifacts/library/agents/harness-curator/` | Harness agent — curator specialist. |

**`artifacts/core/`** — SDLC lifecycle tools and operational role skills and
agents. Deployed to project scope (e.g., `.claude/skills/` in the workspace).
Includes both the SPECS → PLAN → DEV → REVIEW cycle machinery and the
illustrative role skills and agents that ship with the upstream framework.

SDLC lifecycle tools:

| Path | Description |
|---|---|
| `artifacts/core/skills/spec-author/` | Lifecycle skill — qualification stage author. |
| `artifacts/core/skills/pr-logbook/` | Lifecycle skill — PR and logbook composer. |
| `artifacts/core/skills/pr-reviewer/` | Lifecycle skill — independent PR reviewer. |
| `artifacts/core/agents/spec-author/` | Lifecycle agent — spec-author specialist. |
| `artifacts/core/agents/pr-logbook/` | Lifecycle agent — logbook composer specialist. |
| `artifacts/core/agents/pr-reviewer/` | Lifecycle agent — PR reviewer specialist. |
| `artifacts/core/agents/architect/` | Lifecycle agent — architect specialist (plan and design). |

Core rules files (deployed to user home at a fixed priority number):

| Path | Description |
|---|---|
| `artifacts/core/rules/60-tools.md` | Framework-critical tool instructions: three-tier memory architecture, MemPalace protocol, harness engineering loop, Sequential Thinking, Obsidian access model. Deployed at priority 60. NOT a template — upstream content. |

### Built outputs

Built by `scripts/build-components.sh` from `artifacts/`. These
directories are **assembly zones**: after a build they contain both
core-provided harness components and the adopting organisation's own compiled
components. They are never edited directly; the source of truth is always
`artifacts/`.

An adopting organisation may activate only a subset of CLIs; the sync
mechanism respects this scope. The detailed assembly model (which CLI outputs
exist, how org artefacts integrate) is defined in spec 0012 sub-spec E2.

| Path | Description |
|---|---|
| `.claude/skills/` | Compiled Claude Code skill definitions. |
| `.claude/agents/` | Compiled Claude Code agent definitions. |
| `.gemini/skills/` | Compiled Gemini CLI skill definitions. |
| `.gemini/agents/` | Compiled Gemini CLI agent definitions. |
| `.gemini/commands/` | Compiled Gemini CLI slash-command definitions (bootstrap helpers). |
| `.github/skills/` | Compiled GitHub Copilot skill definitions. |
| `.github/agents/` | Compiled GitHub Copilot agent definitions. |
| `.github/copilot-instructions.md` | Copilot system prompt built from `AGENTS.md`. |
| `.github/workflows/` | CI/CD pipeline definitions. |
| `.github/copilot/` | GitHub Copilot workspace configuration. |

### Extension distribution channel

| Path | Description |
|---|---|
| `extension-skeleton/` | Scaffold templates for creating new CrewRig extensions. |
| `hooks/` | Cross-CLI transcript hook configuration files (`claude-transcript-hooks.json`, `gemini-transcript-hooks.json`, `copilot-transcript-hooks.json`, `mempalace-transcript.sh`). |

### Infrastructure service definitions

Service management files for CrewRig's own infrastructure dependencies
(e.g., ChromaDB for MemPalace). These are maintained by upstream and apply
to every deployment of CrewRig.

| Path | Description |
|---|---|
| `config/launchd/` | macOS launchd service definitions for CrewRig infrastructure services. |
| `config/systemd/` | Linux systemd unit files for CrewRig infrastructure services. |

### Public communications

| Path | Description |
|---|---|
| `communication/` | Conference talks, demos, and public presentation materials. |

### Sync tooling

| Path | Description |
|---|---|
| `.crewrig/` | Machine-readable sync manifest and related tooling. `.crewrig/core-paths.txt` enumerates core-layer paths and their sync policy consumed by `scripts/sync-from-upstream.sh`. The `.crewrig/.synced-markers/` subtree is carved out as adopter-owned state (spec 0020) — see the Overlay layer. |

---

## Overlay layer

Paths reserved exclusively for the adopting organisation. The upstream
synchronisation mechanism will never modify these paths. An adopting
organisation initialises them by copying the relevant starting-point templates
from the examples layer.

### Fork identity and configuration

| Path | Description |
|---|---|
| `crewrig.config.toml` | Fork-level configuration: `canonical_repo`, `feedback_repo`, overlay path declarations. |
| `config/ORGANIZATION.md` | Organisation overview: company context, code quality standards, collaboration norms. |
| `config/TOOLS.md` | Tool and MCP server guidelines specific to the organisation. |

### CLI-specific overlay configuration

| Path | Description |
|---|---|
| `config/claude/` | Claude Code overlay rules and workspace settings. |
| `config/gemini/` | Gemini CLI overlay configuration files. |
| `config/copilot/` | GitHub Copilot overlay configuration files. |
| `.claude/settings.json` | Claude Code workspace-level settings (memory, permissions). |

### Extensions and organisation-specific artifact zones

| Path | Description |
|---|---|
| `extensions/` | Organisation-owned extension registry. The adopting organisation places its own CrewRig extensions here. Upstream extensions are installed via `scripts/install-extension.sh` rather than committed directly. |
| `artifacts/community/mcp-servers/` | MCP server declarations specific to the organisation (Jira, Confluence, Slack, etc.). |
| `artifacts/community/hooks/` | Lifecycle hooks specific to the organisation. |
| `artifacts/community/policies/` | Organisation-level policy files. |
| `artifacts/community/themes/` | UI theme files specific to the organisation. |
| `artifacts/community/commands/` | Organisation-specific slash-command definitions. |
| `artifacts/community/skills/` | Sandbox for the organisation's own role skills, not yet validated for the organisation layer. |
| `artifacts/community/agents/` | Sandbox for the organisation's own agents, not yet validated for the organisation layer. |
| `artifacts/org/skills/` | Organisation-validated role skills — promoted from `artifacts/community/` after internal review. Compiled by the tier-agnostic build like any other tier (ADR-0011, spec 0019); installed to the user home on opt-in. |
| `artifacts/org/agents/` | Organisation-validated agents — promoted from `artifacts/community/` after internal review. Compiled by the tier-agnostic build like any other tier (ADR-0011, spec 0019); installed to the user home on opt-in. |

### Org overlay carve-outs in core trees (spec 0020)

Org-owned paths nested within otherwise-core trees. The upstream
synchronisation classifies each as **excluded** in `.crewrig/core-paths.txt`
and carves it out of its core parent's dirty guard and restore via a
`:(exclude)` pathspec, so it is never modified, restored, or able to abort a
sync.

| Path | Description |
|---|---|
| `specs/org/` | Organisation-owned specification overlay, nested in core `specs/`. Excluded from upstream sync. |
| `docs/org/` | Organisation-owned documentation overlay, nested in core `docs/`. Excluded from upstream sync. |
| `AGENTS.org.md` | Organisation-owned agent-rules extension, loaded alongside the upstream `AGENTS.md` (natively on Claude via `@` import; via the priority-66 setup deployment on Gemini and Copilot). Excluded from upstream sync. |

### Adopter-managed sync state (spec 0020)

| Path | Description |
|---|---|
| `.crewrig/.synced-markers/` | Per-path last-synced upstream blob SHAs backing the **adopt-on-edit** decision. Machine-managed by `scripts/sync-from-upstream.sh` (do not hand-edit); **committed** by the adopter so the customisation verdict survives a fresh clone (R7), and **never synced** from upstream — carved out of the `.crewrig` guard and restore. |

The `README.md` core-governance entry carries the **adopt-on-edit** policy
(spec 0020): upstream-owned until the adopter modifies it, then preserved
permanently. It remains a core path; only its sync policy differs from
`strict`.

---

## Examples layer

Illustrative paths authored by the upstream CrewRig project to demonstrate
the framework to newcomers. Adopting organisations may copy any of these
into their overlay and adapt them freely; they are not intended to be
extended or overridden in place.

A notice SHALL be present in each examples component indicating its
demonstrative nature (spec 0012 R3).

### Persona and context starting points

Default persona and context files that CrewRig ships as illustrative
starting points. An adopting organisation copies these into its own overlay
and customises them. After copying, the customised version is `overlay`; the
originals here remain `examples`.

| Path | Description |
|---|---|
| `config/level/` | Seniority-level context rules (e.g., `10-level.md`). Starting points for an org's own level definitions. |
| `config/expertise/` | Domain-expertise context rules. Starting points for an org's own expertise profiles. |
| `config/teams/` | Per-team context and configuration. Starting points for an org's own team configs. |

### Illustrative skills

Role skills shipped by the upstream CrewRig project. They live in
`artifacts/core/` — actively used by the upstream project for its own
development workflow and serving as high-quality starting points for
adopting organisations building their own role skills.

| Path |
|---|
| `artifacts/core/skills/architect/` |
| `artifacts/core/skills/astro/` |
| `artifacts/core/skills/copywriting/` |
| `artifacts/core/skills/developer/` |
| `artifacts/core/skills/doc-writer/` |
| `artifacts/core/skills/frontend/` |
| `artifacts/core/skills/github-actions/` |
| `artifacts/core/skills/security/` |
| `artifacts/core/skills/tester/` |
| `artifacts/core/skills/web-tester/` |

### Illustrative agents

Role agents shipped by the upstream CrewRig project. Same dual-use nature as
the illustrative skills: actively used by upstream, and illustrative starting
points for adopting organisations.

| Path |
|---|
| `artifacts/core/agents/accessibility-auditor/` |
| `artifacts/core/agents/accessibility-tester/` |
| `artifacts/core/agents/astro-developer/` |
| `artifacts/core/agents/ci-configurator/` |
| `artifacts/core/agents/ci-debugger/` |
| `artifacts/core/agents/copywriter/` |
| `artifacts/core/agents/designer/` |
| `artifacts/core/agents/developer/` |
| `artifacts/core/agents/doc-writer/` |
| `artifacts/core/agents/frontend-developer/` |
| `artifacts/core/agents/regression-sentinel/` |
| `artifacts/core/agents/scenario-author/` |
| `artifacts/core/agents/security/` |
| `artifacts/core/agents/seo-specialist/` |
| `artifacts/core/agents/tester/` |
| `artifacts/core/agents/visual-regression-tester/` |
| `artifacts/core/agents/web-conformity-checker/` |

### Identity and configuration templates

Default starting points for the overlay identity files. An adopting
organisation copies one of these, customises it, and saves the result as the
corresponding overlay path (`config/SOUL.md`, `config/PROFILE.md`,
`crewrig.config.toml`). The templates themselves are illustrative; the
organisation owns only the customised instances.

| Path | Seeds overlay file |
|---|---|
| `config/SOUL.md.template` | `config/SOUL.md` |
| `config/PROFILE.md.template` | `config/PROFILE.md` |
| `crewrig.config.toml.template` | `crewrig.config.toml` |
| `config/ORGANIZATION.md.template` | `config/ORGANIZATION.md` |
| `config/TOOLS.md.template` | `config/TOOLS.md` |

---

## Ephemeral and tool-generated paths

The following paths are generated at runtime or by tooling and are not part
of the adoption model. They carry no layer classification and MUST NOT be
committed to the repository.

| Path | Origin |
|---|---|
| `.claude/scheduled_tasks.lock` | Claude Code internal lock file. |
| `.claude/settings.local.json` | Local-only Claude Code overrides. |
| `.claude/worktrees/` | Claude Code worktree metadata. |
| `.worktrees/` | Git worktrees created during agent team sessions. |
| `dist/<tier>/` | Gitignored staging tree for non-`core` build outputs (ADR-0011, spec 0019). `scripts/build-components.sh` writes each non-`core` tier here (`library`, `community`, `org`); the interactive setup scripts install from it to the user home. Never committed. |
| `.DS_Store` | macOS Finder metadata. |
| `node_modules/` | Node.js dependencies installed locally — gitignored. |
| `*.env` | Environment secrets — never committed. |
| `config/SOUL.md` | User-generated from `config/SOUL.md.template` — gitignored, personal to each developer, never committed. |
| `config/PROFILE.md` | User-generated from `config/PROFILE.md.template` — gitignored, personal to each developer, never committed. |

---

## `config/` quick-reference

The `config/` directory is the only top-level path with sub-paths distributed
across multiple layers. This table provides a single-lookup view.

| Path | Layer |
|---|---|
| `config/.env.example` | core |
| `config/release-monorepo.json` | core |
| `config/launchd/` | core |
| `config/systemd/` | core |
| `config/SOUL.md` | user-local (gitignored) |
| `config/PROFILE.md` | user-local (gitignored) |
| `config/ORGANIZATION.md` | overlay |
| `config/TOOLS.md` | overlay |
| `config/claude/` | overlay |
| `config/gemini/` | overlay |
| `config/copilot/` | overlay |
| `config/level/` | examples |
| `config/expertise/` | examples |
| `config/teams/` | examples |
| `config/SOUL.md.template` | examples |
| `config/PROFILE.md.template` | examples |
| `config/ORGANIZATION.md.template` | examples |
| `config/TOOLS.md.template` | examples |

---

## Classification rules for future paths

When a new path is added to the repository and this document has not yet been
updated, the following default rules apply until an explicit classification is
merged:

1. A new file or directory added by an upstream CrewRig pull request is **`core`** by default.
2. A new file or directory added exclusively by an adopting organisation is **`overlay`** by default.
3. Any ambiguity MUST be resolved by opening an issue and merging a delta to this document before the next upstream synchronisation cycle.
