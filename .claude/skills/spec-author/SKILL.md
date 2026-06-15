---
name: spec-author
description: "Specification authoring skill for the SPECS stage of the ADR-0010 lifecycle. Activate as step 0 of any non-trivial ticket — before any architect, developer, or tester — to qualify the user intent and emit exactly one Markdown spec file under `/specs/` conforming to `docs/spec-format.md`. Mode-aware (FULL / INTERMEDIATE / MINIMAL / AUTO) and gated on resolved open questions."
license: Apache-2.0
allowed-tools:
  - Read
  - Glob
  - Write
  - Bash
user-invocable: true
metadata:
  provenance:
    canonical: "https://github.com/crewrig/crewrig"
    feedback: "https://github.com/crewrig/crewrig"
    version: "1.3.2"
---


# Spec Author

The `spec-author` skill turns a raw user intent into a draft specification
file under `/specs/` conforming to `docs/spec-format.md`. It owns the
*qualification* phase of the ADR-0010 lifecycle — answering "what does the
user actually want" — and emits exactly one artifact: a Markdown spec file.
It does not plan, design, or implement; those belong to downstream skills.

The skill is mode-aware (FULL / INTERMEDIATE / MINIMAL / AUTO per ADR-0010
→ *Interaction modes*) and adjusts interview depth accordingly. AUTO
authors the spec end-to-end with zero questions; the other three modes
escalate user gating.

## When to activate

1. **Explicit user invocation.** The user types `/spec` (or the equivalent
   CLI activation phrase). Optional flags: `--mode=FULL|INTERMEDIATE|MINIMAL|AUTO`,
   `--issue=<number>`. Absent `--issue`, the skill infers the parent ticket
   from the current context.
2. **Orchestrator routing of a fresh ticket.** Any new ticket whose tier
   is not `trivial` (per ADR-0010 → *Complexity tiers*) routes through
   `spec-author` before any other team role. Trivial tickets bypass — the
   orchestrator handles them inline.
3. **`spec`-class REVIEW finding** (per ADR-0010 → *Routing matrix*). The
   retroactive routing engine re-invokes the skill to author a
   delta-spec (`/specs/<NNNN>-<slug>.delta-<NN>.md`) per `docs/spec-format.md`
   → *Delta-spec convention*. The skill detects delta mode by the presence
   of a parent spec for the ticket and switches its output template to the
   three delta sections (`## ADDED` / `## MODIFIED` / `## REMOVED`).

## Inputs

The skill expects one of:

- A raw user intent in free-form prose (typical for `/spec` invocations
  without a flag).
- `--issue <N>` — the skill reads the GitHub issue body, related comments,
  and any pre-existing logbook context to derive the intent. Use `gh issue
  view <N> --json title,body,comments` to retrieve it.
- A parent-ticket context provided by the orchestrator at step 0 of a
  non-trivial template.

The skill SHALL pick the interaction mode in this order: (a) explicit
invocation flag, (b) the parent ticket's declared mode if one already
exists, (c) the framework default **INTERMEDIATE**.

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
[`specs/0002-spec-author-skill.md`](../../../specs/0002-spec-author-skill.md).
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
[`specs/0002-spec-author-skill.md`](../../../specs/0002-spec-author-skill.md)
→ `## Scenarios` codify the R15 contract; the two scenarios added by
delta-04 codify the R17 contract. A spec-PR that ships an interview
batch without a preface, with an opaque option `description`, with
an undefined acronym, or with a non-English-language calque from the
R17 catalog, is a `class: tech` finding in the retroactive review
loop.

## Pre-write grounding

Before writing the `## Requirements` section of a spec that qualifies
a **verification, audit, or sanity-check tool** whose acceptance is
file-level, run a short grounding pass against the codebase. The pass
realizes R16 of
[`specs/0002-spec-author-skill.md`](../../../specs/0002-spec-author-skill.md)
(introduced by delta-03) and exists because the friction reported in
issue #194 — spec 0007 mandated a `type` field that no built artifact
ever exhibited, discovered only at DEV time — proves that a WHAT
qualified in isolation from the actual code drifts. The grounding
step is the cheap safety net that catches the drift at qualification
time.

**Mode applicability.** The grounding step runs in all four
interaction modes — `MINIMAL`, `INTERMEDIATE`, `FULL`, and `AUTO`.
In `AUTO` the user has no interactive surface to challenge the
requirements list before the spec PR opens, so grounding is the only
catcher; any anomaly bullet emitted in `AUTO` carries the
`[AUTO-PARKED]` discipline of R10 and is audited post hoc via the PR
diff. A residual risk remains in `AUTO` — a missed-in-scope
classification produces no bullet at all and no `[AUTO-PARKED]`
entry to audit — acknowledged in spec 0002 delta-03's `### Risks`
section.

