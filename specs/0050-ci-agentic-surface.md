---
id: "0050"
slug: ci-agentic-surface
status: draft
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 374
version: 1.0.0
---

# CI agentic surface

## Intent

The project now describes its continuous-integration capabilities once in a
platform-neutral reference, derives the GitLab pipeline from it, and checks all
three sources for drift — but a contributor still has no agentic help to author
or review a GitLab pipeline, the configuration agent only knows GitHub Actions,
and operating or reconciling the drift check is a manual chore. After this
change, the framework offers GitLab CI/CD authoring and review assistance as
deep as the GitHub Actions assistance it already has, the configuration agent
can produce a pipeline for either supported engine, and a dedicated agent
operates the drift check and helps a contributor reconcile any divergence it
reports — so that a contributor working on either engine has the same depth of
guidance and a clear, repeatable path from a reported divergence to a
reconciled, parity-clean state.

## Requirements

1. The framework SHALL provide a GitLab CI/CD knowledge skill that offers
   authoring and review assistance for GitLab pipelines equivalent in depth to
   the assistance the existing GitHub Actions skill provides.
2. The GitLab CI/CD skill SHALL cover the GitLab pipeline domains required for
   practitioner-grade authoring and review — at minimum pipeline, stage, and
   job structure; the trigger and rule model; runners and executors; caching
   and artifacts; the protected secret and variable model; and the security
   defaults that SHALL NOT be negotiated away — at a depth matching the GitHub
   Actions skill's coverage of the equivalent GitHub Actions domains.
3. The GitLab CI/CD skill SHALL ship a `references/` knowledge corpus at
   depth-parity with the GitHub Actions skill, and SHALL add active validation
   tooling under `scripts/` only where a meaningful offline GitLab validation
   exists — such as an offline pipeline lint; where no such offline validation
   exists the skill SHALL remain references-only rather than ship façade
   tooling, since executing a pipeline on a live GitLab is out of scope.
4. The GitLab CI/CD skill SHALL declare its own activation conditions and SHALL
   defer to the security and architect roles on boundaries symmetric to those
   on which the GitHub Actions skill defers, so the two skills present a
   parallel activation and escalation contract.
5. The CI configuration agent SHALL be engine-aware and SHALL be able to
   produce a pipeline for either supported engine — GitHub Actions or GitLab
   CI/CD — selected by an engine target that is either supplied explicitly or
   inferred from the repository.
6. The configuration agent SHALL infer the engine target when the repository
   indicates exactly one engine — a GitHub Actions workflow directory present,
   or a GitLab pipeline file present, but not both — SHALL accept an explicit
   engine target that overrides any inference, and SHALL refuse to generate a
   pipeline only when the target is ambiguous (both engines indicated and none
   specified) or absent (neither indicated and none specified), rather than
   guessing between two present engines.
7. When producing a GitLab CI/CD pipeline, the configuration agent SHALL derive
   it from the platform-neutral CI capability reference rather than
   re-implementing generation logic, so a pipeline it produces stays consistent
   with the reference and with the divergence-check harness.
8. The configuration agent SHALL apply the security defaults and conventions
   proper to the engine it is producing for — preserving the GitHub Actions
   defaults it already enforces and applying the equivalent GitLab CI/CD
   defaults documented by the GitLab CI/CD skill.
9. The framework SHALL provide a CI parity agent that operates the project's CI
   divergence-check harness (spec 0049) and reports its verdict to the
   contributor.
10. The parity agent SHALL interpret the harness's fail-closed output, naming
    for each reported divergence the offending capability and the affected
    engine, and SHALL classify each divergence by kind — a stale derived
    pipeline, reference drift, a hand-authored pipeline drift, an evidence-less
    engine-specific exception, or an untraceable pipeline job.
11. For each detected divergence the parity agent SHALL determine the
    reconciliation appropriate to its kind — regenerating the derived pipeline,
    amending the reference capability or its evidence-backed exception, or
    correcting a hand-authored pipeline job — expressed within the
    evidence-backed-exception discipline the reference contract mandates.
12. The parity agent MAY autonomously apply only the deterministic, no-judgment
    reconciliation — regenerating the derived pipeline from the current
    reference and re-running the divergence-check harness to confirm the
    divergence is resolved; for every judgment-bearing reconciliation —
    amending a reference capability, amending an evidence-backed exception, or
    correcting a hand-authored pipeline job — the parity agent SHALL diagnose
    and propose only and SHALL NOT mutate the reference, a pipeline, or an
    exception autonomously.
13. The parity agent SHALL remain distinct in scope from the configuration
    agent: the configuration agent authors and produces a pipeline; the parity
    agent audits an existing pipeline set and reconciles drift, and SHALL NOT
    duplicate the configuration agent's greenfield authoring interview.
14. The GitLab CI/CD skill, the generalised configuration agent, and the parity
    agent SHALL keep engine-neutral every claim the parent reference keeps
    engine-neutral, naming a specific engine only where the behaviour is
    genuinely engine-specific.

