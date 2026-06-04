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
| `docs/` | All normative and reference documentation, including ADRs, format specs, and this file. |
| `specs/` | Immutable specification history. Spec files are append-only; existing files are never edited after merge. |

### Build and install tooling

| Path | Description |
|---|---|
| `scripts/` | All build, install, setup, and utility scripts. |
| `tests/` | Automated test suite. |
| `docker/` | Docker infrastructure for end-to-end tests. |
| `config/.env.example` | Environment variable reference (gitignored `.env` is never committed). |
| `config/release-monorepo.json` | Monorepo release tooling configuration. |

### Community configuration — harness components

The harness skill set and harness agent set (as defined in spec 0012 R6,
amended by delta-01) are core. All other skill and agent directories in
`community-config/` are classified under **examples**.

| Path | Description |
|---|---|
| `community-config/FORMAT.md` | Normative format contract for skills, agents, and commands. |
| `community-config/skills/spec-author/` | Harness skill — qualification stage author. |
| `community-config/skills/harness-curator/` | Harness skill — friction clustering and issue authoring. |
| `community-config/skills/harness-report/` | Harness skill — friction tagging protocol. |
| `community-config/skills/pr-logbook/` | Harness skill — PR and logbook composer. |
| `community-config/skills/pr-reviewer/` | Harness skill — independent PR reviewer. |
| `community-config/agents/spec-author/` | Harness agent — spec-author specialist. |
| `community-config/agents/harness-curator/` | Harness agent — curator specialist. |
| `community-config/agents/pr-logbook/` | Harness agent — logbook composer specialist. |
| `community-config/agents/pr-reviewer/` | Harness agent — PR reviewer specialist. |
| `community-config/agents/architect/` | Harness agent — architect specialist (plan and design). |

### Built outputs

Built by `scripts/build-components.sh` from `community-config/`. Regenerated
automatically on every relevant commit; never edited directly.

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

### Extension distribution channel and registry

| Path | Description |
|---|---|
| `extension-skeleton/` | Scaffold templates for creating new CrewRig extensions. |
| `extensions/` | Upstream-provided extension registry. Extensions authored here are distributed via `scripts/install-extension.sh`. |
| `hooks/` | Cross-CLI transcript hook configuration files (`claude-transcript-hooks.json`, `gemini-transcript-hooks.json`, `copilot-transcript-hooks.json`, `mempalace-transcript.sh`). |

### Public communications

| Path | Description |
|---|---|
| `communication/` | Conference talks, demos, and public presentation materials. |

---

## Overlay layer

Paths reserved exclusively for the adopting organisation. The upstream
synchronisation mechanism will never modify these paths. An adopting
organisation initialises them from the core-provided templates where
templates exist.

### Fork identity and configuration

| Path | Description |
|---|---|
| `crewrig.config.toml` | Fork-level configuration: `canonical_repo`, `feedback_repo`, overlay path declarations. |
| `config/SOUL.md` | Organisation identity: mission, values, working philosophy. |
| `config/PROFILE.md` | Personal profile: user name, role, preferred language, tooling preferences. |
| `config/ORGANIZATION.md` | Organisation overview: company context, code quality standards, collaboration norms. |
| `config/TOOLS.md` | Tool and MCP server guidelines specific to the organisation. |

### Persona and context files

| Path | Description |
|---|---|
| `config/level/` | Seniority-level context rules (e.g., `10-level.md`). |
| `config/expertise/` | Domain-expertise context rules. |
| `config/teams/` | Per-team context and configuration. |

### CLI-specific overlay configuration

| Path | Description |
|---|---|
| `config/claude/` | Claude Code overlay rules and workspace settings. |
| `config/gemini/` | Gemini CLI overlay configuration files. |
| `config/copilot/` | GitHub Copilot overlay configuration files. |
| `.claude/settings.json` | Claude Code workspace-level settings (memory, permissions). |

### System service definitions

