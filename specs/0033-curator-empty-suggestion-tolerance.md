---
id: "0033"
slug: curator-empty-suggestion-tolerance
status: approved
complexity: small
interaction-mode: AUTO
related-issue: 314
version: 1.0.0
---

# Curator accepts frictions with a present-but-empty suggestion field

## Intent

Frictions whose `suggestion:` key is present but empty are accepted by the
curator identically to frictions where the key is absent entirely. Only
`writer_agent` and `evidence` remain hard-required; `suggestion` is optional
at both the authoring and the ingestion layer.

## Requirements

1. The curator SHALL accept a friction whose `suggestion:` value is empty
   (empty string, whitespace-only, or an empty block-scalar body) without
   classifying the friction as malformed.
2. A friction accepted under R1 SHALL NOT appear in `skipped[]` with reason
   `empty_suggestion`.
3. When a friction is accepted under R1, its parsed output object SHALL NOT
   carry a `suggestion` key — the key is stripped, making the result
   indistinguishable from a friction that omitted `suggestion` entirely.
4. The `stats.skipped_malformed` count SHALL NOT include frictions dropped
   solely because their `suggestion:` value is empty.
5. A friction accepted under R1 that also carries a truthy `opened_as` value
   SHALL still be classified `resolved`, as the resolved-correlation check
   takes precedence over R1.

## Scenarios

**Scenario:** Trailing `suggestion:` with no value is accepted.

Given a friction payload with a valid `FRICTION:` title, `writer_agent`,
`evidence`, and a `suggestion:` key whose value is an empty string  
When the curator processes the payload  
Then the friction is accepted and enters the clustering pipeline  
And `suggestion` is absent from the parsed friction object  
And the friction does not appear in `skipped[]`

**Scenario:** `suggestion: |` with no body is accepted.

Given a friction payload with a valid `FRICTION:` title, `writer_agent`,
`evidence`, and `suggestion: |` followed by no indented body lines  
When the curator processes the payload  
Then the friction is accepted  
And `suggestion` is absent from the parsed friction object  
And the friction does not appear in `skipped[]`

**Scenario:** Whitespace-only `suggestion:` is accepted.

Given a friction payload with a valid `FRICTION:` title, `writer_agent`,
`evidence`, and `suggestion:` followed by whitespace only  
When the curator processes the payload  
Then the friction is accepted  
And `suggestion` is absent from the parsed friction object  
And the friction does not appear in `skipped[]`

**Scenario:** Correlated friction with empty `suggestion:` is resolved.

Given a friction payload with a truthy `opened_as:` field and an empty
`suggestion:` value  
When the curator processes the payload  
Then the friction is classified `resolved` (the correlation check takes
precedence over R1)  
And the friction does not appear in `skipped[]` with reason `empty_suggestion`

## Out of scope

- Relaxing the hard requirements on `writer_agent` (non-empty) and `evidence`
  (at least one entry).
- Modifying spec 0010's scenario that lists "empty suggestion" as a malformed
  case — spec 0010 remains on `main` as written; this spec amends the runtime
  contract prospectively and takes precedence where the two diverge.
- Changing how non-empty block-scalar suggestion bodies are captured — that
  contract is owned by spec 0032.

## Open questions

- None. Both reconciliation options were evaluated in issue #314; option (a)
  — accept and strip the empty key — is unambiguously preferred as it
  preserves evidence-backed signal that would otherwise be silently lost.