### Detection

Classify the spec as in-scope for grounding when ANY of the four
conditions below holds for any drafted requirement. Use the
disjunction, not a conjunction — a single match flips the spec
in-scope.

- **a. Quantifier pattern.** The requirement contains *"every"* or
  *"each"* followed by a noun naming a built artifact class.
  Example: *"every built `SKILL.md` frontmatter SHALL contain a
  `type` field"* — `every` + `SKILL.md frontmatter` triggers.
- **b. File-level assertion.** The requirement asserts a property at
  the file level: an `exit zero`-style claim, a field-presence claim,
  a layout claim, or a content-shape claim. Example: *"the linter
  SHALL exit zero on a clean checkout"* — file-level outcome triggers.
- **c. Validation-verb on existing class.** The requirement uses a
  validation, rejection, refusal, or enforcement verb (*refuse*,
  *reject*, *validate*, *require*, *mandate*, *disallow*, *enforce*,
  *forbid*) acting on a property of an artifact class the codebase
  already produces. Example (the iter:1 reviewer counter-example
  that motivated this clause): *"the build script SHALL refuse to
  publish bundles whose `provenance` block is missing the `version`
  field"* — `refuse` + property of `bundles` (an existing class)
  triggers via condition c. Note that condition a does NOT fire here
  (no `every` / `each`); condition c is the catcher.
- **d. Semantic catch-all.** The drafted requirement describes the
  shape, structure, or content of a class of artifacts the codebase
  already produces, regardless of surface wording. Example: *"the
  ADR header MUST carry the status badge in the second line"* — no
  quantifier, no validation verb, but the requirement targets the
  shape of an existing class.

**False-positive preference.** When uncertain whether a requirement
triggers any of the four conditions, treat it as in-scope and run the
grounding step. Grounding ceremony in an out-of-scope case costs one
extra file read; grounding skipped in an in-scope case re-introduces
the original #194 friction. Bias accordingly.

### Inspection

When the spec is in-scope:

1. **Pick the artifact class.** Read the noun in the drafted
   requirement (e.g. *"every built SKILL.md frontmatter"* →
   `artifacts/core/skills/*/SKILL.md`). When the requirement names
   multiple classes, pick one per class.
2. **Pick at least one real instance.** A safe default is the
   most-recently-modified file under the class's canonical path
   (`git log -1 --name-only` scoped to the path). Choose more
   instances when the class is heterogeneous (e.g. skills and
   agents both ship `metadata.provenance` — inspect one of each).
3. **Read the instance end-to-end** when the file is short, or read
   the relevant section (frontmatter, header block, target field)
   when the file is long. Use the same `Read` / equivalent tool the
   skill already uses for repository content; no new tooling
   required.

### Comparison

Cross-check the observed shape against the drafted requirement. Look
specifically for:

- **Missing fields.** The requirement mandates a field that the
  observed instance does not exhibit. (The #194 origin case — spec
  0007's `type` field.) Distinguish "absent from this instance" from
  "absent from every instance" — the latter is the *New field on
  existing class* path below.
- **Layout divergence.** The requirement implies a structural layout
  (field nesting, section ordering, header level) the observed
  instance does not match.
- **Path mismatch.** The requirement assumes a canonical path
  (`artifacts/core/skills/<name>/SKILL.md`) that does not match
  where the class actually lives in the codebase.

The comparison is informational — the skill is checking that the
WHAT it is about to qualify matches the WHAT already in the codebase,
not refactoring the codebase to match the spec.

### Anomaly emission

When the comparison surfaces an anomaly, emit a single bullet under
`## Open questions` prefixed `[GROUNDING:]`. The bullet blocks skill
exit per R10's open-question discipline (`MINIMAL` / `INTERMEDIATE` /
`FULL`) or lands as `[AUTO-PARKED]` (`AUTO`). One bullet per anomaly,
each one one line, naming the observed shape, the drafted requirement,
and the reconciliation that the user (or AUTO-mode audit reader) must
take.

Worked example:

```text
- [GROUNDING:] artifacts/core/skills/spec-author/SKILL.md frontmatter
  has no 'type' field; the drafted R8 mandates it. Reconcile before exit
  — either drop R8, retarget the requirement at a different artefact
  class, or scope the back-fill in `## Out of scope`.
