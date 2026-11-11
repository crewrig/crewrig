# Authoring skills, agents & commands

<!-- crewrig-doc: section=authoring nav_order=10 published=true title="Authoring skills, agents & commands" -->

Skills, agents, and commands are CrewRig's reusable agent capabilities. The
core idea is **author once, compile everywhere**: you write a single Markdown
source file with YAML frontmatter, and `scripts/build-components.ts` generates
the tool-specific outputs for Gemini CLI, Claude Code, GitHub Copilot CLI, and
Antigravity CLI.
This page is the conceptual overview; the normative format contract lives in
[`artifacts/FORMAT.md`](../artifacts/FORMAT.md).

This page's scope is the component pipeline — skills, agents, and commands —
and stops there. It does not cover CrewRig's separate extension model
(code-based capabilities declared in their own `extension.json`, such as MCP
servers, lifecycle hooks, and per-CLI packaging); see
[Extension authoring](extension-authoring.md) for that model's entry point.

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

## Declaring a model need

An agent source — and only an agent source — declares what its work needs from a model. It does so as a **capability profile** under `metadata.model:`, naming characteristics such as `intelligence`, never a concrete model, a vendor, or a CLI-namespaced key: the retired `metadata.claude.model` is no longer an available way to choose an agent's model.

On the upstream-owned tiers (`core`, `library`), a source's `metadata:` block admits exactly three keys, `provenance`, `model` and, on an `AGENT.md` only, `tools` (see *Declaring a tool allowlist* below). A source that carries no `metadata.model:` block keeps session-model inheritance and needs no edit.

On Claude Code the declared need reaches the compiled agent as a `model:` frontmatter key, and as that key alone: the description no longer ends with `Run this agent on the <model> model.` (spec 0291 R1, R2). That sentence remains on the Antigravity description, whose target has no frontmatter model surface, and returns on Claude Code under a `withheld` guard, which is how an organization on a bring-your-own-key provider keeps it ([`docs/org-model-mapping-override.md`](org-model-mapping-override.md)).

What a declared profile resolves to on each target, and how the build performs that resolution, is [`docs/model-mapping-format.md`](model-mapping-format.md)'s contract; how an adopting organization changes that outcome for its own fork is [`docs/org-model-mapping-override.md`](org-model-mapping-override.md)'s; what the migration of the core agents and of the compiled Claude Code layout asks of that organization is [`docs/agent-profile-migration.md`](agent-profile-migration.md)'s. The closed frontmatter shape itself is normative on [`artifacts/FORMAT.md`](../artifacts/FORMAT.md).

### Worked examples

Every emission below comes from `node scripts/build-components.ts --resolve <agent-source> <target>`, not composed by hand; run it after `node scripts/lib/node-floor-guard.js`, as a separate step, to re-derive one. The Claude Code rows follow the guard lift of spec 0291; the other rows are unchanged from `main` at `18b026d`.

`artifacts/core/agents/doc-writer/AGENT.md` declares:

```yaml
metadata:
  model:
    intelligence: medium
```

| Target | Emission |
|---|---|
| Claude Code | frontmatter `model: haiku`; the description carries no model sentence |
| Gemini CLI | frontmatter `model: gemini-3.5-flash` |
| GitHub Copilot CLI | *(nothing — `unsupported-on-cli`)* |
| Antigravity CLI | guidance `Run this agent on the gemini-3.8-flash-low model.` |

`artifacts/core/agents/developer/AGENT.md` declares `intelligence: high`:

| Target | Emission |
|---|---|
| Claude Code | frontmatter `model: sonnet`; the description carries no model sentence |
| Gemini CLI | frontmatter `model: gemini-3.1-pro-preview` |
| GitHub Copilot CLI | *(nothing — `unsupported-on-cli`)* |
| Antigravity CLI | guidance `Run this agent on the gemini-3.1-pro-low model.` |

`artifacts/core/agents/architect/AGENT.md` declares `intelligence: xhigh`:

| Target | Emission |
|---|---|
| Claude Code | frontmatter `model: opus`; the description carries no model sentence |
| Gemini CLI | frontmatter `model: gemini-3.1-pro-preview` |
| GitHub Copilot CLI | *(nothing — `unsupported-on-cli`)* |
| Antigravity CLI | guidance `Run this agent on the gemini-3.1-pro-low model.` |

`artifacts/library/agents/harness-curator/AGENT.md` carries no
`metadata.model:` block — the **profile-less** case: all four targets emit
nothing.

## Declaring a tool allowlist

