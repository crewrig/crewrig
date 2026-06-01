---
id: "0002"
slug: spec-author-skill
status: draft
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 193
version: 1.2.0
---

# 0002 — spec-author-skill (delta-02)

This delta adds one requirement on the **prose discipline** the
`spec-author` skill SHALL apply to every batch of interview questions
posed to the user. The friction reported in #193 (rephrased: terse
question labels and unexplained shorthand made the user unable to
ground decisions during the spec interview for a prior ticket) is a
prompt-quality defect, not a structural one — the skill already
selects the right number of questions per mode; it merely fails to
frame them. This delta closes the framing gap.

The friction's `suggestion:` field cited four preface anchors —
*EPIC*, *ticket*, *interview-pass position*, and *decisions already
taken*. R15 collapses the first two into a single *originating ticket
identifier* anchor because the concept *EPIC* is not first-class in
`AGENTS.md`: the repository's lifecycle (per ADR-0010) tracks logbook
issues, not multi-ticket epics. Re-introducing EPIC as a mandatory
anchor would import a concept the framework does not otherwise carry.

## ADDED

1. **New requirement (R15) — contextualizing prose around interactive
   question batches.** In `MINIMAL`, `INTERMEDIATE`, and `FULL` modes,
   every batch of questions the skill emits to the user via
   `AskUserQuestion` (or the host CLI's equivalent interactive
   primitive) SHALL be preceded by a short prose paragraph that recalls
   the following four anchors, in this order:

   1. The originating ticket identifier (GitHub issue number or
      equivalent).
   2. The current lifecycle stage (here always `SPECS`) and the
      artefact being authored (e.g. *"delta-spec on parent spec 0002"*).
   3. The current interview-pass position — which question of which
      mode (e.g. *"Question 4 of 6 — failure-path scenario"*).
   4. The decisions already taken in this session, summarised in one
      or two clauses (e.g. *"complexity tier already set to `small`,
      interaction mode to `INTERMEDIATE`"*).

   In addition:

   - **Acronym discipline.** Any acronym that is not part of the
     widely-used software-engineering vocabulary (examples of
     acronyms that DO need explanation at first use within the batch:
     `OQ` for *Open Question*, `R1` for *Requirement 1*, `NNNN` for
     the four-digit spec id; examples that do NOT need explanation:
     `PR`, `CI`, `URL`) SHALL be spelled out the first time it appears
     in a question, including the prose preface and every option
     `description` field.
   - **Description self-sufficiency.** The `description` field of each
     option in an `AskUserQuestion` call SHALL carry enough rationale
     for the user to make a decision without re-reading prior turns of
     the conversation. This is mandatory because the option
     `description` renders in a side panel disconnected from the
     question text and from any preceding chat history.

   The `AUTO` mode poses no questions and is therefore not in scope.

## MODIFIED

1. **`specs/0002-spec-author-skill.md` → `## Scenarios` (after the
   existing *"Delta mode on a `spec`-class REVIEW finding"* scenario).**
   Three new failure-path scenarios SHALL be inserted, one per R15
   sub-rule, recording the contracts the cold spec-reviewer enforces
   on prose discipline:

   ```text
   **Scenario:** Reviewer rejects an interview question batch with no
   contextualizing preface

   Given the skill is running in `INTERMEDIATE` mode and is about to
         emit a question batch to the user
   When  the batch is emitted without a prose preface recalling the
         ticket, the lifecycle stage, the interview-pass position, and
         the decisions already taken
   Then  the cold spec-reviewer SHALL reject the resulting spec PR
   and   the finding SHALL carry `class: tech` per the retroactive
         routing matrix
   ```

   ```text
   **Scenario:** Reviewer rejects an interview question batch with
   unexplained non-standard acronyms

   Given the skill is running in `INTERMEDIATE` mode and is about to
         emit a question batch containing a non-standard
         software-engineering acronym at its first use within the
         batch (for example `OQ`, `R1`, `NNNN`)
   When  the batch is emitted without spelling out the acronym at
         that first use, either in the question prose, in the option
         labels, or in the option `description` fields
   Then  the cold spec-reviewer SHALL reject the resulting spec PR
   and   the finding SHALL carry `class: tech` per the retroactive
         routing matrix
   ```

   ```text
   **Scenario:** Reviewer rejects an interview question batch whose
   option descriptions require prior-turn context to be understood

   Given the skill is running in `INTERMEDIATE` mode and is about to
         emit a question batch whose options each have a `description`
         field
   When  any option's `description` field references a decision,
         identifier, or concept introduced in an earlier conversation
         turn without restating it inline
   Then  the cold spec-reviewer SHALL reject the resulting spec PR
   and   the finding SHALL carry `class: tech` per the retroactive
         routing matrix
   ```

## REMOVED

(None. The delta adds discipline; no existing requirement is removed
or relaxed.)
