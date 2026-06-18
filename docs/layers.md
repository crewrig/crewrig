# CrewRig — Layer Taxonomy and Boundary Contract

<!-- crewrig-doc: section=adoption nav_order=20 published=true title="Layer taxonomy and boundary contract" -->

This document is the **authoritative boundary contract** for the two-layer
adoption model introduced by spec 0012 (core framework separation). Every
path in this repository is classified as belonging to exactly one of three
layers. No path is left unclassified; an omission here is a documentation
gap, not an implicit assignment.

---

## Layer definitions

| Layer | Owner | Immutability contract |
|---|---|---|
| **`core`** | Upstream CrewRig project | Adopting organizations **SHALL NOT** modify these paths. Upstream updates land here cleanly. |
| **`overlay`** | Adopting organization | Upstream updates **SHALL NOT** touch these paths. The organization owns them entirely. |
| **`examples`** | Upstream CrewRig project (authoritative) | Illustrative templates. Adopting organizations may copy and adapt them but are not expected to extend them in place. |

---

## Core layer

Paths controlled exclusively by the upstream CrewRig project. An adopting
organization that modifies a `core` path will receive a conflict on the next
upstream synchronization; the sync mechanism (spec 0012, sub-spec D) will
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
| `docs/index.json` | Generated public-documentation manifest (spec 0027). Core/`strict`, committed, and consumed by the separate site repository — see *Documentation publication contract* below. |
| `specs/` | Immutable specification history. Spec **content** is append-only; existing files are not edited after merge except for lifecycle-metadata transitions (`status`, `superseded-by`) and meaning-preserving editorial edits (orthography, typo fixes) — see [`docs/spec-format.md`](spec-format.md). The `specs/org/` subtree is carved out as overlay (spec 0020) — see the Overlay layer. |

#### Documentation publication contract

Per [spec 0027](../specs/0027-docs-ia-and-publication-contract.md), every page
under `docs/` declares a metadata block (an HTML comment immediately after its
H1) stating its section, navigation order, and published status. The full
normative contract — the eight-section taxonomy, the metadata-block grammar,
and the `docs/index.json` schema — lives in
[`docs/publication-contract.md`](publication-contract.md).

`docs/index.json` is the generated, **committed** manifest of the public
documentation subset. It is classified **core / `strict`** (upstream-owned;
a local modification halts the sync). The generator
`scripts/build-docs-index.sh` (also core/`strict`) derives it from the
per-page blocks; CI runs `bash scripts/build-docs-index.sh --check` to guard
against drift. Org-overlay documentation under `docs/org/` is `excluded` from
sync and is unioned into the organization's own site build under the same
contract — never flowing back upstream.

### Continuous-integration reference (spec 0047)

| Path | Description |
|---|---|
| `ci/` | Platform-neutral CI capability reference (`ci/ci-capabilities.yml`). One entry per CI job — the engine-agnostic source of truth that the per-engine pipelines (GitHub Actions today, GitLab CI and others later) are derived from and drift-checked against. Core/`strict`; its normative shape is `docs/ci-reference-format.md` (ADR-0012). Top-level rather than under `.github/` so the reference reads as engine-neutral, not GitHub-owned. |

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
core-owned (upstream immutable); two are overlay-owned (adopting organization).

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
core-provided harness components and the adopting organization's own compiled
components. They are never edited directly; the source of truth is always
`artifacts/`.

An adopting organization may activate only a subset of CLIs; the sync
mechanism respects this scope. The detailed assembly model (which CLI outputs
exist, how org artifacts integrate) is defined in spec 0012 sub-spec E2.

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
| `extensions/core/` | Upstream-shipped core extensions (e.g. the `hello-world` demo). Synced from upstream under the **strict** policy — a local modification halts the sync, consistent with `artifacts/core/`. |
| `extensions/library/` | Upstream harness and shared extensions. Synced from upstream under the **strict** policy. Ships empty (populated upstream). |

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

Paths reserved exclusively for the adopting organization. The upstream
synchronization mechanism will never modify these paths. An adopting
organization initializes them by copying the relevant starting-point templates
from the examples layer.

### Fork identity and configuration

| Path | Description |
|---|---|
| `crewrig.config.toml` | Fork-level configuration: `canonical_repo`, `feedback_repo` (scopes to adopter-owned tiers only — upstream-owned components always route feedback to `canonical_repo`), overlay path declarations. |
| `config/ORGANIZATION.md` | Organization overview: company context, code quality standards, collaboration norms. |
| `config/TOOLS.md` | Tool and MCP server guidelines specific to the organization. |

### CLI-specific overlay configuration

| Path | Description |
|---|---|
| `config/claude/` | Claude Code overlay rules and workspace settings. |
| `config/gemini/` | Gemini CLI overlay configuration files. |
| `config/copilot/` | GitHub Copilot overlay configuration files. |
| `.claude/settings.json` | Claude Code workspace-level settings (memory, permissions). |

### Extensions and organization-specific artifact zones

