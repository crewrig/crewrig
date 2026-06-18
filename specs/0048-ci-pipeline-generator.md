---
id: "0048"
slug: ci-pipeline-generator
status: draft
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 372
version: 1.0.0
---

# CI pipeline generator

## Intent

The reference contract describes the project's continuous-integration
capabilities once, but an adopter on GitLab still has no pipeline to run.
After this change, the portable subset of a target engine's pipeline is
derived from the reference contract — each portable capability becomes a
job that runs the capability's own command wrapped in that engine's setup
boilerplate — and the GitLab pipeline is produced this way; the existing
GitHub Actions workflows stay hand-authored and are only described by the
contract, not regenerated. A verification mode fails when the committed
pipeline no longer matches what the contract would produce, so the
generated pipeline can never drift silently from its source.

## Requirements

1. The system SHALL derive, from the reference contract, a target engine's
   pipeline for every portable capability, composing the capability's
   declared invocation command with that engine's setup boilerplate.
2. The system SHALL produce the GitLab pipeline for the portable subset of
   capabilities.
3. For every portable capability, the derived job SHALL be identifiable by
   the capability's traceability identifier.
4. The system SHALL leave engine-specific capabilities hand-authored and
   SHALL NOT emit a non-functional placeholder for them in any generated
   pipeline.
5. The system SHALL NOT regenerate the existing GitHub Actions workflows;
   those remain hand-authored, with the contract describing them for the
   divergence verification owned by a separate capability.
6. The system SHALL provide a verification mode that fails with a non-zero
   result when the committed GitLab pipeline differs from what deriving
   from the current contract produces.
7. The verification mode SHALL be runnable within the project's own
   continuous-integration checks.

## Scenarios

**Scenario:** A portable capability is derived into a GitLab job

```text
Given the contract declares a portable capability with its invocation
      command and a trigger
When the GitLab pipeline is derived from the contract
Then the GitLab pipeline contains a job identifiable by the capability's
     traceability identifier, running that command wrapped in the engine's
     setup boilerplate, under an equivalent trigger
```

**Scenario:** A drifted committed pipeline is rejected

```text
Given the committed GitLab pipeline no longer matches what deriving from
      the current contract produces
When the verification mode runs
Then it fails with a non-zero result naming the divergence
```

**Scenario:** An engine-specific capability is not derived

```text
Given a capability is marked engine-specific
When the pipeline is derived from the contract
Then no generated job is emitted for it — it remains hand-authored — and no
     non-functional placeholder is produced
```

## Out of scope

- The three-way divergence harness across reference, GitHub Actions, and
  GitLab (and engine-to-engine parity) — that is sub-spec C (`#373`). This
  spec covers only the generator's own verification of its GitLab output
  against the contract.
- Regenerating the GitHub Actions workflows — deliberately excluded
  (Requirement 5); they stay hand-authored and are verified, not produced.
- Executing the GitLab pipeline on a live GitLab instance — the canonical
  forge remains GitHub; the GitLab pipeline is produced and
  divergence-checked in this repository, not run here.
- The GitLab knowledge skill and the configuration/parity agents — that is
  sub-spec D (`#374`).
- The exact generator command name, extraction mechanics, and internal
  output shape — design choices for this sub-spec's PLAN stage.
- Realizing spec 0047 delta-01 (adding each portable capability's
  invocation command to the contract and its format doc): this
  qualification is already merged; its implementation is absorbed by this
  sub-spec's implementation-PR per the delta-spec cumulative rule, as the
  prerequisite the generator consumes.

## Open questions

- _None. Generation scope (GitLab generated; GitHub Actions hand-authored
  and verified, not regenerated), the per-capability command composition,
  and the fail-closed verification mode are all resolved._
