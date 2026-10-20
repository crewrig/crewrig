---
id: "0271"
slug: orchestrator-only-memory-sweep
status: approved
complexity: small
interaction-mode: AUTO
related-issue: 1728
version: 1.0.0
---

# Run the memory sweep in the orchestrator only

## Intent

Every spawned subagent re-runs the session-start memory sweep, including an
unscoped enumeration call that alone returns about 18 to 20 KB, although the
orchestrator that owns the ticket has already done it. After this spec, only the
session that owns a ticket runs the sweep, a subagent starts working on its
brief with no memory preamble, a ticket still resumes across sessions with its
handoff intact, and the usage attribution of subagent requests is unchanged. It
is work package WP3 of the epic #1724 (sections 3, 4 and 6); the measured effect
is the epic's indicator E3 (subagent context growth from request 1 to request 8,
p50).

## Requirements

Paths: the sweep is defined in `artifacts/core/rules/60-tools.md` → *Memory
Activation Protocol → Session Start*; the bootstrap rule is `AGENTS.md` →
*Session Bootstrap*. Sizes are bytes as reported by `wc -c`. A **subagent** is
any agent instantiated by another agent through a delegation primitive with a
brief, a seated reviewer pass included; the **orchestrator** is the main session
that owns the ticket. An agent is a subagent exactly when its brief was supplied
by another agent; an agent the user starts directly, including one invoked for a
review, is an orchestrator for the purposes of this spec and runs the sweep; when it
owns no ticket, the scoped handoff lookup simply finds nothing to resume and no
checkpoint is written.

1. Only the orchestrator SHALL run the session-start sweep. A subagent SHALL
   skip it entirely, including the "memory unavailable" signal that the sweep
   otherwise requires.
2. The sweep SHALL NOT include any unscoped enumeration call, and
   `mempalace_status` SHALL be removed from it, the project wing being known
   (`crewrig`). The remaining steps SHALL be renumbered in this order: project
   name, scoped handoff lookup, own diary read, knowledge-graph query, and
   checkpoint plus usage declaration.
3. Before the implementation settles, the plan stage SHALL measure whether
   `mempalace_list_wings` returns materially less than `mempalace_status` and
   SHALL record both sizes in the logbook. The result does not change
   requirement 2: no unscoped enumeration call is part of the sweep.
4. The optional system-context store mirror SHALL NOT depend on
   `mempalace_status`; it SHALL be attempted only after the first scoped
   sweep call has succeeded, and SHALL be skipped silently otherwise.
5. A non-seat subagent (developer, tester, `pr-logbook`, an `architect` pass
   authoring, and the like) SHALL receive the `handoff_key` and the handoff
   drawer id in its brief, and MAY fetch that drawer with exactly one scoped
   get-by-id call, only when it needs it. A seated reviewer pass SHALL receive
   neither, and the references-only brief of `docs/reviewer-seat.md` SHALL
   remain unchanged.
6. The rule that skipping the sweep is a process violation, and the
   accompanying `class: tech` REVIEW finding, SHALL bind the orchestrator only.
   A subagent that skips the sweep SHALL NOT produce a finding of any class.
7. A subagent SHALL NOT write the handoff drawer or a diary entry at session
   end. It SHALL state its outcome in its final report, and the orchestrator
   SHALL write the handoff drawer and the diary entry once. Friction tagging
   through the `harness-report` skill is unchanged and remains available to
   every agent.
8. Requirements 1 to 6 of `specs/0226-reviewer-seat-bootstrap-exemption.md` are
   superseded by this spec. A seated pass SHALL no longer run any step of the
   sweep, and the exemption it replaced (skipping steps 3 and 6 while running
   steps 1, 2, 4 and 5) SHALL be removed from `AGENTS.md` and
   `docs/reviewer-seat.md`. The frontmatter of spec 0226 SHALL be set to
   `status: superseded` with `superseded-by: "0271"` as a metadata-only edit.
   The implementation pull request, not the spec-PR, SHALL carry that edit. For
   the sweep obligations of spec 0208 only, `docs/usage-attribution.md` →
   *Channel 4: Session-start protocol* SHALL state that the usage-declaration
   duty now falls on the orchestrator; spec 0208 itself is not superseded,
   because the format admits `superseded-by` for a whole spec only.
9. Every document that cites sweep step numbers or the six-step shape SHALL be
   updated in the same change, among them `AGENTS.md`, `docs/reviewer-seat.md`,
   `docs/mempalace-wakeup-budget.md`, `docs/usage-attribution.md`,
   `tests/e2e/9.3-cross-tool-continuity.md`, `artifacts/core/system-context/`
   and the *Memory Activation Protocol* in `artifacts/core/rules/60-tools.md`.
   The criterion is a search, not a list: after the change, a search of every
   tracked file outside `specs/` (for instance `git grep -n -i -E 'six-step|six steps|steps? 3 and 6|step 3 \(cross-tool' -- . ':!specs'` and `git grep -n 'mempalace_status' -- . ':!specs'`, with every remaining hit explained) for a six-step sweep, a numbered sweep step
   that names `mempalace_status`, or the seated-pass exemption of steps 3 and 6
   returns no match, and the implementation records the commands and their empty
   output in the logbook.
