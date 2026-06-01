---
id: "0006"
slug: interaction-modes-and-sizing
status: draft
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 173
version: 1.0.0
---

# Interaction modes and complexity-based team sizing

## Intent

Contributors gain operational behavioural contracts for the four
interaction modes (FULL / INTERMEDIATE / MINIMAL / AUTO) and a
complexity-based team-sizing rule so the orchestrator can deterministically
pick the right user-gating profile and the right team composition from
each spec's frontmatter, independently and without re-deriving them at
ticket pickup.

## Requirements

1. The `interaction-mode` and `complexity` axes SHALL be treated as
   **independent**: every spec MAY declare any combination of mode and
   tier; the orchestrator SHALL NOT reject a spec on the basis of an
   unusual combination (e.g. `trivial` + `FULL` or `large` + `AUTO`).
2. `AGENTS.md` *Interaction modes* section SHALL be expanded to carry
   the behavioural contract for every (mode × stage) cell, naming
   precisely which actions trigger a user gate.
3. A **user gate** SHALL be defined narrowly as either (a) a call to
   `AskUserQuestion` or its CLI equivalent, or (b) the merge-
   authorization request that AGENTS.md → *Branching Strategy*
   mandates JUST BEFORE every merge. All other agent outputs
   (informational messages, logbook comments, idle notifications) are
   **not** user gates and SHALL NOT block agent execution.
4. `AGENTS.md` SHALL gain a new section "Team sizing by complexity"
   defining, for each tier, the exact team composition the orchestrator
   SHALL spawn:
   - **trivial** — no team; the orchestrator handles the work inline
     in a single turn.
   - **small** — `developer` + `pr-logbook` + `pr-reviewer`; no
     `architect` (the spec is its own architectural input) and no
     `tester` unless the change carries a test surface.
   - **standard** — existing Templates 1 / 2 / 3 per `AGENTS.md` →
     *Standard Team Templates*; no change to those templates.
   - **large** — `architect`-led decomposition into one or more
     sub-specs before any `developer` spawn; each sub-spec is a
     separate ticket with its own SPECS-stage entry.
5. The orchestrator SHALL read the `complexity` and `interaction-mode`
   fields from the spec's frontmatter once at ticket pickup and SHALL
   NOT re-evaluate them mid-lifecycle; per ADR-0010, the mode is
   immutable once SPECS merges, and the tier can only change via a
   delta-spec amendment routed by the retroactive review loop (#172).
6. `community-config/skills/pr-reviewer/SKILL.md` SHALL be amended with
   an explicit obligation: when acting as **spec-reviewer**, the role
   MUST challenge a complexity tier that appears under-stated relative
   to the spec's blast radius, by emitting a `class: spec` finding
   citing the *Team sizing by complexity* section. The skill version
   SHALL be bumped PATCH per AGENTS.md → *Version Bump Convention*.
7. The `AGENTS.md` *Standard Team Templates* section SHALL gain a
   one-line cross-reference to *Team sizing by complexity*, but SHALL
   NOT duplicate the tier-to-composition table.
8. The DEV stage SHALL include an audit pass: doc-writer SHALL verify
   that the `complexity` fields already declared in the merged specs
   `0001` through `0005` are coherent with the new sizing rule. Any
   discordance SHALL be documented as a comment on this ticket's
   logbook (issue #173) WITHOUT editing the merged specs — the
   originals on `main` are immutable per ADR-0010 and spec 0003.
9. A retroactive correction of a mis-tagged tier SHALL go through a
   delta-spec PR per the spec-class routing path; it is NOT in scope
   for this ticket, only the audit and its journal are.

## Scenarios

### Happy path — orchestrator picks the right team from the spec

Given a non-trivial ticket whose spec declares `complexity: small` and
  `interaction-mode: INTERMEDIATE`
When the orchestrator picks up the ticket at DEV time
Then the orchestrator SHALL spawn `developer` + `pr-logbook` +
  `pr-reviewer` (small-tier composition per *Team sizing by
  complexity*)
And the orchestrator SHALL call `AskUserQuestion` to validate the PLAN
  before DEV starts and SHALL request user authorization before any
  merge (INTERMEDIATE-mode gates per *Interaction modes*)
And no other output (informational logbook comments, idle
  notifications) SHALL block agent execution.

### Happy path — unusual but legitimate mode/tier combination accepted

Given a spec declaring `complexity: trivial` and `interaction-mode: FULL`
When the orchestrator picks up the ticket
Then the orchestrator SHALL accept the combination (R1)
And SHALL handle the work inline (trivial — no team spawn)
And SHALL still call `AskUserQuestion` at the FULL-mode gates that
  apply to inline work (intent confirmation before edit; merge
  authorization).

### Failure path — under-stated tier caught at spec-review

Given a spec declaring `complexity: trivial` but listing 12 distinct
  file paths under `## Requirements`
When the spec-reviewer (second `architect` cold-spawned per spec 0004
  → *Plan review protocol*, applied to SPECS via spec 0005
  *Routing matrix*) reads the spec-PR
Then the spec-reviewer SHALL post a `## Verdict: REQUEST CHANGES`
  with at least one finding tagged `class: spec` citing
  *Team sizing by complexity*
And the spec-PR SHALL NOT be merged until the tier is corrected to a
  level coherent with the declared blast radius (`small` or
  `standard`)
And the iteration counter on the spec-PR SHALL be incremented per
  spec 0005 *Iteration mechanics*.

## Out of scope

- The `spec-author` skill activation logic that picks the interaction
  mode and the complexity tier at SPECS time — already shipped in
  issue #168. This spec consumes those fields; it does not author
  them.
- The retroactive routing engine that processes `class: spec` findings
  and re-spawns `spec-author` in delta mode — already shipped in
  issue #172. This spec emits the finding shape; it does not route.
- The plan format and plan-review protocol — already shipped in issue
  #169. The PLAN-stage tier challenge (post-SPECS) is implicitly
  covered by the existing plan-reviewer cold-spawn pattern; no new
  rule needed.
- Editing merged specs `0001` through `0005` to correct any
  discordant tier. Originals on `main` are immutable; corrections go
  through delta-spec PRs in their own tickets if and when needed.
- A mechanical linter that enforces the (mode × stage) gate contract
  — tracked under the spec-linter follow-up #178 if the contract
  proves to need enforcement after the first ten real REVIEW cycles
  in mixed modes.
- Multi-CLI distribution of new skill or agent sources. This spec
  ships no new component; only one PATCH-bump on
  `community-config/skills/pr-reviewer/SKILL.md`.

## Open questions

(none — all interview questions were resolved at SPECS time.)
