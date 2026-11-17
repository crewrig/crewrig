# Interview script

Each mode shares the same output contract (see the skill's output contract) and
differs only in how you gather the information.

## AUTO — zero questions

The skill SHALL ask the user no questions. It reads the ticket body,
related comments, and any pre-existing logbook context, then drafts all
five mandatory body sections itself. Every gap the skill cannot
confidently close becomes a bullet in `## Open questions` prefixed with
`[AUTO-PARKED]`. The user audits after the fact via the merged spec PR.

## MINIMAL — three questions

Asked in order, one at a time, only when the answer is not already
unambiguously derivable from the ticket:

1. **Intent confirmation.** "Confirm in one sentence the user-facing
   change. Anything missing from: *&lt;draft intent&gt;*?"
2. **Out-of-scope check.** "Is there a nearby behavior you do NOT want
   this spec to cover?"
3. **Acceptance signal.** "What single observable outcome will tell us
   the spec is satisfied?" (drives the happy-path scenario).

The skill autonomously drafts requirements, scenarios, and complexity
tier. Open questions are surfaced for the user to resolve before exit.

## INTERMEDIATE — default; six questions

Extends MINIMAL with three more, asked after the first three (numbered
4–6 as a continuation of the MINIMAL list):

- **Failure path.** "What should happen if &lt;the obvious failure
  condition&gt; occurs?" (drives the failure-path scenario).
- **Complexity tier.** "Does this fit `trivial`, `small`, `standard`,
  or `large`? *&lt;skill's proposed tier with rationale&gt;*."
- **Open-questions review.** "These points are unresolved — pick one:
  resolve now / park explicitly / drop." (one pass per unresolved item).

## FULL — INTERMEDIATE plus per-section validation

After drafting each of the five mandatory body sections, the skill SHALL
present the drafted section verbatim and request explicit sign-off
("approve / revise / reject") before moving on. The user gates exit on
the same Open-questions discipline as INTERMEDIATE.

## Prose discipline for interactive batches

The first three rules below apply to MINIMAL, INTERMEDIATE and FULL, wherever
you emit an `AskUserQuestion` (or the host CLI's equivalent prompt). They exist
because interview text often renders in a side panel that strips the prior chat:
the user sees the question and the option descriptions in isolation, so treat
each batch as the first thing they read. The fourth rule also covers AUTO
whenever it emits a user-visible artifact in a language other than English.

- **Preface anchors.** Before every interactive batch, write a short paragraph
  that names, in order: the originating ticket (issue number or spec id); the
  lifecycle stage and the artifact being authored; the position as "Question N
  of M, short label"; and a one-or-two-clause recap of the decisions already
  taken. Example at the third MINIMAL question: *"Issue 193, SPECS stage,
  authoring `specs/0002-...-delta-03.md`. Question 3 of 3 (acceptance signal).
  So far: intent confirmed as the prose-discipline edit, and the
  `harness-report` skill is out of scope."*
- **Acronym discipline.** Spell out non-standard vocabulary at first use in the
  batch, including inside every option `description`: `OQ` (Open Question),
  `R1`, `R2`... (Requirement N), `NNNN` (the four-digit spec id), `delta-NN` (the
  two-digit delta number). Leave `PR`, `CI`, `URL`, `ADR` and `CLI` bare. When in
  doubt, spell it out.
- **Description self-sufficiency.** Each option's `description` renders apart
  from the question and the history, so it must carry enough rationale to decide
  on its own. Bad: *"Use the same approach as before."* Good: *"Reuse the
  `INTERMEDIATE` interview path (six questions, user-gated), the gating model
  already chosen for this ticket; it lets the user audit each draft section
  before commit."*
- **Idiomatic language.** When the user's language is not English (stated, seen
  in their last three messages, or carried over uncorrected), write the preface,
  questions, option labels and descriptions, progress messages and any AUTO
  artifact in idiomatic prose in that language. Avoid calques of English
  engineering jargon: `-er` verbs built on English ones (`spawner`, `shipper`,
  `merger` as a verb), `cold reviewer` left untranslated (say *contrôle
  indépendant*), `verdicter` (say *rendre un verdict* or *trancher*), `en-branche`
  (say *directement sur la branche*), a bare `PR` with no first-use expansion to
  *pull-request*. The list is not exhaustive; extrapolate, and prefer the longer
  idiomatic phrasing to franglais.

A batch with no preface, an opaque description, an undefined acronym or a calque
is a `class: tech` finding when the spec-PR is reviewed.
