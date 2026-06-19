---
id: "0049"
slug: ci-drift-harness
status: approved
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 373
version: 1.0.0
---

# CI drift harness

## Intent

The project now describes its continuous-integration capabilities once in a
platform-neutral reference and derives the GitLab pipeline from it, but
nothing yet guarantees that the reference, the GitHub Actions pipeline, and
the GitLab pipeline actually agree — a hand-edit to a workflow, a stale
committed pipeline, or an unjustified exception could drift silently. After
this change, a single harness checks all three against each other on the
portable capability set: it confirms the reference is itself well-formed,
that each portable capability is faithfully exhibited by both engines, that
the two engines agree, and that no pipeline job exists that cannot be traced
back to a capability — and it fails the project's own continuous-integration
checks, naming the offending capability and platform, whenever any of those
guarantees is broken or an engine-specific exception lacks its evidence.

## Requirements

1. The harness SHALL detect divergence between the reference and the GitHub
   Actions pipeline, between the reference and the GitLab pipeline, and
   between the two engine pipelines on the portable capability set.
2. The harness SHALL reject a reference that violates its normative format
   contract, failing closed on each of these reference-validity violations: a
   trigger outside the neutral vocabulary; an engine-specific capability that
   carries no evidence-backed exception or whose evidence is empty; a missing
   or duplicate traceability identifier; a portable capability that declares
   no invocation command; and a portable capability whose invocation command
   needs a runtime or tool it does not declare as an execution requirement.
3. For every portable capability, the harness SHALL verify that the
   capability's declared invocation command is faithfully exhibited by the
   business steps of the GitHub Actions job attributed to that capability —
   the work the job performs — and SHALL report a divergence that names the
   capability and the GitHub Actions platform when they disagree.
4. For every portable capability, the harness SHALL verify that the
   capability's declared execution requirements — runtime and version,
   additional tools, and source-history depth — are satisfied by the setup
   steps of the attributed GitHub Actions job, judged by presence and
   equivalence rather than by exact authoring syntax, such that legitimate
   hand-authored setup boilerplate (repository checkout, runtime setup,
   caching, tool installation) does not by itself constitute a divergence.
5. The harness SHALL determine reference-to-GitLab conformance by composing
   the GitLab pipeline generator's own verification mode rather than
   re-deriving GitLab generation logic, failing closed when the committed
   GitLab pipeline differs from what deriving from the current reference
   would produce.
6. The harness SHALL verify that the set of portable capabilities exhibited
   by the GitHub Actions pipeline and the set exhibited by the GitLab
   pipeline both agree with the reference's portable set, failing closed and
   naming the mismatch and the affected platform when an engine omits, adds,
   or misattributes a portable capability.
7. The harness SHALL fail closed on any pipeline job, in either engine, that
   cannot be attributed to exactly one reference capability by the
   traceability contract — the job key equal to a capability identifier, or
   the reserved-name fallback annotation — naming the untraceable job and its
   platform.
8. The harness SHALL treat a capability marked engine-specific as expected to
   be absent on the engines its evidence-backed exception does not name, SHALL
   NOT require a generated job for it, and SHALL NOT treat that absence as a
   divergence.
9. The harness SHALL be runnable within the project's own
   continuous-integration checks and SHALL exit with a non-zero result on any
   detected divergence, reference-validity violation, evidence-less
   exception, or untraceable job.
10. The correctness of the harness SHALL be verifiable by an automated
    self-test that asserts both its passing verdict on a conforming input and
    its fail-closed verdict on each class of violation it is responsible for,
    mirroring the project's established check-plus-test-the-checker
    convention.
11. The harness SHALL itself be described by the reference as a portable
    capability, so the verification surface is contract-described and itself
    subject to the parity guarantee rather than being a hidden gate —
    symmetric with the GitLab generator's own drift gate, which is already a
    portable capability. In a repository where one engine's pipeline artifacts
    are absent, the harness SHALL check only the arms whose engine artifacts
    are present rather than fail on the missing engine.

## Scenarios

**Scenario:** All portable capabilities are in sync across the three sources

```text
Given the reference, the GitHub Actions pipeline, and the GitLab pipeline all
      agree on every portable capability and on the portable set
When the harness runs
Then it passes with no divergence reported and exits with a zero result
```

**Scenario:** Hand-authored setup boilerplate alone is not a divergence

```text
Given a portable capability whose invocation command matches its GitHub
      Actions job's business steps, and whose execution requirements are
      satisfied by that job's hand-authored setup steps (checkout, runtime
      setup, caching, tool installation)
When the harness runs
Then it treats the setup boilerplate as satisfying the requirement by
     presence and equivalence and reports no divergence for that capability
```

**Scenario:** A drifted GitHub Actions business step is rejected

