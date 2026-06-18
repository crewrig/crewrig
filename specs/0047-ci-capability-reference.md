---
id: "0047"
slug: ci-capability-reference
status: implemented
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 371
version: 1.0.0
---

# CI capability reference contract

## Intent

The realization of multi-engine CI/CD parity needs one agreed description
of what the project's continuous-integration actually does, independent of
any engine, before either engine's pipeline can be derived or checked.
After this change, every continuous-integration capability the project
relies on is enumerated once in a single platform-neutral reference — one
entry per job, each with a stable identity, the conditions that trigger it
drawn from a fixed neutral vocabulary, and a mark saying whether it is
portable across engines or specific to one — accompanied by a normative
description of the reference's own shape so that a candidate reference can
be judged valid or invalid and a further engine can be added later by
describing only its mapping.

## Requirements

1. The reference SHALL enumerate each continuous-integration capability of
   the project as a single unit at the granularity of one job, identified
   by a stable identifier that is unique across the reference.
2. Each capability SHALL declare its triggering conditions drawn from a
   fixed neutral vocabulary comprising: push, pull-or-merge request, tag,
   scheduled, and manual.
3. The neutral triggering vocabulary SHALL admit the portable filters that
   qualify a trigger — branch set, path set, and tag pattern — as
   normalized attributes of that trigger.
4. Each capability SHALL carry a mark stating whether it is portable across
   engines or specific to a single engine.
5. Every capability marked engine-specific SHALL carry an exception that
   names the engine and states evidence that the mechanism has no faithful
   equivalent on the other supported engines; a bot-mention trigger (an
   issue or review comment) SHALL be treated as engine-specific, never as
   portable.
6. Each capability SHALL expose a stable traceability identifier by which a
   job in any engine's pipeline can be attributed unambiguously to exactly
   one capability.
7. The reference SHALL be accompanied by a normative description of its own
   shape, against which a candidate reference can be judged valid, and which
   allows a further engine to be supported by describing only that engine's
   mapping of the capabilities — without altering any capability definition.
8. The reference SHALL be able to describe every portable
   continuous-integration capability currently present in the project's
   pipeline.
9. The reference and its format description SHALL ship as part of the
   framework's core layer delivered to adopting organisations.

## Scenarios

**Scenario:** A portable capability is described and resolves

```text
Given the reference enumerates a portable capability with a stable
      identifier and a trigger taken from the neutral vocabulary
When the reference is judged against its format description
Then the capability is accepted as valid, its identifier and trigger
     resolve, and any pipeline job bearing that traceability identifier
     attributes to exactly that capability
```

**Scenario:** A trigger outside the neutral vocabulary is rejected

```text
Given a capability declares a triggering condition that is not part of the
      neutral vocabulary
When the reference is judged against its format description
Then it is rejected, naming the unrecognized trigger
```

**Scenario:** An engine-specific capability without evidence is rejected

```text
Given a capability is marked engine-specific but carries no exception or no
      evidence that the mechanism lacks a faithful equivalent
When the reference is judged against its format description
Then it is rejected, requiring the evidence before the capability is
     accepted as a known exception
```

**Scenario:** A missing or duplicated identifier is rejected

```text
Given two capabilities share one identifier, or a capability has none
When the reference is judged against its format description
Then it is rejected, because the traceability identifier must be present
     and unique
```

## Out of scope

- Deriving either engine's pipeline from the reference — that is sub-spec B
  (`#372`).
- The divergence (drift) check across reference and engines — that is
  sub-spec C (`#373`).
- The knowledge skill and configuration/parity agents — that is sub-spec D
  (`#374`).
- Executing any pipeline on a live engine.
- The serialization format and the exact key and annotation syntax of the
  reference and the traceability identifier — those are design choices for
  this sub-spec's PLAN stage, recorded in its architecture decision record.
- The mechanism by which the new top-level `ci/` location is registered for
  delivery to adopters (the core-layer manifest edits) — an implementation
  detail of realizing Requirement 9, owned by the PLAN and implementation
  stages. `ci/` is a new location; there are no pre-existing reference
  instances to migrate.

## Open questions

- _None. The capability granularity (one job), the neutral trigger
  vocabulary with portable filters, the bot-mention exception, and the
  core-layer delivery are all resolved._