```

The bullet names enough context for the reader to act without
re-reading the inspection trail: which file was inspected, what the
delta is, what the next decision is.

### Conforming-case silence

When the inspection confirms the observed shape matches the drafted
requirements, emit **nothing**. No `[GROUNDING:]` bullet, no
"grounding confirmed" line, no audit trail in the spec body. The
absence of pushback is the only signal. This keeps the spec lean —
the spec body documents the WHAT, not the qualification ceremony —
and the grounding step is auditable from the absence of an open
question, not from a manufactured marker.

### New field on existing class

When the spec mandates a field, attribute, or property that no
instance of the artifact class currently exhibits on `main` (the
PR-189 scenario that originated this discipline), still run the
inspection. The purpose is no longer to confirm field presence
(absent by definition) but to confirm two adjacent facts:

- The artifact class genuinely exists in the codebase under the
  path the spec assumes — no typo, no stale path.
- The existing instances have a coherent shape into which the new
  field can be added without breaking the structure.

Emit a `[GROUNDING:]` bullet under `## Open questions` stating
explicitly that the field is absent from every existing instance and
naming who is responsible for the back-fill: the implementation PR
that realizes this spec, a migration PR scoped under `## Out of
scope`, or a separate follow-up ticket. This forces the back-fill
scope decision into the spec PR rather than deferring it to DEV time.

Worked example:

