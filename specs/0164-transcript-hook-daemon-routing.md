---
id: "0164"
slug: transcript-hook-daemon-routing
status: draft
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 753
version: 1.0.0
---

# Route session transcript hooks through the shared MemPalace MCP HTTP daemon

## Intent

Session transcript hook persistence forwards transcript records to the shared
daemon instead of writing directly to the on-disk storage. Interactive sessions
across all supported assistant interfaces deliver lifecycle records without
contending for disk locks or relying on temporary lock-bypass exceptions,
ensuring a single-writer topology while preserving sub-second persistence
latencies.

## Requirements

1. `hooks/mempalace-transcript.sh` SHALL forward session transcript drawer
   records to the active MemPalace Model Context Protocol HTTP daemon endpoint.
2. `hooks/mempalace-transcript.sh` SHALL provide the provisioned daemon bearer
   token on all transcript write requests.
3. `hooks/mempalace-transcript.sh` SHALL enforce a 5.0-second total execution
   time ceiling.
4. When the MemPalace Model Context Protocol HTTP daemon is unreachable or
   returns an error response, `hooks/mempalace-transcript.sh` SHALL emit a
   `DAEMON_UNREACHABLE` diagnostic to stderr and SHALL return a clean zero exit
   status to the calling assistant interface.
5. `hooks/mempalace-transcript.sh` SHALL NOT perform in-process lock bypasses or
   direct database mutations.
6. The palace write architecture SHALL maintain a single-writer topology with the
   shared daemon holding the writer lease.
7. `docs/adr/0016-shared-mempalace-mcp-http-server.md` SHALL contain an
   addendum documenting the benchmark measurements and the selection of daemon
   routing.
8. The hook registration files (`hooks/*-transcript-hooks.json`) SHALL preserve
   their format and interface compatibility across Claude Code, Gemini CLI,
   GitHub Copilot CLI, and Antigravity CLI.

## Scenarios

**Scenario:** Transcript hook persists drawer through the shared daemon (happy path)

```text
Given an active assistant session in any supported interface
And the shared MemPalace Model Context Protocol HTTP daemon is running
When a session lifecycle event triggers `hooks/mempalace-transcript.sh`
Then the hook submits an authenticated tool call to the daemon
And the transcript entry is recorded under the `transcripts` wing
And the hook execution completes in under 200 milliseconds.
```

**Scenario:** Daemon unreachable triggers non-blocking soft skip (failure path)

```text
Given the shared MemPalace Model Context Protocol HTTP daemon is stopped
When a session lifecycle event triggers `hooks/mempalace-transcript.sh`
Then the hook detects that the daemon is unavailable
And logs a `DAEMON_UNREACHABLE` message to stderr
And exits with status 0 without stalling the assistant session.
```

**Scenario:** Palace maintains single-writer lease across concurrent events (audit)

```text
Given multiple concurrent assistant sessions executing lifecycle hooks
When transcript records are submitted simultaneously
Then all writes proceed through the single shared daemon process
And no external process attempts to claim an on-disk lock.
```

## Out of scope

- Modifying the internal tool schema of the MemPalace daemon.
- Modifying the ChromaDB vector database daemon service.
- Modifying the 4000-character content truncation limit in `hooks/mempalace-transcript.sh`.

## Open questions

- (none — all questions resolved during SPECS)