An agent source MAY declare which classes of tool its work needs under `metadata.tools:`, a non-empty list drawn from `read`, `search`, `edit`, `execute`, `web` and `agent`, without duplicates (spec 0291):

```yaml
metadata:
  model:
    intelligence: high
  tools: [read, search, web]
```

Each CLI that has a tool allowlist receives the declaration in its own tool names, in the vocabulary's order: Claude Code `tools: Read, Grep, Glob, WebFetch, WebSearch`, Copilot CLI `tools: [read, search, web]`, Gemini CLI the native `read_file`, `grep_search`, `web_fetch` family. The mapping table, the Gemini omission of `agent` and the Antigravity gap are normative in [`artifacts/FORMAT.md`](../artifacts/FORMAT.md). A source that declares nothing behaves exactly as before. A declaration the build cannot map (not a list, empty, a name outside the vocabulary, a duplicate) stops the build, naming the file, the key, the value and the six classes.

A tool allowlist withholds every tool it does not name. On Claude Code that includes the MCP tools, unless listed, and `SendMessage`, `Skill`, `ToolSearch` and `TodoWrite` (<https://code.claude.com/docs/en/sub-agents>, read 2026-11-11; the page states that an allowlist excludes the MCP tools it does not list, and that `SendMessage`, `ToolSearch` and `TodoWrite` are withheld too is an inference from it). None of those can be expressed with the six classes, so an agent whose body requires one of them SHALL NOT declare `metadata.tools` until the vocabulary covers it. On the shared `.claude/agents/` surface, Copilot CLI treats `Bash`, `Read`, `Edit`, `Write`, `Grep`, `Glob`, `WebFetch`, `WebSearch` and `Task` as aliases of its own names; `Agent` is not an alias and is ignored there, so a declared `agent` class reaches Claude Code but not a Copilot reader of that directory, which fails toward fewer tools.

The rule: an allowlist is declared only for an agent whose classes exclude execute and edit. With `execute` the restriction protects nothing, since a shell can write files and mutate remote state, while the allowlist withholds every tool it does not name, MCP tools included. `scripts/check-component-metadata-keys.ts` enforces it on `core` and `library` sources and rejects `metadata.tools` on a skill or command source; the adopter tiers (`community`, `org`) are outside the check. An agent that receives an allowlist and carries a `harness-report` paragraph says in its body that it reports a friction in its final reply when its tool set withholds the MCP tool that records it, as `security` and `seo-specialist` do.

## The build

`scripts/build-components.ts` is the compiler. It is tier-agnostic: it discovers
every tier directory under `artifacts/` and compiles each one, routing the
output by tier. Core components are written into the committed project tree
(`.claude/`, `.gemini/`, `.github/`, `.agents/`); non-core tiers are written into a
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

The build is TypeScript and needs Node.js 24 or newer. `js-yaml` comes from
the setup dependency step, which installs the production dependencies
(`npm ci --omit=dev --workspaces=false`, hash-gated on `package-lock.json`).
Run the two commands below as separate steps, not chained with `&&`:

```bash
node scripts/lib/node-floor-guard.js
node scripts/build-components.ts
```

A checkout set up before the TypeScript build landed has no `js-yaml`
installed. Its per-component install (the `manage-*` scripts) prunes
`dist/<tier>/<cli-root>` first, then runs the build and fails with the
missing-dependency diagnostic naming `js-yaml` until setup is re-run.
Nothing is lost: the next successful run rebuilds `dist/<tier>/<cli-root>`.

## Provenance and versioning

Each component carries a `metadata.provenance` block recording its canonical
repository, its feedback target, and its version. The `version` field follows
Semantic Versioning, and any change to a shipped source must bump it in the same
diff — a CI gate (`scripts/check-skill-versions.ts`) enforces this. The
provenance block is what lets feedback flow back to the right repository after a
fork and what lets the harness loop pin the contract observed when a friction
was reported. The feedback target is resolved **per tier**: components in
upstream-owned tiers (`core`, `library`) always route feedback to their
`canonical` repository, while adopter-owned tiers (`community`, `org`) route to
the fork's configured `feedback_repo`. The forking workflow, placeholder
resolution, and version semantics are detailed in
[`artifacts/FORMAT.md`](../artifacts/FORMAT.md).

## Where to read next

- The normative format contract: [`artifacts/FORMAT.md`](../artifacts/FORMAT.md).
- How tiers are owned and synced: [Layer taxonomy and boundary contract](layers.md).
- The harness components you may author against:
  [Harness engineering](harness-engineering.md).
