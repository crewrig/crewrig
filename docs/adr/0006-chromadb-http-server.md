# ADR 0006 — Shared ChromaDB HTTP server for MemPalace

## Status

Proposed — 2026-05-25. Scoped to issue #98.

## Context

CrewRig users run several agent CLIs in parallel — typically two or three
Claude Code sessions plus a Gemini CLI session — and every one of them
spawns its own `mempalace mcp_server` process. Each MCP server constructs
a `chromadb.PersistentClient` against the same on-disk palace
(`~/.mempalace/palace`). MemPalace creates that client at
`backends/chroma.py:1195`.

`PersistentClient` is not a passive file handle: it embeds a full
ChromaDB stack, including an in-process Rust HNSW compactor that flushes
`data_level0.bin` and `index_metadata.pickle` on its own cadence,
outside any Python-level lock. MemPalace's `mine_palace_lock`
(`fcntl.flock` around Python upserts) serializes WAL appends, but the
compactor runs asynchronously after the lock has been released, so two
sibling processes can — and do — flush the same binary segment files
concurrently.

### Incident — 2026-05-25

A normal multi-CLI workday produced:

- **15 188 zombie locks** in ChromaDB's `acquire_write` applicative
  table.
- **`index_metadata.pickle` absent** on the active HNSW segment
  (mid-flush kill from a Python 3.14 / PyO3 segfault).
- **20 580 embeddings stuck in `embeddings_queue`**, never applied to
  the HNSW index.
- Full rebuild required (`rebuild_from_sqlite`, 741 s).

This is a recurring class of corruption, not a one-off. As long as more
than one process owns a `PersistentClient` against the same path, the
race is open.

### Constraint check

- `chromadb.HttpClient` and `chromadb.PersistentClient` both return
  `chromadb.api.ClientAPI` — the call surface MemPalace consumes is
  identical (confirmed in the issue body and the upstream ChromaDB API
  reference).
- MemPalace performs the `PersistentClient` instantiation at a single
  call site (`backends/chroma.py:1195`). The symbol resolves through
  `chromadb.PersistentClient` at import time, which is patchable from a
  thin wrapper module loaded before MemPalace.
- The crewrig layer already owns the MCP server invocation (it ships
  the `mempalace` MCP entry in `.claude/`, `.gemini/`, and
  `.copilot/`), so wrapping the entry point is in-scope and does not
  touch the MemPalace source tree.

## Decision

Adopt a **single shared `chroma run` daemon** owning the palace data
directory, and switch every MemPalace MCP server instance to
`chromadb.HttpClient` via a crewrig-owned **monkey-patch wrapper**.

### Topology

```text
chroma run --path ~/.mempalace/palace --host 127.0.0.1 --port 8001
        ↑ sole PersistentClient + sole Rust HNSW compactor

Claude Code ×N  → mempalace MCP → HttpClient ─┐
Gemini CLI      → mempalace MCP → HttpClient ─┴─→ 127.0.0.1:8001
Copilot CLI     → mempalace MCP → HttpClient ─┘
```

Mutations are serialized by the HTTP server's single writer; reads
remain concurrent. The Rust compactor that flushes binary segment
files exists in exactly one process — the corruption race is
structurally eliminated, not merely narrowed.

### Wrapper contract

A wrapper module (target path:
`scripts/lib/mempalace-http-wrapper.py`, finalized by the developer)
replaces `chromadb.PersistentClient` with a factory returning
`chromadb.HttpClient` configured from environment variables:

- `MEMPALACE_CHROMA_HOST` (default `127.0.0.1`)
- `MEMPALACE_CHROMA_PORT` (default `8001`)

The wrapper is loaded before MemPalace imports — either via `python -m`
chaining or `PYTHONSTARTUP`-style injection from the MCP launcher.
Because the patched symbol is read at MemPalace import time, the
factory must be installed before `import mempalace.backends.chroma`.

### Fallback contract — fail loud, never silent

If `chroma run` is unreachable at MCP startup (TCP connect refused, or
the first `HttpClient.heartbeat()` call fails within a short timeout),
the wrapper **MUST exit the MCP process with a non-zero status and a
human-readable error pointing at the launchd unit and the expected
host:port**. Falling back to `PersistentClient` is explicitly
forbidden: that is exactly the configuration this ADR is replacing,
and a silent fallback would re-introduce the corruption class while
hiding the daemon outage.

The error message must include:

1. The host and port the wrapper tried.
2. The expected launchd / systemd unit name.
3. The command to restart it manually.

### Daemon lifecycle

`chroma run` is managed by a per-OS supervisor:

- **macOS** — a launchd user agent under
  `~/Library/LaunchAgents/`, with `KeepAlive=true` so a crash or
  Python 3.14 / PyO3 segfault is restarted within seconds.
- **Linux** — a systemd user unit
  (`~/.config/systemd/user/mempalace-chroma.service`) with
  `Restart=always`.

The supervisor is responsible for the only `PersistentClient` in the
system. Crewrig ships the unit files and an installer.

## Alternatives considered

### A. Write-only `flock` around the Rust compactor

Wrap the binary flush path in an OS-level `flock`, shared across
processes via a sentinel file under the palace directory.

- **Pro:** no new process, no new port, no daemon to supervise.
- **Con:** the Rust compactor is internal to ChromaDB; there is no
  supported extension point to inject a lock around it. The only
  intervention path would be to monkey-patch private ChromaDB
  internals — a contract that changes between ChromaDB releases and
  would silently break with an upgrade.
