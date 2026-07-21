---
id: "0088"
slug: http-wrapper-pool-bound
status: draft
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 588
version: 1.1.0
---

# MemPalace HTTP wrapper connection-pool bound

## ADDED

1. **New requirement (R9) — shared connection-ceiling override.** The
   environment variables introduced to override the connection ceiling
   (per R3) SHALL be shared verbatim between
   `scripts/lib/mempalace-http-wrapper.py` and
   `hooks/mempalace-transcript.sh` — a single override value tunes both
   components' ceilings identically, mirroring the shared
   `MEMPALACE_CHROMA_HOST` / `MEMPALACE_CHROMA_PORT` pattern the hook
   already reuses from the wrapper (see the hook's own header comment
   and spec 0073 R2).
2. **New requirement (R10) — hook's soft-skip behavior unchanged.**
   `hooks/mempalace-transcript.sh`'s existing behavior of soft-skipping
   persistence — printing a `DAEMON_UNREACHABLE:` message and exiting
   with status 4, per spec 0073 R3-R4 — when the shared daemon is
   unreachable SHALL remain unchanged by the ceiling introduced by this
   delta, mirroring R6's protection of the wrapper's own unrelated
   failure behavior.
3. **New scenario — transcript hook's per-invocation clients also stay
   within the connection ceiling.** To be read into a future cumulative
   `## Scenarios` reading of spec 0088, alongside the parent's existing
   three scenarios:

   ```text
   **Scenario:** Transcript hook's per-invocation clients also stay
   within the connection ceiling

   Given the shared Chroma daemon is running and
         `MEMPALACE_TRANSCRIPT_ENABLED=1`
   When  `hooks/mempalace-transcript.sh` is invoked for a
         persistence-eligible event (`UserPromptSubmit`, `Stop`,
         `SessionStart`, or `SessionEnd`) and its Python subprocess
         constructs both the heartbeat reachability-probe `HttpClient`
         (around line 199) and the patched-`PersistentClient`-factory
         `HttpClient` (around line 187)
   Then  both clients are constructed with the same total- and
         idle-connection-ceiling `settings` as the wrapper (8 total / 4
         idle by default, or the shared environment-variable override
         added by R9)
   and   the hook's existing `DAEMON_UNREACHABLE:` soft-skip behavior
         (spec 0073 R3-R4) is unchanged by the ceiling
   ```

4. **New out-of-scope items.**
   - Changing `hooks/mempalace-transcript.sh`'s existing non-blocking,
     soft-skip behavior on daemon-unreachable (`DAEMON_UNREACHABLE:` /
     exit 4, spec 0073 R3-R4) to match the wrapper's fail-loud startup
     behavior (R6) — the two components' failure semantics are
     deliberately different (a per-event fire-and-forget hook vs. an
     MCP-session startup gate), and this delta only bounds
     connection-pool size, not error-handling philosophy.
   - Asserting R5's queuing behavior (excess demand waits rather than
     fails) against `hooks/mempalace-transcript.sh` — each invocation
     is a short-lived subprocess making at most two Chroma calls, well
     under the ceiling, so the queuing path is never exercised in
     practice for this component. A synthetic-burst regression test
     forcing that path for the hook is not required by this delta.
   - Any change to `hooks/mempalace-transcript.sh`'s event-type
     filtering (the `PostToolUse` skip), its room-id derivation, or its
     content-truncation logic — the connection ceiling introduced by
     this delta is orthogonal to those behaviors.

## MODIFIED

Requirement 1 is broadened to name both call sites rather than the
wrapper alone.

- Original R1:

  > The per-session connection footprint that
  > `scripts/lib/mempalace-http-wrapper.py` holds open against the
  > shared Chroma daemon SHALL be capped to an explicit, fixed ceiling
  > instead of the current default that leaves it effectively
  > unconstrained.

- Replacement R1:

  > The connection footprint against the shared Chroma daemon that
  > `scripts/lib/mempalace-http-wrapper.py` holds open for the lifetime
  > of an MCP session, and that each invocation of
  > `hooks/mempalace-transcript.sh` holds open for the lifetime of that
  > invocation, SHALL each be capped to an explicit, fixed ceiling
  > instead of the current default that leaves both effectively
  > unconstrained.

Requirement 4 is broadened to enumerate the hook's two call sites
alongside the wrapper's.

- Original R4:

  > The ceiling SHALL apply to every connection the wrapper opens
  > against the shared daemon, including the startup reachability check
  > and the connection(s) used for the running MCP session — no code
  > path SHALL be exempt from it.

- Replacement R4:

  > The ceiling SHALL apply to every connection either component opens
  > against the shared daemon — for
  > `scripts/lib/mempalace-http-wrapper.py`, including the startup
  > reachability check and the connection(s) used for the running MCP
  > session; for `hooks/mempalace-transcript.sh`, including both the
  > heartbeat reachability-probe client (around line 199) and the
  > patched-`PersistentClient`-factory client used to persist the
  > transcript entry (around line 187) — no code path in either
  > component SHALL be exempt from it.

Requirement 8 is broadened so the mandated regression test covers both
components.

- Original R8:

  > A regression test SHALL assert that the wrapper's connection(s) to
  > the shared daemon carry the bounded ceiling, so a later refactor
  > cannot silently drop it back to the unconstrained default.

- Replacement R8:

  > A regression test SHALL assert that
  > `scripts/lib/mempalace-http-wrapper.py`'s connection(s) and
  > `hooks/mempalace-transcript.sh`'s two `HttpClient(...)` call sites
  > (the heartbeat probe and the patched-`PersistentClient` factory)
  > carry the bounded ceiling, so a later refactor cannot silently drop
  > either back to the unconstrained default.

## REMOVED

(None. This delta only broadens R1, R4, and R8 — see `## MODIFIED` —
and adds new requirements, a scenario, and out-of-scope items — see
`## ADDED`. No requirement, scenario, or out-of-scope item from the
parent spec is deleted.)
