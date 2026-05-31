---
id: "NNNN"
slug: your-kebab-slug-here
status: draft
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 0
version: 1.0.0
---

# Spec title — short, descriptive, matches the slug

## Intent

One paragraph, plain prose, capturing the user-facing WHAT in a single
breath. No HOW words (`by`, `via`, `using`, technology names, library
choices). If the reader cannot picture what changes for a user after
reading this paragraph, rewrite it.

## Requirements

1. The system SHALL _[observable behaviour]_.
2. The system MUST _[invariant or constraint]_.
3. _Add as many as needed. Each line uses SHALL or MUST. Each line is
   independently testable. No HOW words._

## Scenarios

**Scenario:** _happy-path title_

```text
Given <pre-condition>
When  <triggering action>
Then  <observable outcome>
```

**Scenario:** _failure-path title_

```text
Given <pre-condition>
When  <triggering action that should fail or be rejected>
Then  <observable failure mode>
```

## Out of scope

- _Behaviour, integration, or boundary explicitly excluded._
- _Add bullets as needed. Empty list is allowed only for `trivial` tier._

## Open questions

- _Unresolved question, or remove this bullet._
- _If the spec reaches `status: approved` with non-empty open questions,
  the reviewer requires written closure on the logbook issue._
