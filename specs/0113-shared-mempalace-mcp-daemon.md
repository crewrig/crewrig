---
id: "0113"
slug: shared-mempalace-mcp-daemon
status: implemented
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 739
version: 1.0.0
---

# Concurrent sessions all write to shared memory

## Intent

Every agent session records what it learns, no matter how many other sessions
are open on the same machine. Today the first session to write claims the shared
memory for the whole life of its process, and every sibling session — however
long it has been running, whatever it has to record — is refused for the rest of
its own life, losing the end-of-session memory the protocol requires it to keep.
After this spec, an operator opening a second, third or fourth session notices
nothing at all: each one reads and writes as if it were alone.

## Requirements

1. Two or more agent sessions running concurrently on one machine SHALL each
   succeed at recording to shared memory, with no session refused because
   another session recorded first.
2. The shared memory service SHALL outlive any individual session, and SHALL be
   restarted automatically after it stops unexpectedly.
3. Setup SHALL configure every supported assistant to reach shared memory the
   same way, with no assistant left on the previous arrangement.
4. Setup SHALL NOT leave a machine partly configured: either every supported
   assistant present on it reaches shared memory the new way, or the operator is
   told the configuration did not take and nothing is changed.
5. When shared memory is unreachable, a session SHALL report that plainly and
   SHALL NOT silently revert to the previous arrangement.
6. The runtime version guard SHALL continue to refuse to serve an out-of-range
   memory installation, and its refusal SHALL remain readable by an operator.
7. The corruption guarantee of ADR 0006 SHALL continue to hold: exactly one
   process SHALL own the memory data directory.
8. Any credential the new arrangement requires SHALL NOT be committed to the
   repository, and SHALL NOT be observable in the process list.
9. Transcript recording SHALL continue to succeed under the conditions it
   succeeds under today.
10. An operator SHALL be able to determine, without reading source, whether
    shared memory is currently serving.

## Scenarios

**Scenario:** Two sessions record concurrently

Given the shared memory service is running
And an agent session has already recorded to shared memory
When a second agent session records to shared memory
Then the second recording SHALL succeed
And neither session SHALL be refused

**Scenario:** A session outlives another

Given two agent sessions are running
When the session that recorded first ends
Then the remaining session SHALL continue to record successfully
And SHALL NOT require a restart to do so

**Scenario:** Shared memory is unreachable

Given the shared memory service is not running
When an agent session attempts to record
Then the failure SHALL be reported plainly to the operator
And the session SHALL NOT record through the previous arrangement instead

**Scenario:** An out-of-range memory installation

Given the installed memory package is outside the supported range
When the shared memory service is started
Then it SHALL refuse to serve
And the refusal SHALL name the version found, the supported range, and the
  remedy

**Scenario:** Setup cannot complete the change

Given setup is asked to configure an assistant for shared memory
And the configuration cannot be completed
Then the operator SHALL be told the change did not take
And the assistant SHALL be left reaching shared memory exactly as it did before

**Scenario:** Operator checks whether memory is serving

Given an operator wants to know the state of shared memory
When they consult it the documented way
Then they SHALL receive a plain answer without reading source

## Out of scope

- **The transcript recording path.** Whether transcript entries continue to be
  recorded directly or start going through the shared service is decided by the
  derived spec that ADR 0016 places after this one, gated on a latency
  measurement that cannot be taken until this spec has shipped. This spec only
  requires that transcript recording not regress (requirement 9).
- **Migration of an already-configured machine**, and the operator diagnostics
  that report which arrangement a machine is on. ADR 0016 derived spec 3.
- **Partitioning memory by sphere.** ADR 0016 alternative D, orthogonal and
  deferred to its own decision.
- **Reference documentation and the CLI matrix rows** this change will
  invalidate. ADR 0016 derived spec 5, which follows once the behaviour is
  settled.
- **Changing the memory package itself.** The arrangement this spec adopts is
  one the package already supports.
- **Remote or multi-machine memory.** Everything here is local to one machine.

## Open questions

None. The one question that gated this spec — whether the framework's memory
launcher passes its startup arguments through to the memory server — was
resolved by measurement on 2026-08-08 before the spec was written: it does, and
the service was observed serving and recording. Evidence is recorded on the
logbook issue (#739).
