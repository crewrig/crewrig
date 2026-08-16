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

Session transcript hook persistence routes to the shared MemPalace Model Context
Protocol daemon instead of writing directly to the on-disk palace store. When an
interactive session in any supported assistant interface completes a turn or
lifecycle event, the transcript entry reaches the shared daemon over local
network transport. Direct disk locks and temporary lock-bypass exceptions are
retired, establishing a single-writer topology where the daemon manages all
palace updates while transcript write latency stays within an order of magnitude
of baseline execution.

### Empirical latency benchmark

An empirical measurement campaign of 160 executions (N=20 per condition)
conducted on the production palace (~24,000+ drawers, 418 MB store) produced
the following wall-clock results:

| Payload | Lifecycle Event | Direct Write p95 | Daemon Routed p95 | Daemon p50 | Speedup | Budget (<5.0s) |
|---|---|---|---|---|---|---|
| **133 B** | `sessionStart` | 0.675 s | **0.076 s** | 0.041 s | ~8.9× | PASS |
| **133 B** | `userPromptSubmitted` | 0.696 s | **0.087 s** | 0.039 s | ~8.0× | PASS |
| **133 B** | `postToolUse` | 0.709 s | **0.081 s** | 0.040 s | ~8.8× | PASS |
| **133 B** | `sessionEnd` | 0.712 s | **0.080 s** | 0.040 s | ~8.9× | PASS |
| **4000 B** | `sessionStart` | 0.800 s | **0.069 s** | 0.040 s | ~11.6× | PASS |
| **4000 B** | `userPromptSubmitted` | 0.804 s | **0.166 s** | 0.040 s | ~4.8× | PASS |
| **4000 B** | `postToolUse` | 0.823 s | **0.080 s** | 0.039 s | ~10.3× | PASS |
| **4000 B** | `sessionEnd` | 0.812 s | **0.082 s** | 0.040 s | ~9.9× | PASS |

Daemon-routed writes achieve a p95 latency under 0.17 seconds in all conditions,
consuming less than 3.5% of the 5.0-second budget and satisfying the pass
criterion defined in ADR-0016 Derived Spec 4.

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