```text
- [GROUNDING:] No `artifacts/core/skills/*/SKILL.md` on main carries
  a `type: skill` frontmatter field; the drafted R8 mandates it.
  Back-fill responsibility: the implementation PR for this spec SHALL
  add `type:` to every existing skill source in the same diff.
```

## Output contract

The skill writes exactly one new file:

```text
/specs/<NNNN>-<slug>.md
```

The file SHALL conform to `docs/spec-format.md` (the normative format
contract). Below is the skill-side summary; on any conflict, the format
document wins.

### ID allocation

`<NNNN>` is the next free monotonic id across the whole `/specs/`
directory, zero-padded to four digits. The skill discovers it by:

1. Listing `/specs/*.md` (excluding `_template.md`, `README.md`, and any
   `*.delta-*.md`).
2. Parsing each filename's `<NNNN>` prefix.
3. Selecting `max(existing) + 1`. If `/specs/` contains no numbered
   file, start at `0001`.

The skill SHALL NOT reuse an id from archived or superseded specs (per
`docs/spec-format.md` → *Naming convention*: spec ids are cheap and
never reused). On a collision detected at write time (race with a
sibling agent), the skill bumps to the next free id and retries —
non-fatal.

### Frontmatter

Populate every required field per `docs/spec-format.md` → *Frontmatter
schema*:

| Field | Source |
|---|---|
| `id` | Allocated as above, quoted string. |
| `slug` | Generated from the intent; kebab-case, ASCII, ≤ 40 chars. |
| `status` | Always `draft` on first write. |
| `complexity` | From the user (INTERMEDIATE/FULL) or skill-judged (AUTO/MINIMAL). |
| `interaction-mode` | The mode the skill is running in. MAY be omitted in `draft`; the skill SHOULD write it explicitly to lock the choice. |
| `related-issue` | The GitHub issue number the skill is invoked against. |
| `version` | `1.0.0`. |
| `max-iterations` | Omitted by default (inherits ADR-0010's 5). |
| `superseded-by` | Omitted (only present for `superseded` status). |

The filename slug and the frontmatter slug SHALL match exactly.

### Body sections

All five mandatory sections per `docs/spec-format.md` → *Mandatory body
sections* SHALL be present, in order, with their headings verbatim:

1. `## Intent` — one paragraph, no HOW words.
2. `## Requirements` — numbered list, every line uses SHALL or MUST.
3. `## Scenarios` — at least one happy-path AND at least one failure-path
   scenario in Given/When/Then form.
4. `## Out of scope` — bullet list; MAY be empty only for `trivial` tier.
5. `## Open questions` — bullet list; MAY be empty.

A section MAY be empty in `draft` (the linter checks header presence,
not body content) but the skill SHOULD avoid emitting empty sections
when content is derivable — empty sections in a draft are a smell the
spec reviewer will flag.

### Delta-spec mode

When the skill is invoked on a ticket that already has a parent spec
(activation trigger 3), the output file is named
`/specs/<NNNN>-<slug>.delta-<NN>.md` where `<NN>` is the next free
two-digit delta number for the parent. The body replaces the five
mandatory sections with the three delta sections defined in
`docs/spec-format.md` → *Delta-spec convention* (`## ADDED`,
`## MODIFIED`, `## REMOVED`), all three present even when empty.

### Self-validation (best-effort)

Before writing, the skill SHALL re-read `docs/spec-format.md` and verify
locally that: (a) all five headings are present in order, (b)
frontmatter parses as YAML, (c) every required field has a value of the
right type. Enforcement of the format is the spec linter's job; this
self-check is a courtesy, not a substitute.

## Open-questions discipline

Any unresolved entry in `## Open questions` SHALL block skill exit in
MINIMAL, INTERMEDIATE, and FULL modes until either:

- Resolved (rewritten as a requirement, scenario, or out-of-scope bullet); or
- Explicitly parked with the user's recorded consent. Parked items remain
  in `## Open questions` with the prefix `[USER-PARKED]`.

The skill is **forbidden** from silently dropping an unresolved question
— that pre-bakes a `spec`-class finding into the REVIEW loop, which
`docs/spec-format.md` → *Open questions* explicitly calls out as wasted
iteration.

In **AUTO** mode the same discipline applies with no user round-trip:
unresolved items land under the prefix `[AUTO-PARKED]` and the user
audits after the fact via the spec PR.

## Finding class taxonomy

This skill participates in the retroactive review loop on both ends
(per [`specs/0005-retroactive-routing-engine.md`](../../../specs/0005-retroactive-routing-engine.md)
R2, R6 and [`docs/retroactive-loop.md`](../../../docs/retroactive-loop.md)
→ *Routing matrix*):

- **As reviewer.** When the skill reviews a spec-PR (originating or
  delta), every finding it emits SHALL carry exactly one `class:`
  field whose value is `tech`, `arch`, or `spec`. Untagged findings
  are malformed and trigger a retag round-trip that does NOT
  increment the iteration counter.
- **As re-spawn target.** When invoked on a `class: spec` REVIEW
  finding (activation trigger 3 above), the skill operates in
  **delta-spec mode only** — the original spec on `main` is
  immutable per ADR-0010 and spec 0003. The `superseded` transition
  is a new-ticket path outside the loop. The skill SHALL surface a
  violation if the incoming routing request omits the `class:` tag
  or asks for a non-delta re-author of an existing spec.

## Harness friction tagging

When a recognition signal fires (see `config/TOOLS.md` → *Friction
Reporting → Recognition signals*), invoke the `harness-report` skill
(`artifacts/library/skills/harness-report/SKILL.md`) rather than
reimplementing the protocol inline. The skill is the single canonical
implementation of the tagging contract.

In addition to the default recognition signals, the following spec-author
specific triggers SHALL fire a harness-report:

| Trigger | `room` | Notes |
|---|---|---|
| The user pushes back on the drafted intent twice in a row in the same session (rewrites it both times). | `prompt` | Signal that the interview's intent question is misleading. |
| A drafted spec fails the skill's own pre-write self-validation and the failure root-causes to ambiguous wording in `docs/spec-format.md`. | `format` | Subcategory: `spec-format`. Evidence: the failing spec path + the ambiguous sentence. |
| The skill cannot determine the next free `<NNNN>` due to a malformed existing filename in `/specs/`. | `process` | Subcategory: `spec-id-allocation`. |
| In AUTO mode, the skill is forced to `[AUTO-PARKED]` more than five Open questions on a single spec. | `behavior` | High signal that AUTO is being asked to solve an ill-defined ticket; the user should re-route through INTERMEDIATE. |
| A second `spec`-class REVIEW iteration on the same ticket cites a question the skill already attempted to resolve in the prior pass. | `prompt` | Subcategory: `delta-spec-interview`. The interview is missing the right question. |

Tagging is fire-and-forget; the skill SHALL NOT block the user's work
waiting for an acknowledgment.

## Not in scope

The following belong to sibling tickets and SHALL NOT be implemented
inside the `spec-author` skill:

- **Build-time multi-CLI distribution** of the skill and agent — tracked
  in issue #174.
- **Retroactive routing engine** that re-invokes the skill on `spec`-class
  REVIEW findings — tracked in issue #172. The skill declares the
  activation trigger; wiring the trigger is #172.
- **Complexity-tier selection logic** beyond asking the user
  (INTERMEDIATE/FULL) or proposing a reasonable default (AUTO/MINIMAL) —
  tracked in issue #173.
- **Plan format and plan-review protocol** — tracked in issue #169. The
  skill produces specs, never plans.
- **Spec linter** — tracked in issue #178. The skill self-validates
  best-effort; enforcement is the linter's job.
