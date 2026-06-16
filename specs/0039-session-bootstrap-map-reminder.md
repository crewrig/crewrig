---
id: "0039"
slug: session-bootstrap-map-reminder
status: approved
complexity: small
interaction-mode: AUTO
related-issue: 316
version: 1.0.0
---

# Add session-bootstrap Memory Activation Protocol reminder to AGENTS.md

## Intent

The Memory Activation Protocol (MAP) is defined in the user's global
`artifacts/core/rules/60-tools.md` (→ *Memory Activation Protocol →
Session Start*). Nothing in the per-project bootstrap surface —
`CLAUDE.md`, `AGENTS.md`, or a hook — surfaces this protocol when an
agent starts a session on this project. As a result, agents reliably skip
the MAP across entire sessions, missing in-flight handoff tasks and
cross-session context that the protocol is designed to surface (issue 316:
PRs #305 and #307 ran without a single `mempalace_status` call).

Adding an explicit mandatory reminder at the top of `AGENTS.md` closes
the gap: the reminder is read every time `AGENTS.md` is loaded, which
happens at every session start on this project.

## Requirements

1. `AGENTS.md` SHALL gain a **Session Bootstrap** section placed
   immediately after the *What is CrewRig?* section and before the
   *Lifecycle* section.

2. The section SHALL mandate, as the **first action before any work**,
   the deterministic three-step sweep defined in `60-tools.md`:

   a. `mempalace_status` — enumerate wings; confirm the `crewrig` wing
      exists.
   b. `mempalace_search` scoped to `wing="crewrig"`,
      `room="task-handoff"` with `query="[TASK:ongoing]"` — discover
      any in-flight cross-tool task.
   c. `mempalace_diary_read` with the agent's own name — recover recent
      per-agent reasoning trace.

3. The section SHALL state that skipping the sweep is a process
   violation equivalent to missing a lifecycle stage.

4. The section SHALL reference `artifacts/core/rules/60-tools.md` →
   *Memory Activation Protocol* as the authoritative definition.

5. No other section of `AGENTS.md` is modified by this spec.

## Scenarios

**Scenario:** Agent starts a new session and reads AGENTS.md.

Given a Claude Code session opens on the crewrig project  
And the agent reads AGENTS.md (loaded via CLAUDE.md `@AGENTS.md` import)  
When the agent encounters the Session Bootstrap section  
Then it runs `mempalace_status` before any work begins  
And it searches `wing="crewrig"`, `room="task-handoff"` for
`[TASK:ongoing]`  
And it reads its own diary via `mempalace_diary_read`  
And only then proceeds to the first user-requested task

**Scenario:** Agent skips the sweep.

Given the agent reads AGENTS.md  
And the agent omits the three-step sweep  
When the next REVIEW pass audits the session  
Then the reviewer SHALL emit a `class: tech` finding citing this
section's process-violation clause

## Out of scope

- Adding a SessionStart shell hook — the hook mechanism cannot invoke
  MCP tools; the reminder approach is both sufficient and immediately
  actionable.
- Modifying `60-tools.md` — the global definition is authoritative;
  `AGENTS.md` adds a project-visible pointer, not a duplicate.
- Adding the reminder to `AGENTS.org.md` — the MAP is a project-level
  operational mandate, not an org-level convention extension.
- Adding project-specific MemPalace content; no drawers are created by
  this spec.

## Open questions

- None. The target section (`AGENTS.md`), the three-step sweep
  content, and the no-hook rationale are all derived from the existing
  `60-tools.md` contract.
