---
id: "0101"
slug: spec-pr-inline-approval
status: draft
complexity: standard
interaction-mode: AUTO
related-issue: 662
version: 1.1.0
---

# 0101 — spec-pr-inline-approval (delta-01)

This delta narrows and corrects spec 0101's approval-event model to
accommodate ticket #662. Spec 0101 legislated that a spec-PR's
`draft` → `approved` transition is recorded in the spec-PR's own commit
because the merge-authorization request — fired in *every* interaction mode
— is the approval event. Ticket #662 removes the second half of that
predicate for three of the four modes: for a one-file spec-PR, the
SPECS-stage content-approval gate and the pre-merge authorization request
fire back-to-back with nothing decision-relevant between them. The spec-PR
is opened from already-approved content and, under the Spec-PR workflow
*one-file rule* (exactly one new file, no other edits), merges that content
unchanged, so the second ask is pure repetition. The maintainer confirmed
that approving the content gate is itself consent to merge that unchanged
content. The friction was observed live on three spec-PRs during authoring
(`#657`, `#659`, and `#661`).

The correction is a **narrow discharge carve-out**. In `FULL`,
`INTERMEDIATE`, and `MINIMAL`, a SPECS-stage content-approval of spec
content that becomes a one-file spec-PR merging unchanged discharges the
merge-authorization gate for that spec-PR, and the orchestrator does not
fire a second merge-authorization ask. In `AUTO` there is no SPECS-stage
content gate to discharge it, so the merge-authorization request remains
the sole approval event and still fires. The gate stays mandatory and
separate for every pull request the carve-out does not cover —
implementation-PRs, delta-spec PRs whose content changed after approval,
and every non-spec-PR merge.

This must be a delta on spec 0101 because 0101 Requirement 4's rationale
("the merge-authorization request … is fired in every mode") and its
out-of-scope promise ("does not alter when or how the gate fires") both
become false in three of four modes under #662. Spec 0101's *outcome* is
untouched: a spec still lands on `main` already carrying `status: approved`
in the spec-PR's own commit, with no second pull request. This delta
MODIFIES Requirements 4 and 5, the `AUTO`-mode scenario, and one
out-of-scope bullet; it ADDS six requirements, two scenarios, and seven
out-of-scope bullets. No open questions are introduced.

The version bump is **MINOR** (`1.0.0` → `1.1.0`): the change is primarily
additive (a new discharge carve-out), and the Requirement 4 and 5 revisions
refine the approval-event rationale without invalidating spec 0101's
already-merged `docs/spec-format.md` implementation — a spec still lands
`approved` in its own spec-PR commit in every mode.

## ADDED

1. **New requirement — the narrow spec-PR discharge carve-out.** The
   following requirement SHALL be added to spec 0101's `## Requirements`
   (numbered R9, continuing the parent's list):

   > **R9.** `docs/interaction-modes.md` → *User-gate definition* SHALL
   > state that a SPECS-stage content-approval — the content-approval user
   > gate (the `AskUserQuestion` / `user-validate` validation of a spec's
   > content) — of spec content that becomes a one-file spec-PR (per the
   > Spec-PR workflow *one-file rule*: exactly one new file, no other edits)
   > merging that content unchanged SHALL discharge the pre-merge
   > merge-authorization gate for that spec-PR. The orchestrator SHALL NOT
   > fire a second merge-authorization request for such a spec-PR, because
   > the artifact merged to `main` is the identical, unchanged artifact the
   > content-approval already approved.

2. **New requirement — reconcile the matrix invariance notes.** The
   following requirement SHALL be added to spec 0101's `## Requirements`
   (numbered R10):

   > **R10.** The "invariant across modes … not waivable" notes under the
   > *Behavioral contract per (mode × stage) cell* matrix in
   > `docs/interaction-modes.md` SHALL be reconciled with the R9 carve-out:
   > they SHALL continue to state that the merge-authorization gate is
   > mandatory and un-waived for every merge the carve-out does not cover,
   > while admitting that a one-file spec-PR's merge-authorization request
   > is discharged by a prior SPECS-stage content-approval of the identical,
   > unchanged spec content. The reconciliation SHALL NOT present the
   > carve-out as a general waiver of the gate.

3. **New requirement — the gate still fires in `AUTO`.** The following
   requirement SHALL be added to spec 0101's `## Requirements` (numbered
   R11):

   > **R11.** In `AUTO` mode the merge-authorization gate for a spec-PR
   > SHALL still fire, because no SPECS-stage content-approval gate runs in
   > `AUTO` and therefore nothing discharges it; in `AUTO` the
   > merge-authorization request remains the sole approval event for the
   > spec-PR, exactly as spec 0101 already records.

