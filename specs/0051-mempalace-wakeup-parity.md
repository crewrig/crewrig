---
id: "0051"
slug: mempalace-wakeup-parity
status: draft
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 415
version: 1.0.0
---

# Record the MemPalace layered-wake-up parity gap and bound the session sweep

## Intent

An agent starting a session primes its cross-session memory within a
bounded, predictable, and documented cost, and any memory capability the
vendor offers but the agent cannot actually reach is surfaced as a known
limitation rather than silently assumed available.

## Requirements

1. The session-start sweep documented in
   `artifacts/core/rules/60-tools.md` SHALL carry an explicit, bounded
   token budget for its wake-up cost.

2. `docs/cli-matrix.md` SHALL record the parity status of MemPalace's
   layered wake-up capability between the agent-facing MCP tool surface
   and the CLI/library surface, with evidence pinned to the installed
   MemPalace version.

3. A MemPalace capability that the vendor documents but that is absent
   from the agent-facing MCP tool surface SHALL be recorded as a known
   gap in `docs/cli-matrix.md`, and SHALL NOT be presented to agents as
   an available action.

4. The corrected rule content SHALL be reflected in its build output
   `config/TOOLS.md` within the same change.

5. No MemPalace capability reachable only outside the agent-facing MCP
   tool surface SHALL be introduced as an ad-hoc agent action.

## Scenarios

**Scenario:** Agent primes a session within the stated budget.

Given a session opens on a project with a MemPalace wing  
And the agent reads the Memory Activation Protocol in `60-tools.md`  
When the agent runs the session-start sweep  
Then the sweep names a bounded token budget for the wake-up  
And the agent primes its cross-session context within that budget

**Scenario:** Agent encounters the documented wake-up gap.

Given the layered wake-up is absent from the agent-facing MCP tool
surface on the installed MemPalace version  
And the agent considers loading a layered wake-up at session start  
When the agent consults `docs/cli-matrix.md`  
Then it finds the capability recorded as a known MCP-vs-CLI parity gap  
And it does not attempt an ad-hoc CLI or library call to reach it

## Out of scope

- A source-controlled Python carve-out that invokes
  `MemoryStack.wake_up()` at every session start.
- Adopting the importance-ranked L1 "essential story" auto-summary into
  the deterministic sweep.
- The MemPalace tool-surface drift corrections (diary `wing` parameter,
  tool-reference table, AAAK) — tracked separately in issue #416.
- Filing the upstream MemPalace feature request to expose the wake-up
  through MCP — a consent-gated outward-facing follow-up, not part of
  this change.
- Any modification to the transcript hook or the transcripts wing.

## Open questions

- None. The parity verdict is settled by the issue #415 spike (the
  installed MemPalace exposes the wake-up only through the CLI/library,
  not MCP). The concrete numeric token budget is a PLAN-stage
  calibration measured against the installed version, not an open
  spec-level question.
