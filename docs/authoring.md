# Authoring skills, agents & commands

<!-- crewrig-doc: section=authoring nav_order=10 published=true title="Authoring skills, agents & commands" -->

Skills, agents, and commands are CrewRig's reusable agent capabilities. The
core idea is **author once, compile everywhere**: you write a single Markdown
source file with YAML frontmatter, and `scripts/build-components.sh` generates
the tool-specific outputs for Gemini CLI, Claude Code, and GitHub Copilot CLI.
This page is the conceptual overview; the normative format contract lives in
[`artifacts/FORMAT.md`](../artifacts/FORMAT.md).

## The single-source zone

All authored components live under `artifacts/`, organized into tiers that
declare ownership and deployment scope:

| Tier | Owner | Purpose |
|------|-------|---------|
| `core/` | Upstream CrewRig | SDLC lifecycle tools and illustrative role skills/agents. Deployed to project scope. |
| `library/` | Upstream CrewRig | Harness machinery (`harness-report`, `harness-curator`). Deployed to user-home scope. |
| `community/` | Adopting organization | Sandbox for the organization's own skills, agents, commands, hooks, policies, and themes — not yet validated. |
| `org/` | Adopting organization | Components promoted from `community/` after internal review. |

The layer ownership and synchronization rules for these tiers are part of the
[Layer taxonomy and boundary contract](layers.md).

## Component types

Three component types share the single-source pipeline:

| Type | Source location | What it is |
|------|-----------------|------------|
| Skill | `<tier>/skills/<name>/SKILL.md` | Reusable agent behavior, activatable via `/skill-name`. |
| Agent | `<tier>/agents/<name>/AGENT.md` | A sub-agent with a dedicated persona and system prompt. |
| Command | `<tier>/commands/<name>.md` | A slash command with a prompt body. |

A skill may ship optional resource subfolders alongside its `SKILL.md` —
`scripts/`, `references/`, and `assets/` — which are propagated verbatim to the
build outputs. The complete list of supported types, the frontmatter field
reference, and the validation rules are in
[`artifacts/FORMAT.md`](../artifacts/FORMAT.md).

## The source file

Every source is Markdown with YAML frontmatter. Three universal fields are
required — `name`, `description`, and `type` — and the body after the
frontmatter is the prompt content shared across all tools. Tool-specific
overrides are optional and only needed when a tool requires metadata beyond the
universal fields (for example, Claude Code's `allowed-tools`). The body is never
duplicated: it is written once and wrapped into each tool's format at build
time.

```markdown
---
name: my-skill
description: "Brief description used for discovery and activation"
type: skill
---

# My Skill

Prompt content here — shared across all tools, written once.
```

## The build

`scripts/build-components.sh` is the compiler. It is tier-agnostic: it discovers
every tier directory under `artifacts/` and compiles each one, routing the
output by tier. Core components are written into the committed project tree
(`.claude/`, `.gemini/`, `.github/`); non-core tiers are written into a
gitignored staging tree from which the setup scripts install to the user home.

```bash
task build-components           # All tools
task build-components-gemini    # Gemini CLI only
task build-components-claude    # Claude Code only
task check-components           # Drift detection (used in CI)
```

A drift check (`--check`) verifies that the committed outputs match what the
sources would generate, so a build output cannot silently fall out of sync with
its source. The full invocation reference is in
[`artifacts/FORMAT.md`](../artifacts/FORMAT.md).

## Provenance and versioning

Each component carries a `metadata.provenance` block recording its canonical
repository, its feedback target, and its version. The `version` field follows
Semantic Versioning, and any change to a shipped source must bump it in the same
diff — a CI gate (`scripts/check-skill-versions.sh`) enforces this. The
provenance block is what lets feedback flow back to the right repository after a
fork and what lets the harness loop pin the contract observed when a friction
was reported. The forking workflow, placeholder resolution, and version
semantics are detailed in [`artifacts/FORMAT.md`](../artifacts/FORMAT.md).

## Where to read next

- The normative format contract: [`artifacts/FORMAT.md`](../artifacts/FORMAT.md).
- How tiers are owned and synced: [Layer taxonomy and boundary contract](layers.md).
- The harness components you may author against:
  [Harness engineering](harness-engineering.md).
