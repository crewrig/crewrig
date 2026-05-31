# Design note — `spec-author` skill (#168)

**Status:** Design only. The developer turns this note into
`community-config/skills/spec-author/SKILL.md` and
`community-config/agents/spec-author/AGENT.md`. This note is normative
for those two files; nothing else in the repo is touched by #168.

**Upstream contract:** [ADR-0010](../adr/0010-spec-plan-review-lifecycle.md)
and [`docs/spec-format.md`](../spec-format.md). On any conflict
between this note and either source, the upstream wins — STOP and
escalate, do not paper over it.

## 1. Purpose

`spec-author` is the skill that turns a raw user intent into a draft
spec file conforming to `docs/spec-format.md`. It is the entry point
of the SPECS stage of the ADR-0010 lifecycle: every non-trivial
ticket runs through it before any architect, developer, or tester is
spawned. It owns the *qualification* phase — what does the user
actually want — and emits exactly one artefact: a Markdown file
under `/specs/`. It does not plan, design, or implement; those belong
to downstream skills.

The skill is mode-aware (FULL / INTERMEDIATE / MINIMAL / AUTO per
ADR-0010 → *Interaction modes*) and adjusts its interview depth
accordingly. AUTO authors the spec end-to-end with zero questions;
the other three escalate user gating.

## 2. Interview script (by interaction mode)

Each mode shares the same artefact contract (section 3) and differs
only in how the skill gathers the information. The skill SHALL pick
the mode in this order: (a) explicit user invocation flag
(`/spec --mode=FULL` etc.), (b) the parent ticket's declared mode if
one already exists, (c) the framework default **INTERMEDIATE**
(ADR-0010 § *Interaction modes*).

### AUTO — zero questions

The skill SHALL ask the user no questions. It reads the ticket body,
related comments, and any pre-existing logbook context, then drafts
all five mandatory body sections itself. Every gap the LLM cannot
confidently close becomes a bullet in `## Open questions` prefixed
with `[AUTO-PARKED]` (see section 3). The user audits after the fact
via the spec PR.

### MINIMAL — three questions

Asked in order, one at a time, only if the answer is not already
unambiguously derivable from the ticket:

1. **Intent confirmation.** "Confirm in one sentence the user-facing
   change. Anything missing from: *`<draft intent>`*?"
2. **Out-of-scope check.** "Is there a nearby behaviour you do NOT
   want this spec to cover?"
3. **Acceptance signal.** "What single observable outcome will tell
   us the spec is satisfied?" (Drives the happy-path scenario.)

The skill autonomously drafts requirements, scenarios, and complexity
tier. Open questions are surfaced for the user to resolve before
exit.

### INTERMEDIATE — default; six questions

Extends MINIMAL with three more, asked after the first three (numbered
1–3 here to satisfy `MD029/ol-prefix`; conceptually questions 4–6 of
the interview):

1. **Failure path.** "What should happen if `<the obvious failure
   condition>` occurs?" (Drives the failure-path scenario.)
2. **Complexity tier.** "Does this fit `trivial`, `small`,
   `standard`, or `large`? *`<skill's proposed tier with rationale>`*."
3. **Open questions review.** "These points are unresolved — pick
   one: resolve now / park explicitly / drop." (One pass per
   unresolved item.)

### FULL — INTERMEDIATE plus per-section validation

After drafting each of the five mandatory body sections, the skill
SHALL present the drafted section verbatim and request explicit
sign-off ("approve / revise / reject") before moving on. The user
gates exit on the same Open-questions discipline as INTERMEDIATE.

### Common exit gate (MINIMAL / INTERMEDIATE / FULL)

Any unresolved entry in `## Open questions` SHALL block skill exit
until either resolved (rewritten as a requirement, scenario, or
out-of-scope bullet) or explicitly parked with the user's recorded
consent. Parked items remain in `## Open questions` with the prefix
`[USER-PARKED]`. The skill is forbidden from silently dropping an
unresolved question — that pre-bakes a `spec`-class finding into the
REVIEW loop, which ADR-0010 § *Open questions* (via `docs/spec-format.md`
§ 5) explicitly calls out as wasted iteration.

In **AUTO**, the same discipline applies with no user round-trip:
unresolved items land under `[AUTO-PARKED]`.

## 3. Output contract

The skill writes exactly one new file:

```text
/specs/<NNNN>-<slug>.md
```

### 3.1 ID allocation

`<NNNN>` is the next free monotonic id across the whole `/specs/`
directory, zero-padded to four digits. The skill discovers it by:

1. Listing `/specs/*.md` (excluding `_template.md`, `README.md`, and
   any `*.delta-*.md`).
2. Parsing each filename's `<NNNN>` prefix.
3. Selecting `max(existing) + 1`. If `/specs/` contains no numbered
   file, start at `0001`.