4. **New requirement — the gate stays mandatory for every uncovered
   merge.** The following requirement SHALL be added to spec 0101's
   `## Requirements` (numbered R12):

   > **R12.** The merge-authorization gate SHALL remain mandatory and
   > separate for every pull request the R9 carve-out does not cover — in
   > particular implementation-PRs, any delta-spec PR whose content changed
   > after its own content-approval, and every non-spec-PR merge — because
   > none of these merges an artifact that a prior content-approval has
   > provably approved unchanged.

5. **New requirement — the `AGENTS.md` cross-reference.** The following
   requirement SHALL be added to spec 0101's `## Requirements` (numbered
   R13):

   > **R13.** `AGENTS.md` → *Branching Strategy*, whose "NEVER merge a Pull
   > Request … without asking for the user's formal permission JUST BEFORE
   > executing the merge" wording is unconditional, SHALL carry a
   > cross-reference to the `docs/interaction-modes.md` → *User-gate
   > definition* carve-out, so that a reader landing on the unconditional
   > wording discovers the narrow one-file spec-PR exception. Following the
   > precedent of spec 0094, the normative carve-out text SHALL live in the
   > `docs/` file and `AGENTS.md` SHALL carry a pointer only, not a
   > duplicated restatement.

6. **New requirement — `docs/spec-format.md` coherence.** The following
   requirement SHALL be added to spec 0101's `## Requirements` (numbered
   R14):

   > **R14.** `docs/spec-format.md` → *Recording the initial `draft` →
   > `approved` transition* SHALL be kept coherent with the revised
   > approval-event model of Requirement 4: its invariant that the
   > transition is recorded only after the approval has been granted SHALL
   > reference the approval event as whichever gate constitutes it per
   > Requirement 4 — the SPECS-stage content-approval gate in `FULL`,
   > `INTERMEDIATE`, and `MINIMAL`; the merge-authorization request in
   > `AUTO` — rather than the merge-authorization request unconditionally,
   > while preserving the invariant that a spec's `approved` status is never
   > recorded ahead of a real approval decision. This delta states the
   > coherence requirement (the WHAT) and SHALL NOT prescribe the exact
   > `docs/spec-format.md` wording (the HOW, left to the implementation).

7. **New scenario (happy path) — a content-approved one-file spec-PR merges
   with no second ask.** The following scenario SHALL be added to spec
   0101's `## Scenarios`:

   ```text
   **Scenario:** A content-approved one-file spec-PR merges with no second
   merge-authorization ask

   Given a spec-PR authored in INTERMEDIATE mode that carries exactly one
         new spec file and no other edit (the Spec-PR workflow one-file rule)
   And   the SPECS-stage content-approval gate has approved that spec content
   When  the orchestrator moves to merge the spec-PR, whose merged content is
         identical to the approved content
   Then  the prior content-approval discharges the merge-authorization gate
         for that spec-PR
   And   the orchestrator does not fire a second merge-authorization ask, and
         the spec lands on main carrying status approved
   ```

8. **New scenario (boundary) — an implementation-PR still requires its own
   ask.** The following scenario SHALL be added to spec 0101's
   `## Scenarios`:

   ```text
   **Scenario:** An implementation-PR still requires its own
   merge-authorization ask

   Given an implementation-PR whose content was authored and reviewed after
         any PLAN-stage approval, not covered by a content-approval of its
         identical merged content
   When  the orchestrator moves to merge that implementation-PR
   Then  the merge-authorization gate fires as normal
   And   the R9 spec-PR discharge does not apply, because no prior
         content-approval provably approved this PR's merged content unchanged
   ```

