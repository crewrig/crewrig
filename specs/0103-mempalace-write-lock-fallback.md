---
id: "0103"
slug: mempalace-write-lock-fallback
status: implemented
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 637
version: 1.0.0
---

# MemPalace write-path fallback for friction tagging

## Intent

When an agent tags a friction and the memory-backed tagging path cannot
record it — because a peer writer holds the write lock, or the memory
service is unreachable — the friction-reporting protocol tells the agent
exactly what to do so the signal is never silently lost. A future reader
of the protocol finds its "fire-and-forget, costs nothing" promise
qualified with the failure mode it can actually hit, and a concrete
fallback that lands the friction in the same triage lane it would have
reached through the normal path.

## Requirements

1. The friction-reporting protocol SHALL document an explicit fallback
   for the case where a friction tag cannot be recorded because the
   MemPalace write path is unavailable, covering both triggers: (a) a
   peer-writer-lock hard error — MCP error `-32001`, "Peer MCP writer
   active; this server is read-only for mutating tools" — returned by a
   mutating tool, and (b) the MemPalace MCP server being unreachable or
   disconnected entirely, in which case every MemPalace tool (not only
   the mutating ones) is unavailable.
2. The documented fallback SHALL be to file the friction directly as a
   GitHub issue on the canonical repository, mirroring the manual
   workaround already used for the GitHub issues #636 and #637.
3. The directly-filed friction issue SHALL carry the `harness-feedback`
   label, so the direct-filing path lands in the same triage lane as a
   friction that reaches GitHub through the normal MemPalace-mediated
   curator path.
4. The operational fallback procedure SHALL live in
   `artifacts/library/skills/harness-report/SKILL.md`, and
   `artifacts/core/rules/60-tools.md` → *Friction Reporting* SHALL at
   minimum acknowledge that the fire-and-forget tag has a documented
   failure mode and point to that procedure — consistent with the
   existing single-sourcing convention where `60-tools.md` states the
   contract and `harness-report/SKILL.md` carries the procedure.
5. The "fire-and-forget … costs nothing" framing of the tagging protocol
   SHALL be qualified to name this failure mode explicitly, so a future
   agent is not surprised when the "free" tag call fails.
6. For trigger (a) — the transient peer-writer-lock error — the guidance
   SHALL permit at most one immediate retry of the tag call before
   directing the agent to the direct-filing fallback.
7. The guidance SHALL NOT prescribe a retry-with-backoff loop against
   MemPalace for either trigger; for trigger (b) — a disconnected server
   — it SHALL direct the agent straight to the direct-filing fallback
   with no retry.
8. The directly-filed issue SHALL preserve the friction payload's
   substance — at minimum the one-line title, the offender reference
   (the `canonical` repository) when known, and the `evidence:` entries
   — so it carries the same signal the MemPalace drawer would have
   carried.

## Scenarios

**Scenario:** MemPalace available — nominal fire-and-forget tag

Given the MemPalace MCP server is reachable and no peer writer holds the
      write lock
When  an agent tags a friction per the protocol
Then  the single `mempalace_add_drawer` call succeeds and no fallback is
      invoked

**Scenario:** Peer-writer lock — one retry, then direct GitHub filing

Given a peer MCP writer holds the write lock and `mempalace_add_drawer`
      returns MCP error `-32001`
When  the agent applies the documented fallback
Then  it retries the tag at most once and, the lock still holding, files
      the friction as a `harness-feedback`-labeled GitHub issue on the
      canonical repository

**Scenario:** MemPalace disconnected — direct GitHub filing, no retry

Given the MemPalace MCP server is unreachable and all its tools are
      unavailable
When  the agent applies the documented fallback
Then  it files the friction as a `harness-feedback`-labeled GitHub issue
      on the canonical repository without attempting any retry against
      MemPalace

## Out of scope

- The MemPalace server's own write-serialization or write-queuing
  behavior (Option 1 in the GitHub issue #637). MemPalace is an external
  MCP server dependency this repository integrates with, not a component
  whose source lives here; this repository cannot fix it.
- Any change to the MemPalace MCP protocol itself — for example altering
  the `-32001` semantics or adding a server-side blocking-wait mode.
- New tooling or automation to proactively detect a MemPalace lock or
  disconnection (a health-check or probe mechanism). This spec qualifies
  written guidance for agents, not a runtime detection mechanism.
- Changes to the `harness-curator` clustering or issue-creation behavior.
  The direct-filing fallback reuses the existing `harness-feedback` label
  and the canonical-repository target; it does not alter the curator.

## Open questions
