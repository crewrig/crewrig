# ADR 0016 — Shared MemPalace MCP HTTP server

<!-- crewrig-doc: section=architecture-adr nav_order=160 published=true title="ADR 0016 — Shared MemPalace MCP HTTP server" -->

**Status:** Proposed — 2026-08-08 (issue #728)

## Framing

- **Goal.** Let every concurrent CLI session write to shared memory. Today the
  first session to mutate takes the palace writer lease and holds it until its
  process dies; every sibling session is refused for the rest of its life.
- **Constraints.** Multi-CLI parity (`AGENTS.md` → *Multi-CLI parity*); the
  corruption guarantee ADR-0006 established must not regress; the spec-0108
  runtime version guard must keep a place to stand; no MemPalace source
  modification.
- **Non-goals.** Partitioning the palace by sphere (orthogonal — see *Open
  questions*); changing the `-32001` semantics upstream; reworking the
  ChromaDB tier, which ADR-0006 already settled.

## Context

### The observed failure

Three concurrent Claude Code sessions, 2026-08-08. Every mutating MemPalace
call from two of them returned MCP error `-32001` — *"Peer MCP writer active;
this server is read-only for mutating tools"*. The Session-End protocol
(`artifacts/core/rules/60-tools.md` → *Memory Activation Protocol*) mandates a
handoff-drawer update and a diary entry; neither could land.

The holder was identified directly:

```text
lsof ~/.mempalace/locks/mine_palace_e29dc40b24dad462.lock
Python  4837  hoanicross  6u  REG  ...
```

The lock filename is keyed by `sha256(realpath(palace_path))[:16]`; recomputing
it from `~/.mempalace/palace` produced the same key. The holder was **the most
recently started session** — twenty minutes old, blocking two sessions that had
been running for eight and ten hours. The lease goes to whoever mutates first,
not to whoever arrived first.

### The mechanism

`mempalace/mcp_server.py` → `_acquire_mcp_writer_lock()`:

- The lease **is** `mine_palace_lock(palace_path)` — an `fcntl.flock`, one per
  palace.
- It is acquired **lazily**, on the first mutating tool call, not at startup.
- It is released **only at process exit** (`atexit`). Idleness releases nothing.
- There is no backend conditional: the same lease is taken whether the ChromaDB
  client is `PersistentClient` or `HttpClient`.

It covers fourteen tools spanning two different stores — drawer writes that go
through the ChromaDB daemon, and `kg_*` writes that go straight to
`~/.mempalace/knowledge_graph.sqlite3`, a file outside the daemon's `--path`.

### Two tiers of sharing; only one was addressed

```text
Tier 2 — MCP      : N CLI sessions        → N stdio MemPalace processes   ← contention
Tier 1 — ChromaDB : N MemPalace processes → 1 `chroma run` daemon         ← ADR-0006
```

ADR-0006 applied the correct pattern — collapse N owners onto one daemon — one
tier too low. The naming compounds it: the "http" in
`scripts/lib/mempalace-http-wrapper.py` denotes the **ChromaDB client**, not the
MCP transport.

ADR-0006 is working, and measurably so. Palace `.drift-*` directories, which
record the corruption class it targeted:

| Period | Drift events |
|---|---|
| May 2026 | 2 |
| June 2026 | 133 |
| July 2026 | 130 |
| Since 2026-07-21 | **0** |

The last drift predates the current daemon's start. Eighteen days clean against
roughly 130 per month before. This ADR extends that result upward; it does not
revisit it.

### The upstream remedy already exists

`mempalace serve` (`cli.py` → `cmd_serve`) is described in its own docstring as
*"a turnkey wrapper over `mempalace-mcp --transport http`"*. It is not a
prototype:

- `ThreadingHTTPServer` with `daemon_threads = True` — **one process, N
  concurrent clients**.
- Per-palace bearer token, auto-generated and stored `0600` at
  `~/.mempalace/server/<sha256(palace)[:24]>/token`, stable across restarts. The
  token is passed to the child through the environment, never through `argv`.
- Optional TLS (`--tls-cert` / `--tls-key`), a `--read-only` mode, and an
  unauthenticated `/healthz` liveness endpoint.
- A token is *mandatory* on a non-loopback bind; on loopback it is optional, and
  `cmd_serve` mints one anyway.

The lease is designed for exactly this topology. From `mine_palace_lock`'s
docstring:

> Re-entrant … lets the threaded MCP HTTP transport write from a worker thread
> while the long-lived writer-lease is held on another thread of the same
> process.

One process holds the lease; every client writes through it. The contention
disappears by construction. **This is not an upstream defect to report** — it is
a supported topology the framework has not adopted. It ships in the version the
framework already pins (`>=3.6.0,<3.7`).

### The framework already proved the client half

Spec 0091 established that all four CLIs consume an HTTP-transport MCP server,
with the translation to each native shape grounded empirically —
`docs/cli-matrix.md` row 7h: *"stdio and http/sse reach all four CLIs
(grounded)"*, mapping the neutral `url` to Claude's `--transport http`,
Gemini's and Copilot's `{type,url,headers}`, and Antigravity's
`{serverUrl,headers}`.

Every piece exists. None has been pointed at MemPalace itself, which remains
registered over stdio in all four surfaces.

## Decision

Adopt a **single supervised MemPalace MCP HTTP daemon** owning the palace writer
lease, and register MemPalace over `--transport http` in all four CLI surfaces.

### Topology

```text
`chroma run` ──────────────── sole PersistentClient + sole HNSW compactor  (ADR-0006)
        ↑ 127.0.0.1:8001
mempalace MCP HTTP daemon ── sole writer-lease holder                      (this ADR)
        ↑ 127.0.0.1:<port>, bearer token
Claude Code ×N ─┐
Gemini CLI      ├─→ all clients, all sessions, concurrent
Copilot CLI     │
Antigravity CLI ┘
```

### The two tiers must compose

The daemon **must be launched through `scripts/lib/mempalace-http-wrapper.py`**,
not through a bare `mempalace serve`. The wrapper monkey-patches
`chromadb.PersistentClient` before `mempalace` is imported and then calls
`mempalace.mcp_server.main()`; a bare `mempalace serve` `execve`s the module
directly and would resolve `PersistentClient` unpatched — re-introducing the
second `PersistentClient` that ADR-0006 exists to prevent, and bypassing the
spec-0108 launch-time version guard that lives in the same wrapper.

This is the central implementation constraint of this ADR: **collapsing tier 2
must not un-collapse tier 1.**

### Fail loud, never silent

ADR-0006's contract is carried over verbatim to the new tier. If the MCP daemon
is unreachable, the CLI's MCP registration must fail visibly — never fall back
to spawning a stdio MemPalace process, which would silently restore the
contention this ADR removes and mask the outage.

### Daemon lifecycle

Supervised per OS, mirroring the ChromaDB daemon: a launchd user agent on macOS
with `KeepAlive=true`, a systemd user unit on Linux with `Restart=always`.

`MEMPALACE_MCP_IDLE_HOURS` (default 8 h) terminates the server after an idle
period — a guard designed for per-session stdio servers, where stale processes
accumulate. On a supervised shared daemon it is either counter-productive
(a restart cycles the lease for no reason) or harmless (the supervisor restarts
it immediately). The derived spec sets it deliberately rather than inheriting
the default.

## Alternatives considered

### A. Status quo — retry once, then fall back (spec 0103)

- **Pro:** already specified and implemented; zero new moving parts.
- **Con:** it is a *loss-mitigation* protocol, not a fix. Its fallback is
  "file the friction as an issue" — which covers friction tagging only, and has
  no counterpart for the Session-End memory flush that this ADR's motivating
  incident actually lost.
- **Verdict:** retained as the degraded-path safety net, not as the answer.

### B. `MEMPALACE_MCP_ALLOW_PEER_WRITER=1`

- **Pro:** one environment variable; instant.
- **Con:** disables the guard for *all* fourteen mutating tools, including the
  `kg_*` writes to `knowledge_graph.sqlite3`, which sit outside the ChromaDB
  daemon's protection. It removes the symptom and the diagnostic at once: the
  day the lease matters, nothing reports it.
- **Verdict:** rejected as a durable setting; acceptable only as a one-off
  operator escape hatch.

### C. Ask upstream to make the lease backend-conditional

- **Pro:** would shrink the lease to the stores that still need it.
- **Con:** the shared HTTP server already solves the problem completely, in the
  pinned version. Asking upstream to change a mechanism whose supported
  alternative we have not adopted is asking them to work around our
  configuration.
- **Verdict:** rejected. Should the derived specs uncover a real gap in the
  HTTP topology, this reopens on evidence.

### D. One palace per sphere

- **Pro:** the lease is keyed per palace, so sessions on different projects
  would stop contending. It would also serve the sphere-tightness rule in the
  operator's own organization rules, which a single palace mixing client,
  employer, and personal wings does not.
- **Con:** does not help two sessions on the *same* project — the exact case
  observed. It is a data-partitioning decision with migration consequences,
  independent of transport.
- **Verdict:** orthogonal and worth its own ADR; not a substitute for this one.

### E. Bare `mempalace serve`, no wrapper

- **Pro:** the shortest path — one supervised command.
- **Con:** breaks ADR-0006 and the spec-0108 guard, as set out in *The two tiers
  must compose*.
- **Verdict:** rejected.

## Consequences

### Positive

- Writer contention is eliminated by construction: one lease, one holder, all
  sessions writing through it. `-32001` between sibling sessions becomes
  unreachable in the nominal path.
- N MemPalace processes collapse to one — less resident memory, fewer ChromaDB
  connection pools, one log instead of N interleaved.
- The spec-0108 version guard gets a single, authoritative enforcement point
  instead of one per session.
- Symmetric across all four CLIs by construction: the registration is a client
  concern, and spec 0091 already ships the per-CLI translation.
- Consistent with ADR-0006 — the same pattern, the same fail-loud contract, one
  tier up.

### Negative / trade-offs

- **A second SPOF.** Memory dies for every session at once instead of for one.
  Mitigated by the supervisor and by fail-loud detection, exactly as ADR-0006
  mitigated the first.
- **A second loopback port**, plus a bearer token to provision and to keep out
  of `argv` and out of committed config.
- **Version-guard semantics shift.** Today each session serves the MemPalace
  version its own interpreter resolves; afterwards every session is served by
  the daemon's version. A session started after an upgrade keeps talking to the
  pre-upgrade daemon until it is restarted. The derived spec must state how the
  daemon is cycled on upgrade, and `scripts/doctor-mempalace.sh` must report the
  daemon's served version rather than four per-CLI registrations.
- **Startup ordering grows a step:** ChromaDB daemon → MCP daemon → CLI session.

### Blast radius

In scope for the derived specs:

- Supervisor units for the MCP daemon under `config/`, alongside the ChromaDB
  units.
- The four `setup-*-interactive.sh`, switching the `mempalace` registration from
  stdio to `--transport http` with its token, using the spec-0091 translation.
- `scripts/doctor-mempalace.sh` — report the daemon rather than per-session
  registrations.
- `docs/cli-matrix.md` rows 7c and 7d, and the MemPalace entries they describe.
- Taskfile entries for daemon lifecycle, mirroring the ChromaDB ones.

Out of scope: the palace-partitioning question (D), the ChromaDB tier, and any
MemPalace source change.

## Derived spec plan

1. **Daemon and supervisor** — launch through the wrapper, supervisor units for
   both OSes, health check, deliberate `MEMPALACE_MCP_IDLE_HOURS`, fail-loud
   probe. Must land first; everything else depends on it.
2. **Four-CLI registration** — stdio → HTTP in every setup script, token
   provisioning, no committed secret. Symmetric by the parity rule.
3. **Migration and diagnostics** — detect and replace a pre-existing stdio
   registration, cycle the daemon on MemPalace upgrade, extend
   `doctor-mempalace.sh`.
4. **Documentation** — `docs/cli-matrix.md`, the ADR-0006 cross-reference, and
   the runbook.

## Open questions

- **ADR-0006 is still `Proposed`** while running in production for eighteen days
  with the validation table above. This ADR builds directly on it; a dependency
  on an unaccepted decision is a weak foundation. Promoting it to `Accepted`
  with that evidence is a prerequisite of coherence, not a separate errand.
- **Does the wrapper forward `argv` to `mcp_server.main()`?** The handoff calls
  `main()` with no explicit arguments, so it reads `sys.argv`. Passing
  `--transport http --host … --port …` through the wrapper is expected to work
  but must be verified in DEV before spec 1 commits to the launch line.
- **Token on a loopback bind** — mint one anyway (defence in depth, matching
  `cmd_serve`'s own behaviour) or rely on the loopback boundary?
- **What becomes of spec 0103?** Its `-32001` fallback stops describing the
  expected case. Keep it as the degraded-path net, or restate its trigger?
- **Is a per-session read-only client worth it?** `MEMPALACE_MCP_READ_ONLY`
  would let a session declare itself a reader; probably unnecessary once one
  writer serves everyone, but it is the natural place to ask.
