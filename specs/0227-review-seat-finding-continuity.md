---
id: "0227"
slug: review-seat-finding-continuity
status: approved
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
3. When the seat's dossier cannot be reconstructed across the two pull
   requests, `docs/reviewer-seat.md`'s existing `Vacant seat` rule SHALL
   govern that case unchanged — the clarification SHALL NOT introduce a
   silent fallback (guessing a continuation value for `<M>`, or silently
   restarting it at 1) for a dossier gap this spec does not otherwise
   resolve.

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

**Scenario:** Dossier unreconstructable across the two pull requests

Given the first pull request's verdicts are unreachable — for example the
pull request was deleted, so the forge query in `docs/reviewer-seat.md` →
*Reconstructing a dossier* returns nothing for it
When a pass begins on the second pull request under the same `iter:N` label
Then the pass does not guess a continuation value for `<M>`: it declares
the seat vacant per `docs/reviewer-seat.md` → *Vacant seat*, runs a full
examination of the second pull request, and records the vacancy and its
cause — it neither silently restarts at `<N>-F1` nor silently fabricates a
continuation

## Out of scope

- Any change to the `specs` or `plan` surface identifier schemes
  (`s<N>-F<M>`, `v<N>-F<M>`) — neither is affected by this friction.
- Any mechanical or CI enforcement of finding-identifier uniqueness —
  `docs/reviewer-seat.md` → *Nothing mechanical observes this* already
  rules this out by design, and this spec does not revisit that decision.
- Renumbering or migrating any finding identifier already posted on a
  merged or open pull request.

## Open questions
