---
id: "0046"
slug: multi-engine-ci-parity
status: approved
complexity: large
interaction-mode: INTERMEDIATE
related-issue: 366
version: 1.0.0
---

# Multi-engine CI/CD parity

## Intent

CrewRig's continuous-integration behaviour is defined for a single
platform today; an organisation adopting the framework on a different
platform inherits none of it. After this change, every
continuous-integration capability the framework relies on is described
once in a single platform-neutral reference, and the framework
guarantees that each supported platform — GitHub Actions and GitLab
CI/CD to begin with — exhibits the same set of capabilities, with any
capability that genuinely cannot exist on a platform recorded as an
explicit, evidence-backed exception rather than silently missing.

## Requirements

1. The framework SHALL maintain a single platform-neutral reference
   that enumerates every continuous-integration capability the project
   depends on, including each capability's triggering conditions and an
   indication of whether the capability is portable across platforms or
   platform-specific.
2. For every capability marked portable, each supported platform's
   pipeline SHALL exhibit that capability equivalently to the reference,
   such that the reference and a platform pipeline cannot diverge on the
   portable set without the divergence being detectable.
3. For every capability that has no faithful equivalent on a given
   platform, the reference SHALL record an explicit exception that
   carries evidence the mechanism does not exist on that platform, and
   the framework SHALL NOT emit a non-functional placeholder in that
   platform's pipeline for it.
4. The framework SHALL detect divergence between the reference and the
   GitHub Actions pipeline, between the reference and the GitLab CI/CD
   pipeline, and between the two platform pipelines on the portable set.
5. The divergence check SHALL run within the project's own
   continuous-integration checks and SHALL fail closed when it finds an
   undocumented divergence, an exception lacking evidence, or a platform
   job that cannot be traced back to a reference capability.
6. The framework SHALL provide GitLab CI/CD authoring and review
   assistance equivalent in depth to the GitHub Actions assistance it
   already provides.
7. The framework SHALL provide a configuration capability that produces
   a pipeline for either supported platform from the reference.
8. The framework SHALL provide a means to operate the divergence check
   and to reconcile a detected divergence.
9. Adding support for a further platform SHALL require describing only
   that platform's mapping of the reference capabilities, without
   altering the reference's capability definitions themselves.
10. Any change to the reference, to a platform pipeline, or to the
    capability set SHALL leave the reference, both platform pipelines,
    and the divergence check mutually consistent within the same change.

## Scenarios

**Scenario:** Portable capability stays in sync

```text
Given the reference declares a portable capability with a stated trigger
When the pipelines for both supported platforms are derived from the
     reference and the divergence check runs
Then both platform pipelines exhibit that capability under an equivalent
     trigger and the divergence check passes with no divergence reported
```

**Scenario:** Drift introduced on one platform

```text
Given a portable capability is present in the reference and in both
      platform pipelines
When one platform's pipeline is changed so it no longer matches the
     reference for that capability
Then the divergence check fails with a non-zero result naming the
     diverging capability and the affected platform
```

**Scenario:** Platform-specific capability recorded as an evidence-backed exception

```text
Given the reference declares a capability that has no faithful
      equivalent on one supported platform
When that capability is recorded as an exception carrying evidence for
     that platform and the divergence check runs
Then the divergence check passes, treats the absent job as expected, and
     no non-functional placeholder is emitted
```

**Scenario:** Exception declared without evidence

```text
Given the reference declares a platform-specific exception
When that exception carries no evidence that the mechanism is absent on
     the platform
Then the divergence check fails and refuses to treat the absent job as
     expected
```

## Out of scope

- Supporting continuous-integration platforms other than GitHub Actions
  and GitLab CI/CD in this iteration. The reference is platform-neutral
  by design (Requirement 8), but only the two named mappings ship here.
- Changing the behaviour of any existing check. The portable jobs keep
  exercising the same underlying logic; only an additional platform
  expression of that logic is added.
- A faithful GitLab equivalent of the conversational-bot trigger
  workflows (the mention-driven assistant workflows). These are expected
  to be evidence-backed exceptions, not ported.
- Executing the GitLab pipeline on a live GitLab instance. The project's
  canonical forge remains GitHub; the GitLab pipeline is authored and
  divergence-checked in this repository, not run here.
- Any change to the ADR-0010 lifecycle, the spec format, or the spec
  linter.

## Open questions

- _None. All qualification decisions are resolved: the reference is
  platform-neutral with portable/specific capability marking, the
  portable set is kept in sync by derivation, platform-specific gaps are
  evidence-backed exceptions, and the divergence check fails closed
  within CI._
