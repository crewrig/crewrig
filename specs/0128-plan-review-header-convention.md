---
id: "0128"
slug: plan-review-header-convention
status: draft
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 833
version: 1.0.0
---

# Multi-pass plan review header convention

## Intent

Contributors and automated tooling (linters, retroactive routing engine) gain a standardized, deterministic header convention for multi-pass plan reviews on GitHub logbook issues. This closes the ambiguity where reviewers invent ad-hoc headers (e.g., `## PLAN review v2`) during multi-pass plan review loops, while preserving backward compatibility with existing single-pass review comments.

## Requirements

1. `docs/plan-format.md` → *Header conventions* SHALL specify the review header pattern for multi-pass plan reviews:
   - Initial plan review: `## PLAN review — issue #<N>` or `## PLAN review of v1 — issue #<N>`
   - Review of plan revision `v<M>` (where `<M> >= 2`): `## PLAN review of v<M> — issue #<N>`
2. `docs/plan-format.md` SHALL explicitly accept `## PLAN review — issue #<N>` as a valid backward-compatible alias for `## PLAN review of v1 — issue #<N>`, ensuring past comments and single-pass workflows remain fully compliant.
3. Every plan review header pattern SHALL maintain the `## PLAN review` prefix so that filters relying on `startswith("## PLAN review")` or regex matching find all review passes deterministically.
4. `specs/0004-plan-format-and-review.md` Requirement 6 and its scenarios SHALL be updated to document the multi-pass header convention (`## PLAN review of v<M> — issue #<N>`).

## Scenarios

### Scenario 1: Initial plan review (pass 1)

Given a plan comment `## PLAN — issue #833 (spec 0128)` posted on logbook issue #833
When a cold architect reviewer posts a review comment judging plan v1
Then the reviewer header MAY be `## PLAN review — issue #833` or `## PLAN review of v1 — issue #833`
And both forms are recognized as valid reviews of plan v1.

### Scenario 2: Multi-pass plan review (pass 2+)

Given a revised plan comment `## PLAN v2 — issue #833 (spec 0128) — revision after REQUEST CHANGES review`
When a cold architect reviewer posts a review comment judging plan v2
Then the reviewer header SHALL be `## PLAN review of v2 — issue #833`
And automated tools parse `<M> = 2` as judging plan revision `v2`.

### Scenario 3: Non-compliant review header format (failure path)

Given a review comment posted with an ad-hoc header such as `## PLAN review v2 — issue #833`
When an automated tool or plan linter parses logbook comment headers
Then the header fails strict schema validation because it lacks the required `of` keyword
And the reviewer is prompted to correct the header to `## PLAN review of v2 — issue #833`.

## Out of scope

- Modifying the body structure or finding taxonomy (`class: tech`, `class: arch`, `class: spec`) of plan review comments.
- Building the automated plan linter (tracked separately).

## Open questions

(none)
