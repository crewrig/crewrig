---
id: "0227"
slug: review-seat-finding-continuity
status: draft
complexity: trivial
interaction-mode: AUTO
related-issue: 1270
version: 1.0.0
---

# Review-seat finding-identifier continuity across pull requests

## Intent

A reader of `docs/reviewer-seat.md` can tell, without inferring it, how a
`review`-surface seat numbers findings when its life spans more than one
implementation pull request under the same `iter:N` label — so a seat
never re-mints a finding identifier a prior pass on that seat already used.

## Requirements

1. `docs/reviewer-seat.md` SHALL state that on the `review` surface, `<M>`
   counts findings continuously across every pull request the seat has
   reviewed under a given `<N>`, and SHALL NOT reset to 1 merely because
   the seat begins reviewing a new pull request while `<N>` (the `iter:N`
   label ordinal) is unchanged.
2. `docs/reviewer-seat.md` SHALL keep the existing rule that `<N>` tracks
   only the `iter:N` label ordinal unchanged — this spec does not
   redefine `<N>`.
3. The clarification SHALL introduce no new store, service, or mechanical
   check: the seat's dossier — already reconstructible from the forge per
   `docs/reviewer-seat.md` → *Reconstructing a dossier* — remains the sole
   mechanism a pass consults before minting its next identifier.

## Scenarios

**Scenario:** Same iteration label, second pull request

Given a `review` seat has minted `i1-F1` through `i1-F5` on the first
implementation pull request of a ticket, and no `iter:N` label advance has
occurred
When the ticket's implementation branch is recreated and a second
implementation pull request is opened under the same `iter:1` label
Then a fresh pass on that seat reads the dossier across both pull requests
and mints its next finding as `i1-F6`, not `i1-F1`

**Scenario:** Iteration label advances

Given a `review` seat's dossier already carries `i1-F1` through `i1-F6`
When the ticket's DEV loop completes another retroactive iteration and the
`iter:N` label advances to `iter:2`
Then the next pass mints its findings as `i2-F1`, `i2-F2`, ... — `<N>`
advances and `<M>` restarts under the new `<N>`, exactly as the existing
identifier format already implies

## Out of scope

- Any change to the `specs` or `plan` surface identifier schemes
  (`s<N>-F<M>`, `v<N>-F<M>`) — neither is affected by this friction.
- Any mechanical or CI enforcement of finding-identifier uniqueness —
  `docs/reviewer-seat.md` → *Nothing mechanical observes this* already
  rules this out by design, and this spec does not revisit that decision.
- Renumbering or migrating any finding identifier already posted on a
  merged or open pull request.

## Open questions
