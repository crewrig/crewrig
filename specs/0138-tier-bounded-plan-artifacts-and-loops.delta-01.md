---
id: "0138"
slug: tier-bounded-plan-artifacts-and-loops
status: draft
complexity: small
interaction-mode: MINIMAL
related-issue: 884
version: 1.1.0
---

# Tier-bounded plan artifacts and PLAN loops — delta 01

## ADDED

1. **New requirement (R8) — spec 0004 alignment.**
   `specs/0004-plan-format-and-review.md` Requirement 2 and its scenarios
   SHALL be updated to admit the tier-conditioned mandatory set of
   Requirement 1 (sections `### Approach` and `### Steps` mandatory at
   `trivial` and `small` tiers; all five sections at `standard` and `large`),
   in the same implementation change that realizes Requirement 1.

Scenario:

**Scenario:** spec 0004 no longer contradicts the tier-conditioned set

Given the implementation change for this spec has landed
When  a reviewer checks a `small`-tier plan containing exactly `### Approach` and `### Steps` against `specs/0004-plan-format-and-review.md`
Then  Requirement 2 of that spec admits the plan and no format finding arises

Rationale (non-normative): the parent spec left `specs/0004-plan-format-and-review.md`
Requirement 2 ("Every plan comment SHALL contain, in order, the following five
mandatory sections") in force, so two merged normative artifacts contradicted
each other at `trivial`/`small` tiers — the `class: spec` finding of the PLAN
review of v1 on issue #884. The remediation follows the project precedent of
spec 0128 Requirement 4, which mandated the equivalent update of spec 0004
Requirement 6 and was carried by the implementation change of its own ticket.

## MODIFIED

## REMOVED
