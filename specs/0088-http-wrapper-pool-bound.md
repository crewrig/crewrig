---
id: "0088"
slug: http-wrapper-pool-bound
status: implemented
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 588
version: 1.0.0
---

# MemPalace HTTP wrapper connection-pool bound

## Intent

A CrewRig user running several concurrent agent CLI sessions against the
shared MemPalace Chroma daemon (ADR-0006) currently sees an individual
session's connection footprint against that daemon climb into the dozens
under load, with no fixed ceiling on how large a single session's footprint
can grow. Realizing this spec keeps each session's footprint small and
predictable, so the daemon's total connection and file-descriptor load —
the sum across every concurrent session — grows slowly as sessions
accumulate instead of compounding without limit, complementing the
server-side floor already raised for the same failure mode in issue #587.

## Requirements

1. The per-session connection footprint that
   `scripts/lib/mempalace-http-wrapper.py` holds open against the shared
   Chroma daemon SHALL be capped to an explicit, fixed ceiling instead of
   the current default that leaves it effectively unconstrained.
2. The ceiling SHALL bound both the total number of connections a session
   holds open to the daemon and the number of idle (keep-alive)
   connections it retains between requests, as two independently
   enforced limits.
3. The default ceiling SHALL be no greater than 8 total connections and
   no greater than 4 idle keep-alive connections per session — a small
   fraction of the roughly 28 connections observed for an active session
   under load — and SHALL remain overridable through dedicated
   environment variables, mirroring the wrapper's existing
   `MEMPALACE_CHROMA_HOST` / `MEMPALACE_CHROMA_PORT` override pattern.
4. The ceiling SHALL apply to every connection the wrapper opens against
   the shared daemon, including the startup reachability check and the
   connection(s) used for the running MCP session — no code path SHALL
   be exempt from it.
5. When a session's momentary demand exceeds the ceiling, the wrapper
   SHALL let the excess requests wait for a connection to free rather
   than failing them outright.
6. The wrapper's existing behavior of exiting with a non-zero status and
   a host/port/restart-command error when the shared daemon is
   unreachable at startup SHALL remain unchanged by the ceiling.
7. `docs/runbooks/chroma-http-server.md` SHALL document the new ceiling,
   its default values, and the environment variables that override them,
   alongside the wrapper's existing documentation.
8. A regression test SHALL assert that the wrapper's connection(s) to the
   shared daemon carry the bounded ceiling, so a later refactor cannot
   silently drop it back to the unconstrained default.

## Scenarios

**Scenario:** Single active session stays within the connection ceiling

Given the shared Chroma daemon is running and no other MemPalace session
is connected
When one MCP session performs a sustained burst of drawer reads and
writes through `scripts/lib/mempalace-http-wrapper.py`
Then the daemon-side connection count attributable to that session stays
at or below the documented ceiling (8 total / 4 idle keep-alive)
And the session's `mempalace_add_drawer` / `mempalace_search` calls
complete successfully throughout the burst

**Scenario:** Daemon unreachable at startup still fails loud

Given the shared Chroma daemon is not running, or unreachable at the
configured host and port
When an MCP session starts and the wrapper's startup reachability probe
runs
Then the wrapper exits with a non-zero status and prints an error naming
the host, the port, and the command to start the daemon
And no connection-ceiling change introduced by this spec suppresses or
alters that exit behavior

**Scenario:** Momentary demand above the ceiling queues instead of failing

Given a single session has already reached its configured maximum of
concurrently open connections to the daemon
When that session issues more concurrent Chroma requests than the
ceiling allows in the same instant
Then the excess requests wait for a connection to free and complete
successfully
And none of the excess requests raise a connection-pool-exhausted error
to the caller

## Out of scope

- Raising the shared Chroma daemon's own resource ceiling (open-file /
  connection headroom on the server side) — the companion fix, already
  speced in merged spec 0087 and tracked in issue #587, currently being
  implemented separately.
- Reaping orphaned wrapper processes or the connections they leave open
  — already covered by spec 0029 (R4-R5); this spec only bounds the pool
  of a live, correctly-reaped session.
- Any change to the daemon's topology, bind host/port, transport, or the
  on-disk index format, or to the pinned `chromadb` version floor already
  declared in the wrapper.
- Automatically tuning the connection ceiling from live measured
  concurrency — a fixed, documented default with an environment-variable
  override is in scope; adaptive or self-tuning sizing is not.
- Any change to how the three supported CLIs (Claude Code, Gemini CLI,
  Copilot CLI) invoke the shared wrapper script — the wrapper remains the
  single, CLI-agnostic module it already is.

## Open questions

- None. Grounding against the pinned production dependency — the
  `mempalace` pipx virtual environment's installed `chromadb==1.5.9`,
  matching the wrapper's own declared `>=1.5.9` floor — confirmed the
  connection-pool hook the issue asked to verify: `chromadb.HttpClient`'s
  `settings` parameter accepts a configuration object exposing dedicated
  total- and keep-alive-connection-limit fields, so R1-R4 are realizable
  against the real API without constructing a custom transport client.
