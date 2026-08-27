---
id: "0188"
slug: reviewer-seat-refinements
status: approved
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 1054
version: 1.0.0
---

# 0188 — Reviewer-seat documentation and dossier recipe refinements

## Intent

The reviewer-seat contract documentation and dossier reconstruction recipes maintain structural clarity and query safety by isolating normative fallback clauses, preventing false matches on unset pattern variables, clarifying pass ordinal counting across addenda, and explicitly barring characterization of referenced records in seated pass briefs.

## Requirements

1. The reviewer-seat contract documentation in `docs/reviewer-seat.md` SHALL cleanly separate the whitespace tolerance rationale from the non-editable artifact fallback rule into distinct paragraphs, restoring the referential antecedent for concluding clauses and keeping line lengths bounded.
2. The dossier reconstruction recipes in `docs/reviewer-seat.md` SHALL specify queries that guard against unset pattern variables so that copying individual query commands cannot match non-verdict comments.
3. The reviewer-seat contract documentation SHALL clarify dossier reconstruction on the `specs` surface so that multiple dossier entries belonging to the same review pass (such as addenda or multi-comment posts) are associated with that single pass rather than inflating the seat pass ordinal.
4. The seated pass instantiation contract in `docs/reviewer-seat.md` SHALL explicitly prohibit characterization, summarization, or interpretation of referenced artifacts within the brief, restricting brief content strictly to identifiers and locations.

## Scenarios

### Scenario: Reviewer-seat document maintains clean paragraph boundaries for fallback rules

Given a reader consulting the voiding mechanism section of `docs/reviewer-seat.md`
When reading the whitespace tolerance rationale and the non-editable artifact fallback rules
Then the two concerns appear in separate paragraphs with clear grammatical antecedents and conformant line wrapping

### Scenario: Dossier reconstruction query executed with unset pattern variable

Given an operator copying an individual dossier query snippet from `docs/reviewer-seat.md` without setting the `SEAT` shell variable
When the query executes against issue or pull request comments
Then the query does not return non-verdict comments or fail silently

### Scenario: Specs surface dossier reconstruction with addendum comment

Given a spec review pass that emits a primary verdict comment and a subsequent addendum comment under the same seat
When the seat's dossier is reconstructed for a subsequent pass
Then the pass ordinal reflects the unique review passes executed rather than inflating for the addendum entry

### Scenario: Seated pass brief strictly excludes artifact characterization

Given an orchestrator composing an instantiation brief for a seated reviewer pass
When constructing the references-only brief
Then the brief supplies only the artifact identifiers, revision IDs, and location references without asserting interpretations or summaries of what those records contain

## Out of scope

- Modifying the reviewer seat key schema (`<surface>/<ticket>[#<generation>]`).
- Changing the role assignments for reviewer surfaces (`architect` on `plan`, `pr-reviewer` on `review`).
- Introducing dynamic database stores for reviewer dossiers outside forge comments.

## Open questions

(none)