| Path | Description |
|---|---|
| `config/launchd/` | macOS launchd service definitions (organisation-specific launch agents). |
| `config/systemd/` | Linux systemd unit files (organisation-specific services). |

### Organisation-specific community configuration

| Path | Description |
|---|---|
| `community-config/mcp-servers/` | MCP server declarations specific to the organisation (Jira, Confluence, Slack, etc.). |
| `community-config/hooks/` | Lifecycle hooks specific to the organisation. |
| `community-config/policies/` | Organisation-level policy files. |
| `community-config/themes/` | UI theme files specific to the organisation. |
| `community-config/commands/` | Organisation-specific slash-command definitions. |
| `community-config/skills/<org-name>/` | Any skill directory in `community-config/skills/` not belonging to the harness skill set (see Core) and not listed under Examples is reserved for the adopting organisation's own role skills. |
| `community-config/agents/<org-name>/` | Any agent directory in `community-config/agents/` not belonging to the harness agent set (see Core) and not listed under Examples is reserved for the adopting organisation's own agents. |

---

## Examples layer

Illustrative paths authored by the upstream CrewRig project to demonstrate
the framework to newcomers. Adopting organisations may copy any of these
into their overlay and adapt them freely; they are not intended to be
extended or overridden in place.

A notice SHALL be present in each examples component indicating its
demonstrative nature (spec 0012 R3).

### Illustrative skills

Skills in `community-config/skills/` not belonging to the harness skill set
(spec 0012 R8):

| Path |
|---|
| `community-config/skills/architect/` |
| `community-config/skills/astro/` |
| `community-config/skills/copywriting/` |
| `community-config/skills/developer/` |
| `community-config/skills/doc-writer/` |
| `community-config/skills/frontend/` |
| `community-config/skills/github-actions/` |
| `community-config/skills/security/` |
| `community-config/skills/tester/` |
| `community-config/skills/web-tester/` |

### Illustrative agents

Agents in `community-config/agents/` not belonging to the harness agent set
(spec 0012 R8, amended by delta-01):

| Path |
|---|
| `community-config/agents/accessibility-auditor/` |
| `community-config/agents/accessibility-tester/` |
| `community-config/agents/astro-developer/` |
| `community-config/agents/ci-configurator/` |
| `community-config/agents/ci-debugger/` |
| `community-config/agents/copywriter/` |
| `community-config/agents/designer/` |
| `community-config/agents/developer/` |
| `community-config/agents/doc-writer/` |
| `community-config/agents/frontend-developer/` |
| `community-config/agents/regression-sentinel/` |
| `community-config/agents/scenario-author/` |
| `community-config/agents/security/` |
| `community-config/agents/seo-specialist/` |
| `community-config/agents/tester/` |
| `community-config/agents/visual-regression-tester/` |
| `community-config/agents/web-conformity-checker/` |

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
| `crewrig.config.toml.template` *(forthcoming — spec 0012 R12)* | `crewrig.config.toml` |

### Forthcoming examples directory

`examples/` — **not yet present** in the repository. Planned by spec 0012 R11
(sub-spec B or C of the core framework separation). When introduced, it will
serve as the primary landing zone for illustrative role skills, configuration
templates, and other starting-point artefacts, visually distinct from the core
harness area. The identity templates above will physically relocate there at
that point.

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
| `.DS_Store` | macOS Finder metadata. |
| `node_modules/` | Node.js dependencies installed locally — gitignored. |
| `*.env` | Environment secrets — never committed. |

---

## Classification rules for future paths

When a new path is added to the repository and this document has not yet been
updated, the following default rules apply until an explicit classification is
merged:

1. A new file or directory added by an upstream CrewRig pull request is **`core`** by default.
2. A new file or directory added exclusively by an adopting organisation is **`overlay`** by default.
3. Any ambiguity MUST be resolved by opening an issue and merging a delta to this document before the next upstream synchronisation cycle.
