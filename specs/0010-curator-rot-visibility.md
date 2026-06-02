---
id: "0010"
slug: curator-rot-visibility
status: draft
complexity: small
interaction-mode: AUTO
related-issue: 203
version: 1.0.0
---

# 🔍 Curator rot visibility

## Intent

The curator JSON output surfaces every drawer skipped as malformed and every cluster that failed routing, so that an operator can diagnose wing rot from the output alone. Empty-suggestion payloads never reach cluster output.

## Requirements

1. The FRICTION-payload parser SHALL treat a `suggestion` value that is empty or contains only whitespace as an absent `suggestion` field.
2. The JSON output SHALL include a top-level `skipped` array listing every drawer the parser rejects as malformed, each entry carrying the drawer identifier, room, rejection reason, and a content excerpt.
3. The JSON output SHALL include a top-level `routing_failures` array listing every cluster that fails routing, each entry carrying the cluster key, the aggregated frictions, and the reason routing failed.
4. The additions in R2 and R3 SHALL not alter the behaviour of the `--apply` path.

## Scenarios

**Scenario:** Empty block scalar suggestion is rejected

Given a drawer whose FRICTION payload contains `suggestion: |` with no body text
When the curator parses the payload
Then the drawer is classified as malformed
And the drawer appears in the `skipped` array with a reason indicating an empty or whitespace-only suggestion

**Scenario:** Cluster without a canonical target is visible in output

Given a cluster whose member frictions carry no `canonical:` field
When the curator attempts to route the cluster
Then the cluster appears in the `routing_failures` array with its cluster key, its constituent frictions, and a reason indicating a missing target repository
And the cluster does not appear in `clusters`

**Scenario:** Multiple malformed drawers are all accounted for

Given a wing with three drawers that are malformed for distinct reasons (missing title, empty suggestion, missing writer agent)
When the curator processes the wing
Then the `skipped` array contains exactly three entries
And each entry carries a distinct reason matching the specific parse failure

## Out of scope

- Adding `skipped` entries for resolved drawers (those carrying `opened_as:`). Resolved drawers are already correlated with an existing GitHub issue and do not represent wing rot.
- Modifying the `--apply` path to consume `skipped:` or `routing_failures:` entries. Acting on the new visibility fields is a separate concern.
- Editing the curator skill prose (`SKILL.md`). The skill step that advises the operator to validate output becomes executable on the existing prose; prose edits are not required for the new fields to be useful.

## Open questions

- [GROUNDING:] The `skipped` and `routing_failures` top-level arrays do not exist in the current JSON output on `main` (`curate.py` emits only `{"stats": ..., "clusters": ...}`). Back-fill responsibility: the implementation PR for this spec SHALL add both arrays to the output in the same diff.
