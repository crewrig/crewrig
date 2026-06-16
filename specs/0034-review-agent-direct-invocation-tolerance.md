---
id: "0034"
slug: review-agent-direct-invocation-tolerance
status: approved
complexity: small
interaction-mode: AUTO
related-issue: 319
version: 1.0.0
---

# PR-reviewer agent tolerates direct invocation without a team-lead

## Intent

The pr-reviewer agent produces its verdict silently and cleanly when spawned
directly (not via TeamCreate), without flagging a missing team-lead recipient
as a failure. The durable output — the GitHub PR review comment — is the
canonical artifact in both invocation modes.

## Requirements

1. The pr-reviewer agent's post-review reporting step SHALL be conditional on
   a TeamCreate context: when a `team-lead` agent is addressable, the agent
   SHALL send the verdict via `SendMessage`; when no team-lead exists, the
   step is a no-op.
2. When invoked directly, the agent SHALL NOT flag the absence of a team-lead
   recipient as a failure, anomaly, or protocol violation.
3. When invoked directly, the agent SHALL conclude its turn by returning the
   verdict summary as its final response text, making the result available to
   the caller without a side-channel message.
4. The GitHub PR review comment posted via the MCP `pull_request_review_write`
   tool remains the canonical, durable artifact regardless of invocation mode.
5. When invoked via TeamCreate (a `team-lead` is addressable), the existing
   `SendMessage` reporting behavior SHALL be preserved without change.

## Scenarios

**Scenario:** Direct invocation — no team-lead addressable.

Given the pr-reviewer agent is spawned via the `Agent` tool directly (not via
TeamCreate)  
And there is no `team-lead` process in the current session  
When the agent completes its review and posts the verdict on GitHub  
Then the agent concludes its turn without attempting `SendMessage`  
And the agent does not report a failure or anomaly  
And the verdict is returned as the agent's final response text

**Scenario:** TeamCreate invocation — team-lead is addressable.

Given the pr-reviewer agent is spawned as a TeamCreate teammate  
And a `team-lead` agent is addressable in the same session  
When the agent completes its review and posts the verdict on GitHub  
Then the agent sends the verdict to `team-lead` via `SendMessage`  
And the agent does not go idle without reporting (existing contract preserved)

## Out of scope

- Applying the same conditional reporting logic to other agents (architect
  cold-review, tester, developer) — those agents do not have a hardcoded
  `SendMessage` step in their current AGENT.md.
- Changing the content or format of the verdict posted on GitHub.
- Introducing a runtime mechanism to detect TeamCreate context automatically —
  a documentation-level conditional ("if a team-lead is addressable") is
  sufficient and avoids coupling the agent to the orchestration infrastructure.

## Open questions

- None. The preferred fix (documentation-level conditional, not a runtime
  detection mechanism) is unambiguous and was settled in issue #319.
