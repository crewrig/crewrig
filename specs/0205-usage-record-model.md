---
id: "0205"
slug: usage-record-model
status: draft
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 1168
version: 1.0.0
---

# Usage record model — the CLI-agnostic contract for token-consumption records

## Intent

This specification defines the usage record: the single, versioned contract
every other concern of the token-consumption epic reads or writes —
capturing consumption, storing it, attributing it to a task, pricing it, and
displaying it — so a unit of model consumption reported from any of the four
CLIs carries the same shape and the same meaning regardless of its origin or
its fidelity. A person or a downstream tool inspecting a record can tell,
without guessing, which model handled the request, how many tokens fell into
each recognized class, whether the number reflects a single request or a
coarser aggregate, and whether the source could be read at all — never a
silent zero standing in for a measurement that was never taken.

## Requirements

1. A usage record SHALL carry exactly one of two record kinds: `captured`,
   for a unit of model consumption a source successfully yielded, or
   `uncaptured`, for a unit a source could not yield. No third or implicit
   kind SHALL exist, and no record SHALL omit the kind.
2. A `captured` record SHALL carry five normalized token-count fields — net
   input, cache read, cache write, output, and reasoning — each present
   with a non-negative integer value. A class the underlying request
   genuinely did not exercise SHALL be recorded as zero. Only the record's
   `kind` field SHALL distinguish that legitimate zero from an unread
   source; no separate marker on the count itself SHALL serve that
   purpose.
3. The net-input class SHALL exclude any token count the source vendor
   already reports as cached. A vendor reporting one combined input figure
   that includes its cached-token count SHALL have its net-input value
   derived to exclude that overlap rather than copied verbatim from the
   vendor's combined figure.
4. The cache-write class SHALL preserve any tier distinction a source
   vendor exposes (for example a short-lived versus a long-lived cache
   write) as a structured sub-value rather than collapsing distinct tiers
   into one summed number. A source vendor exposing only a single,
   untiered cache-write figure SHALL populate that figure as the class's
   sole tier, never invented or artificially split.
5. Every `captured` record SHALL carry a raw sub-object holding the source
   vendor's original field names and their original values, unaltered,
   alongside the five normalized classes, so the normalization SHALL
   remain independently auditable and recomputable from the same record.
6. An `uncaptured` record SHALL carry raw provenance describing what was
   attempted and why it failed, and SHALL NOT carry any of the five
   token-count classes populated with a zero standing in for an unmeasured
   value. A record whose source could not be read SHALL always take the
   `uncaptured` kind; there SHALL be no permitted path that represents a
   failed read as a zero-valued `captured` record.
7. Every record SHALL declare a `fidelity` that is exactly one of
   `per-request`, `run-total`, or `session-cumulative`. No default value
   SHALL be assumed when the field is absent; an absent `fidelity` SHALL
   itself be treated as non-conforming.
8. A record's model identifier SHALL be the literal string the source CLI
   reports for that request, unresolved and unmapped to any canonical or
   vendor-neutral identifier, including when that literal string is a
   placeholder such as an unresolved automatic-selection marker.
9. Every record, `captured` or `uncaptured`, SHALL carry an idempotency key
   that uniquely identifies the captured or attempted unit within its
   source, so reading the same underlying source data more than once SHALL
   NOT yield two records recognized as distinct. When a source offers no
   natural identifier for a unit, the record SHALL still carry a derived
   idempotency key sufficient to satisfy this guarantee; deriving it is a
   concern of the capture seam, not of this contract.
10. Every record SHALL carry capture provenance naming the source CLI, the
    source CLI's version, the capture channel the record came from, and a
    format fingerprint of the source data at capture time.
11. Every record SHALL carry an identity block naming the session the
    request belongs to, the parent session when the request originates
    from a subordinate agent (absent or null when the session has no
    parent), an agent identifier or name (absent or null only when the
    record originates from the CLI's own top-level driver rather than a
    named agent), and the project root the session ran against.
12. Every record SHALL carry two distinct timing values: the instant the
    request the record describes occurred, and the instant the record
    itself was captured. The two SHALL be permitted to differ, and neither
    SHALL be derived from the other.
13. Every record SHALL declare the schema version it conforms to. The
    contract SHALL define a rule for how a consumer reads a record written
    under an earlier schema version, and a rule for how a consumer
    encountering a record declaring a version it does not recognize SHALL
    behave, at minimum refusing to guess at the meaning of an unrecognized
    field.
