---
id: "0146"
slug: dropped-plan-review-finding-detection
status: draft
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 874
version: 1.0.0
---

# Make Dropped Plan Review Findings Detectable

## Intent

Prevent plan revisions from silently dropping prior review findings by establishing a reviewer-minted finding identifier convention (`v<N>-F<M>`), a mandatory reviewer traceability audit obligation in `docs/plan-review-protocol.md`, and a countable invariant for plan revision completeness.

## Requirements

1. **Reviewer-minted identifiers.** Every PLAN review pass SHALL assign a reviewer-minted identifier to each finding in the format `v<N>-F<M>` (e.g., `v1-F1`, `v1-F2`), where `<N>` is the plan version being reviewed and `<M>` is the 1-based sequence number of the finding within that review pass. Subsequent split findings or sub-findings SHALL retain the parent prefix (e.g., `v1-F2a`, `v1-F2b`).
2. **Reviewer traceability audit obligation.** Every PLAN review of a revised plan (`v<N+1>` for N >= 1) SHALL include a **Finding Traceability Audit** section that enumerates every finding from all prior review passes by its reviewer-minted ID (`v<N>-F<M>`) and states its disposition: *addressed*, *superseded*, or *withdrawn with reason*.
3. **Traceability table and countable invariant.** When revising a plan in response to review findings, the author SHALL include a `### Finding traceability` subsection (or `### Revision rationale & traceability`) in the revised plan comment. The row count of addressed reviewer-minted IDs SHALL match the total number of findings raised across prior review passes.
4. **Documentation updates.**
   - `docs/plan-review-protocol.md` SHALL be updated to document the `v<N>-F<M>` reviewer-minted identifier convention, the prior-finding audit obligation for reviewers, and the countable invariant check command.
   - `docs/plan-format.md` SHALL be updated to document the optional `### Finding traceability` subsection header, its schema, and its interaction with optional revision rationale headings.

## Scenarios

### Scenario 1: Reviewer assigns IDs and audits prior findings

- **GIVEN** a PLAN review of plan revision `v2` on Issue #751
- **WHEN** the reviewer conducts the review pass
- **THEN** the reviewer assigns `v1-F1` through `v1-F7` to findings raised on `v1` and verifies that all seven reviewer-minted IDs are accounted for in `v2` before issuing a verdict.

### Scenario 2: Dropped finding detected during review pass

- **GIVEN** a PLAN revision `v3` where a prior finding `v1-F4` was silently omitted
- **WHEN** the reviewer performs the traceability audit for pass `v3`
- **THEN** the reviewer identifies `v1-F4` as missing in the audit section and emits a `REQUEST CHANGES` verdict citing the unaddressed finding `v1-F4`.

## Out of scope

- Building a CLI-based plan linter script in `scripts/` (plan comments live on GitHub issues and adding linting tools for issue comments is explicitly out of scope).

## Open questions

- None.
