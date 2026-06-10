# Contributing to AI Agent Configuration

This guide explains how to add new configurations, skills, and components
to the repository. The framework supports **Gemini CLI**, **Claude Code**,
and **GitHub Copilot CLI** as target platforms.

## Philosophy: The Artifacts Zone

The `artifacts/` directory is the **single-source zone** for all skills,
agents, and commands:

- `artifacts/core/` — upstream-owned SDLC lifecycle tools and role skills.
- `artifacts/library/` — upstream-owned harness machinery (harness-report, harness-curator).
- `artifacts/community/` — adopting organisation sandbox (commands, hooks, MCP servers, policies, themes, org-specific skills and agents).
- `artifacts/org/` — adopting organisation validated components.

Write each component **once** in the unified source format — the build
system generates outputs for Gemini CLI, Claude Code, and GitHub Copilot CLI.
Once a capability requires executable code, migrate it to a full `extension/`
with an `extension.json` manifest.

## Single-Source vs Project-Specific

| Directory | Scope | Duplication? |
|-----------|-------|:------------:|
| `artifacts/` | Reusable, shared across tools | **No** — single source, build generates targets |
| `.gemini/commands/` | Gemini CLI project commands | **Yes** — native to Gemini |
| `.claude/skills/` | Claude Code project skills | **Yes** — native to Claude Code |
| `.github/skills/` | GitHub Copilot CLI project skills (Agent Skills standard) | **Yes** — native to Copilot CLI |

Artifact components use the unified format documented in
[`artifacts/FORMAT.md`](artifacts/FORMAT.md).

## Development Workflow

### Copy Mode (default — recommended)

Copy mode creates isolated snapshots that are immune to branch changes:

**Gemini CLI:**

```bash
task install-component TYPE=skills NAME=my-new-skill
task install-workspace
```

**Claude Code:**

```bash
task install-claude-component TYPE=claude-skills NAME=my-new-skill
task install-claude-workspace
```

### Link Mode (development only — security warning)

Link mode creates symbolic links for immediate feedback during
development. **Use only if you trust all branches in this repository.**

**Gemini CLI:**

```bash
task link-component TYPE=skills NAME=my-new-skill
task link-workspace
```

**Claude Code:**

```bash
task link-claude-component TYPE=claude-skills NAME=my-new-skill
task link-claude-workspace
```

### Removing a component

```bash
task unlink-component TYPE=skills NAME=my-new-skill
```

## Community Component Format

Artifact components use a **unified source format** (Markdown with YAML
frontmatter). See [`artifacts/FORMAT.md`](artifacts/FORMAT.md)
for the complete specification.

```markdown
---
name: my-skill
description: "Brief description used for activation"
type: skill
claude:
  allowed-tools:
    - Read
    - Bash
  user-invocable: true
---

# Skill Title

Prompt content — shared across ALL tools, written once.
```

Build outputs for each tool:

```bash
task build-components           # Both tools
task check-components           # Drift detection (CI)
```

### Component Types

| Type | Source | Gemini Output | Claude Code Output |
|------|--------|---------------|--------------------|
| Skill | `skills/<name>/SKILL.md` | `.gemini/skills/<name>/SKILL.md` | `.claude/skills/<name>/SKILL.md` |
| Command | `commands/<name>.md` | `.gemini/commands/<name>.toml` | `.claude/skills/<name>/SKILL.md` |
| Agent | `agents/<name>/AGENT.md` | `agents/<name>/PROMPT.md` | `.claude/agents/<name>/AGENT.md` |
| Hook | `hooks/` | hooks.json | settings.json merge |
| Policy | `policies/` | YAML rule file | settings.json permissions |
| MCP server | `mcp-servers/` | settings.json merge | `claude mcp add --scope user` |
| Theme | `themes/` | settings.json merge | *(not supported)* |

## Creating Extensions

When a capability requires executable code (TypeScript MCP server, custom
build steps), create a full extension with an `extension.json` manifest.

A single `extension.json` generates both a Gemini extension and a Claude
Code plugin. See
[`extension-skeleton/EXTENSION-FORMAT.md`](extension-skeleton/EXTENSION-FORMAT.md)
for the complete manifest specification.

Quick steps:

1. Copy `extension-skeleton/base/` into `extensions/<your-name>/`.
2. Add optional component directories from the skeleton.
3. Replace every `SKELETON_NAME` with your extension name.
4. Implement your MCP server in `src/index.ts`.
5. Test locally:
   - **Gemini**: `task link-extensions` then start a Gemini session.
   - **Claude Code**: `task build-claude-plugin EXT=<name>` then
     `claude --plugin-dir extensions/<name>/dist-claude-plugin/<name>`.

Each extension is an independent npm package with its own versioning. See
`extensions/hello-world/` for a complete working reference.

> **Warning:** never install the `extension-skeleton/` directory itself.
> It is a template container, not a functional extension.

## Harness Engineering Contribution Path

Frictions are a first-class contribution mechanism. Any agent or
developer who encounters a problem with a skill, agent, or process can
tag it immediately:

1. During real work, invoke the `harness-report` skill (or
   `/harness-report`) the moment a recognition signal fires.
2. Frictions accumulate in the MemPalace `harness-friction` wing — no
   manual ticket required at tag time.
3. Run `task harness-curate -- --apply` to cluster frictions and open
   GitHub issues automatically.
4. Address the issues via the standard PR workflow like any other
   change.

This path ensures that systemic improvements surface without requiring
the person who hits the friction to also write the fix. Tag it; the
loop handles the rest.

## Internal Agent Crew

CrewRig is developed using its own agent crew. Each PR goes through a
chain of specialized agents:

| Agent | Role |
|---|---|
| `architect` | Design reviews, ADRs, blast-radius analysis before implementation |
| `developer` | Implements the smallest correct change |
| `tester` | Authors high-signal regression tests |
| `pr-logbook` | Drafts the PR title, body, and logbook issue |
| `pr-reviewer` | Cold-start independent review before merge |

The crew runs on the skills and agents shipped with crewrig itself. To
invoke the full chain on an issue:

```python
Agent(subagent_type="architect", prompt="Design the implementation for issue #N in crewrig/crewrig. Read the issue first.")
# then developer, tester, pr-logbook, pr-reviewer in sequence
```

## Standards

1. **Language**: all technical artifacts (code, commits, PRs) in **English**.
2. **Commits**: follow the [Gitmoji](https://gitmoji.dev/) convention.
3. **PRs**: follow the format described in `AGENTS.md` (summary, reading
   guide, test plan, detailed description, linked logbook issue).
4. **Secrets**: never commit credentials. Use `~/.gemini/.env` or shell
   environment variables for local tokens.
5. **Artifact components**: use the unified source format — one file,
   build generates both tool outputs. See `artifacts/FORMAT.md`.
6. **Extensions**: use `extension.json` manifest for new extensions.
   See `extension-skeleton/EXTENSION-FORMAT.md`.
7. **Shell + Python glue**: follow the rules in
   [`docs/scripting-conventions.md`](docs/scripting-conventions.md). They
   exist because each one has already shipped a real bug.
