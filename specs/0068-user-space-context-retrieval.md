---
id: "0068"
slug: user-space-context-retrieval
status: implemented
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 496
version: 1.0.0
---

# Forkable-first retrieval for the user-space layered context system

## Intent

A user's home-installed rule set stays small enough that every supported CLI
loads it in full, and any rule moved out of it remains reliably available to
every CLI on demand. The everyday path needs no extra running service, and the
worst case is always an explicit, visible signal — a rule is never silently
missing.

## Requirements

1. Rules moved out of the home-installed layered files SHALL live in a single
   committed store, and the content resolved from that store SHALL be
   byte-identical no matter which retrieval path serves it.
2. A direct file read of the store SHALL be the **default, always-available**
   retrieval path and SHALL require no additional running service.
3. Retrieval through the MemPalace memory service SHALL be supported as an
   **optional enhancement** for adopters who already run it; MemPalace being
   absent SHALL NOT make any rule unreachable.
4. When a needed rule cannot be served by any available retrieval path, the
   outcome SHALL be an explicit, visible signal to the agent; a rule SHALL
   never be silently omitted.
5. Retrieval-path selection at session start SHALL be deterministic: the same
   environment SHALL always resolve to the same path, and the chosen path
   SHALL be observable.
6. For each of the four supported CLIs (Claude Code, Gemini CLI, GitHub Copilot
   CLI, Antigravity CLI), the realization SHALL establish whether the CLI can
   perform the default direct file read of the store at runtime; any CLI that
   cannot SHALL be documented as the trigger condition for a future dedicated
   retrieval service.
7. Every rule moved out of the home-installed files SHALL remain reachable
   through the store; no rule SHALL be deleted or have its meaning changed by
   the move.

## Scenarios

**Scenario:** default path serves a rule with no service running

Given a rule has been moved into the committed store
And   no memory service is running
When  an agent needs that rule at session start
Then  the agent reads it directly from the store and proceeds, with no warning

**Scenario:** MemPalace enhancement resolves identically

Given the same rule in the store
And   the MemPalace memory service is running
When  the agent retrieves the rule through MemPalace
Then  the content is byte-identical to the direct file read

**Scenario:** no path can serve the rule — explicit signal, never silent

Given a needed rule cannot be served by any available retrieval path
When  the agent evaluates retrieval at session start
Then  an explicit, visible warning is emitted naming the unreachable content
And   no rule is silently omitted

## Out of scope

- The project-scope `AGENTS.md` reduction — owned by spec 0067 (implemented).
  This spec has no dependency on it.
- Building the dedicated fallback retrieval service (the deferred "third mode"):
  it SHALL be built only when a CLI is proven unable to read the store directly.
  This spec only documents that trigger condition (requirement 6).
- Deciding **which** specific rules are moved out of the home-installed files —
  a PLAN/DEV classification decision, not a spec-level requirement.
- Any change to MemPalace itself.
- The `AGENTS.org.md` / organization-rules surface.

## Open questions

- [GROUNDING:] `~/.crewrig/system-context/` does not exist on `main` today (only
  `.crewrig/.synced-markers/` exists). Creating the store is the realizing PR's
  responsibility; the store path and layout are introduced by this spec.
- [USER-PARKED] The canonical on-disk layout of the store (file granularity,
  naming, how a rule maps to a stored entry) is deferred to PLAN, constrained
  only by requirement 1 (byte-identical resolution). Parked with owner consent.
- [USER-PARKED] The exact deterministic session-start detection logic (how the
  agent decides between direct read and MemPalace) is deferred to PLAN, under
  requirement 5. Parked with owner consent.
- [USER-PARKED] The empirical result of requirement 6 (whether any of the four
  CLIs cannot read the store directly) is unknown at authoring time; if none
  cannot, the realization reduces to the default direct-read path plus the
  optional MemPalace enhancement. Parked with owner consent; resolved during
  realization.
