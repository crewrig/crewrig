---
id: "0110"
slug: transcript-hook-lock-bypass
status: approved
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 713
version: 1.0.0
---

# Transcript persistence survives a concurrently held palace write lock

## Intent

An agent whose session records transcripts keeps recording them while another
writer already holds the palace write lock — the ordinary condition as soon as
more than one agent or background task runs against the same palace, and today
the condition under which every transcript is silently lost. And if the relief
that makes this possible ever stops working, the operator learns that
specifically, rather than reading a generic write failure that names no cause
and looks like every other one.

## Requirements

1. When the transcript hook persists an entry while another process holds the
   palace write lock, the hook SHALL persist that entry successfully rather
   than fail to acquire the lock.
2. The lock relief of requirement 1 SHALL take effect only after the hook has
   established that the remote memory service is reachable, so that a
   persistence attempt whose remote routing is not established keeps the
   lock's protection.
3. Before persisting an entry, the hook SHALL establish that the relief of
   requirement 1 is in force on the write path the entry actually takes, and
   SHALL decline to persist and report a failure when it is not.
4. The failure reported per requirement 3 SHALL be distinguishable from every
   failure the hook already reports — an unavailable import, an unreachable
   service, a refused write — in both its exit status and its diagnostic
   prefix.
5. The relief of requirement 1 SHALL apply at every location from which the
   write path resolves the lock, and SHALL NOT assume a single location.
6. The relief of requirement 1 SHALL remain confined to the process the hook
   launches for one entry, and SHALL NOT alter the locking behaviour of any
   other process, including a concurrently running memory server or a
   maintenance writer.
7. The hook SHALL continue to terminate successfully for the calling session
   whatever the outcome of a persistence attempt, so that a failed persistence
   never fails the agent's turn.

## Scenarios

**Scenario:** an entry persists while a peer holds the lock

```text
Given another process holds the palace write lock
And   the remote memory service is reachable
When  the transcript hook persists an entry
Then  the entry is stored
And   the hook reports success
```

**Scenario:** nothing changes when no peer holds the lock

```text
Given no process holds the palace write lock
And   the remote memory service is reachable
When  the transcript hook persists an entry
Then  the entry is stored
And   the hook reports success
```

**Scenario:** an ineffective relief is reported, not silently absorbed

```text
Given the write path no longer resolves the lock where the relief applies
When  the transcript hook attempts to persist an entry
Then  the hook declines to persist
And   it reports a failure whose exit status and diagnostic prefix are used by
      no other failure the hook reports
And   the calling session's turn still succeeds
```

**Scenario:** an unreachable service keeps its existing behaviour

```text
Given the remote memory service is unreachable
When  the transcript hook attempts to persist an entry
Then  the relief of requirement 1 is not in force
And   the hook reports the unreachable-service failure it already reports
And   the calling session's turn still succeeds
```

**Scenario:** a peer's lock protection is unaffected

```text
Given the transcript hook has persisted an entry under the relief
When  another process afterwards acquires the palace write lock
Then  that acquisition behaves exactly as it did before the relief existed
```

## Out of scope

- Changing the MemPalace library, its locking primitive, or the granularity at
  which it serializes writers. This spec adapts the framework's hook to the
  library as shipped; amending the library is upstream work under its own
  ticket.
- Extending the memory service so the hook can record an entry without loading
  the library in-process. That is the architectural answer to the same defect
  and it is deliberately not taken here: it widens the change from a hook to a
  service contract, and it is tracked separately.
- The memory server's writer lease and the `MEMPALACE_MCP_ALLOW_PEER_WRITER`
  setting. Measured against the real write path while the lock was held, that
  setting leaves the failure in place — it governs the server's long-lived
  lease, not the per-write lock this defect turns on — so it is not a lever
  this spec pulls.
- Transcript persistence when no remote memory service is reachable. Spec 0073
  already defines that path, and requirement 2 preserves it unchanged.
- The locking behaviour of the palace's other writers — mining, synchronisation,
  repair. Requirement 6 bounds this spec to the hook's own subprocess; every
  other writer keeps the lock it takes today.
- Recording transcripts for sessions that do not run the hook at all.

## Open questions

None. The three candidate reliefs the anchor issue left implicit were settled by
measurement before this spec was written, against a holder process holding the
lock on a throwaway palace while a second process replayed the real write path:
neutralising the lock primitive works; nulling the collection's palace path also
works but additionally disables the SQLite path and embedder-sidecar resolution
that the same field feeds, making it oversized; and the peer-writer setting
leaves the failure in place. Requirement 5 exists because the relief that works
does so only while the write path resolves the primitive late — three sibling
modules in the same library resolve it at module load instead — so the spec
requires coverage of every resolution site rather than the one observed today.