The skill SHALL NOT reuse an id from `archived` or `superseded`
specs (per `docs/spec-format.md` § *Naming convention*: "spec ids are
cheap and never reused"). On a collision detected at write time
(race with a sibling agent), the skill bumps to the next free id and
retries — non-fatal.

### 3.2 Frontmatter

Populate every required field per `docs/spec-format.md` § *Frontmatter
schema*:

| Field | Source |
|---|---|
| `id` | Allocated per § 3.1, quoted string. |
| `slug` | Generated from the intent; kebab-case, ASCII, ≤ 40 chars. |
| `status` | Always `draft` on first write. |
| `complexity` | From the user (INTERMEDIATE/FULL) or LLM-judged (AUTO/MINIMAL). |
| `interaction-mode` | The mode the skill is running in. MAY be omitted in `draft` per the schema; the skill SHOULD write it explicitly to lock the choice. |
| `related-issue` | The GitHub issue number the skill is invoked against. |
| `version` | `1.0.0`. |
| `max-iterations` | Omitted by default (inherits ADR-0010's 5). |
| `superseded-by` | Omitted (only present for `superseded` status). |

The filename slug and the frontmatter slug SHALL match exactly.

### 3.3 Body sections

All five mandatory sections per `docs/spec-format.md` § *Mandatory
body sections* SHALL be present, in order, with their headings
verbatim:

1. `## Intent` — one paragraph, no HOW words.
2. `## Requirements` — numbered list, every line uses SHALL or MUST.
3. `## Scenarios` — at least one happy-path AND at least one
   failure-path scenario in Given/When/Then form.
4. `## Out of scope` — bullet list; MAY be empty only for `trivial`
   tier.
5. `## Open questions` — bullet list; MAY be empty.

A section MAY be empty in `draft` (the linter checks header presence,
not body content) but the skill SHOULD avoid emitting empty sections
when content is derivable — empty sections in a draft are a smell the
spec reviewer will flag.

### 3.4 Self-validation (best-effort)

Before writing, the skill SHALL re-read `docs/spec-format.md` and
verify locally that: (a) all five headings are present in order,
(b) frontmatter parses as YAML, (c) every required field has a value
of the right type. Enforcement of the format is the spec linter's
job (#178); this self-check is a courtesy, not a substitute.

## 4. Activation triggers

The skill becomes the orchestrator's step 0 of every non-trivial
template when any of the following fires:

1. **Explicit user invocation.** The user types `/spec` (or the
   equivalent CLI activation phrase for the active CLI). Optional
   flags: `--mode=FULL|INTERMEDIATE|MINIMAL|AUTO`,
   `--issue=<number>`. Absent `--issue`, the skill infers from the
   current ticket context.
2. **Orchestrator routing of a fresh ticket.** Any new ticket whose
   tier is not `trivial` (per ADR-0010 § *Complexity tiers*) routes
   through `spec-author` before any other team role. Trivial tickets
   bypass — the orchestrator handles them inline.
3. **`spec`-class REVIEW finding** (per ADR-0010 § *Routing matrix*).
   The retroactive routing engine (#172) re-invokes `spec-author` to
   author a delta-spec (`/specs/<NNNN>-<slug>.delta-<NN>.md`) per
   `docs/spec-format.md` § *Delta-spec convention*. The skill detects
   delta mode by the presence of an existing parent spec for the
   ticket and switches its output template to the three delta
   sections (`### ADDED` / `### MODIFIED` / `### REMOVED`).

## 5. Routing note for `AGENTS.md`

This note tells the developer **what to insert and where**. The
developer authors the AGENTS.md edit; this design note does not.

**Where:** in the *Agent Team Protocol* → *Standard Team Templates*
subsection, **before the `#### Template 1` heading**, insert a new
subsection titled `Step 0 — spec-author (every non-trivial template)`
at heading level `####`. It precedes Templates 1, 2, and 3 because it
applies to all three.

**Exact body to insert:**

```markdown
#### Step 0 — `spec-author` (every non-trivial template)

Templates 1, 2, and 3 below describe the DEV-stage staffing of the
ADR-0010 lifecycle. Before any of them runs, the `spec-author` skill
authors the SPECS-stage artefact: a single Markdown file under
`/specs/` conforming to `docs/spec-format.md`. The skill is invoked
once per ticket, in the mode declared by the parent ticket (default
INTERMEDIATE per ADR-0010).

The skill runs as step 0 for every ticket whose complexity tier is
NOT `trivial` (ADR-0010 → *Complexity tiers and team sizing*).
`trivial`-tier tickets bypass `spec-author` entirely; the orchestrator
handles them inline per the trivial-tier row of the ADR.

The spec PR SHALL be merged before the team proceeds to PLAN/DEV. The
ordering is enforced by the spec-PR workflow (#170) — agents do not
hand-roll it.
```

Additionally, each of Templates 1, 2, 3 SHALL gain a one-line
preamble immediately under its `####` heading: `Preceded by step 0
(spec-author) — see the subsection above.` The developer inserts this
verbatim in all three templates.

The `architect → developer → tester → pr-logbook → pr-reviewer`
ordering inside each template does NOT change. The PLAN-stage role
of `architect` (writing the plan comment per #169) is out of scope
for this ticket; for now, the architect's step 1 of Template 1
continues to cover both PLAN authorship and design review until #169
formalises the split.

## 6. Harness-report hooks

The skill SHALL tag a friction via the `harness-report` skill
(canonical protocol at `community-config/skills/harness-report/SKILL.md`
— do NOT re-author it) when any of the following fires:

| Trigger | `room` | Notes |
|---|---|---|
| The user pushes back on the drafted intent twice in a row in the same session (rewrites it both times). | `prompt` | Signal that the interview script's intent question is misleading. |
| A drafted spec fails the skill's own pre-write self-validation (section 3.4) and the failure root-causes to ambiguous wording in `docs/spec-format.md`. | `format` | Subcategory: `spec-format`. Evidence: the failing spec path + the ambiguous sentence. |
| The skill cannot determine the next free `<NNNN>` due to a malformed existing filename in `/specs/`. | `process` | Subcategory: `spec-id-allocation`. |
| In AUTO mode, the skill is forced to `[AUTO-PARKED]` more than five Open questions on a single spec. | `behavior` | High signal that AUTO is being asked to solve an ill-defined ticket; the user should re-route through INTERMEDIATE. |
| A second `spec`-class REVIEW iteration on the same ticket cites a question the skill already attempted to resolve in the prior pass. | `prompt` | Subcategory: `delta-spec-interview`. The interview is missing the right question. |

Tagging is fire-and-forget (`config/TOOLS.md` → *Friction Reporting*);
the skill SHALL NOT block the user's work waiting for an
acknowledgement.

## 7. CLI-target constraints

The skill SHALL remain CLI-agnostic in its `SKILL.md` body — no
references to `Claude Code`, `Gemini CLI`, or `Copilot CLI`
mechanics in the prose. Per-CLI integration (Claude Code
`allowed-tools`, Gemini frontmatter overlays, Copilot equivalents)
lives in the YAML frontmatter and is materialised at build time by
`scripts/build-components.sh`. The multi-CLI distribution mechanics
themselves are tracked in **#174** and are explicitly out of scope
for this ticket.

The `AGENT.md` slim wrapper follows the same constraint: it points to
the skill, restates its activation rule in one paragraph, and lets
the skill carry the operational detail. Model the structure on
`community-config/agents/architect/AGENT.md`.

## 8. Out of scope for this ticket

The following are deliberately excluded; the developer SHALL NOT
implement them in the same diff:

- **Build-time multi-CLI distribution** of the skill and agent —
  tracked in **#174**.
- **Retroactive routing engine** that re-invokes the skill on
  `spec`-class REVIEW findings — tracked in **#172**. This note
  declares the activation trigger (section 4 item 3); wiring the
  trigger is #172's job.
- **Complexity-tier selection logic** beyond asking the user (in
  INTERMEDIATE/FULL) or proposing a reasonable default (in
  AUTO/MINIMAL) — tracked in **#173**.
- **Plan format and plan-review protocol** — tracked in **#169**.
  `spec-author` produces specs, never plans.
- **Spec linter** — tracked in **#178**. The skill self-validates
  best-effort (section 3.4); enforcement is the linter's job.
- Editing `docs/cli-matrix.md` — no CLI-specific surface is touched
  by the skill source itself, so the CLI-matrix trigger does not
  fire for #168. #174 will own the matrix update when the skill is
  wired into the build.

## 9. Open design questions

Parked for the developer or the user:

1. **Delta-spec authoring depth.** The skill detects delta mode
   (section 4 item 3), but the exact interview script for delta
   authoring is not specified here. Proposal: reuse the
   INTERMEDIATE/FULL scripts, but constrain answers to the three
   delta sections. Confirm during developer authorship; if it grows
   non-trivial, escalate to a follow-up architect pass before
   shipping.
2. **Slug generation collision policy.** Two near-simultaneous
   tickets could converge on the same slug. The id collision policy
   (section 3.1) handles ids; slugs are not unique-keyed. Proposal:
   the skill warns and lets the user disambiguate in INTERMEDIATE/
   FULL; in AUTO/MINIMAL, append a short hash. Confirm with the user
   if this matters before AUTO mode is used in earnest.
3. **`/spec` activation phrase parity.** Section 4 lists `/spec` as
   the explicit invocation. Whether each CLI maps `/spec` to the
   skill identically is a #174 problem, but if the spelling differs
   the activation trigger documented in this note will need an
   update.
4. **Trivial-tier bypass enforcement.** The note states trivial
   tickets bypass `spec-author`, but does not say who decides the
   tier *before* the spec exists. Current proposal: the orchestrator
   pre-classifies based on the ticket body using a coarse heuristic
   (single-file, no test surface ⇒ trivial). The full tier engine is
   #173; until it lands, agents SHOULD default to `standard` and run
   `spec-author` whenever in doubt.
