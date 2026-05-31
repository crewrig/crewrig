---
id: "0004"
slug: plan-format-and-review
status: draft
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 169
version: 1.0.0
---

# Plan format and plan-review protocol

## Intent

Contributors gain a normative plan format and a matching review protocol
so the PLAN stage of the ADR-0010 lifecycle produces a structured,
classifiable artefact on the logbook issue before the DEV stage starts,
giving findings a stable shape that the retroactive review loop can route.

## Requirements

1. The PLAN stage SHALL emit exactly one artefact: a Markdown comment
   posted on the logbook issue (per *Logbook Issues → Rule A*) whose
   first line is the header `## PLAN — issue #<N> (spec <NNNN>)`.
2. Every plan comment SHALL contain, in order, the following five
   mandatory sections, with their headings verbatim:
   1. `### Approach` — one paragraph.
   2. `### Steps` — ordered list; each step SHALL name the concrete
      file path(s) it touches and a one-line description of the edit.
   3. `### Blast radius` — bullet list of affected code paths, downstream
      tickets, build outputs, version-bump triggers, and CLI-matrix
      trigger surfaces.
   4. `### Alternatives considered and rejected` — at least one
      alternative, each with a one-line rationale.
   5. `### Rollback strategy` — one paragraph.
3. A plan comment MAY include an optional `### Risks` section after
   *Rollback strategy*; when present, it SHALL list discrete risks with
   a mitigation or acceptance note for each.
4. Step entries in `### Steps` MAY carry the `[P]` marker to indicate
   the step can run in parallel with the previous step; absence of `[P]`
   means strictly sequential.
5. The plan SHALL be authored by the same `architect` agent role that
   already exists in the team; no new specialist role is introduced.
6. Plan review SHALL be performed by a second `architect` agent spawned
   cold (no authoring context), posting the review as a follow-up
   comment on the same logbook issue whose first line is the header
   `## PLAN review — issue #<N>` followed by a verdict line
   (`### Verdict: APPROVE` or `### Verdict: REQUEST CHANGES`).
7. Every plan-review finding SHALL be tagged with exactly one `class:`
   field (`tech` / `arch` / `spec`) so the retroactive routing engine
   (issue #172) can route the finding to the correct upstream stage.
8. A plan-review verdict of `REQUEST CHANGES` SHALL block the DEV stage
   from starting until a revised plan is posted and re-reviewed.
9. Plan comments SHALL be append-only: once a plan is validated by the
   reviewer (in autonomous modes) or by the user (in FULL/INTERMEDIATE),
   any subsequent revision SHALL be posted as a new comment whose
   header is `## PLAN v<N+1> — issue #<N> (spec <NNNN>) — revision
   after <trigger>`, citing the trigger (DEV finding, user request,
   etc.); silent edits of the validated plan comment are prohibited.
10. `docs/plan-format.md` SHALL document the format normatively and
    SHALL link to one worked example: the validated PLAN comment for
    issue #170 (the first live use of the PLAN stage) at
    `https://github.com/crewrig/crewrig/issues/170#issuecomment-4588163138`.
11. `AGENTS.md` SHALL declare the plan-review protocol in a dedicated
    section and SHALL cross-reference `docs/plan-format.md` for the
    format details; AGENTS.md SHALL NOT duplicate the format schema.

## Scenarios

### Happy path — single review pass

Given a non-trivial ticket #N whose spec-PR has merged on `main`
When the architect drafts a PLAN comment on the logbook with the five
  mandatory sections and posts it
And a second architect is spawned cold to review the plan
Then the reviewer posts a `## PLAN review` comment with verdict
  `### Verdict: APPROVE` and zero findings of any class
And the DEV stage starts immediately from the merged spec and the
  validated plan.

### Happy path — plan revision after DEV finding

Given a validated plan for ticket #N
And DEV in progress discovers that step 3 of the plan is unimplementable
  as written
When the architect posts a follow-up comment whose header is
  `## PLAN v2 — issue #N (spec <NNNN>) — revision after DEV finding`
And the revised plan is re-reviewed by a second architect cold
Then the validated v2 plan supersedes the v1 plan for routing purposes
And the original v1 plan comment SHALL NOT be edited or deleted.

### Failure path — REQUEST CHANGES with arch finding

Given a plan comment posted on the logbook for ticket #N
When the plan reviewer posts `### Verdict: REQUEST CHANGES` with at
  least one finding tagged `class: arch`
Then the DEV stage SHALL NOT start
And the orchestrator SHALL re-spawn the authoring architect with the
  reviewer's findings as input to produce a revised plan
And the revised plan SHALL be re-reviewed cold by a third architect
  (distinct from both the author and the prior reviewer where the
  orchestrator's spawn-pool allows it).

## Out of scope

- The retroactive routing engine that consumes plan-review findings —
  tracked in issue #172. This spec declares the `class:` field shape
  on findings; wiring the routing logic is #172.
- The file-based spec format itself — already shipped in issue #167.
- The `spec-author` skill — already shipped in issue #168. This spec is
  about the PLAN stage, not SPECS.
- A dedicated `plan-reviewer` skill or agent. The protocol intentionally
  reuses the `architect` role with a second cold spawn rather than
  introducing a new specialist; this keeps the surface area minimal and
  defers any decision to add `plan-reviewer` until empirical friction
  surfaces.
- The plan linter that would enforce header presence, section ordering,
  and `class:` tag validity. May be filed as a follow-up if friction
  surfaces after the first ten real plans land.
- Multi-CLI distribution. The plan format is documentation; no skill or
  agent source ships in this ticket, so `scripts/build-components.sh`
  and `docs/cli-matrix.md` are not on the trigger surface.

## Open questions

(none — all interview questions were resolved at SPECS time.)
