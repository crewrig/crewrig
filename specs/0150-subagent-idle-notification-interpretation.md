---
id: "0150"
slug: subagent-idle-notification-interpretation
status: approved
complexity: small
interaction-mode: AUTO
related-issue: 730
version: 1.0.0
---

# Subagent Idle Notification Non-Completion Protocol

## Intent

Prevent orchestrators from prematurely abandoning or terminating working subagents by establishing that `idle_notification` events are asynchronous thread status indicators rather than completion signals for pending requests.

## Requirements

1. **Non-completion semantics.** `docs/agent-team-protocol.md` SHALL state under `## Team Communication` that `idle_notification` events indicate subagent process idleness at the time of event emission and SHALL NOT be treated as a completion signal for a pending `SendMessage` request.
2. **Orchestrator anti-abandonment rule.** An orchestrator SHALL NOT terminate, replace, or abandon a subagent upon receiving an `idle_notification` while a request is pending; completion SHALL be verified strictly through expected artifact updates or direct subagent responses.
3. **Reference updates.** `AGENTS.md` SHALL update its `## Agent Team Protocol` reference summary to include the `idle_notification` non-completion rule while maintaining file size under 22,000 bytes.

## Scenarios

### Scenario 1: Asynchronous idle notification received with request pending

- **GIVEN** an orchestrator that has sent a follow-up request to a subagent via `SendMessage`
- **WHEN** an asynchronous `idle_notification` event from a previous turn is delivered to the orchestrator inbox
- **THEN** the orchestrator does not terminate or abandon the subagent and continues waiting for the subagent's artifact output or explicit message.

### Scenario 2: Verification of completion via artifact

- **GIVEN** a subagent processing a review pass
- **WHEN** the subagent completes the review
- **THEN** the orchestrator verifies completion by inspecting the GitHub issue comment artifact rather than relying solely on transport notification messages.

## Out of scope

- Modifying host CLI engine event emission behavior or hook notification payloads.

## Open questions

- None.
