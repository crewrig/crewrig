# Friction tagging failure mode

<!-- crewrig-doc: published=false -->

<!-- Expands the paragraph on the documented failure mode in the section "How to tag — the `harness-report` skill" of artifacts/core/rules/60-tools.md. Cross-references to other sections refer to that file. -->

The fire-and-forget tag has one **documented failure mode**: the
MemPalace write path may be unavailable — a peer holds the write lock
(MCP error `-32001`) or the server is disconnected — so the tag call
cannot record the friction. **On a machine converted to the shared
MemPalace MCP HTTP daemon (ADR 0016), a peer-held write lock between
sibling sessions becomes rare rather than expected**: one process holds
the palace writer lease on behalf of every session, and MemPalace's own
lock is re-entrant for the process that already holds it — it passes
through without re-acquiring rather than refusing — which is what lets
that one process serve every session's writes without contending with
itself. **However, on a half-converted machine where the shared MCP daemon
runs while the active CLI remains configured on stdio, the lockout is not
rare or transient — it is permanent and total**, because the daemon holds the
exclusive palace lease while the stdio process is refused on every mutating
call. **Whenever an agent or operator encounters error `-32001` or a write-lock
refusal, the first diagnostic step SHALL be running `task mempalace:status`
(`node scripts/status-mcp-server.ts`)** to identify whether the machine is in a
half-converted state or a peer collision. The `harness-report` procedure carries
the operational fallback for this case regardless (file the friction directly as a
`harness-feedback`-labeled issue on the offender's canonical repository,
using the forge-appropriate CLI, so the signal still reaches the
curator's triage lane): the refusal stays a degraded path every agent must
still handle, converted machine or not. This file states the contract; the
`SKILL.md` procedure carries the "how".