- **Con:** even a working lock would serialize compactor work without
  removing the multiple-owner topology, so other latent races
  (segment-file rename, WAL truncation) remain on the table.

**Rejected:** brittle, ChromaDB-version-coupled, and treats a symptom
rather than the topology that produces it.

### B. Palace-per-agent (one PersistentClient, one palace, per CLI)

Give each CLI its own data directory and reconcile periodically.

- **Pro:** zero shared writers; no corruption race by construction.
- **Con:** kills cross-tool memory continuity — pillar #2 of CrewRig.
  Reconciliation between palaces is an unsolved problem (vector-index
  merges are not commutative; KG fact provenance would have to be
  re-stamped on every merge).
- **Con:** disk footprint multiplies by the number of active CLIs,
  and the user no longer has a single source of truth.

**Rejected:** breaks the explicit cross-tool-memory contract that
MemPalace exists to provide.

### C. Swap ChromaDB for `sqlite-vec`

Use `sqlite-vec` (a SQLite extension exposing a vector index) so that
SQLite's existing multi-writer story (WAL mode + `BEGIN IMMEDIATE`)
handles concurrency.

- **Pro:** single well-understood concurrency model; no separate
  daemon; mature operational story.
- **Con:** MemPalace's backend abstraction does not currently target
  `sqlite-vec`; this is a multi-week refactor, not a fix for the
  incident already in flight.
- **Con:** index recall characteristics differ from HNSW; would
  require benchmarking and almost certainly tuning of MemPalace's
  search-quality assumptions.
- **Con:** still requires solving the migration of existing palace
  state.

**Rejected for this ticket:** out of scope and disproportionate.
Worth re-evaluating as a separate ADR if `chroma run` proves
unreliable in production over a multi-month window.

## Consequences

### Positive

- The HNSW corruption class is eliminated by construction: exactly one
  process holds the writer.
- No MemPalace source modification — the wrapper lives entirely in the
  crewrig layer (`scripts/lib/`), so MemPalace upgrades remain
  unblocked as long as `chromadb.PersistentClient` and
  `chromadb.HttpClient` continue to expose `ClientAPI`.
- All three CLIs benefit symmetrically; the wrapper is invoked from
  the shared MCP launcher and does not require per-CLI code paths.
- Operational visibility improves: a single `chroma run` log
  replaces N interleaved per-process logs.

### Negative / trade-offs

- **New SPOF.** `chroma run` is now a single point of failure for all
  MCP memory operations. Mitigation: launchd `KeepAlive` /
  systemd `Restart=always` restart it within seconds of a crash; the
  wrapper's fail-loud fallback makes outages immediately visible
  rather than silently degrading.
- **New port on `127.0.0.1`.** Bound to loopback only; not exposed to
  the network. Documented in the installer output.
- **Wrapper is a private contract on ChromaDB.** If upstream ChromaDB
  ever changes `HttpClient` to no longer return `ClientAPI`, the
  wrapper breaks. Mitigation: pin the ChromaDB version in the
  installer and add a smoke test that asserts
  `isinstance(client, chromadb.api.ClientAPI)`.
- **First-launch ordering.** The supervisor unit must come up before
  any MCP server tries to connect. Mitigation: installer enables and
  starts the unit before writing the wrapper into the MCP entry
  scripts; documented in the runbook.

### Blast radius

In-scope changes (this PR):

- New ADR (this file).
- New wrapper module under `scripts/lib/`.
- New launchd plist and systemd unit under `config/`.
- Updated MCP launcher entries for the `mempalace` server in each CLI
  surface (`.claude/`, `.gemini/`, `.copilot/`) — symmetric across
  all three per the parity rule.
- New installer / Taskfile entries to enable the supervisor unit.
- New row in `docs/cli-matrix.md` for the wrapped MCP entry, since
  the launcher lives in CLI-specific directories.

Out of scope:

- MemPalace source modifications (none required).
- Migrating existing palace data — `chroma run` reads the existing
  on-disk format directly.
- The fallback-to-`PersistentClient` mode is explicitly excluded; it
  re-introduces the corruption class.

## Open risks

1. **launchd / systemd unit not installed on first run after upgrade.**
   Users upgrading crewrig will not have the supervisor unit until
   they run the installer. Mitigation: the wrapper's fail-loud error
   prints the exact installer command, so the failure mode is
   self-documenting rather than silent.
2. **Port collision on 8001.** A user may already run something on
   that port. Mitigation: `MEMPALACE_CHROMA_PORT` is honored by both
   the supervisor unit template and the wrapper; the installer detects
   a collision and surfaces an error before writing the unit.
3. **ChromaDB upgrade breaking the `ClientAPI` equivalence.** The
   wrapper relies on `HttpClient` and `PersistentClient` exposing the
   same call surface. Mitigation: pin ChromaDB in the installer and
   ship a smoke test under `tests/` that exercises a representative
   subset of `ClientAPI` against `HttpClient`.

## Sources

- Issue #98 — root-cause analysis and incident write-up
  (`gh issue view 98 --repo crewrig/crewrig`).
- MemPalace backend instantiation site —
  `backends/chroma.py:1195` (cited in issue #98).
- ChromaDB client interface equivalence — cited in issue #98 against
  the upstream `chromadb.api.ClientAPI` surface.
