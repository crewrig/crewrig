<!-- Extracted from AGENTS.md. Cross-references to other sections refer to AGENTS.md. -->

# Agent Team Protocol

<!-- crewrig-doc: published=false -->

Project tickets are multi-step work. They must be treated by a **team of specialist agents**, not by a single agent working solo inline.

The team protocol below governs the **DEV stage** of the lifecycle
defined in [ADR-0010](adr/0010-spec-plan-review-lifecycle.md).
SPECS and PLAN run before DEV (with their own artifacts: a spec file
under `/specs/` and a plan comment on the logbook issue); REVIEW runs
after, and its findings may re-enter DEV (`tech`), PLAN (`arch`), or
SPECS (`spec`) per the routing matrix in
[`docs/retroactive-loop.md`](retroactive-loop.md) → *Routing matrix*.
Templates 1 / 2 / 3 in this section describe how the DEV stage
is staffed for a `standard`-tier ticket; trivial / small / large
tiers adjust the composition per ADR-0010 → *Complexity tiers and
team sizing*.

## Which file to cite

A spawn brief cites the one role file (and anchor) its role needs, not the whole protocol.

| Role | Cite |
|---|---|
| `developer` | [worktree-isolation](agent-team-protocol/worktree-isolation.md#worktree-isolation); add [built-components](agent-team-protocol/built-components.md#built-components) when the ticket edits `artifacts/` |
| `tester` | [solo-work-prohibition](agent-team-protocol/orchestrator.md#solo-work-prohibition) |
| `doc-writer` | [solo-work-prohibition](agent-team-protocol/orchestrator.md#solo-work-prohibition) |
| `architect` | [seated-review-passes](agent-team-protocol/templates.md#seated-review-passes) |
| `pr-logbook` | [shared-template-rules](agent-team-protocol/templates.md#shared-template-rules) |
| `pr-reviewer` | [seated-review-passes](agent-team-protocol/templates.md#seated-review-passes) |
| `security` | [worktree-isolation](agent-team-protocol/worktree-isolation.md#worktree-isolation) |

## When this applies

Moved to [orchestrator](agent-team-protocol/orchestrator.md#when-this-applies).

## On Claude Code CLI (single implicit session team)

Moved to [orchestrator](agent-team-protocol/orchestrator.md#claude-code-implicit-team).

## On CLIs with no multi-agent coordination surface (e.g. Gemini CLI)

Moved to [orchestrator](agent-team-protocol/orchestrator.md#no-coordination-surface).

## Solo work prohibition

Moved to [orchestrator](agent-team-protocol/orchestrator.md#solo-work-prohibition).

## Worktree Isolation

Moved to [worktree-isolation](agent-team-protocol/worktree-isolation.md#worktree-isolation).

### Session-boundary worktree hygiene

Moved to [worktree-isolation](agent-team-protocol/worktree-isolation.md#session-boundary-worktree-hygiene).

## Built Components

Moved to [built-components](agent-team-protocol/built-components.md#built-components).

## Standard Team Templates

Moved to [templates](agent-team-protocol/templates.md#standard-team-templates).

### Seated review passes

Moved to [templates](agent-team-protocol/templates.md#seated-review-passes).

### Step 0 — `spec-author` (every non-trivial template)

Moved to [templates](agent-team-protocol/templates.md#step-0-spec-author).

### Template 1 — Feature implementation (results in a PR)

Moved to [templates](agent-team-protocol/templates.md#template-1).

### Template 2 — Documentation-only change

Moved to [templates](agent-team-protocol/templates.md#template-2).

### Template 3 — Bug fix

Moved to [templates](agent-team-protocol/templates.md#template-3).

## Team sizing by complexity

Moved to [templates](agent-team-protocol/templates.md#team-sizing-by-complexity).

## Team Communication

Moved to [team-communication](agent-team-protocol/team-communication.md#team-communication).

- [Rule 1 — Report before idle](agent-team-protocol/team-communication.md#rule-1)
- [Rule 2 — Idle fallback](agent-team-protocol/team-communication.md#rule-2)
- [Rule 3 — Idle notifications can race result messages](agent-team-protocol/team-communication.md#rule-3)
- [Rule 4 — Review findings are not auto-deferrals](agent-team-protocol/team-communication.md#rule-4)
- [Rule 5 — Edit fence for delegated deliverables](agent-team-protocol/team-communication.md#rule-5)
- [Rule 6 — Single writer per forge artifact](agent-team-protocol/team-communication.md#rule-6)
- [Rule 7 — Anti-permission-laundering via orchestrator takeover](agent-team-protocol/team-communication.md#rule-7)

## Team Shutdown

Moved to [orchestrator](agent-team-protocol/orchestrator.md#team-shutdown).

### On a harness that genuinely exposes team primitives

Moved to [orchestrator](agent-team-protocol/orchestrator.md#harness-team-primitives).
