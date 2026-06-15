---
id: "0030"
slug: feedback-routing-upstream-tiers
status: draft
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 304
version: 1.0.0
---

# Feedback routing for upstream-owned tiers

## Intent

A fork that redirects its own harness feedback to an internal repository never
diverts feedback away from the components it does not own. Frictions tagged
against upstream-maintained skills and agents always reach the upstream
repository where those components are maintained, while frictions tagged
against the fork's own components reach the fork. The provenance feedback
target of a component is governed by who owns the component, not by a single
fork-wide setting.

## Requirements

1. Every built component whose source lives in an **upstream-owned tier**
   (`artifacts/core`, `artifacts/library`, `extensions/core`,
   `extensions/library`) SHALL emit a `metadata.provenance.feedback` value
   identical to its `metadata.provenance.canonical` value, for every adopting
   fork and regardless of the fork's configured feedback repository.
2. The `feedback_repo` configuration key in `crewrig.config.toml` SHALL govern
   the feedback target of **adopter-owned tiers only** (`artifacts/community`,
   `artifacts/org`, `extensions/org`). It SHALL NOT influence the feedback
   target of any upstream-owned component.
3. Every existing upstream-owned source that currently carries a
   `metadata.provenance` block SHALL be reconciled so that its `feedback`
   field resolves to the canonical repository, in the same change that
   introduces this invariant.
4. A continuous-integration guard SHALL fail the build when any upstream-owned
   source declares a `feedback` value that can resolve to anything other than
   the canonical repository, so a future regression is caught before merge.
5. The provenance and forking documentation (`artifacts/FORMAT.md`) SHALL state
   the per-tier feedback-routing rule explicitly, so an adopter forking the
   project understands that overriding `feedback_repo` does not capture
   feedback on upstream-owned components.
6. The invariant SHALL be expressed uniformly across all four upstream-owned
   tiers, so a provenance block added later to an `extensions/core` or
   `extensions/library` component inherits the same routing guarantee without a
   further specification change.

## Scenarios

**Scenario:** A fork redirecting feedback keeps upstream feedback upstream

Given a fork sets `feedback_repo` to its own internal repository while keeping
`canonical_repo` pointing at upstream
When the fork rebuilds the components
Then every built upstream-owned component carries a `feedback` value equal to
its `canonical` value (the upstream repository)
And no built upstream-owned component carries the fork's internal repository as
its feedback target

**Scenario:** Adopter-owned components still honor the fork's feedback target

Given the same fork has authored its own component under an adopter-owned tier
with a `feedback` value bound to `feedback_repo`
When the fork rebuilds the components
Then that adopter-owned component carries the fork's internal repository as its
feedback target

**Scenario:** The CI guard rejects a regressed upstream source

Given an upstream-owned source is edited so its `feedback` field would resolve
to a repository other than the canonical one
When the continuous-integration guard runs against the change
Then the guard fails the build and identifies the offending source

## Out of scope

- Creating `metadata.provenance` blocks where none exist today — in particular
  the `extensions/core` and `extensions/library` components, which carry no
  provenance block and do not flow through `scripts/build-components.sh`. R6
  states the prospective rule; this spec does not back-fill provenance into the
  extension tiers.
- Defining or populating any adopter-owned tier (`artifacts/community`,
  `artifacts/org`, `extensions/org`) beyond stating that `feedback_repo`
  governs them.
- Changing the `canonical` routing, the `version` field semantics, or any
  other provenance field.
- Adding a build-time override that rewrites the `feedback` field independently
  of the source declaration — the chosen enforcement is a source-level
  declaration plus a CI guard, not a build-time mutation.
- The harness-curator's downstream routing of issues to the resolved feedback
  target — unchanged by this spec.

## Open questions

- [GROUNDING:] Every upstream-owned source carrying a `metadata.provenance`
  block today (all `artifacts/core/**` and `artifacts/library/**` components,
  ~39 files) declares `feedback: "${FEEDBACK_REPO}"`; none declares
  `feedback` equal to `canonical`. Back-fill responsibility is resolved: the
  implementation PR for this spec reconciles every such source in the same
  diff (per R3) and the CI guard introduced by R4 prevents regression. No
  residual question.
