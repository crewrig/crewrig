---
id: "0144"
slug: permission-laundering-prevention
status: approved
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 891
version: 1.0.0
---

# Permission laundering prevention

## Intent

When a subagent reports a tool or command permission denial, the orchestrator/parent agent must not re-execute the denied action in the parent session on its own authority. Doing so launders a user-authored rejection and bypasses human review. This specification mandates that subagent permission denials be treated as user-authored decisions that must be surfaced to the user for explicit confirmation or guidance.

## Requirements

1. `docs/agent-team-protocol.md` under `## Team Communication` SHALL mandate that any tool or action permission denial reported by a subagent MUST be treated as potentially user-authored.
2. The orchestrator/parent agent SHALL NOT re-execute a subagent's denied action in the parent session on its own classification.
3. When a subagent reports a permission denial, the orchestrator SHALL surface the denied action and context directly to the user and wait for human decision before taking any further action.
4. `AGENTS.md` under `## Agent Team Protocol` SHALL include a explicit critical rule prohibiting permission laundering via orchestrator takeover.
5. The anti-permission-laundering requirement SHALL apply uniformly across all subagent types, tool calls, and shell execution surfaces.

## Scenarios

**Scenario:** Subagent permission denial is surfaced to the user

Given a subagent executing a delegated task encounters a permission denial on a tool call or command
When the subagent reports the denial back to the orchestrator
Then the orchestrator surfaces the denied action to the user
And the orchestrator waits for user approval or guidance before proceeding.

**Scenario:** Orchestrator takeover on subagent denial is prohibited

Given a subagent reports a permission rejection for a file write or command execution
When the orchestrator processes the subagent message
Then the orchestrator does NOT re-run the write or command in the parent session automatically.

## Out of scope

- Single-agent sessions without subagents (where the user directly approves or denies prompts in the primary session).
- Automatic retry logic within the same subagent session for transient execution errors (non-permission failures).

## Open questions

(None.)
