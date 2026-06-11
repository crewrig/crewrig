---
id: "0005"
slug: retroactive-routing-engine
status: draft
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 172
version: 1.0.0
---

# Automatic retroactive routing engine

## Intent

The orchestrator gains a deterministic, autonomous procedure for routing
classified REVIEW findings back into the upstream stage that owns them, so
REVIEW becomes a looping stage that terminates only on a clean pass and
never silently strands findings or requires user gating between
iterations (outside FULL / INTERMEDIATE mode).

## Requirements

1. The orchestrator (the team-lead role) SHALL act as the routing engine
   for the REVIEW loop; the engine is **doc-only** — a documented
   procedure the orchestrator follows — and SHALL NOT be implemented as
   an executable script in this spec.
2. Every reviewer finding (PR-reviewer, plan-reviewer, spec-reviewer)
   SHALL carry exactly one `class:` field whose value is `tech`, `arch`,
   or `spec`.
3. A finding emitted without a `class:` field SHALL be returned to the
   reviewer for retagging before the routing engine consumes it; the
   engine SHALL NOT default an untagged finding to `tech`.
4. Upon receiving a REVIEW verdict that contains at least one blocking
   finding, the orchestrator SHALL select the most upstream class
   present (`spec` > `arch` > `tech`) and route the entire iteration to
   the corresponding stage per the routing matrix:

   | Class | Loop target | Re-spawn sequence |
   |---|---|---|
   | `tech` | DEV | `developer` (+ `tester` if test surface touched) |
   | `arch` | PLAN | `architect` (PLAN-author) → on revalidation, DEV team re-runs from start |
   | `spec` | SPECS | `spec-author` in delta-spec mode → spec-PR review → on merge, PLAN re-runs, then DEV |

5. Mixing loop targets within a single iteration SHALL be prohibited;
   findings of lower-precedence classes from the same pass SHALL be
   re-tagged onto the next iteration's verdict by the next reviewer
   spawned cold (the engine does not silently drop them, but it does
   not parallelise multi-class routing either).
6. A `spec`-class loop SHALL invoke `spec-author` in **delta-spec mode
   only**; the original spec on `main` is immutable per ADR-0010 and
   spec 0003. Re-authoring a fundamentally broken spec (status
   transition to `superseded`) is out of scope for the loop and SHALL
   be handled as a new ticket.
7. The iteration counter SHALL be persisted as a GitHub label `iter:N`
   on the implementation-PR (or the spec-PR for `spec`-class
   iterations). The orchestrator SHALL increment the label atomically
   at the start of every new iteration via `gh pr edit --add-label`.
8. The lifecycle SHALL terminate at MERGE iff a REVIEW pass produces
   verdict APPROVE, zero blocking findings of any class, and CI is
   green on the head commit reviewed (per ADR-0010 → *Termination*).
9. The loop SHALL halt after **5 iterations** (configurable via the
   spec frontmatter `max-iterations`, default 5) without termination;
   on halt, the orchestrator SHALL post a structured summary comment
   on the logbook issue and SHALL page the user regardless of mode
   (including AUTO).
10. Non-blocking findings SHALL be routed conditionally by mode:
    - **FULL / INTERMEDIATE** — the orchestrator SHALL present every
      non-blocking finding to the user (Rule 4) and route only those
      the user accepts to the loop; the rest are journalled in the
      logbook and left unactioned.
    - **MINIMAL / AUTO** — the orchestrator SHALL route every
      non-blocking finding into the loop using the same matrix; in
      autonomous modes there is no user to defer to, so non-blocking
      findings become blocking by default.
11. `AGENTS.md` *Retroactive review loop* SHALL be updated to cite this
    spec, declare the doc-only engine form, link to the new procedural
    document, and state the iteration-counter label convention.
12. `AGENTS.md` Templates 1 / 2 / 3 SHALL note that REVIEW is a
    **looping** stage, not terminal, and reference the routing engine
    procedure.
