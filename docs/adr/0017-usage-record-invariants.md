# ADR 0017 — Usage record invariants

<!-- crewrig-doc: section=architecture-adr nav_order=170 published=true title="ADR 0017 — Usage record invariants" -->

**Status:** Accepted — 2026-09-17 (spec 0205, issue #1168; owner-validated 2026-09-17 after developer and tester review)

This ADR governs one stage of the usage feature; the [usage architecture overview](../usage-overview.md) shows how the stages fit together.

## Framing

- **Goal.** Establish three non-negotiable invariants in the usage record contract so that downstream consumers can reason about the shape without ambiguity: model identifiers remain literal, fidelity is always typed, and an unmeasured source is never represented as a zero-valued record.
- **Constraints.** The contract must be machine-enforceable (a JSON Schema that rejects violations). The invariants must hold across all four CLIs despite their varied measurement channels and timing models. Subagents and parent-session linkage are already in the `identity` block and must remain there, not migrate to the record envelope.
- **Non-goals.** Deciding which capture seam (a, b, c in #1169) will apply these invariants — that is a concern of each capture seam's specification. This ADR names the invariants and explains why they matter; the derived specs implement them.

## Context

### Spec 0205 and the token-consumption epic

Spec 0205 defines the usage record — a versioned contract every component of the token-consumption epic (issues #1166–#1170) will read or write. One specification alone does not suffice: the contract's prose requirements cover the shape, but not all of its structural properties are obviously enforced by a schema and none of its philosophical foundations are documented.

This ADR addresses the three invariants that emerged from the specification and the evidence gathered in IDEA #1167:

1. **Literal model identifiers (R8):** The model id must be the exact string the source CLI reports, including placeholders like `"auto"`.
2. **Typed fidelity (R7):** Fidelity must always be explicitly set; no default is assumed.
3. **Uncaptured over zero (R6):** An unmeasured source is never represented as a zero-valued `captured` record; it must be `uncaptured`.

### Why each invariant matters

#### R8 — Literal model identifiers

The evidence from IDEA #1167 showed that all four CLIs report a model identifier in their on-disk session records, but with varying names and semantic relationships:

- **Claude Code:** `message.model` is the resolved model (e.g., `"claude-sonnet-5"`).
- **Gemini CLI:** `model` is the resolved model; a `model_change` event marks mid-session switches.
- **Copilot CLI:** `model` column in the `assistant_usage_events` table reflects the resolved model per call.
- **Antigravity CLI:** Not captured by own-record tailing (protobuf opaqueness).

A temptation arises: normalize all model strings to a canonical form, strip effort suffixes (e.g., `"gemini-3.8-flash-medium"` → `"gemini-3.8-flash"`), or map `"auto"` to whichever model actually served the call.

**This ADR rejects normalization.** The literal string is the record of truth because:

- **It is what the source reported.** A normalization layer introduces a trust boundary. If the mapping goes wrong, the record can no longer reproduce the original claim.
- **It is sufficient for pricing.** Pricing downstream can compute its own mapping; a record carrying a canonical id loses the information needed to audit a disagreement.
- **Placeholders matter.** When a user pins a model explicitly, the string `"claude-sonnet-5"` tells one story; when the CLI auto-selected it on their behalf, the literal `"auto"` preserves that decision context, even if later audit resolves `"auto"` to the same model id.

The invariant is: **the model identifier is stored exactly as the CLI reports it, never remapped or normalized.**

#### R7 — Typed fidelity

The evidence in IDEA #1167 showed three different measurement granularities across capture strategies:

- **Own-record tailing (S2):** Per-request granularity from the on-disk session logs — one record per API call.
- **OpenTelemetry export (S1):** Per-request granularity from vendor telemetry spans, but lossy under debounce (Claude Code debounces status-line updates at 300 ms).
- **Statusline shim (S3):** Cumulative within a session — the payload reflects the current context window state, not a discrete call.

A downstream tool consuming these records needs to know what each figure represents. If `fidelity` defaulted to `"per-request"` when absent, a record from the statusline shim would be silently miscounted — that call would appear to be a single request when it is actually a running total.

The invariant is: **every record declares a typed fidelity (`per-request`, `run-total`, or `session-cumulative`) with no default assumed when absent.** A record missing the field is non-conforming.

#### R6 — Uncaptured over zero

When a source cannot be read — a transcript rotated before the capture step could open it, a session that crashed before writing a particular state file — the question arises: how do you represent a failed read?

One path: emit a `captured` record with all token classes set to zero, recording the attempt even though the measurement failed.

Another path: emit an `uncaptured` record carrying a reason, acknowledging that no measurement is available.

Spec 0205 and IDEA #1167 both converged on the second path. The reasoning:

- **A zero is ambiguous.** If a downstream tool sees a record with `netInput: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0`, it cannot tell whether the request genuinely consumed nothing (e.g., a metadata-only call that never reached the model) or whether the measurement failed. The `kind` field alone must make that distinction clear — and a `captured` kind with five zeros can only be a failed read, not a legitimate measurement.
- **The schema enforces it.** A `captured` record's schema requires that at least one of its five token classes be non-zero. This simple, machine-enforceable constraint prevents the ambiguity from ever arising.

The invariant is: **an unread source is never represented as a zero-valued `captured` record; it must take the `uncaptured` kind and carry a reason.**

## Decision

Adopt the three invariants as non-negotiable properties of the usage record contract:

1. **R8 (literal model id):** Store the model identifier exactly as the source CLI reports it, unmapped and unnormalized, including placeholders.
2. **R7 (typed fidelity):** Require `fidelity` to be explicitly set on every record; no default is assumed when absent.
3. **R6 (uncaptured over zero):** Enforce via schema: a `captured` record must have at least one non-zero token class; an unread source must be `uncaptured`.

Each invariant is documented in the usage record format guide (`docs/usage-record-format.md`) and enforced by the JSON Schema at `schemas/usage-record/v1.schema.json`.

## Consequences

### Positive

- **Unambiguous by construction.** A downstream tool can determine the measurement granularity, the model that was asked for, and whether the source was successfully read — all without guessing or consulting a separate lookup table.
- **Auditable normalization.** If a tool needs a canonical model id, it can compute it from the literal string in the record and record its own mapping table separately, preserving the audit trail.
- **Resilient to upstream changes.** If a CLI changes its model-naming convention or adds a new placeholder string, records conforming to this contract remain meaningful without schema updates.
- **Interoperability.** A tool consuming records from multiple capture seams can apply consistent logic — treat the fidelity as meaningful, treat the model as literal, and treat zeros as impossible in `captured` records.

### Negative / trade-offs

- **Downstream normalization burden.** Any tool that needs canonical model identifiers must maintain its own mapping table. This is intentional — pushing the burden onto consumers rather than baking it into the contract — but it is still a burden.
- **Strictness can be surprising.** A developer expecting `fidelity` to default to `"per-request"` will encounter a schema rejection and need to update their record. This is a feature, not a bug, but it raises the bar for record-producing code.
- **Placeholder complexity.** A tool analyzing records across sessions must recognize that `"auto"` may resolve to different models on different days or machines. The literal value is preserved for audit, but not automatically resolved.

### Blast radius

- **In scope:** Every capture seam (b, c, d; #1169–#1171) must enforce these invariants when constructing records.
- **In scope:** Any tool importing legacy usage data must map it to this contract or explicitly reject it.
- **Out of scope:** Downstream pricing, model-grouping, or comparative-analysis tools — their job is to consume conforming records and apply their own rules.

## Alternatives considered

### A. Normalize model identifiers at capture time

- **Pro:** Downstream tools do not need their own mapping table.
- **Con:** Normalization is lossy — if the mapping goes wrong, the record can no longer reproduce the original claim. Placeholders like `"auto"` become indistinguishable from resolved ids. A norm that is wrong is worse than no norm.
- **Verdict:** Rejected. The cost of reversibility — storing the literal and losing the canonical mapping — is lower than the cost of irreversibility.

### B. Default fidelity to `per-request`

- **Pro:** Simpler for record producers; one fewer required field.
- **Con:** A record from the statusline shim (which aggregates within a session) would be silently miscounted as a discrete call. The contract would be unsafe by default.
- **Verdict:** Rejected. Fidelity is a safety-critical field; defaulting it is a foot-gun.

### C. Represent failed reads as zero-valued captured records

- **Pro:** Same structure for every record, no special case for `uncaptured`.
- **Con:** Downstream tools cannot distinguish a legitimate zero (a call that consumed nothing) from a failed read. The `kind` field becomes the only disambiguator, and the contract becomes unsafe if a producer forgets to set it.
- **Verdict:** Rejected. Making zeros impossible in `captured` records is the minimal, sufficient constraint to eliminate the ambiguity.

### D. Require explicit `modelId` / `fidelity` / `kind` at the record level, with a schema-level default for backward compatibility

- **Pro:** Eases migration of legacy records.
- **Con:** A default is invisible — old records slipping through would be miscounted or misdirected. The contract is weakened by pretending backward compatibility is possible when the meaning of a field has changed.
- **Verdict:** Rejected in favor of explicit rejection. Legacy data has its own migration spec; the contract itself is cleaner without a default.

### Readings recorded for downstream seams

#### JSON Schema validation and ADR-0012's narrowed scope

ADR-0012 rejected JSON Schema as a reference validator ("introduces a validator toolchain absent from CI today, against the YAML/`yq` decision"), scoping that decision to the CI-reference job, which relies on `yq` for validation. This ADR's usage record contract runs a different CI job that invokes a different tool: `node@22` is already present in the CI environment, and `ajv` (the reference JSON Schema validator for Node.js) is installed as an explicit devDependency. The narrower scope of ADR-0012's rejection — tied to the `yq`-only reference job — does not transfer to this contract.

#### R5 and R21: raw presence and status visibility

R5 specifies that the `raw` sub-object is the default obligation at capture: every record carries its source vendor's verbatim payload when `rawStatus: "complete"`. R21 names the downstream degradations: `rawStatus` values of `truncated`, `externalized`, and `elided` represent post-capture transformations. The schema permits a `captured` record without a `raw` object only when `rawStatus` is `externalized` (with a corresponding `rawRef` to the externalized payload) or `elided` (when the payload is dropped entirely). This design allows downstream seam (c, #1170) to apply size-management and externalization policies without breaking the schema contract.

#### Capture-time rawStatus obligation

Every record at the point of capture carries `rawStatus: "complete"` and the full `raw` block. The states `truncated`, `externalized`, and `elided` are only reachable through a post-capture transformation — a storage decision, compression, or audit policy applied by a downstream system. A consumer seeing a record with `rawStatus` other than `complete` knows the transformation has already occurred.

## References

- **Spec 0205** (issue #1168): Usage record model — the CLI-agnostic contract for token-consumption records.
- **IDEA #1167** (issue #1167): Composition of capture strategies for usage records. Evidence gathered on model naming, fidelity variations, and measurement granularity across four CLIs.
- **Issue #1169:** Capture seam (b) — own-record tailing.
- **Issue #1170:** Capture seam (c) — storage and transformation seam (raw truncation, externalization, elision).
- **Issue #1171:** Capture seam (d) — integration and presentation.