## Scenarios

**Scenario:** GitLab pipeline authored from the reference for the chosen engine

```text
Given a contributor asks the configuration agent for a GitLab CI/CD pipeline
      and the engine target resolves to GitLab CI/CD
When the agent produces the pipeline by deriving it from the platform-neutral
     capability reference
Then the produced pipeline is consistent with the reference and the divergence
     check reports no drift attributable to it
```

**Scenario:** GitLab review assistance at parity depth

```text
Given a contributor asks for a review of a GitLab pipeline
When the GitLab CI/CD skill is consulted
Then it provides authoring and review guidance — structure, triggers, runners,
     caching, protected secrets, and non-negotiable security defaults — at a
     depth equivalent to the GitHub Actions skill's review of a GitHub Actions
     workflow
```

**Scenario:** Parity agent reports a clean run

```text
Given the reference, the GitHub Actions pipeline, and the GitLab pipeline all
      agree on the portable capability set
When the parity agent operates the divergence-check harness
Then it reports a parity-clean verdict and proposes no reconciliation
```

**Scenario:** Parity agent auto-applies the mechanical reconciliation of a stale derived pipeline

```text
Given the divergence-check harness fails closed because the committed derived
      GitLab pipeline is stale relative to the current reference
When the parity agent operates the harness and identifies the divergence as the
     deterministic, no-judgment stale-derived-pipeline case
Then it regenerates the derived pipeline from the current reference, re-runs the
     harness, and confirms the divergence is resolved without mutating the
     reference or any hand-authored job
```

**Scenario:** Parity agent diagnoses and proposes on a judgment-bearing divergence

```text
Given the divergence-check harness fails closed naming a divergence whose
      reconciliation requires judgment — a hand-authored pipeline job drift,
      reference drift, or an evidence-less engine-specific exception
When the parity agent operates the harness
Then it classifies the divergence by kind, names the offending capability and
     engine, and proposes a reconciliation without mutating the reference, any
     pipeline, or any exception autonomously
```

**Scenario:** Configuration agent refuses an ambiguous engine target

```text
Given a contributor asks the configuration agent to produce a pipeline in a
      repository that indicates both engines and supplies no explicit engine
      target
When the agent prepares to generate
Then it refuses to generate and asks for the target to be resolved rather than
     guessing between the two present engines
```

## Out of scope

- Authoring or changing the platform-neutral CI capability reference, its
  normative format, the capability definitions, or their triggers — owned by
  the reference-contract sub-spec (spec 0047).
- Changing the GitLab pipeline generator or the GitHub-to-reference generation
  logic — owned by the generator sub-spec (spec 0048). This spec's agents
  operate and compose those mechanisms; they do not re-implement them.
- Changing the behaviour of the divergence-check harness — owned by the drift
  harness sub-spec (spec 0049). The parity agent operates the harness as
  shipped; it does not alter what the harness checks.
- Generating the GitHub Actions pipeline from the reference. The GitHub Actions
  pipeline stays hand-authored and step-level-verified, exactly as spec 0049
  leaves it.
- A faithful GitLab equivalent of the conversational mention-driven assistant
  workflows. Per spec 0046, these remain evidence-backed exceptions, not ported.
- Executing any pipeline on a live GitLab instance. The canonical forge stays
  GitHub; pipelines are authored and drift-checked in this repository, never run
  on a live GitLab.
- Reading, injecting, or managing any live secret or token. The agents reason
  about pipeline and reference definitions, not live credentials.
- The realization obligations that the implementation PR for this spec SHALL
  discharge at DEV time — they are consequences of touching `artifacts/**`, not
  requirements of the WHAT: bumping `artifacts/core/agents/ci-configurator`
  from version 1.0.2 to a MINOR 1.1.0 for the additive engine-awareness;
  re-running `scripts/build-components.sh` and staging the regenerated CLI
  outputs; updating `docs/cli-matrix.md`; and obtaining the copywriting /
  storyteller sign-off on the new GitLab CI/CD skill body and the generalised
  configuration agent prompt.

## Open questions

- None. All qualification decisions are resolved. The GitLab CI/CD skill ships a
  `references/` corpus at depth-parity with the GitHub Actions skill and adds
  `scripts/` tooling only where a meaningful offline GitLab validation exists,
  remaining references-only otherwise (Requirement 3). The configuration agent
  infers the engine target when the repository indicates exactly one engine,
  accepts an explicit override, and refuses to generate only on an ambiguous or
  absent target rather than guessing between two present engines (Requirements 5
  and 6). The parity agent autonomously applies only the deterministic
  regenerate-and-re-verify reconciliation, and for every judgment-bearing case —
  amending a reference capability, amending an evidence-backed exception, or
  correcting a hand-authored pipeline job — diagnoses and proposes only, never
  mutating the reference, a pipeline, or an exception autonomously (Requirements
  11 and 12).