14. The contract SHALL define an optional attribution block — a CrewRig
    task-handoff key, or an external work-tracking asset reference naming
    its own kind (forge issue, Jira key, shared file) — such that a record
    without an attribution block and a record with one are both
    conforming, and such that a future addition of a new external-asset
    kind to that block SHALL NOT require a breaking schema-version change.
15. The record SHALL NOT carry a computed price field or any monetary
    value. A price is a separate, derived, independently timestamped fact
    a different seam of the epic owns; a record carrying one SHALL be
    treated as non-conforming.
16. The repository SHALL hold at least one sample record for each of the
    four supported CLIs, each exercising the fidelity and token-class
    shape that CLI's capture is expected to produce, plus at least one
    `uncaptured` sample.
17. The repository SHALL hold a versioned schema artifact against which
    every sample record can be mechanically validated, and a
    continuous-integration check SHALL run that validation and fail when
    any sample does not conform.
18. The same continuous-integration check SHALL also validate deliberately
    non-conforming counter-examples — at minimum a record missing one of
    the five token-count classes, and a record carrying a zero-valued
    token class in place of the `uncaptured` kind — and SHALL fail if the
    schema accepts any of them.
19. The implementation realizing this specification SHALL include an
    architecture decision record stating the invariants named in
    requirements 8 (literal model identifier), 7 (typed fidelity), and 6
    (no zero standing in for an unmeasured value). That record SHALL be
    authored as part of the implementation, never as part of this
    specification; an implementation shipped without it is non-conforming.
20. Once a usage record has been written, its normative fields SHALL NOT be
    mutated in place. A correction to a previously written record SHALL
    take the form of a new record, never an edit of the old one.
21. A record whose raw sub-object has been truncated, elided, or moved out of
    the record SHALL be distinguishable from a record carrying the complete
    raw payload, so that the auditability requirement 5 grants degrades
    visibly rather than silently.
22. A record's own identifier SHALL be derivable from its idempotency key
    together with its identity block, so that capturing the same source
    unit twice yields the same record identifier and no consumer needs a
    lookup table to recognize a re-capture.

## Scenarios

**Scenario:** Every CLI's sample record validates

```text
Given the repository holds one sample usage record for each of the four
      supported CLIs and the versioned schema artifact
When  the continuous-integration validation check runs against every
      sample
Then  each sample record validates against the schema with zero errors
```

**Scenario:** A mutant missing one token class is rejected

```text
Given a captured-kind sample record that omits its reasoning token-count
      field
When  the validation check runs that mutant against the schema
Then  the schema rejects the mutant, and the continuous-integration check
      fails because it does not
```

**Scenario:** A zero standing in for an unreadable source is rejected

```text
Given a source file the capturing step could not open
When  a record is constructed for that failed read as a captured-kind
      record with every token class set to zero
Then  the schema rejects that record, because a failed read is only
      representable as an uncaptured-kind record carrying raw provenance
```

**Scenario:** Gemini net-input derivation with raw preserved

```text
Given a Gemini CLI source record reporting one combined input token count
      that includes its cached-token count
When  the sample usage record is built from that source
Then  the record's net-input class equals the combined count minus the
      cached count, and the raw sub-object still carries the source's
      original combined figure unaltered
```

**Scenario:** An Antigravity session-cumulative row is typed and flags a mixed rollup

```text
Given an Antigravity CLI sample record declared at session-cumulative
      fidelity, alongside per-request records from another CLI for the
      same reporting period
When  a downstream aggregation combines records across both fidelities
Then  a rollup step that checks the fidelity field before aggregating
      flags the combination as mixed-fidelity and does not silently sum
      the cumulative counter together with the per-request counts
```

**Scenario:** A duplicate idempotency key on re-read is not counted twice

```text
Given a source file already processed once, producing one record with
      idempotency key K
When  the same source file is read again, for example after the capturing
      step is re-run over history already on disk
Then  the reprocessing recognizes the previously captured unit by its
      idempotency key K and does not produce a second record recognized
      as distinct for that same unit
```

**Scenario:** Attribution is optional; a price field is not

```text
Given three candidate records: one with no attribution block, one with a
      conforming attribution block, and one carrying a computed price
      field
When  each candidate is validated against the schema
Then  the record with no attribution block validates, the record with a
      conforming attribution block validates, and the record carrying a
      price field is rejected
```

**Scenario:** A truncated raw payload stays distinguishable from a complete one

