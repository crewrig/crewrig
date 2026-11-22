# CrewRig

CrewRig gives an organization one place to define how its AI coding
assistants behave, and ships that definition to every colleague on
[Gemini CLI](https://github.com/google-gemini/gemini-cli),
[Claude Code](https://claude.ai/code),
[GitHub Copilot CLI](https://docs.github.com/copilot/github-copilot-in-the-cli), and
[Antigravity CLI](https://antigravity.google).
You write the company context, skills, agents and hooks once; CrewRig
compiles them for all four CLIs, so no team ends up with a private, drifting
setup.

## What CrewRig brings to a company

- **One source, four CLIs.** Skills, agents, commands and hooks are authored
  once and built for every supported CLI. No silent asymmetry between tools.
- **Layered context.** Company policies, team practices, expertise and
  seniority are assembled into each assistant's context, on top of a personal
  profile and an agent identity.
- **Shared memory.** A three-tier memory model (working memory, persistent
  agent memory, personal notes) that survives across sessions and across CLIs.
- **A feedback loop.** Agents tag the frictions they hit during real work, and
  those tags become issues on your tracker, so the setup improves with use.
- **Safe by default.** Context files are copied, never symlinked, so a hostile
  branch cannot poison an assistant's instructions.

## The four jobs

| Job | Where to start |
|-----|----------------|
| **Configure memory** — give assistants persistent, shared memory | [Memory](#memory), then the [MemPalace runbook](docs/runbooks/mempalace-mcp-server.md) |
| **Author a skill, agent or hook** — write it once for every CLI | [Authoring skills, agents & commands](docs/authoring.md), [Extension authoring](docs/extension-authoring.md), and the format contract in [`artifacts/FORMAT.md`](artifacts/FORMAT.md) |
| **Share it with colleagues** — one build, deployed to each person's CLI | [Adoption Guide](docs/adoption-guide.md) (overlay, `artifacts/community/` and `artifacts/org/` tiers, build, deploy, upstream sync) <!-- WP4 (#2114): fork-model link; swap this row together with the adopter-quick-start block --> |
| **Report frictions** — turn assistant pain points into issues | [Reporting frictions](#reporting-frictions) |

## Adopter quick start

<!-- adopter-quick-start:begin -->

CrewRig is adopted as a fork that holds your organization's overlay.
**Run first: follow the [Adoption Guide](docs/adoption-guide.md), Steps 1 to 6.**
In short:

```bash
# 1. Fork crewrig into your organization's repository, then clone your fork
git clone <your-fork-url> && cd <your-fork>

# 2. Copy the configuration template. Keep canonical_repo on the upstream URL;
#    point feedback_repo at your own repository.
cp crewrig.config.toml.template crewrig.config.toml

# 3. Deploy to your CLI (claude, gemini, copilot or antigravity)
task setup-claude-interactive
```

The Adoption Guide covers the organization identity files, the build
pipeline, every CLI's deployment, and how to stay in sync with upstream.
Prerequisites are listed in [Prerequisites](#prerequisites).

<!-- adopter-quick-start:end -->

## Supported Platforms

| Platform | Config Target | Setup Command |
|----------|---------------|---------------|
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | `~/.gemini/` | `task setup-gemini-interactive` |
| [Claude Code](https://claude.ai/code) | `~/.claude/rules/` | `task setup-claude-interactive` |
| [GitHub Copilot CLI](https://docs.github.com/copilot/github-copilot-in-the-cli) | Split: `.github/copilot/` + `.github/skills/` + `.github/agents/` (workspace-level) | `task setup-copilot-interactive` |
| [Antigravity CLI](https://antigravity.google) | `~/.gemini/config/` | `task setup-antigravity-interactive` |

All platforms share the same source configuration files in `config/` and
`artifacts/`. Setup and build scripts deploy them into the
platform-specific directories. See `docs/cli-matrix.md` for the full
per-CLI integration matrix.

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
| [GitHub Copilot CLI](https://docs.github.com/copilot/github-copilot-in-the-cli) | `npm i -g @github/copilot` | same | same |
| [Antigravity CLI](https://antigravity.google) | See [Antigravity install](https://antigravity.google) (`agy`) | same | same |
| [Task](https://taskfile.dev/) (3.54 or later, see note below) | `brew install go-task` | `sh -c "$(curl -ssL https://taskfile.dev/install.sh)"` | `choco install go-task` or `scoop install task` |
| [fzf](https://github.com/junegunn/fzf) | `brew install fzf` | `sudo apt install fzf` | `choco install fzf` or `scoop install fzf` |
| [uv](https://github.com/astral-sh/uv) | `brew install uv` | `curl -LsSf https://astral.sh/uv/install.sh \| sh` | `powershell -c "irm https://astral.sh/uv/install.ps1 \| iex"` |
| [yq](https://github.com/mikefarah/yq) | `brew install yq` | `sudo snap install yq` | `choco install yq` |

> **Node.js note:** the four setups are TypeScript entries
> (`scripts/setup-<cli>-interactive.ts`) and need
> [Node.js 24 or later](https://nodejs.org/en/download). The `task
> setup-<cli>-interactive` entries run the Node.js floor guard
> (`scripts/lib/node-floor-guard.js`) before the entry and stop with a
> diagnostic below 24. Run by hand, use two separate steps: `node
> scripts/lib/node-floor-guard.js`, then `node
> scripts/setup-<cli>-interactive.ts`. The setups need neither `fzf` nor `jq`
> and run on Windows without a Bash-compatible shell. The scripts that remain
> shell scripts still need one
> ([Git Bash](https://gitforwindows.org/), [WSL](https://learn.microsoft.com/en-us/windows/wsl/install), or [MSYS2](https://www.msys2.org/)).
>
> **Task note:** Task 3.54 or later is required. The tasks live in domain
> files under `taskfiles/` that the root `Taskfile.yml` includes with the
> `flatten:` option, so CI and local runs share one Task version. Every Taskfile declares
> `version: '3.54'`, so an older Task fails loudly instead of silently renaming
> tasks.

## Personal setup per CLI

Once your fork is cloned, each person generates a personal profile and agent
identity, then deploys the shared configuration to their CLI.

### Gemini CLI

```bash
# Generate your personal profile
gemini "/init-personal-profile"

# Customize the agent identity
gemini "/init-soul"

# Run the interactive setup (deploys to ~/.gemini/)
task setup-gemini-interactive
```

### Claude Code

```bash
# Generate your personal profile
claude /init-personal-profile

# Customize the agent identity
claude /init-soul

# Run the interactive setup (deploys to ~/.claude/rules/)
task setup-claude-interactive
```

### Copilot CLI

```bash
# Generate your personal profile
copilot -i "/init-personal-profile"

# Customize the agent identity
copilot -i "/init-soul"

# Run the interactive setup (deploys to ~/.copilot/)
task setup-copilot-interactive
```

### Antigravity CLI

```bash
# --new-project anchors the session to this clone — without it, on a machine
# with other Antigravity projects, agy resolves against whichever project was
# last active instead of the current directory.

# Generate your personal profile
agy -i "/init-personal-profile" --new-project

# Customize the agent identity
agy -i "/init-soul" --new-project

# Run the interactive setup (deploys to ~/.gemini/config/)
task setup-antigravity-interactive
```

### What happens step by step

1. **`/init-personal-profile`** walks you through an interview to
   generate `config/PROFILE.md` with your identity, tooling preferences,
   projects, and working philosophy.
2. **`/init-soul`** lets you customize the agent's personality by
   refining the `config/SOUL.md` template section by section.
3. **`task setup-*-interactive`** copies shared configuration files to
   the target directory, then prompts you to select your **team**,
   **expertise**, and **experience level** through numbered questions
   (`?N` previews entry N).

## How it works

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
| 60 | `artifacts/core/rules/60-memory.md` | Memory architecture and orchestrator memory protocol (excluded from Claude Code workers) |
| 60 | `artifacts/core/rules/60-tools.md` | Core tool rules and the memory obligations that bind every agent |
| 65 | `config/TOOLS.md` | Organization-specific tool guidelines |

**Gemini CLI** loads these via numeric-prefix files in `~/.gemini/` with
enforced priority order. **Claude Code** loads them from `~/.claude/rules/`
as additive context (all files combine, no override). **GitHub Copilot CLI**
loads them from `~/.copilot/instructions/` as `*.instructions.md` files,
applied to all sessions. **Antigravity CLI** loads them from
`~/.gemini/config/AGENTS.md`.

### Security: Copy by Default

Context files are **copied** (not symlinked) to the target directory by
default. This prevents context poisoning from malicious branches. Symlink
mode is available for development only (with a security disclaimer).

### Authoring: skills, agents, hooks

`artifacts/` is the single-source zone where skills, agents, and commands
are written **once** and compiled into outputs for all CLIs. Your
organization's own components live in `artifacts/community/` (sandbox) and
`artifacts/org/` (validated).
An agent source declares what its work needs from a model as a **capability
profile** ([spec 0195](specs/0195-agent-capability-profile.md)) rather than
naming one — see [`docs/model-mapping-format.md`](docs/model-mapping-format.md)
for what each CLI resolves it to.

| Type | Description |
|---|---|
| Skill | Reusable agent behavior activated via `/skill-name` |
| Command | Slash command with a prompt body |
| Agent | Sub-agent with a dedicated persona |
| Hook | Lifecycle hook (BeforeTool/AfterTool/etc.) |
| Policy | Security or behavioral constraint |
| MCP Server | External tool integration |
| Theme | UI theme fragment |

Build and install components:

```bash
task build-components           # Both tools
task build-components-gemini    # Gemini only
task build-components-claude    # Claude Code only
task check-components           # Drift detection

# Install a component on a project
task install-component TYPE=skills NAME=my-skill                    # Gemini CLI
task install-claude-component TYPE=claude-skills NAME=my-skill      # Claude Code
task install-workspace                                              # Gemini: all components
task install-claude-workspace                                       # Claude Code: all components
```

See [`artifacts/FORMAT.md`](artifacts/FORMAT.md) for the full unified-source
specification.

### Extensions (optional)

Extensions are code-based capabilities (TypeScript MCP servers) packaged
as independent npm modules. From a single `extension.json` manifest, the
shared render produces the tool-native form for all four supported
command-line tools (Gemini CLI, Claude Code, GitHub Copilot CLI,
Antigravity CLI):

**All CLIs (umbrella installer):**

```bash
task install-deps
task install-extension-all EXT=hello-world
```

**Gemini CLI:**

```bash
task install-deps
task install-gemini-extensions
task install-gemini-extension EXT=hello-world
```

**Claude Code:**

```bash
task install-deps
task build-claude-plugin EXT=hello-world
task install-claude-plugin EXT=hello-world
```

See [Extension authoring](docs/extension-authoring.md) for the authoring
model, `extensions/core/hello-world/` for a complete example,
`extension-skeleton/EXTENSION-FORMAT.md` for the manifest specification,
and `extension-skeleton/` as a starting template.

### Memory

The framework implements a three-tier memory model:

| Tier | System | Role | Access |
|------|--------|------|--------|
| 1 | Sequential Thinking | Working memory (ephemeral) | Session only |
| 2 | MemPalace | Agent memory (persistent) | Read/write, cross-tool |
| 3 | Obsidian | User knowledge (Second Brain) | Read free, write user-controlled |

See `config/TOOLS.md` for the full memory protocol.

When several CLI sessions or parallel agents use MemPalace at once, two
layers each need a single owner: a shared ChromaDB daemon (one vector-index
compactor) and a shared MemPalace MCP daemon (one writer lease). Every setup
run installs and registers both by default; `task mempalace:switch-http`
converges machines set up earlier. Details, topology diagram and
troubleshooting: [MemPalace MCP runbook](docs/runbooks/mempalace-mcp-server.md),
[ChromaDB runbook](docs/runbooks/chroma-http-server.md), and
[Multi-agent concurrency](DEVELOPMENT.md#multi-agent-concurrency-chromadb-and-mcp-daemons).

### Reporting frictions

When an assistant hits a sharp edge during real work (a misleading prompt, a
tool that does the wrong thing), it tags the friction with the
`harness-report` skill. Tags accumulate in the MemPalace `harness-friction`
wing, and `task harness-curate -- --apply` clusters them into one GitHub
issue per cluster.

Where those issues land is set in `crewrig.config.toml`:

- `canonical_repo` — the upstream CrewRig repository. Keep the upstream URL
  (`https://github.com/crewrig/crewrig`): frictions on upstream-owned
  components always route there.
- `feedback_repo` — your organization's repository, for frictions on the
  components your organization authored.

## MCP Servers

### Gemini CLI (`config/gemini/settings.json`)

- **MemPalace** — Unified agent memory (replaces KG Memory + Deep Memory).
- **Sequential Thinking** — Working memory for structured reasoning.

### Claude Code (`~/.claude.json`, managed by `claude mcp add`)

Claude Code reads MCP servers from `~/.claude.json`, not from any `mcp.json`
file. The `setup-claude-interactive.ts` entry registers them via
`claude mcp add --scope user`. To inspect or manage them later:

```bash
claude mcp list                      # Show registered servers
claude mcp add --scope user <name> -- <command> [args...]
claude mcp remove <name>
```

- **Sequential Thinking** — Working memory; registered as user-scope.
- **MemPalace** — Persistent agent memory; registered as user-scope (the
  setup script auto-detects the right Python interpreter and verifies the
  installed version is within the supported range `>=3.6.0,<3.7`). Install
  or upgrade with `task install-mempalace` (or
  `pipx install --force 'mempalace>=3.6.0,<3.7'`). Session recording, an
  opt-in of each setup script, wires `hooks/mempalace-transcript.ts` by its
  absolute path in the checkout that ran setup (no copy under the CLI's
  home, no `jq` or `curl`). It needs **Node.js 24 or later when the hook
  fires**, and re-running setup from the checkout repairs a moved one
  ([`docs/cli-matrix.md`](docs/cli-matrix.md) row 8b).
- **GitHub** — Available via Claude Code's built-in connectors.

## Contributing to CrewRig

Changing the framework itself (not just your organization's overlay) goes
through feature branches and Pull Requests. Start with
[`CONTRIBUTING.md`](CONTRIBUTING.md); it links the lifecycle, the internal
agent crew, the harness engineering loop and the repository structure
([`DEVELOPMENT.md`](DEVELOPMENT.md#repository-structure)). Commit
conventions, PR format and logbook rules are in [`AGENTS.md`](AGENTS.md).
