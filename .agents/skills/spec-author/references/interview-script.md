# Interview script

## Interview script

Each mode shares the same output contract (see *Output contract*) and
differs only in how the skill gathers the information.

### AUTO — zero questions

The skill SHALL ask the user no questions. It reads the ticket body,
related comments, and any pre-existing logbook context, then drafts all
five mandatory body sections itself. Every gap the skill cannot
confidently close becomes a bullet in `## Open questions` prefixed with
`[AUTO-PARKED]`. The user audits after the fact via the merged spec PR.

### MINIMAL — three questions

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

### INTERMEDIATE — default; six questions

Extends MINIMAL with three more, asked after the first three (numbered
4–6 as a continuation of the MINIMAL list):

- **Failure path.** "What should happen if &lt;the obvious failure
  condition&gt; occurs?" (drives the failure-path scenario).
- **Complexity tier.** "Does this fit `trivial`, `small`, `standard`,
  or `large`? *&lt;skill's proposed tier with rationale&gt;*."
- **Open-questions review.** "These points are unresolved — pick one:
  resolve now / park explicitly / drop." (one pass per unresolved item).

### FULL — INTERMEDIATE plus per-section validation

After drafting each of the five mandatory body sections, the skill SHALL
present the drafted section verbatim and request explicit sign-off
("approve / revise / reject") before moving on. The user gates exit on
the same Open-questions discipline as INTERMEDIATE.

### Prose discipline for interactive batches

The four sub-rules below realize R15 and R17 of
[`specs/0002-spec-author-skill.md`](../../../../specs/0002-spec-author-skill.md).
The first three (preface anchors, acronym discipline, description
self-sufficiency) apply uniformly to MINIMAL, INTERMEDIATE, and FULL —
wherever the skill emits an `AskUserQuestion` (or the host CLI's
equivalent interactive prompt) — and exist because the framework's
interview text frequently renders through a side panel that strips
prior chat context; the user sees the question and option descriptions
in isolation. Treat each batch as if it were the first thing the user
reads in this session. The fourth sub-rule (idiomatic language quality)
extends to AUTO whenever AUTO emits any user-visible artifact in a
language other than English — AUTO is not exempt simply because no
interactive question batch is emitted.

- **Preface anchors.** Before every interactive batch, emit a short
  one-paragraph preface that names, in this order: (1) the originating
  ticket identifier (issue number or spec id), (2) the current
  lifecycle stage and the artifact being authored, (3) the
  interview-pass position as "Question N of M — &lt;short label&gt;",
  and (4) a one-or-two-clause recap of the decisions already taken in
  this session. The preface compensates for the side-panel rendering;
  it is not a re-introduction of the skill. Concrete example for a
  MINIMAL pass at its third question: *"Issue #193 — SPECS stage,
  authoring `specs/0002-…-delta-03.md`. Question 3 of 3 (acceptance
  signal). So far: intent confirmed as the prose-discipline edit, and
  the `harness-report` skill is out of scope."*
- **Acronym discipline.** Non-standard software-engineering vocabulary
  SHALL be spelled out at first use within the batch, including inside
  every option `description`. Treat the following as **illustrative**,
  not exhaustive. Spell out at first use: `OQ` (*Open Question*), `R1`
  / `R2` / … (*Requirement N*), `NNNN` (the four-digit spec id),
  `delta-NN` (the two-digit delta sequence number). Leave bare: `PR`,
  `CI`, `URL`, `ADR`, `CLI`. When in doubt, spell out — the cost of
  redundancy is negligible against the cost of an opaque question.
- **Description self-sufficiency.** Each option's `description` field
  renders in a side panel disconnected from the question text and from
  prior chat history; the user must be able to decide from the
  description alone. Every `description` SHALL carry enough rationale
  to support the decision without re-reading earlier turns.
  Non-self-sufficient (bad): *"Use the same approach as before."*
  Self-sufficient (good): *"Reuse the `INTERMEDIATE` interview path
  (six questions, user-gated) — same gating model already chosen for
  spec 0002's parent ticket; lets the user audit each draft section
  before commit."*
- **Idiomatic language quality.** When the user's preferred language
  is not English (declared explicitly via a memory record or a direct
  *"écris-moi en français"*-style instruction, inferred from the
  last three messages, or inherited from prior session prose without
  correction), produce the preface, the question text, the option
  `label` fields, the option `description` fields, inline progress
  messages, and any AUTO-mode user-visible artifact in **idiomatic**
  prose in that language. Direct calques of English software-
  engineering jargon — verb forms in `-er` derived from English
  verbs (`spawner`, `shipper`, `merger` as a verb, `amender` in the
  English sense), unprefixed `cold reviewer` instead of *"contrôle
  indépendant"*, `verdicter` instead of *"rendre un verdict"* or
  *"trancher"*, `en-branche` instead of *"directement sur la
  branche"*, bare `PR` without first-use expansion to
  *"pull-request"* — SHALL be avoided. The reference catalog is
  in spec 0002 R17 (sub-clause 2). The catalog is non-exhaustive;
  extrapolate from the listed patterns. When in doubt, prefer the
  longer idiomatic phrasing over the calque — verbosity in the
  target language is a smaller cost than the cognitive friction of
  parsing franglais.

Reviewer enforcement: the three failure-path scenarios added by spec
0002 delta-02 in
[`specs/0002-spec-author-skill.md`](../../../../specs/0002-spec-author-skill.md)
→ `## Scenarios` codify the R15 contract; the two scenarios added by
delta-04 codify the R17 contract. A spec-PR that ships an interview
batch without a preface, with an opaque option `description`, with
an undefined acronym, or with a non-English-language calque from the
R17 catalog, is a `class: tech` finding in the retroactive review
loop.
