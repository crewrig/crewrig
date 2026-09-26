---
id: "0226"
slug: reviewer-seat-bootstrap-exemption
status: approved
complexity: small
interaction-mode: AUTO
related-issue: 1264
version: 1.0.0
---

# Reviewer seats are exempt from the Session Bootstrap task-handoff steps

## Intent

A cold reviewer seat pass — occupying the `specs`, `plan`, or `review`
surface per `docs/reviewer-seat.md` — no longer reads the authoring
session's cross-tool task-handoff drawer or writes a resumption checkpoint
into it before starting its review, because that read hands the seat
exactly the authoring-session context its cold-start contract forbids it
from having, and there is no "resumption" for a seat to record in the
first place. A REVIEW pass auditing such a session no longer raises a
process-violation finding for that correctly-skipped pair of steps, while
every other agent and role — the orchestrator, a developer pass, an
architect pass not occupying a seat, `pr-logbook` — keeps running the
unmodified Session Bootstrap sweep and keeps being flagged exactly as
before when it skips a step.

## Requirements

1. A seated pass — an agent instantiated per `docs/reviewer-seat.md` →
   *Instantiating a seated pass*, occupying the `specs`, `plan`, or
   `review` surface, on any pass ordinal of that seat — SHALL be exempt
   from step 3 (cross-tool handoff lookup) and step 6 (mandatory
   checkpoint write) of the Session Bootstrap sweep defined in
   `artifacts/core/rules/60-tools.md` → *Memory Activation Protocol →
   Session Start*.
2. A seated pass SHALL still perform steps 1, 2, 4, and 5 of that same
   sweep — project-name computation, `mempalace_status`, the per-agent
   diary read, and the Knowledge Graph query — unchanged from the
   obligation any other role carries for those four steps.
3. `AGENTS.md` → *Session Bootstrap* SHALL state the exemption of
   requirement 1 normatively, cross-referencing `docs/reviewer-seat.md`,
   such that its "skipping the sweep is a process violation" statement and
   its accompanying rule that a REVIEW pass auditing an omitted sweep
   SHALL emit a `class: tech` finding SHALL NOT apply to a seated pass's
   skip of steps 3 and 6 for the reason stated in requirement 1.
4. `docs/reviewer-seat.md` SHALL state the same exemption in terms a
   reader of that document alone can act on, without first reading
   `AGENTS.md` or `artifacts/core/rules/60-tools.md` to learn that a
   seated pass's Session Bootstrap obligations differ from an authoring
   agent's.
5. The exemption of requirement 1 SHALL apply only to a pass that meets
   requirement 1's own definition of a seated pass. Every other agent or
   role — including the orchestrator, a developer pass, an architect pass
   acting outside a seated review, and `pr-logbook` — SHALL remain bound
   by the unmodified six-step Session Bootstrap sweep, with no exemption
   for steps 3 or 6.
6. A REVIEW pass, or any later audit performed under the same rule, that
   finds steps 3 and 6 skipped by a seated pass for the reason stated in
   requirement 1 SHALL NOT record that skip as a finding of any class. The
   same audit finding steps 3 or 6 skipped by a pass that does not meet
   requirement 1's definition SHALL continue to emit a `class: tech`
   finding, unchanged from the rule that predates this specification.

## Scenarios

**Scenario:** A cold review-surface seat pass skips steps 3 and 6 and
draws no finding

```text
Given a review/1300 seat pass is instantiated per docs/reviewer-seat.md
      → Instantiating a seated pass, with a references-only brief
When  the pass runs the Session Bootstrap sweep before starting its
      review of the implementation pull request
Then  the pass completes steps 1, 2, 4, and 5; skips steps 3 and 6 citing
      the exemption of requirement 1; and a later REVIEW pass auditing
      that session raises no finding of any class for the skip
```

**Scenario:** A non-seated developer pass stays fully bound to the sweep

```text
Given a developer pass is working ticket #1300 at the DEV stage, and is
      not instantiated as a seated pass on any surface
When  that pass skips step 3 and step 6 of the Session Bootstrap sweep
Then  a REVIEW pass auditing that session emits a class: tech finding
      citing AGENTS.md → Session Bootstrap, exactly as it would have
      before this specification
```

**Scenario:** The same role name authoring a plan, not seated as its
reviewer, is not exempt

```text
Given an architect pass is drafting the PLAN-stage comment for ticket
      #1300 as its author, and is not occupying the plan surface's
      reviewer seat for that same ticket
When  that pass skips step 3 and step 6 of the Session Bootstrap sweep
Then  the exemption of requirement 1 does not apply, because the pass is
      not a seated pass, and a REVIEW pass auditing that session emits a
      class: tech finding
```

## Out of scope

- The content of Session Bootstrap sweep steps 1, 2, 4, and 5 — unchanged
  by this specification (requirement 2).
- The MemPalace wake-up budget, its overflow rule, and the per-step byte
  caps in `artifacts/core/rules/60-tools.md` → *Memory Activation
  Protocol* — unchanged.
- The system-context store retrieval protocol.
- Every other clause of the reviewer-seat contract in
  `docs/reviewer-seat.md` not touched by requirement 4 — seat dossier
  reconstruction, the seat line's exact placement and form, finding
  identifiers, the prior-finding disposition record, retirement and
  generation, and vacant-seat handling — all unchanged.
- Session End (final-flush) obligations for a seated pass — updating the
  cross-tool handoff drawer, writing a diary entry — which this
  specification does not address; only the Session Start sweep's steps 3
  and 6 are in scope.
- The harness-report friction-tagging protocol and its recognition
  signals — unchanged.
- Which role occupies which review surface, and the composition of the
  teams that produce a reviewed artifact (`docs/agent-team-protocol.md`)
  — unchanged.
- The actual edits to `AGENTS.md`, `artifacts/core/rules/60-tools.md`, and
  `docs/reviewer-seat.md` that realize requirements 3 and 4 — those are
  DEV-stage work and are not part of this SPECS-stage artifact.

## Open questions

None. The friction cluster in issue #1264 converges on a single suggested
resolution — exempt the `specs`/`plan`/`review` seat surfaces from steps 3
and 6 and state it in both `AGENTS.md` and `docs/reviewer-seat.md` — and
the incident it cites (`review/1211` pass 1 on pull request #1242) already
demonstrates the correct behavior this specification normalizes. The
boundary between a seated pass and a same-named role acting outside a seat
(requirement 5, third scenario) was the one ambiguity worth resolving
explicitly, and requirements 1 and 5 close it: the exemption is keyed to
the seat instantiation contract of `docs/reviewer-seat.md`, never to an
agent's role name.
