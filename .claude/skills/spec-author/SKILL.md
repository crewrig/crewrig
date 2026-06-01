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
    version: "1.0.2"
---


# Spec Author

The `spec-author` skill turns a raw user intent into a draft specification
file under `/specs/` conforming to `docs/spec-format.md`. It owns the
*qualification* phase of the ADR-0010 lifecycle — answering "what does the
user actually want" — and emits exactly one artefact: a Markdown spec file.
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
2. **Out-of-scope check.** "Is there a nearby behaviour you do NOT want
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
(`community-config/skills/harness-report/SKILL.md`) rather than
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
waiting for an acknowledgement.

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
