---
id: "0022"
slug: editorial-carve-out
status: draft
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 270
version: 1.0.0
---

# Editorial carve-out for the spec append-only rule

## Intent

The specification append-only rule — which today forbids any edit to a merged
spec's body — is widened so that meaning-preserving editorial edits, namely
orthography and typo corrections that change spelling or surface form but never
meaning, are permitted on merged specs. Normative content stays protected: an
editorial edit may fix a spelling, but the substance of any requirement,
scenario, intent, or out-of-scope item must not change. This extends the
lifecycle-metadata carve-out already in the append-only rule and unblocks a
later, repository-wide orthographic normalization.

## Requirements

1. The append-only rule in `docs/spec-format.md` SHALL permit meaning-preserving
   editorial edits — orthography and typo corrections — to the body prose of a
   merged spec.
2. A meaning-preserving editorial edit SHALL NOT alter the substance of any
   normative content: no requirement, scenario, intent, or out-of-scope item
   may change in meaning; only its spelling or surface form may change.
3. `docs/spec-format.md` SHALL state the editorial-edit carve-out and its
   boundary explicitly, replacing the current statement that such edits "remain
   prohibited pending a separate amendment".
4. The editorial carve-out SHALL be consistent with, and stated alongside, the
   existing lifecycle-metadata carve-out (`status`, `superseded-by`) in
   `docs/spec-format.md`; substantive corrections SHALL still chain via
   delta-specs, not in-place edits.

## Scenarios

**Scenario:** An orthographic edit to a merged spec is permitted

```text
Given a merged spec contains a British spelling in its prose
When  an editorial edit corrects it to American spelling without changing any
      meaning
Then  the edit is permitted under the append-only rule
```

**Scenario:** A meaning-changing edit to a merged spec is still forbidden

```text
Given a merged spec
When  an edit changes the substance of a requirement (not merely its spelling)
Then  it is not permitted by the editorial carve-out; it remains an append-only
      violation and the correction must chain via a delta-spec
```

## Out of scope

- The en-GB to en-US orthographic sweep itself — split out by the maintainer
  into a separate, later spec. This spec only *unblocks* it by permitting
  editorial edits. Parameters recorded for that future spec: exhaustive British
  to American normalization, prose only, excluding code identifiers, file paths,
  URLs, command names, proper nouns, the `LICENSE` legal text, and third-party
  content; complexity `standard`.
- The lifecycle-metadata carve-out (`status`, `superseded-by`) — already merged
  (issue #262).

## Open questions

- None.
