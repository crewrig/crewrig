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

ADR-0016 established a single supervised MemPalace MCP HTTP daemon owning the
palace writer lease and registered over HTTP across all four CLI surfaces (Claude
Code, Gemini CLI, Copilot CLI, and Antigravity CLI). However, ADR-0016 left one
architectural question open for Derived Spec 4 (issue #753): whether session
transcript hooks (`hooks/mempalace-transcript.sh`) should continue writing
directly via an out-of-process Python invocation under spec-0110 lock-bypass
relief (Shape a), or route their writes through the shared MCP HTTP daemon
(Shape b).

ADR-0016 mandated that this decision be decided by an empirical latency
measurement campaign against a production-sized palace (~24,000+ drawers, 418 MB
ChromaDB store), testing both baseline (133 bytes) and upper-bound (#757 / 4000
bytes) payloads across all four session lifecycle events (`sessionStart`,
`userPromptSubmitted`, `postToolUse`, `sessionEnd`). The pass criterion was that
the p95 latency of the routed write must fit well within the hook's 5.0-second
self-cap.

### Empirical Benchmark Campaign Results

A benchmark campaign of 160 executions (N=20 per condition) on the production
palace yielded the following wall-clock results:

| Payload | Lifecycle Event | Direct Write (Shape a) p95 | Daemon Routed (Shape b) p95 | Daemon p50 | Speedup | Budget (<5.0s) |
|---|---|---|---|---|---|---|
| **133 B** | `sessionStart` | 0.675 s | **0.076 s** | 0.041 s | ~8.9× | PASS |
| **133 B** | `userPromptSubmitted` | 0.696 s | **0.087 s** | 0.039 s | ~8.0× | PASS |
| **133 B** | `postToolUse` | 0.709 s | **0.081 s** | 0.040 s | ~8.8× | PASS |
| **133 B** | `sessionEnd` | 0.712 s | **0.080 s** | 0.040 s | ~8.9× | PASS |
| **4000 B** | `sessionStart` | 0.800 s | **0.069 s** | 0.040 s | ~11.6× | PASS |
| **4000 B** | `userPromptSubmitted` | 0.804 s | **0.166 s** | 0.040 s | ~4.8× | PASS |
| **4000 B** | `postToolUse` | 0.823 s | **0.080 s** | 0.039 s | ~10.3× | PASS |
| **4000 B** | `sessionEnd` | 0.812 s | **0.082 s** | 0.040 s | ~9.9× | PASS |

### Decision Analysis

The empirical measurements demonstrate that **Shape (b) (routing through the
shared daemon)** decisively satisfies the pass criterion:
1. **Latency Performance:** Daemon-routed writes achieve a p95 latency under
   **0.17 seconds** in all cases (p50 ~40 ms), utilizing less than **3.5%** of
   the 5.0-second budget and outperforming direct Python subprocess startup by
   nearly an order of magnitude.
2. **Single-Writer Topology:** Routing writes through the daemon eliminates
   writer lease contention by construction. The daemon holds the sole writer
   lease, and all four CLIs and their hooks write through the unified HTTP
   interface.
3. **Elimination of Fragile Lock Relief:** The in-memory monkey patch
   (`_relieved_palace_lock` / spec 0110) becomes obsolete and is retired.

This specification implements Shape (b), converting `hooks/mempalace-transcript.sh`
to persist session exchanges via the shared MemPalace MCP HTTP daemon.

## Requirements

1. `hooks/mempalace-transcript.sh` SHALL persist session transcript drawers by
   sending an HTTP JSON-RPC `tools/call` request for `mempalace_add_drawer` to
   the shared MemPalace MCP HTTP daemon (`http://${MEMPALACE_MCP_HOST:-127.0.0.1}:${MEMPALACE_MCP_PORT:-41893}/mcp`).
2. The transcript hook SHALL authenticate against the shared MemPalace MCP HTTP
   daemon using the bearer token provisioned in the machine-local token store
   (`~/.mempalace/server/<key>/token`).
3. `hooks/mempalace-transcript.sh` SHALL retain its 5.0-second execution timeout
   ceiling via the system timeout wrapper, ensuring that a hung network call
   cannot stall the calling CLI session.
4. If the shared MemPalace MCP HTTP daemon is unreachable, returns an HTTP error
   status, or fails to respond within the timeout, the hook SHALL emit a
   diagnostic message to stderr with exit code `4` (`DAEMON_UNREACHABLE`), SHALL
   NOT write directly to disk, and SHALL exit 0 from the outer hook wrapper so
   that the agent's turn is never blocked.
5. The in-process lock bypass (`_relieved_palace_lock`) and direct in-process
   `mempalace.mcp_server.tool_add_drawer` invocation in
   `hooks/mempalace-transcript.sh` SHALL be removed.
6. `docs/adr/0016-shared-mempalace-mcp-http-server.md` SHALL receive an addendum
   recording the empirical latency measurement results and the resolution of
   Derived Spec 4 in favor of daemon routing (Shape b).
7. The hook JSON registrations (`hooks/*-transcript-hooks.json`) SHALL remain
   structurally unchanged, preserving compatibility across Claude Code, Gemini
   CLI, Copilot CLI, and Antigravity CLI.

## Scenarios

### Happy path — Transcript hook persists drawer through daemon

Given a running session in any of the four supported CLIs  
And the shared MemPalace MCP HTTP daemon is active on `127.0.0.1:41893`  
When a session lifecycle event triggers `hooks/mempalace-transcript.sh`  
Then the hook sends an authenticated `tools/call` request to the daemon  
And the daemon persists the transcript drawer under the `transcripts` wing  
And the hook completes execution in under 200 milliseconds.

### Failure path — Daemon unreachable falls back to soft skip

Given the shared MemPalace MCP HTTP daemon is stopped or unreachable  
When a session lifecycle event triggers `hooks/mempalace-transcript.sh`  
Then the hook attempts to reach the daemon endpoint  
And the request fails with a connection refusal or timeout  
And the hook logs `DAEMON_UNREACHABLE` to stderr  
And the hook exits cleanly without blocking the interactive CLI session.

### Invariant check — Palace maintains single-writer lease

Given multiple concurrent CLI sessions executing hook events  
When transcript writes are submitted concurrently  
Then all writes route through the single shared MemPalace daemon process  
And no process attempts to acquire an out-of-band disk lock.

## Out of scope

- Modifying the daemon's internal MCP tool implementations in `mempalace`.
- Modifying the ChromaDB HTTP service daemon (managed separately under ADR-0006).
- Altering the payload format or truncating cap (4000 characters) defined in `hooks/mempalace-transcript.sh`.

## Open questions

- (none — all questions resolved during SPECS)
