---
name: spec-author
description: "Specification authoring for the SPECS stage of the ADR-0010 lifecycle. Activate as step 0 of any non-trivial ticket, before architect, developer or tester, to qualify the intent and emit one spec under `/specs/` per `docs/spec-format.md`. Mode-aware (FULL/INTERMEDIATE/MINIMAL/AUTO)."
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
    version: "1.10.1"
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

Read `references/interview-script.md` when qualifying the intent, before asking anything.

## Pre-write grounding

Read `references/pre-write-grounding.md` before drafting the spec.

## Output contract

Read `references/output-contract.md` before writing the file (ticket pickup, ID allocation, frontmatter, body, delta mode, self-validation).

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
(per [`docs/retroactive-loop.md`](../../../docs/retroactive-loop.md)
→ *Routing matrix*):

- **As reviewer.** When the skill reviews a spec-PR (originating or
  delta), every finding it emits SHALL carry exactly one `class:`
  field whose value is `tech`, `arch`, or `spec`. Untagged findings
  are malformed and trigger a retag round-trip that does NOT
  increment the iteration counter. The review runs on the
  `specs/<ticket>` seat: the verdict carries a `seat:` line at the
  placement its posting transport dictates, findings carry `s<N>-F<M>`
  identifiers where
  `<N>` counts the seat's passes across every artifact of that surface,
  and a fresh delta-spec PR is a **replaced artifact** — examined in
  full, with the seat's dossier retained for the prior-finding audit.
  The contract is `docs/reviewer-seat.md`.
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
