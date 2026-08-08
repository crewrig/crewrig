---
id: "0112"
slug: spec-id-reservation
status: draft
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 726
version: 1.1.0
---

# 0112 — spec-id-reservation (delta-01)

Spec 0112 qualified reservation for the upstream `/specs/` corpus and said
nothing about `specs/org/`, the org-owned overlay in which an adopting
organization authors its own specifications. That silence is the gap this delta
closes, and it was surfaced by the user at the PLAN validation gate.

The gap matters because org specs are subject to the identical race: two
contributors in the same organization, authoring in parallel, will pick the same
org id for exactly the reason spec 0112 documents for upstream ids. But the fix
cannot be a copy of the upstream one. `specs/0071-org-specs-lint-exclusion.md`
establishes that upstream tooling does **not** validate `specs/org/`, precisely
so that an adopting organization may choose its own numbering convention; the
`ORG-0001` form appears in that spec only as an illustrative example, never as a
mandated pattern. Upstream therefore cannot know the shape of an org id, and any
requirement that assumes one would reopen the layer boundary spec 0071 drew.

The resolution separates two capabilities that spec 0112 conflated: *securing a
given identifier*, which needs no knowledge of the identifier's form, and
*computing the next free identifier*, which does. The first is made generic and
serves both corpora; the second stays upstream-only.

## ADDED

1. **R14.** The reservation mechanism SHALL expose the securing of a
   caller-supplied identifier, treating that identifier as an **opaque string**
   and asserting nothing about its shape, length, or numeric content. The
   atomicity guarantee of requirement 1 SHALL apply to it identically.

2. **R15.** An identifier belonging to a specification under `specs/org/` SHALL
   be securable through requirement 14, and org reservations SHALL occupy a
   reservation namespace **disjoint** from the one holding upstream
   reservations, so that no org identifier can collide with an upstream
   identifier and no read of one corpus can return a reservation belonging to
   the other.

3. **R16.** Computation of the next free identifier SHALL remain confined to the
   upstream corpus. The mechanism SHALL NOT attempt to derive, infer, or
   validate the next org identifier, because the org numbering convention is
   deliberately unknown to upstream per
   `specs/0071-org-specs-lint-exclusion.md`. An organization selects its own org
   identifier and secures it through requirement 14.

4. **Scenario — an org identifier is secured.**
   Given an organization whose specs under `specs/org/` use an identifier form
   upstream has never seen, when a contributor secures one of those identifiers,
   then the reservation succeeds, a concurrent attempt on the same identifier is
   refused, and no upstream identifier is affected.

5. **Scenario — two corpora, one numeric suffix.**
   Given an upstream identifier and an org identifier whose numeric portions
   coincide, when both are secured, then both succeed, and a read of the
   upstream allocated set does not report the org reservation.

6. **Out of scope — computing an org identifier.** Offering an organization the
   next free identifier for its own corpus, in any form, including a
   configurable numbering pattern supplied by the adopter. Rejected because it
   would oblige upstream to know a convention spec 0071 deliberately excluded it
   from knowing, and would add an adopter-supplied pattern as a new failure
   surface.

## MODIFIED

1. **Requirement 3 is replaced** to name the corpus it governs, which was
   unambiguous only while `specs/org/` was out of view.

   - Original R3:

     > **R3.** The set of unavailable ids SHALL be the union of the ids already
     > present on the reference branch and the ids secured by sessions whose
     > spec has not yet merged. Allocation SHALL read that union, never the
     > merged ids alone.

   - Replacement R3:

     > **R3.** For the **upstream** corpus, the set of unavailable ids SHALL be
     > the union of the upstream ids already present on the reference branch and
     > the upstream ids secured by sessions whose spec has not yet merged.
     > Allocation SHALL read that union, never the merged ids alone. Org
     > reservations SHALL NOT appear in that union, per requirement 15.

2. **Requirement 7 is replaced** so the continuous-integration check does not
   extend upstream enforcement over org-owned content.

   - Original R7:

     > **R7.** A check SHALL run in continuous integration on every pull request
     > that adds or renames a non-delta spec file, and SHALL fail when that
     > spec's id was never secured, or was secured for a different ticket. The
     > check SHALL read the authoritative record of secured ids rather than any
     > local copy that may lag behind it.

   - Replacement R7:

     > **R7.** A check SHALL run in continuous integration on every pull request
     > that adds or renames a non-delta spec file **outside `specs/org/`**, and
     > SHALL fail when that spec's id was never secured, or was secured for a
     > different ticket. The check SHALL read the authoritative record of
     > secured ids rather than any local copy that may lag behind it. A
     > specification under `specs/org/` SHALL NOT fail this check, consistent
     > with the exclusion `specs/0071-org-specs-lint-exclusion.md` establishes
     > for upstream validation of org-owned content.

## REMOVED

(None. This delta adds three requirements, two scenarios and one out-of-scope
item, and replaces two requirements. Requirements 1, 2, 4 through 6, and 8
through 13 of spec 0112 stand unchanged, as do all five of its original
scenarios and the remainder of its out-of-scope list.)