9. **New out-of-scope bullet — the broader framing is rejected.** The
   following bullet SHALL be added to spec 0101's `## Out of scope`:

   > - The broader framing under which any content-approval whose precise
   >   ask names an unchanged artifact would discharge the
   >   merge-authorization gate. That generalization was considered and
   >   rejected: only the one-file spec-PR case guarantees the merged
   >   artifact is provably identical to the approved one, so the discharge
   >   is deliberately limited to it and is not extended to
   >   implementation-PRs or any other non-spec-PR merge.

10. **New out-of-scope bullet — no automated enforcement.** The following
    bullet SHALL be added to spec 0101's `## Out of scope`:

    > - Any CI check, linter rule, or git hook that enforces the discharge
    >   carve-out. This delta amends the written behavioral contract only;
    >   whether tooling later enforces it is a separate concern.

11. **New out-of-scope bullet — the Spec-PR workflow rules are unchanged.**
    The following bullet SHALL be added to spec 0101's `## Out of scope`:

    > - Any change to the Spec-PR workflow *one-file rule*, *ordering rule*,
    >   or *independence rule* in `docs/spec-pr-workflow.md` beyond
    >   referencing the one-file rule as the precondition that makes the
    >   merged spec-PR content provably identical to the approved content.

12. **New out-of-scope bullet — no retroactive relabeling.** The following
    bullet SHALL be added to spec 0101's `## Out of scope`:

    > - Retroactive relabeling or re-processing of the already-merged
    >   spec-PRs that exhibited this friction during authoring — `#657`,
    >   `#659`, and `#661`. This delta changes the forward process only.

