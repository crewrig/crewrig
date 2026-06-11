---
id: "0025"
slug: harden-agent-team-protocol
status: draft
complexity: small
interaction-mode: AUTO
related-issue: 280
version: 1.0.0
---

# Harden the agent team protocol: issue-triggered team assembly and silent-agent timeout

## Intent

An agent picking up a tracked GitHub issue can no longer downgrade that
work to solo inline handling, and an agent waiting on a silent teammate
has a bounded, explicit signal telling it when to stop waiting and fall
back. A reader of the team protocol finds, in one place, both the rule
that a referenced issue number forces a team and the time bound after
which an unresponsive teammate is treated as dead. Nothing about the
existing team templates, tiers, or communication rules changes; the two
additions sharpen guidance that was previously implicit.

## Requirements

1. The team protocol SHALL state that when a unit of work references a
   tracked GitHub issue number, assembling a team is mandatory and the
   work SHALL NOT be downgraded to the `trivial` tier's inline handling
   on the basis of perceived small scope.
2. The team protocol SHALL preserve the existing exemption for trivial
   single-file edits that the user explicitly scopes as inline, and
   SHALL make explicit that this exemption does not apply to work
   anchored on a tracked issue.
3. The team protocol SHALL give a bounded waiting heuristic for a
   teammate that has produced no result message and no observable
   side-effect, after which the team-lead SHALL treat the teammate as
   dead and apply the existing idle-fallback remedy.
4. The waiting heuristic SHALL be expressed as guidance that composes
   with the existing idle-notification handling, and SHALL NOT contradict
   the rule that observable side-effects are checked before an apparent
   silence is treated as a protocol violation.
5. The additions SHALL be confined to the team protocol documentation and
   SHALL NOT alter any existing requirement of the lifecycle, the
   interaction modes, or the complexity tiers.

## Scenarios

**Scenario:** A referenced issue forces a team

```text
Given a user asks the agent to fix a problem and references a tracked
      GitHub issue number
When  the agent classifies the work
Then  it assembles a team sized to the scope and does not handle the work
      as a trivial inline edit, regardless of how small the fix appears
```

**Scenario:** A user-scoped inline edit remains exempt

```text
Given a user explicitly scopes a one-file change as an inline edit and
      references no tracked issue
When  the agent classifies the work
Then  the trivial inline exemption still applies and no team is required
```

**Scenario:** A silent teammate crosses the waiting bound

```text
Given a teammate has produced no result message and no observable
      side-effect after the bounded waiting period
When  the team-lead next evaluates the teammate's state
Then  the team-lead treats the teammate as dead and spawns a fresh
      direct agent with a self-contained brief, per the idle-fallback rule
```

## Out of scope

- Any harness-level mechanism (heartbeat events, a TaskStatus polling
  API, runtime timeouts): the suggested runtime improvement in issue #279
  is outside CrewRig's reach as a configuration framework; this spec
  documents an agent-side waiting heuristic only.
- Changes to the existing idle-notification handling, the report-before-idle
  rule, or the idle-fallback remedy beyond adding the waiting bound that
  triggers them.
- Any change to the complexity-tier definitions themselves; the spec only
  forbids downgrading issue-anchored work to the trivial tier.

## Open questions

- None.
