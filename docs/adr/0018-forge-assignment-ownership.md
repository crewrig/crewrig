# ADR 0018 — Forge assignment record as the cross-contributor ticket lock

<!-- crewrig-doc: section=architecture-adr nav_order=180 published=true title="ADR 0018 — Forge assignment record as the cross-contributor ticket lock" -->

**Status:** Accepted (spec 0244, issue #1387)

## Context

Every coordination guard in the framework is scoped to one machine: spec-id
reservation (spec 0112), worktree claims (`docs/agent-team-protocol.md`), and
reviewer seats. The shared agent memory is per-person. Nothing stops two
contributors, each driving their own agent sessions, from duplicating the same
ticket. The only state that every contributor already shares, through the
credential they already hold, is the forge's issue assignment record — its
current assignees and its assignment history.

## Decision

- The forge assignment record is the **only** lock shared across contributors.
- An issue with no assignee is **free**. Otherwise its **owner** is the one
  contributor added by the first change after it was last free; a replacement
  that never empties the set does not free it.
- **Undecidable means not yours.** A tie, or a history that does not replay to
  the current list, makes nobody the owner.
- Enforcement is **agent-only**: `scripts/ticket-pickup.ts` runs at every
  authoring pickup and fails closed ([`docs/ticket-ownership.md`](../ticket-ownership.md)).

## Consequences

- A pull request opened by hand, without an agent, bypasses the check (spec 0244 → *Out of scope*).
- GitLab has no assignee event API, so its history comes from parsing system notes; an unparsable assignment note fails closed.
- Every pickup costs a few forge reads and, on a free ticket, one self-assignment plus a settle delay of about 3 s.
- On GitHub and Gitea, a replacement whose removal and addition land in different seconds reads as a release followed by a take. This is **intended**: transfers (R7) and takeovers (R8) must leave the issue free before the new assignment, and this is the pattern that lets R1 recognise the new owner. It is not a record gap to fix.
- Transfers and takeovers stay human decisions; the tool only recognises their outcome.