```text
Given two captured-kind records for two different requests, one carrying
      the source vendor's complete raw fields and one whose raw sub-object
      was truncated downstream because of its size
When  a consumer inspects both records
Then  the consumer can tell from the record itself which raw sub-object is
      complete and which is not, without comparing against the source
```

## Out of scope

- Capture adapters and their triggers per CLI — seam (b), issue #1169.
- Storage layout and backends, MemPalace or file-system — seam (c), issue
  #1170.
- The size cap, truncation rule, or externalization policy for an oversized
  raw sub-object — seam (c), issue #1170; this contract only requires the
  outcome to stay visible (requirement 21).
- Attribution semantics and rollup rules beyond the fidelity field's
  ability to make a mismatch detectable — seam (d), issue #1171.
- Pricing computation, model-id-to-vendor-neutral mapping, and currency
  conversion — seam (e), issue #1172.
- The dashboard and tracked-asset navigation surface — seam (f), issue
  #1173.
- The text of the architecture decision record mandated by requirement 19
  — authored during the implementation of this specification, not in this
  spec-PR (the one-file rule).
- Any change to the behavior, output format, or configuration surface of
  the four CLIs themselves.

## Open questions

- [GROUNDING:] No `*.schema.json` file or per-CLI fixture-sample
  convention exists on `main` today. The repository's test surface is
  exclusively `scripts/tests/test-*.sh` scripts wired through the
  ADR-0014 registration guard, with ad hoc fixtures under
  `scripts/tests/fixtures/`; no schema-validation toolchain is a CI
  dependency today, and ADR-0012 explicitly rejected introducing a JSON
  Schema validator for an unrelated contract on that same ground. Back-fill
  responsibility: the implementation PR realizing this specification
  SHALL introduce, in the same diff, both the schema artifact's canonical
  location and a `scripts/tests/test-*.sh` validator wired per ADR-0014,
  alongside the four CLI samples required by requirement 16. No separate
  migration PR is scoped for this back-fill.

## Record shape (informative)

This section is informative and non-normative — a starting point for the
implementation, not a constraint any requirement above depends on.

| Field | Type | Required | Notes |
|---|---|---|---|
| `schemaVersion` | string (semver) | always | Requirement 13. |
| `kind` | enum: `captured` \| `uncaptured` | always | Requirement 1. |
| `fidelity` | enum: `per-request` \| `run-total` \| `session-cumulative` | always | Requirement 7; no default. |
| `recordId` | string | always | Requirement 22; derived from `idempotencyKey` and the identity block. |
| `idempotencyKey` | string | always | Requirement 9; e.g. Claude Code `requestId`, Copilot `assistant_usage_events.id`, Gemini message id — examples of the key's role, not the derivation mechanism. |
| `provenance.cli` | enum: `claude-code` \| `gemini-cli` \| `copilot-cli` \| `antigravity` | always | Requirement 10. |
| `provenance.cliVersion` | string | always | Requirement 10. |
| `provenance.captureChannel` | string | always | Requirement 10; e.g. own-record tail, headless envelope, statusline shim. |
| `provenance.formatFingerprint` | string | always | Requirement 10. |
| `identity.sessionId` | string | always | Requirement 11. |
| `identity.parentSessionId` | string \| null | conditional | Null when the session has no parent. |
| `identity.agentId` | string \| null | conditional | Null for the CLI's own top-level driver. |
| `identity.projectRoot` | string | always | Requirement 11. |
| `timing.requestInstant` | timestamp | always | Requirement 12. |
| `timing.captureInstant` | timestamp | always | Requirement 12. |
| `modelId` | string | `captured` only | Requirement 8; verbatim, including a literal `"auto"`. |
| `tokens.netInput` | integer ≥ 0 | `captured` only | Requirements 2, 3. |
| `tokens.cacheRead` | integer ≥ 0 | `captured` only | Requirement 2. |
| `tokens.cacheWrite` | integer ≥ 0, or a per-tier map | `captured` only | Requirements 2, 4. |
| `tokens.output` | integer ≥ 0 | `captured` only | Requirement 2. |
| `tokens.reasoning` | integer ≥ 0 | `captured` only | Requirement 2. |
| `raw` | object | `captured` only | Requirement 5; vendor's original fields verbatim. |
| `uncapturedReason` | string | `uncaptured` only | Requirement 6. |
| `attribution.taskHandoffKey` | string | optional | Requirement 14. |
| `attribution.externalAsset` | object `{kind, ref}` | optional | Requirement 14; `kind` ∈ `{forge-issue, jira-key, shared-file}`. |
| `price` | — | forbidden | Requirement 15; never present. |
