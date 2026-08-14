---
id: "0154"
slug: spec-pr-status-transition-discharge-carveout
status: approved
complexity: small
interaction-mode: AUTO
related-issue: 849
version: 1.0.0
---

# Spec-PR Status Transition Discharge Carve-Out Protocol

## Intent

Clarify in `docs/interaction-modes.md` that the mandatory frontmatter transition from `status: draft` to `status: approved` on a one-file spec-PR does not forfeit the pre-merge merge-authorization discharge.

## Requirements

1. **Status transition carve-out reconciliation.** `docs/interaction-modes.md` SHALL state under *User-gate definition → Narrow discharge carve-out* that the frontmatter transition from `status: draft` to `status: approved` is expected prior to squash-merge and SHALL NOT forfeit the merge-authorization discharge.
2. **Carve-out scope definition.** The carve-out SHALL define approved spec content as covering the spec's body and non-status frontmatter fields, ensuring the mandatory status field update does not trigger an additional approval gate.
3. **Summary reference alignment.** `AGENTS.md` SHALL maintain summary alignment with `docs/interaction-modes.md` under `## Interaction modes` while keeping file size under 22,000 bytes.

## Scenarios

### Scenario 1: One-file spec PR with frontmatter status transition

- **GIVEN** a one-file spec-PR whose body and non-status frontmatter were approved at the SPECS content-approval gate
- **WHEN** the spec's frontmatter status is updated from `draft` to `approved` prior to merge
- **THEN** the pre-merge merge-authorization gate remains discharged and the spec-PR is squash-merged without requesting a duplicate authorization.

### Scenario 2: Body or requirements change forfeits discharge

- **GIVEN** a spec-PR whose body or non-status frontmatter is modified after the content-approval gate
- **WHEN** merge is attempted
- **THEN** the carve-out does not apply and re-approval is required.

## Out of scope

- Removing the narrow discharge carve-out.
- Modifying gate contracts for implementation PRs.

## Open questions

- None.
