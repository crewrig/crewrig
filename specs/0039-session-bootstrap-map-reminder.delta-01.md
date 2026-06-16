---
id: "0039"
slug: session-bootstrap-map-reminder
delta: "01"
status: approved
complexity: small
interaction-mode: AUTO
related-issue: 316
version: 1.1.0
---

# Add session-bootstrap Memory Activation Protocol reminder to AGENTS.md

## ADDED

(none)

## MODIFIED

**R2** — replace:

> The section SHALL mandate, as the **first action before any work**,
> the deterministic three-step sweep defined in `60-tools.md`: (a) `mempalace_status` —
> enumerate wings; confirm the `crewrig` wing exists. (b) `mempalace_search` scoped to
> `wing="crewrig"`, `room="task-handoff"` with `query="[TASK:ongoing]"` — discover any
> in-flight cross-tool task. (c) `mempalace_diary_read` with the agent's own name —
> recover recent per-agent reasoning trace.

with:

> The section SHALL mandate, as the **first action before any work**,
> the complete deterministic session-start sweep defined in
> `artifacts/core/rules/60-tools.md` → *Memory Activation Protocol →
> Session Start* (all six steps, in order). The section SHALL NOT
> enumerate the steps inline; it SHALL reference `60-tools.md` as the
> authoritative source so that future revisions to the MAP propagate
> automatically. The section MAY name the project-specific parameter
> (`wing="crewrig"`) as a concrete aide-mémoire for step 3 without
> reproducing the full step list.

## REMOVED

(none)
