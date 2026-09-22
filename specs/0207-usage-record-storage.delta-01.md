---
id: "0207"
slug: usage-record-storage
status: approved
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 1170
version: 1.1.0
---

# Usage record storage — delta 01: explicit prune reaches registered derived stores

## ADDED

1. **New requirement (R28) — Explicit prune reaches items in registered
   derived stores.** An explicit prune of a period SHALL also remove,
   together with that period's journal entries and mirrored drawers,
   every item that any derived store registered with the storage
   contract holds for that period, leaving no such item behind on its
   own.
2. **New requirement (R29) — Removal only through the explicit prune.**
   No item a registered derived store holds SHALL ever be removed by
   an automatic expiry; such items SHALL be removed only through the
   explicit prune naming their period.
3. **New requirement (R30) — Registration leaves existing entries
   untouched.** Registering a derived store with the storage contract
   SHALL NOT alter any journal entry, sidecar, marker, or mirrored
   drawer already written; a later specification registers a derived
   store by declaring it to the storage contract, not by writing
   through any of those journal-owned paths, so requirement 3's
   append-only guarantee for the journal stays whole.
4. **New requirement (R31) — The prune's report names what it
   reached.** The explicit prune's own report SHALL name each
   registered derived store it reached and, for each, how many of that
   store's items it removed.
5. **New requirement (R32) — No registered store, no change in
   behavior.** An explicit prune of a period for which no derived store
   has anything recorded SHALL behave exactly as it did before this
   delta.
6. **New requirement (R33) — Continuous-integration acceptance
   criterion for the registered-derived-store prune.** A
   continuous-integration suite SHALL verify, with no shared memory
   service present and under the same root override the storage
   contract already reads, that an explicit prune of a period removes
   the items of two registered derived stores for that period together
   with the journal entries and mirrored drawers, and reports each
   store with the count of items it removed; and that an explicit
   prune of a period for which no registered derived store has
   anything recorded behaves exactly as it did before this delta, with
   no derived store named in the report.

**Scenario:** Pruning removes registered derived stores together with the journal and mirror

```text
Given a period holding journal entries, mirrored drawers, and items in
      two derived stores registered with the storage contract
When  an explicit prune is requested for that period
Then  the journal entries, the mirrored drawers, and both derived
      stores' items for that period are all removed together, the
      period is recorded as pruned, and the prune's report names both
      derived stores with the count of items it removed from each
```

**Scenario:** Pruning with no registered derived store behaves as before this delta

```text
Given a period holding journal entries and mirrored drawers, and no
      derived store has anything recorded for that period
When  an explicit prune is requested for that period
Then  the journal entries and mirrored drawers are removed together and
      the period is recorded as pruned, exactly as spec 0207 specified
      before this delta, with no derived-store removal attempted and no
      derived store named in the report
```

## MODIFIED

**R19** — the explicit prune requirement SHALL be widened to also reach
every item a registered derived store holds for the pruned period.

> Original R19: *"An explicit prune of a period SHALL remove both the
> journal entries for that period and their mirrored drawers together,
> leaving neither behind on its own."*

Replacement: An explicit prune of a period SHALL remove the journal
entries for that period, their mirrored drawers, and every item any
registered derived store holds for that period, together, leaving none
of them behind on its own.

The parent's two `## Out of scope` bullets for seams (d) and (e) are
restated so each seam stays out of scope except for the prune
obligation this delta adds:

> Original: *"Attribution semantics and rollups across records — seam
> (d), issue #1171."*

Restated: Attribution semantics and rollups across records remain out
of scope — seam (d), issue #1171 — except that the attribution
ledger's own entries, once registered as a derived store under
requirement 28, fall under the prune obligation this delta adds.

> Original: *"Pricing computation and any monetary value — seam (e),
> issue #1172."*

Restated: Pricing computation and any monetary value remain out of
scope — seam (e), issue #1172 — except that stored prices, once
registered as a derived store under requirement 28, fall under the
prune obligation this delta adds.

## REMOVED

(none — nothing the parent required is withdrawn; this delta only
widens the reach of the explicit prune the parent already specified.)

## Notes

This delta exists because two later specifications ask the explicit,
period-scoped prune to reach state spec 0207 did not name. Spec 0209
requirement 37 (`specs/0209-usage-pricing.md`) asks the prune to remove
a period's stored prices, and spec 0208 requirement 17
(`specs/0208-usage-attribution.md`) asks it to remove the attribution
ledger's entries of that period; spec 0207 requirements 18 through 20
name only journal entries and mirrored drawers. The owner resolved the
reconciliation at spec 0209's content gate:

> **Resolved at the content gate — prune reconciliation with spec
> 0207.** Requirement 37 asks the explicit period-scoped prune to
> remove a period's stored prices, while spec 0207's requirements 18
> through 20 name only journal entries and their mirrored drawers. The
> owner settled the reconciliation at the `user-validate` gate
> (approved without annotation): a **delta-spec of spec 0207**
> (`0207-delta-01`) extends the prune to the derived stores that later
> seams declare; it is opened at the PLAN stage of this specification
> and merges before its implementation starts. The implementation
> realizing this specification does not extend spec 0207's prune
> behavior without that delta.

Rather than each of spec 0208 and spec 0209 — and any future seam —
silently widening spec 0207's prune on its own, this delta establishes
a single obligation: a later specification registers its derived store
with the storage contract, and the explicit prune, already the sole
removal path for journal entries and mirrored drawers (R18), reaches
every registered store's items for the pruned period. Six requirements
are added above (28 through 33, one sentence per obligation for
clarity) and satisfy both spec 0208 requirement 17 and spec 0209
requirement 37 without either spec needing to restate spec 0207's
prune contract itself.

MINOR bump (`1.0.0` → `1.1.0`) per `docs/spec-format.md` →
*Versioning*: an additive normative change — one new requirement
(split into requirements 28 through 33) — plus a reworded R19 that
keeps every existing obligation of the original (journal entries and
mirrored drawers removed together, leaving neither behind on its own)
intact while adding every item a registered derived store holds for the
period to the same removal.
