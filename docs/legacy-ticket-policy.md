<!-- Extracted from AGENTS.md. Cross-references to other sections refer to AGENTS.md. -->

# Legacy ticket policy

<!-- crewrig-doc: published=false -->

## Cutoff rule

Tickets opened **before** the merge of PR #176 — which introduced
[ADR-0010](adr/0010-spec-plan-review-lifecycle.md) and the
SPECS → PLAN → DEV → REVIEW lifecycle — on `main` (literal date for
the human reader: **2026-05-31**) were eligible for one-time
migration triage under
[`specs/0008-migration-of-in-flight-tickets.md`](../specs/0008-migration-of-in-flight-tickets.md).
Tickets opened on or after that date SHALL follow the new lifecycle
by default. The migration was a one-time pass; this cutoff rule is
the steady-state contract.

## Legacy contract

Tickets classified `keep-legacy` by the spec 0008 audit continue to
run under the contract that preceded ADR-0010:

- The team protocol defined above in *Agent Team Protocol → Standard
  Team Templates* (Templates 1 / 2 / 3) applies unchanged.
- A direct implementation pull request closes the issue.
- **No** SPECS stage — no `/specs/<NNNN>-<slug>.md` file is required.
- **No** PLAN comment — no `## PLAN — issue #<N>` artifact on the
  logbook.
- **No** spec-PR / delta-spec ordering — implementation may proceed
  without a preceding qualification PR.
- **No** retroactive review-loop class tagging (`tech` / `arch` /
  `spec`) on findings.

## Audit reference

The one-time migration audit table — classifying every ticket open
at the time of the cutoff into `keep-legacy`, `retrofit`, or
`NA — post-cutoff` — lives in
[`specs/0008-migration-of-in-flight-tickets.md`](../specs/0008-migration-of-in-flight-tickets.md)
under *Audit table*. Reclassification requires a delta-spec
amendment.
