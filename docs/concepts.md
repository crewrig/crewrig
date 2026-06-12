# Core concepts

<!-- crewrig-doc: section=concepts nav_order=10 published=true title="Core concepts" -->

This page introduces the five concepts that recur throughout CrewRig at a
conceptual level. Each links to the detailed documentation that specifies it
normatively; the goal here is shared vocabulary, not exhaustive coverage.

## The layered context system

An AI assistant's behavior is shaped by a stack of context files, each
addressing one concern and combined in a fixed priority order. CrewRig organizes
them with a numeric prefix from `00` to `60`:

| Priority | Source | Concern |
|----------|--------|---------|
| 00 | `config/SOUL.md` | Agent identity and values |
| 10 | `config/level/<LEVEL>.md` | Seniority-adapted guidance |
| 20 | `config/ORGANIZATION.md` | Company-wide policies |
| 30 | `config/PROFILE.md` | Personal information |
| 40 | `config/expertise/<ROLE>.md` | Technical specialization |
| 50 | `config/teams/<TEAM>.md` | Team practices and norms |
| 60 | `config/TOOLS.md` | Memory architecture and MCP servers |

The three supported tools consume the same source files but load them
differently: Gemini CLI uses numeric-prefix files in `~/.gemini/` with enforced
priority order, Claude Code combines them additively from `~/.claude/rules/`, and
GitHub Copilot CLI applies them as `*.instructions.md` files in
`~/.copilot/instructions/`. The build pipeline that reconciles these differences
is documented in the [CLI support matrix](cli-matrix.md).

## Core, overlay, and examples layering

Every path in the repository belongs to exactly one of three layers, which
governs who owns it and how an upstream synchronization treats it:

- **`core`** — owned by the upstream CrewRig project. Adopting organizations do
  not modify these paths; upstream updates land here cleanly.
- **`overlay`** — owned by the adopting organization. Upstream updates never
  touch these paths.
- **`examples`** — illustrative templates the upstream project ships. An
  organization may copy and adapt them, but is not expected to extend them in
  place.

This boundary contract is what lets an organization fork CrewRig, customize its
own surface, and still pull upstream improvements without merge conflicts. The
authoritative classification of every path — including the `adopt-on-edit`
policy for catalogs like `config/expertise/` and `config/teams/` — lives in the
[Layer taxonomy and boundary contract](layers.md).

## Multi-CLI parity

CrewRig implements each feature symmetrically across Gemini CLI, Claude Code, and
GitHub Copilot CLI. Silent asymmetry is prohibited: where a feature cannot be
mirrored on a given tool, the gap must be justified with concrete evidence that
the target tool lacks the mechanism, rather than left unexplained. The per-tool
integration points, parity checks, and gap-acceptance evidence are tracked in
the [CLI support matrix](cli-matrix.md).

## Shared cross-tool memory

CrewRig uses a three-tier memory model so that knowledge an agent builds up
persists and travels across tools:

| Tier | System | Role | Persistence |
|------|--------|------|-------------|
| 1 | Sequential Thinking | Working memory (ephemeral) | Session only |
| 2 | MemPalace | Agent memory (persistent) | Cross-session, cross-tool |
| 3 | Obsidian | User knowledge base | Read free, write user-controlled |

MemPalace is the tier that makes memory *shared*: it is read/write and visible
across Gemini CLI, Claude Code, and Copilot CLI, so a decision recorded during a
Claude Code session can be recovered later from Gemini CLI. The full memory
protocol — how agents activate memory at session start, the wing/room/drawer
structure, and the cross-tool task-handoff convention — is specified in the
framework's tool rules (the priority-60 core rules file).

## The harness feedback loop

The harness turns frictions agents hit during real work into tracked
improvements. When a recognition signal fires (for example, the user reverts the
agent's action, or a tool surprises the agent a second time), the agent invokes
the `harness-report` skill to tag the friction into a global memory wing. The
`harness-curator` skill later clusters those tags and opens one descriptive
GitHub issue per cluster, which is then fixed through the normal branch/PR
workflow. The loop is covered in depth on the
[Harness engineering](harness-engineering.md) page.