| Path | Description |
|---|---|
| `extensions/org/` | Adopter-owned extension tier. The adopting organization places its own CrewRig extensions here. Excluded from the upstream sync — never modified, restored, or aborted on. The upstream `extensions/core/` and `extensions/library/` tiers are committed and live in the Core layer. |
| `artifacts/community/mcp-servers/` | MCP server declarations specific to the organization (Jira, Confluence, Slack, etc.). |
| `artifacts/community/hooks/` | Lifecycle hooks specific to the organization. |
| `artifacts/community/policies/` | Organization-level policy files. |
| `artifacts/community/themes/` | UI theme files specific to the organization. |
| `artifacts/community/commands/` | Organization-specific slash-command definitions. |
| `artifacts/community/skills/` | Sandbox for the organization's own role skills, not yet validated for the organization layer. |
| `artifacts/community/agents/` | Sandbox for the organization's own agents, not yet validated for the organization layer. |
| `artifacts/org/skills/` | Organization-validated role skills — promoted from `artifacts/community/` after internal review. Compiled by the tier-agnostic build like any other tier (ADR-0011, spec 0019); installed to the user home on opt-in. |
| `artifacts/org/agents/` | Organization-validated agents — promoted from `artifacts/community/` after internal review. Compiled by the tier-agnostic build like any other tier (ADR-0011, spec 0019); installed to the user home on opt-in. |

### Org overlay carve-outs in core trees (spec 0020)

Org-owned paths nested within otherwise-core trees. The upstream
synchronization classifies each as **excluded** in `.crewrig/core-paths.txt`
and carves it out of its core parent's dirty guard and restore via a
`:(exclude)` pathspec, so it is never modified, restored, or able to abort a
sync.

| Path | Description |
|---|---|
| `specs/org/` | Organization-owned specification overlay, nested in core `specs/`. Excluded from upstream sync. |
| `docs/org/` | Organization-owned documentation overlay, nested in core `docs/`. Excluded from upstream sync. |
| `AGENTS.org.md` | Organization-owned agent-rules extension, loaded alongside the upstream `AGENTS.md` (natively on Claude via `@` import; via the priority-66 setup deployment on Gemini and Copilot). Excluded from upstream sync. |

### Adopter-managed sync state (spec 0020)

| Path | Description |
|---|---|
| `.crewrig/.synced-markers/` | Per-path last-synced upstream blob SHAs backing the **adopt-on-edit** decision. Machine-managed by `scripts/sync-from-upstream.sh` (do not hand-edit); **committed** by the adopter so the customization verdict survives a fresh clone (R7), and **never synced** from upstream — carved out of the `.crewrig` guard and restore. |

The `README.md` core-governance entry carries the **adopt-on-edit** policy
(spec 0020): upstream-owned until the adopter modifies it, then preserved
permanently. It remains a core path; only its sync policy differs from
`strict`.

### Persona, team, and seniority catalogs (spec 0021)

`config/expertise/`, `config/teams/`, and `config/level/` are **core paths**
carrying the **adopt-on-edit** policy at **directory granularity**. Each is
reconciled member-by-member by `scripts/sync-from-upstream.sh`
(`reconcile_dir`): an untouched file keeps updating from upstream, a newly
published upstream example is added (if the path never existed in the org's
own history), a file the org customizes or deletes freezes permanently
(deletions stay deleted), and any file the org adds is left untouched. They
moved here from the *Examples layer* (where they were copy-and-own starting
points) so adopters receive upstream catalog improvements in place rather
than re-copying. Adopters may add their own role and team files through the
`init-expertise` and `init-team` guided skills.

| Path | Description |
|---|---|
| `config/expertise/` | Domain-expertise (role) context profiles. adopt-on-edit (directory). |
| `config/teams/` | Per-team context and configuration profiles. adopt-on-edit (directory). |
| `config/level/` | Seniority-level context rules. adopt-on-edit (directory). |

---

## Examples layer

Illustrative paths authored by the upstream CrewRig project to demonstrate
the framework to newcomers. Adopting organizations may copy any of these
into their overlay and adapt them freely; they are not intended to be
extended or overridden in place.

A notice SHALL be present in each examples component indicating its
demonstrative nature (spec 0012 R3). **Exception (spec 0021):**
`config/expertise/`, `config/teams/`, and `config/level/` are no longer
examples — they moved to the core layer under the **adopt-on-edit** sync
policy (see *Core layer → Persona, team, and seniority catalogs*). Under
that policy the shipped files are meant to be extended in place, which
inverts the "do not extend in place" demonstrative contract; they are
therefore exempt from this notice requirement.

### Illustrative skills

Role skills shipped by the upstream CrewRig project. They live in
`artifacts/core/` — actively used by the upstream project for its own
development workflow and serving as high-quality starting points for
adopting organizations building their own role skills.

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
points for adopting organizations.

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
organization copies one of these, customizes it, and saves the result as the
corresponding overlay path (`config/SOUL.md`, `config/PROFILE.md`,
`crewrig.config.toml`). The templates themselves are illustrative; the
organization owns only the customized instances.

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
| `config/level/` | core (adopt-on-edit) |
| `config/expertise/` | core (adopt-on-edit) |
| `config/teams/` | core (adopt-on-edit) |
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
2. A new file or directory added exclusively by an adopting organization is **`overlay`** by default.
3. Any ambiguity MUST be resolved by opening an issue and merging a delta to this document before the next upstream synchronization cycle.
