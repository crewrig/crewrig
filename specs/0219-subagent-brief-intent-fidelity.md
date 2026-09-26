---
id: "0219"
slug: subagent-brief-intent-fidelity
status: approved
complexity: small
interaction-mode: AUTO
related-issue: 1266
version: 1.0.0
---

# Sub-agent briefs preserve user-intent fidelity

## Intent

When an orchestrator briefs specialist sub-agents on a user's proposal, the
user's exact wording survives the briefing and the synthesis step
unaltered — a sub-agent never receives the proposal reframed as one option
among others, and the orchestrator never adopts a sub-agent's reframing of
that proposal without checking it against what the user actually said.

## Requirements

1. An `Agent` spawn brief that describes a user proposal SHALL quote the
   user's own wording verbatim (a direct quote, not a paraphrase) for the
   part of the brief that states what the user asked for.
2. An `Agent` spawn brief SHALL NOT present a user's literal proposal as an
   open option to be weighed against alternatives the sub-agent is free to
   invent or prefer; the sub-agent MAY be asked to identify risks or
   implementation concerns with the proposal, but not to replace it.
3. Before adopting a sub-agent's recommendation that changes, narrows, or
   reframes the user's original proposal, the orchestrator SHALL re-check
   that recommendation against the user's literal statement (recovered from
   the conversation, not from an intermediate summary) and SHALL surface
   the discrepancy to the user rather than silently adopting the
   reframing.
4. This rule applies to every `Agent` spawn whose brief restates a user
   proposal, regardless of role (`architect`, `developer`, or any other
   specialist).

## Scenarios

**Scenario:** Brief quotes the user's proposal verbatim

Given a user has proposed a specific design in their own words
When the orchestrator spawns a specialist sub-agent whose brief restates
  that proposal
Then the brief contains the user's proposal as a direct quotation, not a
  paraphrase, and does not present it as one option among alternatives

**Scenario:** Sub-agent reframes the proposal; orchestrator must re-check before adopting

Given a specialist sub-agent's returned recommendation changes or narrows
  the user's original proposal
When the orchestrator synthesizes that recommendation into its own reply
  or plan
Then the orchestrator compares the recommendation against the user's
  literal statement before adopting it, and surfaces any discrepancy to
  the user instead of silently adopting the reframed version

## Out of scope

- Tooling or automated linting that detects paraphrasing in a spawned
  brief — this spec is a protocol/documentation fix, not a linter.
- Changes to the `TaskCreate`/`SendMessage` coordination primitives
  themselves (tracked separately under issue #1267).
- General prompt-engineering guidance for brief quality beyond the
  intent-fidelity concern described here.

## Open questions

(none)