10. A subagent SHALL NOT run the usage declaration (`usage-task set`) unless
    requirement 11 shows that its CLI needs it. The change SHALL include an
    automated test, or recorded evidence, that on Claude Code a subagent usage
    record carries its parent session's identifier, so the parent's
    session-scoped declaration covers it.
11. For Gemini CLI, GitHub Copilot CLI and Antigravity CLI, `docs/cli-matrix.md`
    SHALL record whether subagent usage is attributed through the parent's
    declaration or through the worktree and branch channel. A CLI where
    neither attributes it SHALL keep exactly one declaration call in its
    subagents, documented as an explicit asymmetry in the same file; no
    asymmetry between CLIs SHALL remain silent.
12. `AGENTS.md` SHALL NOT grow beyond its current size, and its threshold in
    `scripts/check-agents-size.ts` SHALL NOT be raised.
    `artifacts/core/rules/60-tools.md` SHALL NOT exceed 24,688 bytes.
13. The setup goldens and every size-coupled test that depend on the tools rule
    SHALL be regenerated and proven in two environments, and commits touching
    `artifacts/` SHALL include outputs regenerated by
    `node scripts/lib/node-floor-guard.js` followed by
    `node scripts/build-components.ts`.
14. `docs/cli-matrix.md` and `.crewrig/core-paths.txt` SHALL be updated in the
    same diff wherever a path they cover changes, and the change SHALL ship
    symmetrically for the four CLIs.
15. The logbook SHALL record E3 before and after on one reference ticket,
    measured with `task usage:query`, against the epic's own criterion: the
    p50 growth of a subagent context from request 1 to request 8 has a
    baseline of +39 K and a target of at most +20 K. It SHALL also record
    Q1 to Q4 of epic section 4.2, and the rollback criterion of section 4.4
    applies.
16. The spec linter, the markdown-link check, the version-bump check, the
    typecheck, the test suite and every `*-ci-wiring` test SHALL pass, none
    disabled or loosened. The change SHALL NOT ship in the same pull request as
    any other work package of epic #1724.

## Scenarios

**Scenario:** A ticket resumes across two sessions

Given session one worked on a ticket and left a `[TASK:ongoing]` handoff drawer
When  a second orchestrator session starts on the same ticket
Then  its scoped handoff lookup finds the drawer, it writes the checkpoint with the resumed-from revision before any task work, and the progress recorded by session one is intact

**Scenario:** A subagent starts without the sweep

Given an orchestrator spawns a `developer` with a brief carrying the `handoff_key` and the drawer id
When  the developer starts
Then  it makes no sweep call and no enumeration call, and it reads the drawer with one get-by-id call only if its task needs it

**Scenario:** A seated pass runs nothing of the sweep

Given a reviewer seat is instantiated with the references-only brief
When  the pass starts
Then  it makes no memory call before reading its dossier from the forge, its brief carries no handoff reference, and a later audit records no finding for that absence

**Scenario:** The orchestrator skips the sweep

Given an orchestrator session that never ran the sweep
When  a REVIEW pass audits it
Then  the pass emits a `class: tech` finding citing *Session Bootstrap*

**Scenario:** Subagent usage stays attributed

Given a subagent runs on Claude Code without a declaration of its own and its parent declared the ticket
When  `task usage:query -- --task-key <N> --rollup` runs
Then  the subagent requests are counted under the ticket, and the same check is recorded in `docs/cli-matrix.md` for the other three CLIs

**Scenario:** Growth is caught at the size caps

Given `AGENTS.md` or the tools rule would exceed its cap after the change
When  the corresponding size check runs
Then  it exits 1 and prints the measured size and the cap

## Out of scope

- Any change to the lifecycle ceremony, the number of agent passes or the PLAN and REVIEW loop caps (work package WP6).
- The seat dossier rules, the prior-finding disposition record and the references-only brief content of `docs/reviewer-seat.md`, beyond removing the sweep exemption.
- MemPalace internals, the MCP tool surface, and the friction-reporting protocol of the `harness-report` skill.
- Slimming the rules or `AGENTS.md` further (WP2), skill splitting (WP1), document splitting (WP4) and every other work package of epic #1724.
- Changing how usage records are captured or queried, beyond the proof and the matrix entries of requirements 10 and 11.

## Open questions

- [AUTO-PARKED] Whether `mempalace_list_wings` is cheaper than `mempalace_status` is unmeasured; requirement 3 makes the plan stage measure it, and requirement 2 holds either way.
- [AUTO-PARKED] The attribution channel of Gemini CLI, Copilot CLI and Antigravity subagents is unverified; requirement 11 fixes the obligation to record it, and the keep-one-call fallback applies wherever it fails.
- [AUTO-PARKED] The `superseded` status of spec 0226 depends on this spec being implemented; the plan stage records it in the implementation pull request, as `docs/spec-format.md` requires of any post-merge transition. The format has no field on the superseding spec, so the spec 0208 relationship is stated in requirement 8 in prose.
- Decision (AUTO): E3 is quoted from the epic as a baseline of +39 K and a target of at most +20 K (p50, request 1 to request 8), not as a growth allowance of +20 K over the pre-change value.
