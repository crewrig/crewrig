---
id: "0100"
slug: worktree-session-hygiene
status: draft
complexity: small
related-issue: 609
version: 1.0.0
---

# Session-boundary worktree hygiene: surface stale worktrees at session start and sweep merged ones at session end

## Intent

Agent sessions that open one or more ticket worktrees under `.worktrees/`
have no obligation today to account for those worktrees at the boundaries
of a session, so worktrees whose work has already merged accumulate
unnoticed until a cluttered `.worktrees/` directory and a backlog of stale
local branches slow down and confuse later sessions. The project already
documents how to clean up a single ticket's worktree at the moment that
ticket's pull request merges, but nothing prompts an agent to reckon with
the whole `.worktrees/` directory when a session begins or ends — a session
can end for reasons unrelated to any specific ticket completing (context
exhaustion, the user stopping, an unrelated wrap-up), and a session can
begin on top of a backlog left by earlier sessions. A repository state
observed during authoring, with well over a hundred accumulated local
branches and lingering worktrees, shows the accumulation is real and
ongoing. This spec closes that session-boundary gap: an agent surfaces any
already-merged, stale worktrees before it starts piling new work on top of
them, and safely removes the worktrees whose work has demonstrably merged
before its session ends, while never touching a worktree whose work is
still in flight.

## Requirements

1. The session-boundary worktree-hygiene guidance introduced by this spec
   SHALL be documented in the CrewRig project layer, co-located with the
   existing worktree-lifecycle documentation (`AGENTS.md` → *Agent Team
   Protocol* and its extracted `docs/agent-team-protocol.md` → *Worktree
   Isolation*), and SHALL NOT be added to the cross-project global rules
   source `artifacts/core/rules/60-tools.md`.
2. The session-start surfacing obligation (Requirement 5) SHALL be
   reachable from the project's mandated session-start entry point
   (`AGENTS.md` → *Session Bootstrap*), and the session-end sweep
   obligation (Requirement 7) SHALL be documented alongside the existing
   worktree-lifecycle procedure (`docs/agent-team-protocol.md` → *Worktree
   Isolation*), so an agent encounters each obligation at the relevant
   session boundary.
3. The new guidance SHALL reference the existing per-ticket post-merge
   cleanup procedure in `docs/agent-team-protocol.md` → *Worktree
   Isolation* rather than restate its ordered steps, and any worktree
   removal it directs SHALL follow that procedure's existing step order
   (worktree removal before local-branch deletion).
4. The new guidance SHALL state explicitly that the session-boundary steps
   are additional to, and do not replace, the existing per-ticket cleanup
   that runs at the moment a ticket's pull request merges.
5. At session start, before beginning new ticket work, the agent SHALL
   surface any stale worktrees present under `.worktrees/` — at minimum
   every worktree whose branch has already merged into the mainline — so
   the agent is aware of the existing backlog before it creates additional
   worktrees.
6. The session-start surfacing step SHALL be non-destructive: it reports
   stale worktrees but SHALL NOT itself remove any worktree or delete any
   branch, so a sibling session's in-flight worktree is never destroyed at
   another session's start.
7. At session end, the agent SHALL account for the worktrees under
   `.worktrees/` and SHALL remove every worktree whose associated pull
   request has been confirmed merged, together with that worktree's local
   branch, so merged worktrees do not persist past the session that could
   observe their completion.
8. The session-end sweep SHALL NOT remove a worktree whose pull request is
   still open, whose branch carries unmerged or uncommitted work, or whose
   merge status cannot be positively confirmed; such a worktree SHALL be
   left in place and surfaced for later adjudication.
9. The session-end sweep SHALL remain consistent with the existing
   *Stray-file discovery — no unilateral action* discipline in
   `docs/agent-team-protocol.md`: a worktree's mere presence or apparent
   staleness SHALL NOT by itself authorize removal, and positive
   confirmation of a merged pull request SHALL be the precondition for
   removing any worktree.

## Scenarios