13. The `architect`, `pr-reviewer`, `developer`, `tester`, and
    `spec-author` source files under `community-config/` SHALL be
    updated so each emits or accepts the `class:` field on findings
    where applicable; version bumps apply per AGENTS.md → *Version
    Bump Convention* on every modified source (PATCH for the wording
    change).
14. A new procedural document `docs/retroactive-loop.md` SHALL
    describe the engine end-to-end: routing matrix, iteration counter
    mechanics, termination check, max-iteration guardrail, untagged-
    finding handling, mode-conditional non-blocking routing, and a
    worked example referencing the second iteration of PR #183 (the
    plan-format ticket, where three non-blocking findings were routed
    via Rule 4 in INTERMEDIATE mode).

## Scenarios

### Happy path — single tech iteration terminates

Given an implementation-PR for ticket #N with one blocking `class: tech`
  finding and CI red
When the orchestrator reads the verdict comment
Then the orchestrator increments the PR label from `iter:1` to `iter:2`
And re-spawns the `developer` (and `tester` if the touched surface
  includes tests) with the finding text and remediation pointer
And on doc-writer/developer completion, re-spawns `pr-reviewer` cold
And the new verdict is APPROVE with zero findings and CI green
And the orchestrator stops the loop and asks the user for merge
  authorization per AGENTS.md → *Branching Strategy*.

### Happy path — spec-class loop produces delta-spec PR

Given a merged spec `<NNNN>-<slug>` on `main` and an implementation-PR
  whose REVIEW surfaces one blocking `class: spec` finding
When the orchestrator increments `iter:N+1` on the implementation-PR
And invokes the `spec-author` skill in delta-spec mode against the
  finding, citing the parent spec id
Then `spec-author` emits a new `/specs/<NNNN>-<slug>.delta-<NN>.md`
  on a new branch `spec/<NNNN>-<slug>-delta-<NN>` cut from `main`
And a new spec-PR is opened, reviewed, and merged independently per
  spec 0003 → *Delta-spec cumulative rule*
And the implementation-PR is then re-routed through PLAN (architect)
  and DEV (developer / tester) to absorb the delta
And no new implementation-PR is opened — the existing one cumulates
  the delta (spec 0003 R6).

### Failure path — reviewer omits the class tag

Given a REVIEW verdict comment containing at least one finding without
  a `class:` field
When the orchestrator reads the verdict
Then the orchestrator SHALL NOT consume the verdict
And SHALL post a comment on the PR explicitly requesting retagging
  ("Finding N is missing the `class:` field — please re-tag per
  AGENTS.md → *Retroactive review loop*")
And SHALL re-spawn the reviewer cold (same role, fresh agent) with the
  retag instruction
And SHALL NOT increment the iteration counter for this pass — the
  malformed verdict does not count as an iteration consumed against
  the max-iteration guardrail.

## Out of scope

- The spec-PR mechanics themselves (branch naming, ordering, delta-PR
  cumulative rule) — already shipped in spec 0003 (issue #170).
- The plan-review protocol and the `class:` taxonomy definitions —
  already shipped in spec 0004 (issue #169).
- The interaction-mode engine (argument parsing, gate enforcement,
  user-notification surface for FULL mode) — tracked in issue #173.
- A scripted automation that programmatically reads PR review
  comments, parses `class:` tags, and spawns roles. The engine is
  doc-only in this ticket; a script is a candidate follow-up if
  friction surfaces after the first ten real REVIEW loops run end-
  to-end.
- The `superseded` status transition for a fundamentally broken spec
  (full re-author rather than delta). This is a new-ticket path
  outside the loop; the loop owns deltas only.
- The complexity-tier selection logic at SPECS time — tracked in
  issue #173.
- The spec linter — tracked in issue #178.
- Multi-CLI distribution of any new skill or agent. This spec ships
  no skill or agent source; the engine lives in the orchestrator's
  documented behavior.

## Open questions

(none — all interview questions were resolved at SPECS time.)
