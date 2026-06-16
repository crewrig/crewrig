---
id: "0032"
slug: curator-blockscalar-suggestion
status: draft
complexity: standard
interaction-mode: AUTO
related-issue: 312
version: 1.0.0
---

# Curator preserves block-scalar suggestions and prefers resolved correlation

## Intent

A contributor who writes a friction report with a multi-line suggestion — the
very form the harness-report schema encourages — sees that whole suggestion
survive into the curator's clustering, instead of having it vanish and the
report wrongly discarded as if it carried no suggestion at all. And a friction
that the curator has already turned into an opened issue is recognized as
already handled, no matter what shape its suggestion takes, rather than being
thrown away first for the way its suggestion is written.

## Requirements

1. A friction whose `suggestion` field is authored as a multi-line value SHALL
   have its full body text preserved when the curator parses that friction —
   the parsed value SHALL be the authored text, not merely the leading
   indicator of a multi-line value.
2. The preservation in requirement 1 SHALL apply to any field whose value is
   authored as a multi-line value, not only the `suggestion` field.
3. A friction whose `suggestion` is a non-empty multi-line value SHALL NOT be
   classified as having an empty suggestion, since its body text is preserved
   per requirement 1.
4. A friction drawer that is already correlated with a previously opened issue
   SHALL be classified as resolved, regardless of the shape or emptiness of its
   suggestion field.
5. The resolved-correlation classification in requirement 4 SHALL take
   precedence over the empty-suggestion classification: a drawer that is both
   correlated with an opened issue and carries an empty suggestion SHALL be
   classified as resolved, not as having an empty suggestion.
6. A friction that is not correlated with any opened issue and whose suggestion
   field is genuinely empty SHALL continue to be classified as having an empty
   suggestion, unchanged from the current contract.
7. The behaviors in requirements 1 through 6 SHALL be covered by automated
   regression scenarios.

## Scenarios

**Scenario:** A multi-line suggestion is preserved and the friction is accepted

Given a friction report whose `suggestion` field is authored as a multi-line
value with non-empty body text
And the friction is not correlated with any previously opened issue
When the curator parses that friction
Then the parsed suggestion holds the full authored body text
And the friction is accepted for clustering rather than discarded for an empty
suggestion

**Scenario:** A correlated drawer with a multi-line suggestion is resolved

Given a friction drawer already correlated with a previously opened issue
And its `suggestion` field is authored as a multi-line value
When the curator parses that drawer
Then the drawer is classified as resolved
And it is not classified as having an empty suggestion

**Scenario:** A correlated drawer with an empty suggestion is resolved

Given a friction drawer already correlated with a previously opened issue
And its `suggestion` field is empty
When the curator parses that drawer
Then the drawer is classified as resolved
And the empty-suggestion classification does not apply

**Scenario:** An uncorrelated friction with a genuinely empty suggestion is
rejected

Given a friction that is not correlated with any previously opened issue
And its `suggestion` field is present but empty
When the curator parses that friction
Then the friction is classified as having an empty suggestion
And it is discarded from clustering

## Out of scope

- Relaxing the spec-0010-R1 empty-suggestion contract — whether a
  present-but-empty suggestion should remain malformed is owned by issue #314.
  This spec keeps the empty-suggestion semantics intact.
- Changing how the curator clusters accepted frictions or how it opens issues
  from clusters.
- Changing the required-field contract for a friction (`writer_agent` and at
  least one evidence entry).
- Altering how correlation with a previously opened issue is established or
  stamped onto a drawer.

## Open questions

- None. The scope is settled by the brief: preserve multi-line field bodies so
  a non-empty multi-line suggestion is no longer mistaken for empty, and order
  the resolved-correlation check ahead of the empty-suggestion check. The
  empty-suggestion contract itself is deliberately left untouched and tracked
  separately on issue #314.
