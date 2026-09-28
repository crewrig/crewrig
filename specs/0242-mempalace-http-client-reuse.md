---
id: "0242"
slug: mempalace-http-client-reuse
status: implemented
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 1370
version: 1.0.0
---

# MemPalace HTTP wrapper client reuse

*Root cause is diagnosed from reading the code (issue #1370): `_http_factory()`
in `scripts/lib/mempalace-http-wrapper.py` builds a brand-new
`chromadb.HttpClient` — and therefore a brand-new `httpx` connection pool — on
every call, and MemPalace's own `_get_client()` (in the separate `mempalace`
package) calls that factory again whenever `chroma.sqlite3`'s mtime or inode
changes, which in HTTP transport mode happens on every write from any session.
This has NOT yet been independently reproduced by an automated test.
Producing that reproduction, and the fix it validates, is this ticket's own
DEV-stage job — the acceptance criteria below are test-first by design.*

## Intent

A MemPalace MCP session running the wrapper in HTTP transport mode holds a
bounded number of ChromaDB HTTP connections open against the shared daemon for
the entire lifetime of the process, no matter how many times the daemon's
on-disk index file changes underneath it. A person or agent running a normal
day of MCP traffic on a shared machine no longer sees the wrapper's or the
daemon's socket count climb toward the operating system's ephemeral-port
ceiling, and no longer sees unrelated outbound network operations — `git
push`, `gh`, a test suite's network calls — fail once that ceiling is reached.

## Requirements

1. `_http_factory()` in `scripts/lib/mempalace-http-wrapper.py` SHALL return
   the same process-wide `HttpClient` instance on every invocation after the
   first, instead of constructing a new client on every call.
2. The process-wide client SHALL be built lazily: no `HttpClient` instance
   for this cache SHALL be constructed before `_http_factory()` is first
   invoked in the process.
3. The connection-pool settings already read from
   `MEMPALACE_CHROMA_MAX_CONNECTIONS` and
   `MEMPALACE_CHROMA_MAX_KEEPALIVE_CONNECTIONS` SHALL apply to the single
   reused client, so the wrapper's total socket footprint against the daemon
   SHALL stay bounded by those two values no matter how many times
   `_http_factory()` is subsequently invoked in the same process.
4. When two or more invocations of `_http_factory()` race to perform the
   first (lazy) build in the same process, the wrapper SHALL still end the
   race holding exactly one live cached client for every subsequent call —
   including the other racing caller's — to return. A race SHALL NOT leave
   more than one client's connection pool active for the remainder of the
   process's life.
5. If the lazy build of the process-wide client raises an exception, the
   wrapper SHALL NOT cache a client for that failed attempt; a later call to
   `_http_factory()` SHALL be free to attempt the build again rather than
   being permanently stuck on the failed attempt.
6. This ticket's DEV stage SHALL add an automated, self-contained test that
   exercises the patched `_http_factory()` directly and asserts either (a)
   repeated calls return the identical object instance, or (b) the number of
   underlying client/connection-pool objects created stays bounded after a
   simulated burst of N reconnect-triggering calls. The test SHALL NOT open a
   network connection to the live, shared MemPalace daemon (127.0.0.1:41893)
   or its ChromaDB backend (127.0.0.1:8001) — every session on this machine
   currently depends on that daemon, so verification SHALL be self-contained
   rather than a probe against the live process.
7. The fix SHALL be scoped to `scripts/lib/mempalace-http-wrapper.py` in this
   repository. It SHALL NOT modify the `mempalace` package's own
   `_get_client()` reconnect logic, which is maintained outside this
   repository.
8. Any new file this ticket adds SHALL comply with spec 0238's ratchet
   (`specs/0238-shell-ratchet-and-typescript-toolchain.md` requirement 3): a
   new test file SHALL be authored in TypeScript, or, if authored in Python,
   SHALL import the `mempalace` library. Editing the existing
   `scripts/lib/mempalace-http-wrapper.py` is not subject to this constraint,
   since editing a tracked file is not "adding" one under that requirement.

## Scenarios

**Scenario:** Repeated reconnect calls reuse one client

Given the wrapper process has already built its cached `HttpClient` once
When `_http_factory()` is invoked additional times, as MemPalace's
`_get_client()` does on every `chroma.sqlite3` mtime or inode change
Then every invocation returns the same cached instance, and no additional
connection pool is created beyond the one already bounded by
`MEMPALACE_CHROMA_MAX_CONNECTIONS` and
`MEMPALACE_CHROMA_MAX_KEEPALIVE_CONNECTIONS`.

**Scenario:** A failed lazy build does not poison the cache

Given no cached client has been built yet in the process, and the first call
to `_http_factory()` raises because the client construction fails
When a later call to `_http_factory()` is made
Then the wrapper attempts the build again rather than returning a broken
cached instance or permanently refusing to build one, and no invocation prior
to the first successful build increases the wrapper's held connection count
beyond one failed, discarded attempt.

## Out of scope

- The upstream `mempalace` package's `_get_client()` fix (closing the
  previous client before rebuilding). That change lives outside this
  repository's control and is not part of this spec.
- Any interaction — read or write — with the live, shared MemPalace daemon
  (127.0.0.1:41893) or its ChromaDB backend (127.0.0.1:8001) as part of this
  ticket's verification. Every agent session on this machine currently
  depends on that daemon; this ticket's test-first acceptance criteria
  (requirement 6) is deliberately self-contained instead.
- Changing the default values of `MEMPALACE_CHROMA_MAX_CONNECTIONS` or
  `MEMPALACE_CHROMA_MAX_KEEPALIVE_CONNECTIONS`.
- Changing the behavior of the Step 3 startup daemon-reachability probe
  (`_probe = _chromadb.HttpClient(...)`) beyond whatever requirement 1's
  caching implies for it. Whether the probe client doubles as the first
  cached instance, or stays a separate one-off client, is a PLAN-stage
  implementation decision this spec does not fix.
- A formal locking implementation for requirement 4. Any approach that
  satisfies the stated race outcome is acceptable; a specific
  synchronization primitive is not mandated.
- Any change to the orphan self-reap watchdog (Step 0), the runtime version
  guard (Step 1, spec 0108), or any other section of
  `mempalace-http-wrapper.py` unrelated to `_http_factory()`.

## Open questions

- [OPEN] Does MemPalace's own `_get_client()` (in the separate `mempalace`
  package) ever invoke `_http_factory()` from more than one thread within a
  single wrapper process, or is the wrapper's MCP dispatch strictly
  single-threaded per session? This session could not import the
  `mempalace` package to inspect its calling context (it is not installed in
  this worktree's Python environment). If dispatch is strictly
  single-threaded, requirement 4's race-safety may be satisfiable without
  any synchronization primitive; if not, the DEV-stage implementation needs
  one. Left for PLAN to resolve by reading the installed `mempalace` package
  directly on a machine where it is available.