**Scenario:** Session start surfaces an already-merged worktree backlog

```text
Given `.worktrees/` contains one or more worktrees whose branch has
      already merged into the mainline
When  an agent begins a new session and runs its session-start steps
      before creating a new ticket worktree
Then  the agent surfaces those already-merged worktrees as a stale backlog
      before it proceeds to open a new worktree
And   it removes none of them as part of the session-start step
```

**Scenario:** Session end sweeps a worktree whose pull request has merged

```text
Given a session opened a ticket worktree whose pull request has since been
      confirmed merged
When  that session reaches its end
Then  the agent removes the merged worktree and its local branch, following
      the existing ordered cleanup procedure in
      `docs/agent-team-protocol.md` → *Worktree Isolation*
And   the merged worktree does not persist into a later session
```

**Scenario:** Session end preserves a worktree whose work is still in flight

```text
Given `.worktrees/` contains a worktree whose pull request is still open,
      or whose branch holds unmerged or uncommitted work
When  a session reaches its end and runs the session-end worktree sweep
Then  the agent leaves that worktree and its branch in place and deletes
      neither
And   it surfaces the worktree for later adjudication rather than
      destroying in-flight work
```

## Out of scope

- The existing per-ticket post-merge cleanup procedure in
  `docs/agent-team-protocol.md` → *Worktree Isolation* (verify the merge
  landed → `git worktree remove` → `git branch -D` → close the logbook
  issue, with its rationale about git refusing to delete a checked-out
  branch). That procedure already exists and is UNCHANGED by this spec;
  this spec adds session-boundary triggers that reuse it, it does not
  re-invent, restate, or modify worktree cleanup itself.
- Mirroring the guidance into the cross-project global rules source
  `artifacts/core/rules/60-tools.md` (the originating issue's suggested
  "mirror in `60-tools.md`"). That file is generic across every project
  the user works in and deliberately carries no CrewRig-specific path
  conventions — the `.worktrees/<ticket-id>/` convention is supplied by
  the project layer, mirroring how `AGENTS.md` → *Session Bootstrap*
  injects the `wing="crewrig"` parameter into the generic session sweep
  rather than hardcoding it in `60-tools.md`. Adding a `.worktrees/`-
  specific rule to the global file would break that layering discipline.
- Defining a specific numeric dormancy threshold for a worktree, or
  automatically deleting a long-dormant worktree whose work has NOT
  demonstrably merged. An unmerged worktree may hold paused or in-flight
  work; the spec surfaces such worktrees but never auto-deletes them.
- Bulk pruning of standalone stale local branches that have no associated
  worktree (the repository's broader accumulated-branch backlog). This
  spec's removal is scoped to a worktree and its paired local branch; a
  general branch-gardening pass is a separate concern.
- Any new script, git tooling change, or automated CI job that enforces
  worktree hygiene. This spec mandates written protocol guidance for the
  agent at session boundaries, not an automated enforcement mechanism.
- Any change to the existing six steps of the mandated session-start sweep
  or to the MemPalace cross-tool handoff protocol in
  `artifacts/core/rules/60-tools.md`. The session-start surfacing
  obligation is a project-layer addition reachable from `AGENTS.md` →
  *Session Bootstrap*; it does not alter the generic sweep steps
  themselves.
- Code changes of any kind. This is a documentation-only change to
  project-layer protocol documents; the mechanical obligations that follow
  from touching those documents (for example any CLI-matrix consultation
  the project already requires) are governed by existing conventions and
  are not redefined here.

## Open questions

None outstanding. The one non-obvious authoring decision — placing the new
guidance in the CrewRig project layer rather than in the cross-project
global `artifacts/core/rules/60-tools.md` that the originating issue
suggested mirroring into — was resolved by explicit decision during
authoring (see Requirement 1 and the corresponding `## Out of scope`
bullet) on the grounds that the `.worktrees/<ticket-id>/` convention is
project-specific and the global rules file is deliberately kept free of
project path conventions.
