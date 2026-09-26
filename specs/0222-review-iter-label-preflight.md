---
id: "0222"
slug: review-iter-label-preflight
status: draft
complexity: small
interaction-mode: AUTO
related-issue: 1268
version: 1.0.0
---

# Review iteration label self-healing preflight

## Intent

A pull request always carries an `iter:N` label before any reviewer
finding is minted against it: the `pr-reviewer` skill's preflight step
notices a missing label and adds `iter:1` on its own, so a reviewer
session is never inconsistent when an earlier orchestrator step omitted
the label. The retroactive-loop documentation carries a cross-reference
note about this behavior, so the two surfaces describing the label
lifecycle stay consistent with each other.

## Requirements

1. The `pr-reviewer` skill's preflight step SHALL check whether the
   pull request under review carries any label matching the `iter:N`
   pattern before the skill mints the first finding identifier of the
   pass.
2. When no `iter:N` label is present on the pull request, the
   `pr-reviewer` skill SHALL apply the `iter:1` label to the pull
   request before minting any finding identifier for that pass.
3. When an `iter:N` label is already present on the pull request, the
   `pr-reviewer` skill SHALL proceed without modifying the label.
4. The `pr-reviewer` skill SHALL derive the `<N>` used in every
   `i<N>-F<M>` finding identifier it mints during the pass from the
   pull request's `iter:N` label value as it stands after the check in
   Requirement 1 and the conditional action in Requirements 2–3 — never
   from an assumed or hardcoded value.
5. The self-healing check defined in Requirements 1–4 SHALL run on
   every pass of the `pr-reviewer` skill against a given pull request,
   not only the first pass of a seat.
6. When the `pr-reviewer` skill cannot apply the `iter:1` label (the
   label-add call fails), the skill SHALL surface the failure
   explicitly in the pass's output rather than silently proceeding as
   if the label had been applied.
7. `docs/retroactive-loop.md`'s *REVIEW launch trigger* section SHALL
   carry a cross-reference note naming the `pr-reviewer` preflight
   self-healing behavior defined in Requirements 1–4 as a backstop to
   the orchestrator's own `iter:1`-labeling step, so the two surfaces
   stay in the lockstep relationship that section already declares for
   itself and the routing matrix.

## Scenarios

**Scenario:** Preflight self-heals a missing label

Given a pull request under review by the `pr-reviewer` skill carries no
label matching `iter:N`
When the skill reaches its preflight step, before minting any finding
identifier
Then the skill applies the `iter:1` label to the pull request and
mints every finding identifier for the pass as `i1-F<M>`

**Scenario:** Preflight defers to an existing label

Given a pull request under review already carries an `iter:2` label
(applied earlier by the orchestrator's REVIEW launch trigger step)
When the `pr-reviewer` skill reaches its preflight step
Then the skill does not modify the label and mints every finding
identifier for the pass as `i2-F<M>`

**Scenario:** Self-heal failure is surfaced, not swallowed

Given a pull request under review carries no label matching `iter:N`
and the attempt to add the `iter:1` label fails (missing repository
label definition, permission denial, or a connectivity error)
When the `pr-reviewer` skill's preflight step attempts to self-apply
the label
Then the skill states the failure explicitly in the pass's output and
does not mint finding identifiers as if an `iter:N` label had been
successfully established

## Out of scope

- Any change to `AGENTS.md` or to the `pr-logbook` skill/agent briefs
  (`artifacts/core/skills/pr-logbook/SKILL.md`,
  `artifacts/core/agents/pr-logbook/AGENT.md`). Issue #1268's suggested
  resolution offers an either/or between a producing-side fix
  (`pr-logbook` applying `iter:1` at PR creation) and a consuming-side
  fix (this spec's `pr-reviewer` preflight). This spec deliberately
  takes only the consuming-side branch.
- Any change to the orchestrator-side labeling step itself in
  `docs/retroactive-loop.md`'s *REVIEW launch trigger* section (it
  keeps applying `iter:1` before spawning the `pr-reviewer` seat, in
  every mode). This spec adds only a cross-reference note there; the
  orchestrator's own obligation is unchanged.
- Any change to the `i<N>-F<M>` / `s<N>-F<M>` finding-identifier scheme
  or to the reviewer-seat contract in `docs/reviewer-seat.md`, beyond
  reading the existing `iter:N` label value.
- Retroactive back-labeling of pull requests already open at the time
  this spec merges. This spec governs the `pr-reviewer` skill's
  behavior on its next pass against any pull request, not a one-time
  migration of in-flight PRs.

## Open questions

- `[AUTO-PARKED]` The exact label-matching rule for a malformed label
  value (e.g. an `iter:` label present with a non-numeric or empty
  suffix) is not specified here. The implementation PR should decide
  whether that counts as "no `iter:N` label present" (triggering
  self-heal) or as a distinct error state (triggering the Requirement 6
  failure path), and record the choice in the plan.
- `[AUTO-PARKED]` This spec does not specify behavior if a pull request
  is ever found carrying more than one `iter:N` label. The GitHub label
  API is documented elsewhere (`docs/retroactive-loop.md` → *Iteration
  counter — GitHub label*) as atomic and single-valued in normal
  operation, so this is expected to be unreachable; the implementation
  PR should confirm that assumption rather than add defensive handling
  speculatively.
