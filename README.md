# CrewRig

CrewRig is a centralized configuration framework for
[Gemini CLI](https://github.com/google-gemini/gemini-cli),
[Claude Code](https://claude.ai/code), and
[GitHub Copilot CLI](https://docs.github.com/copilot/github-copilot-in-the-cli).
It serves three complementary
purposes:

- **Personal context layer** — layered configuration files shape how AI
  assistants behave for a specific user's role, team, and seniority.
- **Shared artifact zones** — `artifacts/` is the single-source zone where
  skills, agents, and commands are authored once and compiled into outputs
  for all supported CLIs.
- **Harness engineering** — a built-in feedback loop lets agents tag
  frictions encountered during real work; the harness curator clusters
  those frictions into actionable GitHub issues, closing the loop
  between AI behavior and continuous improvement.

CrewRig develops itself using its own mechanics. The internal agent crew
— architect, developer, tester, pr-logbook, and pr-reviewer — runs on
the same skills and agents that ship with the framework. The development
workflow is the product in action.

## Supported Platforms

| Platform | Config Target | Setup Command |
|----------|---------------|---------------|
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | `~/.gemini/` | `task setup-gemini-interactive` |
| [Claude Code](https://claude.ai/code) | `~/.claude/rules/` | `task setup-claude-interactive` |
| [GitHub Copilot CLI](https://docs.github.com/copilot/github-copilot-in-the-cli) | Split: `.github/copilot/` + `.github/skills/` + `.github/agents/` (workspace-level) | `task setup-copilot-interactive` |

All platforms share the same source configuration files in `config/` and
`artifacts/`. Setup and build scripts deploy them into the
platform-specific directories. See `docs/cli-matrix.md` for the full
per-CLI integration matrix.

## How It Works

### Layered Context

Configuration files are organized by priority. Each file addresses a
specific concern (identity, policies, expertise, etc.) and they combine
to form the agent's full context:

| Priority | Source | Purpose |
|----------|--------|---------|
| 00 | `config/SOUL.md` | Agent identity and values |
| 10 | `config/level/<LEVEL>.md` | Seniority-adapted guidance |
| 20 | `config/ORGANIZATION.md` | Company-wide policies |
| 30 | `config/PROFILE.md` | Personal information |
| 40 | `config/expertise/<ROLE>.md` | Technical specialization |
| 50 | `config/teams/<TEAM>.md` | Team practices and norms |
| 60 | `config/TOOLS.md` | Memory architecture and MCP servers |

**Gemini CLI** loads these via numeric-prefix files in `~/.gemini/` with
enforced priority order. **Claude Code** loads them from `~/.claude/rules/`
as additive context (all files combine, no override). **GitHub Copilot CLI**
loads them from `~/.copilot/instructions/` as `*.instructions.md` files,
applied to all sessions.

### Artifact Zone

`artifacts/` is the single-source zone where skills, agents, and commands
are written **once** and compiled into outputs for all CLIs. Contributors
edit a single Markdown file with YAML frontmatter; the build step produces
Gemini CLI, Claude Code, and GitHub Copilot CLI targets.

| Type | Description |
|---|---|
| Skill | Reusable agent behaviour activated via `/skill-name` |
| Command | Slash command with a prompt body |
| Agent | Sub-agent with a dedicated persona |
| Hook | Lifecycle hook (BeforeTool/AfterTool/etc.) |
| Policy | Security or behavioural constraint |
| MCP Server | External tool integration |
| Theme | UI theme fragment |

Install a component on a project:

```bash
# Gemini CLI
task install-component TYPE=skills NAME=my-skill

# Claude Code
task install-claude-component TYPE=claude-skills NAME=my-skill
```

See [`artifacts/FORMAT.md`](artifacts/FORMAT.md) for the
full unified-source specification.

### Harness Engineering Loop

The harness turns real-world frictions into shipped improvements through
a four-stage loop:

1. **Tag** — during real work, agents invoke the `harness-report` skill
   the moment a friction signal fires (user pushback, tool surprise,
   process gap). Each tag lands in the MemPalace `harness-friction`
   wing.
2. **Cluster** — `task harness-curate -- --apply` clusters the tagged
   frictions by subcategory and opens one descriptive GitHub issue per
   cluster.
3. **Fix** — issues are addressed via the normal branch/PR workflow;
   the internal agent crew handles the implementation cycle.
4. **Re-install** — after a fix ships, run `task build-components` and
   reinstall. The `metadata.provenance.version` bump in every modified
   `SKILL.md` signals that a new version is available.

For automated periodic sweeps,
`artifacts/library/skills/harness-curator/scripts/schedule-curator.sh`
installs a macOS launchd job or a Linux crontab entry that runs the
curator on a fixed cadence.

### Security: Copy by Default

Context files are **copied** (not symlinked) to the target directory by
default. This prevents context poisoning from malicious branches. Symlink
mode is available for development only (with a security disclaimer).

### Memory Architecture

The framework implements a three-tier memory model:

| Tier | System | Role | Access |
|------|--------|------|--------|
| 1 | Sequential Thinking | Working memory (ephemeral) | Session only |
| 2 | MemPalace | Agent memory (persistent) | Read/write, cross-tool |
| 3 | Obsidian | User knowledge (Second Brain) | Read free, write user-controlled |

See `config/TOOLS.md` for the full memory protocol.

#### Multi-agent concurrency and ChromaDB HTTP daemon

When multiple CLI sessions (Claude Code, Gemini CLI, Copilot CLI) or
parallel agents access MemPalace simultaneously, each `PersistentClient`
instance spawns its own Rust HNSW compactor. Concurrent compactors write
to the same binary vector index files without coordination, silently
corrupting the HNSW segment — searches return empty results while the
SQLite layer remains intact.

CrewRig solves this by running a single shared `chroma run` daemon that
owns the `PersistentClient`. Every CLI session connects through
`scripts/lib/mempalace-http-wrapper.py`, which monkey-patches
`chromadb.PersistentClient` → `chromadb.HttpClient` before importing
MemPalace, reducing multi-writer contention to a single process.

See [`docs/runbooks/chroma-http-server.md`](docs/runbooks/chroma-http-server.md)
for start/stop/status commands, log locations, migration steps, and
troubleshooting. The architectural decision is recorded in
[ADR 0006](docs/adr/0006-chromadb-http-server.md).

## Adopting CrewRig

Organisations that wish to adopt CrewRig without contributing upstream should
follow the **[Adoption Guide](docs/adoption-guide.md)** — a step-by-step
walkthrough covering fork initialisation, overlay configuration, build
pipeline, CLI deployment, and upstream synchronisation. The guide covers all
three supported CLIs (Claude Code, Gemini CLI, GitHub Copilot CLI) and is the
primary onboarding surface for adopting organisations.

## Lifecycle Scenario

A complete journey, from installing the framework to closing the
harness loop:

1. **Install** — fork crewrig, then run
   `task setup-claude-interactive` (or `task setup-gemini-interactive`).
   Generate your profile with `/init-personal-profile` and your soul
   with `/init-soul`.
2. **Create** — add a `SKILL.md` to
   `artifacts/community/skills/my-skill/`, or run
   `task create-extension NAME=my-skill`. Run `task build-components`
   to generate outputs for both CLIs.
3. **Use on another project** — install the component:
   `task install-claude-component TYPE=claude-skills NAME=my-skill`.
   The skill is now available in Claude Code on that project.
4. **Record frictions** — as agents use the skill, they invoke the
   `harness-report` skill the moment a recognition signal fires. Each
   friction tag lands in the MemPalace `harness-friction` wing.
5. **Transform frictions into tickets** — run
   `task harness-curate -- --apply`. The curator clusters the
   frictions and opens one GitHub issue per cluster against the
   target repo.
6. **Implement** — address the issues via feature branches. The
   internal agent crew (architect → developer → tester → pr-logbook →
   pr-reviewer) handles the cycle.
7. **Install the new version** — run `task build-components` and
   reinstall; `metadata.provenance.version` bumps confirm which
   components changed.
8. **Back to step 3** — use the improved skill on your projects; the
   harness loop continues.

## Prerequisites

### Package Managers

| OS | Package Manager | Install |
|----|-----------------|---------|
| macOS | [Homebrew](https://brew.sh/) | `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"` |
| Windows | [Chocolatey](https://chocolatey.org/install) | See [install guide](https://chocolatey.org/install) |
| Windows | [Scoop](https://scoop.sh/) | `irm get.scoop.sh \| iex` |
| Linux | apt / dnf / pacman | Bundled with your distribution |

### Required Tools

| Tool | macOS | Linux (Debian/Ubuntu) | Windows |
|------|-------|----------------------|---------|
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | `npm i -g @google/gemini-cli` | same | same |
| [Claude Code](https://claude.ai/code) | `npm i -g @anthropic-ai/claude-code` | same | same |
| [Task](https://taskfile.dev/) | `brew install go-task` | `sh -c "$(curl -ssL https://taskfile.dev/install.sh)"` | `choco install go-task` or `scoop install task` |
| [fzf](https://github.com/junegunn/fzf) | `brew install fzf` | `sudo apt install fzf` | `choco install fzf` or `scoop install fzf` |
| [uv](https://github.com/astral-sh/uv) | `brew install uv` | `curl -LsSf https://astral.sh/uv/install.sh \| sh` | `powershell -c "irm https://astral.sh/uv/install.ps1 \| iex"` |
| [yq](https://github.com/mikefarah/yq) | `brew install yq` | `sudo snap install yq` | `choco install yq` |

> **Windows note:** setup scripts require a Bash-compatible shell
> ([Git Bash](https://gitforwindows.org/), [WSL](https://learn.microsoft.com/en-us/windows/wsl/install), or [MSYS2](https://www.msys2.org/)).

## Quick Start

### Gemini CLI

```bash
git clone git@github.com:crewrig/crewrig.git
cd crewrig

# Generate your personal profile
gemini "/init-personal-profile"

# Customize the agent identity
gemini "/init-soul"

# Run the interactive setup (deploys to ~/.gemini/)
task setup-gemini-interactive
```

### Claude Code

```bash
git clone git@github.com:crewrig/crewrig.git
cd crewrig

# Generate your personal profile
claude /init-personal-profile

# Customize the agent identity
claude /init-soul

# Run the interactive setup (deploys to ~/.claude/rules/)
task setup-claude-interactive
```

### What happens step by step

1. **`/init-personal-profile`** walks you through an interview to
   generate `config/PROFILE.md` with your identity, tooling preferences,
   projects, and working philosophy.
2. **`/init-soul`** lets you customize the agent's personality by
   refining the `config/SOUL.md` template section by section.
3. **`task setup-*-interactive`** copies shared configuration files to
   the target directory, then prompts you to select your **team**,
   **expertise**, and **experience level** via an interactive menu with
   live preview.

### Artifact Zone (optional)

The `artifacts/` directory is the single-source zone for lightweight,
prompt-based components. Single-source files generate outputs for all
supported CLIs:

**Gemini CLI:**

```bash
task install-workspace
task install-component TYPE=skills NAME=my-skill
```

**Claude Code:**

```bash
task install-claude-workspace
task install-claude-component TYPE=claude-skills NAME=my-skill
```

**Build from source:**

```bash
task build-components           # Both tools
task build-components-gemini    # Gemini only
task build-components-claude    # Claude Code only
task check-components           # Drift detection (CI)
```

### Extensions (optional)

Extensions are code-based capabilities (TypeScript MCP servers) packaged
as independent npm modules. From a single `extension.json` manifest,
install scripts generate both Gemini extensions and Claude Code plugins:

**Gemini CLI:**

```bash
task install-deps
task install-extensions
task install-extension EXT=hello-world
```

**Claude Code:**

```bash
task install-deps
task build-claude-plugin EXT=hello-world
task install-claude-plugin EXT=hello-world
```

See `extensions/hello-world/` for a complete example,
`extension-skeleton/EXTENSION-FORMAT.md` for the manifest specification,
and `extension-skeleton/` as a starting template.

## Repository Structure

```text
extensions/
└── hello-world/           # Example extension (MCP server + command + skill)

extension-skeleton/        # Template for new extensions
├── EXTENSION-FORMAT.md    # extension.json specification
├── agent/
├── base/
├── command/
├── hook/
├── mcp-server/
├── skill/
└── theme/

config/
├── gemini/
│   └── settings.json      # Gemini CLI settings and MCP servers
├── claude/
│   └── settings.json.template
├── level/                 # INTERN, JUNIOR, CONFIRMED, EXPERT
├── expertise/             # BACKEND-JAVA, FRONTEND-REACT, FULLSTACK-PYTHON,
│                          # DEVOPS-CLOUD, QA-AUTOMATION, PRODUCT-OWNER
├── teams/                 # ATLAS, NOVA, FORGE, SENTINEL, HORIZON
├── ORGANIZATION.md        # Company-wide policies
├── PROFILE.md.template    # Personal profile template
├── SOUL.md.template       # Agent identity template
├── TOOLS.md               # Memory architecture and MCP server guidelines
└── release-monorepo.json  # Monorepo release configuration

artifacts/
├── FORMAT.md              # Unified source format specification
├── core/                  # Upstream-owned SDLC lifecycle tools and role skills/agents
│   ├── skills/            # Reusable agent skills — SDLC + role skills
│   │   ├── spec-author/   # Lifecycle: qualification stage author
│   │   ├── pr-logbook/    # Lifecycle: PR and logbook composer
│   │   ├── pr-reviewer/   # Lifecycle: independent PR reviewer + linters
│   │   │   └── scripts/   # lint-shell.sh, lint-markdown.sh, lint-skill.sh, ...
│   │   └── # … 10 role skills (architect, astro, copywriting, developer, doc-writer,
│   │       # frontend, github-actions, security, tester, web-tester)
│   └── agents/            # Sub-agent definitions (lifecycle + role agents)
│       └── # … spec-author, pr-logbook, pr-reviewer, architect + 17 role agents
├── library/               # Upstream-owned harness machinery (user-home scope)
│   ├── skills/
│   │   ├── harness-report/    # Skill: tag frictions during real work
│   │   └── harness-curator/   # Skill: cluster frictions and open GitHub issues
│   │       └── scripts/       # schedule-curator.sh, curate.sh, test.sh, ...
│   └── agents/
│       └── harness-curator/   # Agent: curator specialist
├── community/             # Adopting organisation sandbox
│   ├── skills/            # Org-authored role skills (not yet validated)
│   ├── agents/            # Org-authored agents (not yet validated)
│   ├── commands/          # Org-specific slash commands
│   ├── hooks/             # Org-specific lifecycle hooks
│   ├── policies/          # Org-specific policy files
│   ├── mcp-servers/       # Org-specific MCP server configurations
│   └── themes/            # Org-specific UI themes
└── organisation/          # Adopting organisation validated components
    ├── skills/
    └── agents/

.gemini/                              # Build output — generated by scripts/build-components.sh
                                      # Do not edit manually
.claude/                              # Build output — generated by scripts/build-components.sh
                                      # Do not edit manually

hooks/                                # Shared hook scripts
├── mempalace-transcript.sh           # Session recording (opt-in)
├── gemini-transcript-hooks.json      # Gemini hook registration
└── claude-transcript-hooks.json      # Claude Code hook registration

docs/
└── scripting-conventions.md          # Shell scripting standards

tests/
└── e2e/                              # End-to-end test documentation

.github/workflows/                    # CI/CD pipelines
├── build.yml                         # Component build and drift check
├── claude.yml                        # Claude Code integration
├── pages.yml                         # GitHub Pages deployment
├── release-extension.yml             # Extension release automation
├── release-monorepo.yml              # Monorepo release automation
├── scripting-conventions.yml         # Shell scripting lint
└── security-mcp.yml                  # MCP security scan

scripts/
├── build-components.sh               # Community component builder (both CLIs)
├── build-claude-plugin.sh            # Claude Code plugin generator
├── check-skill-versions.sh           # CI gate: enforces version bump on modified sources
├── create-extension.sh               # Extension scaffolding
├── import-claude-history.sh          # Claude transcript import
├── import-gemini-history.sh          # Gemini transcript import
├── install-claude-plugin.sh          # Claude Code plugin installer
├── install-extension.sh              # Gemini extension installer
├── install-workspace.sh              # Bulk Gemini component install
├── link-extensions.sh                # Symlink extensions for local dev
├── manage-claude-component.sh        # Claude Code component manager
├── manage-workspace-component.sh     # Gemini component manager
├── monorepo-release.sh               # Monorepo release script
├── package-extension.sh              # Package a single extension
├── package-extensions.sh             # Package all extensions
├── prune-transcripts.sh              # Remove old transcript archives
├── setup-claude-interactive.sh       # Claude Code setup (interactive)
├── setup-gemini-interactive.sh       # Gemini CLI setup (interactive)
├── test-build-components.sh          # Self-test for build-components.sh
├── unlink-component.sh               # Remove a component symlink
├── unlink-extensions.sh              # Remove all extension symlinks
├── lib/
│   └── common.sh                     # Shared Bash helpers (sourced by scripts)
└── tests/
    ├── test-check-skill-versions.sh  # Tests for check-skill-versions.sh
    └── test-extract-frontmatter.sh   # Tests for frontmatter extraction

Taskfile.yml                          # Task runner configuration
AGENTS.md                             # Agent working rules
CLAUDE.md                             # Claude Code entry point (@AGENTS.md)
CONTRIBUTING.md                       # Contribution guide
DEVELOPMENT.md                        # Extension development guide
crewrig.config.toml                   # CrewRig framework configuration
package.json                          # Node.js workspace manifest
renovate.json                         # Renovate dependency-update configuration
```

## MCP Servers

### Gemini CLI (`config/gemini/settings.json`)

- **GitHub** — GitHub MCP server via OAuth.
- **MemPalace** — Unified agent memory (replaces KG Memory + Deep Memory).
- **Sequential Thinking** — Working memory for structured reasoning.

### Claude Code (`~/.claude.json`, managed by `claude mcp add`)

Claude Code reads MCP servers from `~/.claude.json`, not from any `mcp.json`
file. The `setup-claude-interactive.sh` script registers them via
`claude mcp add --scope user`. To inspect or manage them later:

```bash
claude mcp list                      # Show registered servers
claude mcp add --scope user <name> -- <command> [args...]
claude mcp remove <name>
```

- **Sequential Thinking** — Working memory; registered as user-scope.
- **MemPalace** — Persistent agent memory; registered as user-scope (the
  setup script auto-detects the right Python interpreter and verifies the
  installed version is within the supported range `>=3.3.3,<3.4`). Install
  or upgrade with `task install-mempalace` (or
  `pipx install --force 'mempalace>=3.3.3,<3.4'`).
- **GitHub** — Available via Claude Code's built-in connectors.

## Contributing

All contributions go through feature branches merged into `main` via Pull
Request. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the full guide,
[`DEVELOPMENT.md`](DEVELOPMENT.md) for the extension development lifecycle,
and [`AGENTS.md`](AGENTS.md) for commit conventions (Gitmoji), PR format,
and logbook issue requirements.
