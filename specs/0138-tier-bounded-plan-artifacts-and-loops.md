---
id: "0138"
slug: tier-bounded-plan-artifacts-and-loops
status: implemented
complexity: small
interaction-mode: MINIMAL
related-issue: 884
version: 1.0.0
---

# Tier-bounded plan artifacts and PLAN loops

## Intent

The PLAN stage costs what the ticket's declared complexity tier warrants: a
small ticket's plan artifact carries only the sections that earn their place at
that tier, the PLAN review loop halts at a tier-bound number of revision rounds
instead of iterating without limit, and a user gate does not fire twice for the
same decision when the only difference between the two firings is the
application of that gate's own feedback. Review depth is deliberately
unchanged — a reader of the amended contracts finds the reviewer's obligations
exactly as they were.

## Requirements

1. At `trivial` and `small` tiers, an initial or revised plan comment SHALL be
   format-conformant when it contains the sections `### Approach` and
   `### Steps` as defined in `docs/plan-format.md`; the sections
   `### Blast radius`, `### Alternatives considered and rejected`, and
   `### Rollback strategy` MAY be omitted at those tiers, and when present
   SHALL keep the format that document defines. A plan omitting `### Approach`
   or `### Steps` SHALL remain non-conformant at every tier. At `standard` and
   `large` tiers, all five sections SHALL remain mandatory.
2. At `trivial` tier, the one-line plan confirmation that ADR-0010 transition
   rule 3 already admits SHALL be a sufficient PLAN artifact, and ADR-0010
   SHALL be amended so its Appendix Example 1 ("PLAN — skipped for trivial")
   agrees with transition rule 1 ("PLAN SHALL NOT be skipped"): the PLAN stage
   always runs, and at `trivial` its artifact MAY be that one-line
   confirmation.
3. The PLAN review loop SHALL halt when the number of plan revisions for one
   ticket would exceed the tier's cap: one revision at `trivial` and `small`,
   two at `standard`, five at `large` (the ADR-0010 default). A plan approved
   on its first cold review consumes zero revisions and is unaffected.
4. On a PLAN-loop halt, the orchestrator SHALL post a structured summary on
   the logbook issue and escalate to the user regardless of interaction mode;
   the orchestrator SHALL NOT auto-approve the halted plan, and the loop SHALL
   resume only on explicit user instruction, which MAY lift the cap for that
   ticket.
5. A cold review returned for retagging (a malformed verdict, per
   `docs/retroactive-loop.md`) SHALL NOT count as a revision against the
   tier's cap.
6. When an artifact-validation gate returns feedback and the artifact is
   revised, the same gate SHALL NOT fire again for the revised artifact when
   every change in the revision is attributable to that gate's own feedback
   and the revision contains no other normative change. When any change is not
   attributable to the feedback, or when attribution is uncertain, the gate
   SHALL fire again on the full artifact.
7. The amended documents SHALL carry, verbatim, the sentence: "These clauses
   bound the plan's size and the loop's length; they remove no item from the
   reviewer's checklist at any tier." No amendment under this spec SHALL
   remove or weaken any reviewer obligation.

## Scenarios

**Scenario:** small-tier plan with the reduced section set passes format review

Given a ticket whose spec declares `complexity: small`
When  the architect posts a plan containing exactly `### Approach` and `### Steps`
Then  the plan is format-conformant and the cold review proceeds with no format finding

**Scenario:** PLAN-loop cap halt escalates instead of iterating

Given a `small` ticket whose plan has already consumed its one revision
When  the cold re-review returns REQUEST CHANGES again
Then  the loop halts, a structured summary is posted on the logbook issue, the user is paged, and no further revision is authored without explicit user instruction

**Scenario:** conforming amendment discharges the gate re-fire

Given an artifact-validation gate returned feedback naming two corrections
When  the revision applies exactly those two corrections and nothing else
Then  the same gate does not fire again and the lifecycle proceeds

**Scenario:** non-conforming amendment re-fires the gate

Given an artifact-validation gate returned feedback and the revision contains a change not attributable to that feedback
When  the orchestrator prepares the next lifecycle step
Then  the gate fires again on the full revised artifact

**Scenario:** small-tier plan omitting Steps stays non-conformant

Given a ticket whose spec declares `complexity: small`
When  a plan comment omits the `### Steps` section
Then  the cold review emits a format finding and DEV does not start

## Out of scope

- Reviewer checklist depth. Option 2 of issue #882 (tier-calibrated review
  depth) was rejected at the IDEA session (#883); requirement 7 guards the
  boundary.
- The deferred-findings lane (non-blocking findings channel and findings
  ledger) — Unit 2 of the same IDEA session, tracked as issue #885 and gated
  on the measurement that follows this spec's implementation.
- The REVIEW-loop guardrail. The existing five-iteration cap of ADR-0010 and
  `docs/retroactive-loop.md` is untouched; this spec bounds the PLAN loop
  only.
- A plan linter. None exists today (`docs/plan-format.md` names it as
  future work); building one, tier-aware or otherwise, is not part of this
  spec.
- Retro-fitting merged plans or re-opening past lifecycles.

## Open questions
