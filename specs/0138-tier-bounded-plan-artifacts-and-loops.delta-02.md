---
id: "0138"
slug: tier-bounded-plan-artifacts-and-loops
status: draft
complexity: small
interaction-mode: MINIMAL
related-issue: 884
version: 1.2.0
---

# Tier-bounded plan artifacts and PLAN loops — delta 02

## ADDED

## MODIFIED

1. **Requirement 1, last-but-one sentence — reconciled with Requirement 2.**
   Original line:

   > A plan omitting `### Approach` or `### Steps` SHALL remain non-conformant
   > at every tier.

   Replacement:

   > A structured plan comment omitting `### Approach` or `### Steps` SHALL be
   > non-conformant at every tier; the sole exception is the `trivial`-tier
   > one-line plan confirmation admitted by Requirement 2, which is a
   > sufficient PLAN artifact without either section.

   Rationale (non-normative): as merged, Requirement 1 and Requirement 2
   contradicted each other — the one-line confirmation carries no headings,
   so Requirement 1's "at every tier" declared non-conformant the very
   artifact Requirement 2 declares sufficient. The cold REVIEW pass on the
   implementation PR (#888, iteration 1, `class: spec`) surfaced the
   contradiction after the implementation faithfully carried both horns into
   `docs/plan-format.md` and ADR-0010. This delta keeps the floor for
   structured plans and names the one-line confirmation as the single
   explicit exception.

## REMOVED
