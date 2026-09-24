# Usage record format

<!-- crewrig-doc: section=reference nav_order=120 published=true title="Usage record format" -->

The usage record is the versioned contract for a unit of model-token consumption captured from a CLI source. A record carries exactly one of two kinds — `captured` for a unit a source successfully yielded, or `uncaptured` for a unit a source could not yield — and declares the schema version it conforms to. This page documents the field structure, the reading rules for older schema versions, and the invariants that govern model identifiers, fidelity typing, and the absence of zero-standing-in-for-unmeasured-value.

This page is one stage of the usage feature; the [usage architecture overview](usage-overview.md) shows how the stages fit together.

## Field reference

| Field | Type | Required | Description |
|---|---|---|---|
| `schemaVersion` | string (const: `"1.0.0"`) | Yes | The schema version this record conforms to. **R13:** A v2 of this contract is a new sibling file (`v2.schema.json`), never an edit of v1. A consumer refuses a record declaring a version it does not recognize rather than guessing at an unrecognized field. Consumers reading an older version must use that version's own schema file; unrecognized versions are refused outright, never coerced. |
| `kind` | enum | Yes | **R1:** Exactly one of `captured` (unit successfully yielded by the source) or `uncaptured` (unit the source could not yield). No third or implicit kind exists. |
| `fidelity` | enum | Yes | **R7:** Exactly one of `per-request`, `run-total`, or `session-cumulative`. No default is assumed when absent; an absent `fidelity` is non-conforming. |
| `recordId` | string (64 hex chars) | Yes | **R22:** Derivable as `sha256(identity.sessionId + U+001F + idempotencyKey)` in lowercase hex. A re-capture of the same source unit yields the same `recordId`. See *Derivation* below. |
| `idempotencyKey` | string | Yes | **R9:** Uniquely identifies the captured or attempted unit within its source. Reading the same underlying source data more than once does not yield two records recognized as distinct. |
| `corrects` | string (64 hex chars) | No | **R20:** Optional. Names the `recordId` this record corrects. A correction to a previously written record is always a new record; normative fields of the old record are never mutated in place. |
| `provenance` | object | Yes | **R10:** Capture provenance naming the source CLI, its version, the capture channel, and a format fingerprint of the source data at capture time. Required fields: `cli`, `cliVersion`, `captureChannel`, `formatFingerprint`. |
| `identity` | object | Yes | **R11:** Session identity. Required fields: `sessionId`, `projectRoot`. Optional fields: `parentSessionId` (null when absent), `agentId` (null when the record originates from the CLI's own top-level driver). |
| `timing` | object | Yes | **R12:** Two distinct timing values: `requestInstant` (when the request occurred) and `captureInstant` (when the record was captured). Both are ISO 8601 date-time strings; neither is derived from the other. |
| `modelId` | string | Conditional | **Captured only.** **R8:** The literal string the source CLI reports for this request, unresolved and unmapped to any canonical identifier, including placeholders such as `"auto"`. |
| `interaction` | enum | Conditional | **Captured only.** **R23:** Exactly one of `user-turn` (request whose newest input was a user message), `tool-continuation` (request whose newest input was tool results), `agent-internal` (request the CLI issued for its own purposes), or `unknown` (source exposes no signal to decide). The vendor's original stop or finish reason, when reported, is preserved in the `raw` block. |
| `tokens` | object | Conditional | **Captured only.** **R2/R6:** Five normalized, non-negative token-count classes: `netInput`, `cacheRead`, `cacheWrite`, `output`, `reasoning`. `cacheWrite` may be a single integer or an object mapping tier names to integers. A `captured` record whose all five classes are zero is rejected by the schema, because such a shape can only represent an unread source, which R6 requires to be `uncaptured` instead. |
| `raw` | object | Conditional | **Captured only.** **R5:** The source vendor's original field names and values, unaltered, including its stop/finish reason. Deliberately left open (no `additionalProperties` constraint) because it is the vendor's verbatim payload. **R15 note:** A vendor cost figure inside `raw` is not a "computed price" under R15; `raw` is audit trail, not pricing. |
| `rawStatus` | enum | Conditional | **Captured only.** **R21:** Whether `raw` is present in full (`complete`), truncated (`truncated`), externalized (`externalized`, see `rawRef`), or dropped (`elided`). **R5/v2-F3:** `complete` is the capture-time obligation — a record with `rawStatus` other than `complete` only appears after capture, under a post-capture transformation owned by downstream seam (c, #1170). |
| `rawRef` | string | Conditional | **Captured only, with `rawStatus` == `externalized`.** A reference to the externalized raw payload. Not carried with any other `rawStatus` value. |
| `uncapturedReason` | string | **Uncaptured only.** | **R6:** Raw provenance describing what was attempted and why it failed. |
| `attribution` | object | No | **R14:** Optional. A CrewRig task-handoff key and/or an external work-tracking asset reference. If present, contains `taskHandoffKey` (string) and/or `externalAsset` (object with required `kind` and `ref` fields). |

## Derivation (R22)

The `recordId` is deterministic from the idempotency key and identity block, so re-capturing the same source unit yields the same identifier. Compute it as:

```javascript
sha256(identity.sessionId + U+001F + idempotencyKey)
```

In lowercase hex. The **U+001F** separator is the ASCII unit separator character (decimal 31, hex 1F). A consumer can verify a record's identifier by recomputing it on the sample:

```bash
node -e "const crypto = require('crypto'); const s = 'claude-code-session-20260915-001'; const k = 'req_01HXAMPLE0000000000000001'; console.log(crypto.createHash('sha256').update(s + String.fromCharCode(0x1F) + k).digest('hex'))"
```

Fields excluded from the derivation (`parentSessionId`, `agentId`, `projectRoot`, `provenance.*`) are nullable, mutable, or machine-dependent — the inputs to the hash must remain stable across re-capture.

## Record kinds

### Captured

A `captured` record represents a unit of model consumption the source successfully yielded. It carries:

- Five token-count classes (`tokens` block): `netInput`, `cacheRead`, `cacheWrite`, `output`, `reasoning`
- The source vendor's original payload (`raw` block)
- A `rawStatus` stating whether `raw` is complete, truncated, externalized, or elided
- The model identifier as reported by the source (`modelId`)
- An interaction class (`interaction`)

**R2/R6 token constraint:** A `captured` record's five token classes may each be zero individually (a class the request genuinely did not exercise), but not all five at once. A record whose all five classes are zero represents an unread source and must be represented as an `uncaptured` record instead. This constraint is enforced by the schema.

### Uncaptured

An `uncaptured` record represents a unit the source could not yield — a failed read, an unavailable transcript, a missing source file. It carries only:

- The `uncapturedReason` string describing the failure
- Standard headers (`schemaVersion`, `kind`, `fidelity`, `recordId`, `idempotencyKey`, `provenance`, `identity`, `timing`)

It does not carry `tokens`, `raw`, `rawStatus`, `modelId`, or `interaction`.

## Raw status states

| State | Meaning | Accompanies | When it appears | Ownership |
|---|---|---|---|---|
| `complete` | Raw payload is present in full | `raw` present, `rawRef` absent | At capture time, always | R5 — capture seam obligation |
| `truncated` | Raw payload is present but truncated | `raw` present (partial), `rawRef` absent | After capture only | Downstream seam (c, #1170) |
| `externalized` | Raw payload moved out-of-record | `raw` absent, `rawRef` present | After capture only | Downstream seam (c, #1170) |
| `elided` | Raw payload dropped entirely | `raw` absent, `rawRef` absent | After capture only | Downstream seam (c, #1170) |

**R5 obligation:** Every record at the point of capture carries `rawStatus: "complete"` and the full `raw` block. The states `truncated`, `externalized`, and `elided` are only reachable through a post-capture transformation — a storage decision, compression, or audit policy applied by a downstream system. A consumer seeing a record with `rawStatus` other than `complete` knows the transformation has already occurred.

## External asset kinds (R14)

The `attribution.externalAsset.kind` field names the class of external work-tracking reference. The registry is open — adding a new kind is a MINOR schema version bump, never a breaking change.

Current kinds:

| Kind | Meaning | Example ref |
|---|---|---|
| `forge-issue` | A GitHub/GitLab/Gitea issue | `crewrig/crewrig#1168` |
| `jira-key` | A Jira issue key | `PROJ-1234` |
| `shared-file` | A shared file or document reference | `https://drive.google.com/file/d/…` |

## Interaction classes (R23)

The `interaction` field (captured records only) names what the request served. Classification is declared by the capture seam (b, #1169), not inferred from token magnitudes or timing.

| Class | Meaning |
|---|---|
| `user-turn` | Request whose newest input was a user message |
| `tool-continuation` | Request whose newest input was tool results returned to the model |
| `agent-internal` | Request the CLI issued for its own purposes (e.g., context compaction, title generation) |
| `unknown` | Source exposes no signal that decides the class; never guessed |

The source vendor's original stop reason or finish reason, when reported, is always preserved in the `raw` block.

## Append-only corrections (R20)

Once a usage record has been written, its normative fields are not mutated in place. A correction takes the form of a new record whose `corrects` field names the `recordId` of the superseded record.

```json
{
  "recordId": "841100d8ff5216fb1656592564deb8109e0e8f10c156d0f6aad5a1bb76ddae59",
  "idempotencyKey": "req_01HXAMPLE0000000000000001-correction-01",
  "corrects": "e6b0fcca737a7f332eec7d720cf1ade116638ea3b47084618ed9c267f1df6aeb",
  ...
}
```

A consumer that encounters both the original and its correction must keep both records and apply the correction as a logical supersession — the newer record (`captureInstant` later) logically replaces the older, but the old record is never deleted. This audit-trail discipline ensures that every change is traceable and no data is lost.

## Fidelity declarations

The `fidelity` field captures the granularity of measurement:

- **`per-request`:** Each record represents one API call to the model.
- **`run-total`:** A record represents the aggregated consumption of a single execution of a tool or script.
- **`session-cumulative`:** A record represents the cumulative consumption of an entire CLI session up to that point.

Mixing fidelities in a dataset — for example, some records at `per-request` and others at `session-cumulative` from the same session — requires explicit handling by downstream tools. The fidelity label allows a consumer to flag such mixes rather than silently miscounting.