13. **New out-of-scope bullet — the canonical home is a HOW detail.** The
    following bullet SHALL be added to spec 0101's `## Out of scope`:

    > - Whether the normative carve-out text canonically lives in
    >   `AGENTS.md` § *Interaction modes* or in the extracted
    >   `docs/interaction-modes.md` (whose header records it as "Extracted
    >   from AGENTS.md"). That placement is a HOW detail for the PLAN and DEV
    >   stages; this delta requires only that the carve-out be normative in
    >   the `docs/` file and pointed to from `AGENTS.md`.

14. **New out-of-scope bullet — specs 0026 and 0037 are not amended.** The
    following bullet SHALL be added to spec 0101's `## Out of scope`:

    > - Any amendment to specs 0026 or 0037. Both mention the
    >   merge-authorization gate's invariance only in their own *Out of
    >   scope* sections — non-normative historical scope boundaries, not
    >   requirements — and spec 0037's statement that `AUTO` keeps the
    >   pre-merge gate stays true under this delta. This delta deliberately
    >   does not amend them, so a REVIEW pass SHALL NOT raise a spec-class
    >   finding on their unchanged invariance mentions.

15. **New out-of-scope bullet — spec 0101's own `## Open questions` is not
    amended.** The following bullet SHALL be added to spec 0101's `## Out of
    scope`:

    > - Any amendment to spec 0101's own `## Open questions` section. Its
    >   note that "the rule is mode-independent … the merge-authorization
    >   gate that constitutes the approval event is itself invariant across
    >   all four modes" records 0101's authoring-time reasoning; the revised
    >   Requirement 4 is the operative statement of the approval-event model,
    >   and the immutable parent body is left unedited.

## MODIFIED

1. **Requirement 4 is replaced** to make the *approval event* mode-dependent
   while keeping the `draft` → `approved` rule mode-independent in effect.

   - Original Requirement 4:

     > The rule SHALL apply independently of interaction mode — in `FULL`,
     > `INTERMEDIATE`, `MINIMAL`, and `AUTO` alike — because the
     > merge-authorization request that authorizes a spec-PR's merge is
     > fired in every mode and is the approval event that the `approved`
     > status records.

   - Replacement Requirement 4:

     > The `draft` → `approved` rule SHALL apply in all four interaction
     > modes — `FULL`, `INTERMEDIATE`, `MINIMAL`, and `AUTO` — in the sense
     > that every mode has a real approval event whose grant the recorded
     > `approved` status reflects; which user gate constitutes that approval
     > event, however, is mode-dependent. In `FULL`, `INTERMEDIATE`, and
     > `MINIMAL` the approval event is the SPECS-stage content-approval gate,
     > and that same content-approval — because the spec content it approves
     > becomes a one-file spec-PR that merges unchanged — discharges the
     > merge-authorization request for that spec-PR, so no second
     > merge-authorization ask is fired. In `AUTO`, where no SPECS-stage
     > content gate runs, the approval event is the merge-authorization
     > request, which still fires and remains the sole approval event. The
     > rule is thus mode-independent in effect — no mode lacks a real
     > approval decision to record — while the gate that constitutes the
     > approval event differs by mode.

2. **Requirement 5 is replaced** so that "recorded only after the approval
   has been secured" references whichever gate constitutes the approval
   event, not the merge-authorization request specifically.

   - Original Requirement 5:

     > The amended section SHALL require that the `draft` → `approved`
     > transition be recorded only after the spec-PR's merge-authorization
     > approval has been secured, so that a spec's recorded `approved`
     > status always reflects an approval decision that has actually been
     > made and never one presumed ahead of that authorization.

   - Replacement Requirement 5:

     > The amended section SHALL require that the `draft` → `approved`
     > transition be recorded only after the approval event has been secured
     > — where "the approval event" is whichever gate constitutes it under
     > the revised Requirement 4 (the SPECS-stage content-approval gate in
     > `FULL`, `INTERMEDIATE`, and `MINIMAL`; the merge-authorization request
     > in `AUTO`) — so that a spec's recorded `approved` status always
     > reflects an approval decision that has actually been made and never
     > one presumed ahead of that approval.

3. **The `AUTO`-mode scenario is replaced** to state that the
   merge-authorization gate still fires in `AUTO` because no content gate
   discharges it; its When/Then outcome is unchanged, only the "invariant
   across every mode" characterization is corrected.

   - Original scenario:

     ```text
     **Scenario:** The rule applies in AUTO mode because the merge gate is invariant

     Given a spec-PR authored autonomously in AUTO mode with `status: draft`
     And   the merge-authorization gate — invariant across every mode, AUTO
           included — has been granted for that spec-PR
     When  the spec-PR is merged to `main`
     Then  the merged spec file carries `status: approved`, recorded in the
           spec-PR's own commit, exactly as in the other three modes
     And   no separate post-merge status-transition pull request is required
     ```

   - Replacement scenario:

     ```text
     **Scenario:** In AUTO mode the spec-PR merge-authorization gate still
     fires and is the approval event

     Given a spec-PR authored autonomously in AUTO mode with status draft
     And   no SPECS-stage content-approval gate ran to discharge it, so the
           merge-authorization request still fires and is granted for that
           spec-PR
     When  the spec-PR is merged to main
     Then  the merged spec file carries status approved, recorded in the
           spec-PR's own commit, exactly as in the other three modes
     And   no separate post-merge status-transition pull request is required
     ```

4. **The out-of-scope bullet on the merge-authorization gate is replaced**
   to acknowledge that this delta does alter *when* the gate fires for
   one-file spec-PRs, while leaving its form and its behavior for every
   other merge unchanged.

   - Original bullet:

     > Any change to the merge-authorization gate itself or to the
     > `interaction-mode` frontmatter semantics. This spec relies on both as
     > fixed constraints; it sets `interaction-mode` at the `approved`
     > transition only to satisfy the existing frontmatter schema, and does
     > not alter when or how the gate fires.

   - Replacement bullet:

     > Any change to the *form* of the merge-authorization gate itself, or
     > to the `interaction-mode` frontmatter semantics. This delta does
     > alter *when* the merge-authorization gate fires for a one-file
     > spec-PR — in `FULL`, `INTERMEDIATE`, and `MINIMAL` a prior
     > SPECS-stage content-approval of the identical, unchanged spec content
     > discharges it, so it is not fired a second time — but it leaves the
     > gate's form unchanged, leaves it mandatory and un-discharged for every
     > merge the carve-out does not cover, and still sets `interaction-mode`
     > at the `approved` transition only to satisfy the existing frontmatter
     > schema.

## REMOVED

(None. This delta modifies Requirements 4 and 5, the `AUTO`-mode scenario,
and one out-of-scope bullet, and adds six requirements, two scenarios, and
seven out-of-scope bullets; it removes no requirement, scenario, or
out-of-scope item. Requirements 1, 2, 3, 6, 7, and 8 of spec 0101 remain in
force unchanged.)
