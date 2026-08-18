---
id: "0005"
slug: retroactive-routing-engine
status: draft
complexity: standard
interaction-mode: FULL
related-issue: 885
version: 3.0.0
---

# Automatic retroactive routing engine

## ADDED

- **Ledger-route disposition:** Introduces the findings ledger as a third disposition for non-blocking findings alongside loop-route and dismiss (R8 of spec 0162).
- **Journalling obligation:** The orchestrator SHALL journal every ledger-route disposition on the active logbook issue (R16 of spec 0162).

## MODIFIED

Requirement 10 is replaced. Non-blocking routing now introduces the ledger-route.

Original R10 (as amended by delta-01):

<!-- markdownlint-disable-next-line MD029 -->
> 10. Non-blocking findings SHALL be routed conditionally by mode:
>     - FULL — the orchestrator SHALL present every non-blocking finding
>       to the user (Rule 4) and route only those the user accepts to the
>       loop; the rest are journalled in the logbook and left unactioned.
>     - INTERMEDIATE / MINIMAL / AUTO — the orchestrator SHALL route every
>       non-blocking finding into the loop using the same matrix as
>       blocking findings; in these modes the REVIEW loop fires no user
>       gate, so non-blocking findings become blocking by default.

Replacement R10 (from spec 0162 R8):

<!-- markdownlint-disable-next-line MD029 -->
> 10. Non-blocking findings SHALL be routed conditionally by mode:
>     - FULL — The orchestrator SHALL present every non-blocking finding to the user. The user SHALL choose per finding: **loop** (the finding SHALL be routed into the retroactive loop via the blocking matrix per spec 0005 R4), **ledger** (the finding SHALL be routed to the findings ledger), or **dismiss** (the finding SHALL be journalled in the logbook and left unactioned).
>     - INTERMEDIATE / MINIMAL / AUTO — The orchestrator SHALL route every non-blocking finding to the **ledger** by default. No user gate SHALL fire.

Requirement 8 is replaced. The termination condition is narrowed to allow termination with ledger-routed or dismissed non-blocking findings.

Original R8:

<!-- markdownlint-disable-next-line MD029 -->
> 8. The lifecycle SHALL terminate at MERGE iff a REVIEW pass produces
>    verdict APPROVE, zero blocking findings of any class, and CI is
>    green on the head commit reviewed (per ADR-0010 → *Termination*).

Replacement R8 (from spec 0162 R9/R11):

<!-- markdownlint-disable-next-line MD029 -->
> 8. The lifecycle SHALL terminate at MERGE iff a REVIEW pass produces
>    verdict APPROVE, **zero blocking** findings of any class, CI is
>    green on the head commit reviewed, and **every non-blocking finding** in the pass has been disposed as **ledger** or **dismiss** (FULL: per user triage; others: auto-ledger). Non-blocking findings loop-routed by the user in FULL mode count as blocking for this purpose.

## REMOVED

(none)