```text
Given a portable capability whose GitHub Actions job business steps no longer
      match the capability's declared invocation command
When the harness runs
Then it fails with a non-zero result naming the diverging capability and the
     GitHub Actions platform
```

**Scenario:** A drifted committed GitLab pipeline is rejected

```text
Given the committed GitLab pipeline no longer matches what deriving from the
      current reference produces
When the harness runs and composes the generator's verification mode
Then it fails with a non-zero result naming the divergence on the GitLab
     platform
```

**Scenario:** The two engines disagree on the portable set

```text
Given a portable capability is exhibited by one engine's pipeline but absent
      from or misattributed in the other engine's pipeline
When the harness runs
Then it fails with a non-zero result naming the mismatched capability and the
     affected platform
```

**Scenario:** An untraceable pipeline job is rejected

```text
Given a pipeline job in either engine whose key is not a reference capability
      identifier and which carries no reserved-name fallback annotation
When the harness runs
Then it fails with a non-zero result naming the untraceable job and its
     platform
```

**Scenario:** An engine-specific exception without evidence is rejected

```text
Given a capability marked engine-specific that carries no exception or whose
      exception states no evidence
When the harness runs
Then it fails with a non-zero result and refuses to treat the absent job as
     expected
```

**Scenario:** An engine-specific capability is expected absent on the other engine

```text
Given a capability marked engine-specific carrying evidence that names one
      engine
When the harness runs
Then it treats the capability as expected to be absent on the engines the
     evidence does not name, requires no generated job for it, and reports no
     divergence
```

**Scenario:** An adopter repository is missing one engine's pipeline

```text
Given an adopter repository that contains the reference and one engine's
      pipeline but not the other engine's pipeline artifacts
When the harness runs
Then it checks only the arms whose engine artifacts are present, does not
     fail on the absent engine, and reports no divergence attributable to its
     absence
```

**Scenario:** A reference-validity violation is rejected

```text
Given the reference declares a capability with a trigger outside the neutral
      vocabulary, a duplicate or missing traceability identifier, a portable
      capability without an invocation command, or a portable capability
      whose command needs an undeclared execution requirement
When the harness runs
Then it fails with a non-zero result naming the offending capability and the
     specific validity rule it violates
```

## Out of scope

- Generating the GitHub Actions pipeline from the reference. This spec builds
  only the checker; it verifies the existing hand-authored GitHub Actions
  pipeline at the step level. The deliberate step-level conformance checking
  (Requirements 3 and 4) is the forward-compatible investment that proves the
  reference faithfully describes the GitHub Actions business steps — the
  precondition for a future sub-spec that will generate the GitHub Actions
  pipeline the way the generator sub-spec generates GitLab. That generation
  is explicitly not in this spec.
- Generating or re-deriving the GitLab pipeline. That belongs to the
  generator sub-spec (`#372`); this harness composes the generator's own
  verification mode (Requirement 5) and never re-implements GitLab generation
  logic.
- Authoring the reference contract and its normative format description.
  Those belong to the reference-contract sub-spec (`#371`); this harness
  checks a reference against that already-defined contract.
- The GitLab knowledge skill and the configuration and parity agents — that
  is the agentic-surface sub-spec (`#374`). This harness is the script the
  parity agent will later operate, not the agent.
- Executing any pipeline on a live engine. The canonical forge remains
  GitHub; the GitLab pipeline is checked in this repository, never run on a
  live GitLab.
- Reading, injecting, or managing any live secret or token. The
  token-bearing engine-specific capabilities (GitLab Pages, Releases) are
  validated only as evidence-backed exceptions; the harness inspects the
  reference and the pipeline definitions, not any live credential, and SHALL
  NOT introduce a token-leak vector. The full security review is performed by
  the implementation team.
- Adding new portable capabilities or changing any existing capability
  definition or trigger. The harness checks the reference; it does not edit
  it.
- The exact checker command name, the YAML extraction mechanics, and the
  internal comparison shape — design choices for this sub-spec's PLAN stage.
  The traceability extraction expressions the harness relies on are pinned in
  the normative format description (contract C2).

## Open questions

- None. All qualification decisions are resolved. The harness is registered as
  a portable capability (Requirement 11) — symmetric with the generator's own
  drift gate and avoiding a semantically invalid engine-specific exception for
  a portable shell-and-yq checker that GitLab can run — so its implementation
  will describe the harness in the reference and regenerate the GitLab
  pipeline, and it gracefully checks only the engine arms whose artifacts are
  present. It checks reference-to-GitHub-Actions conformance at the
  business-step level (Requirements 3 and 4), composes the generator's
  verification mode for reference-to-GitLab conformance (Requirement 5), and
  fails closed on cross-engine, traceability, reference-validity, and
  evidence violations.
