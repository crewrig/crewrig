---
id: "0136"
slug: document-shared-mempalace-mcp-daemon
status: approved
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 751
version: 1.0.0
---

# Document the shared MemPalace MCP daemon

## Intent

A reader who opens the project's entry documentation learns that shared memory
has two coordinated layers, not one, and can operate the upper one: start it,
check it, stop it, tell a collision from a healthy service, and replace its
credential. The decision record behind that layer is reachable from the
documentation rather than only from the directory that holds it, and no statement
in it contradicts the code it depends on. An agent reading the memory rules
understands that a refused write is now the rare case on a converted machine
rather than the expected one.

## Requirements

1. Every factual claim this spec's implementation writes or corrects about
   MemPalace's own behaviour SHALL be verified against the installed MemPalace
   source at the pinned version, and the verifying file and line SHALL be cited
   in the implementation's logbook comment. A claim that cannot be verified
   SHALL NOT be written.
2. `README.md` SHALL describe both memory coordination layers — the shared
   ChromaDB daemon and the shared MCP daemon — and SHALL NOT state or imply that
   the ChromaDB layer alone reduces write contention to a single process.
3. `README.md` SHALL name the operator entry point that converts a machine to
   the shared MCP daemon, and SHALL link the runbook of requirement 4.
4. A runbook for the shared MCP daemon SHALL exist under `docs/runbooks/` and
   SHALL cover: starting, stopping and checking the daemon; the distinction
   between stopping it and uninstalling it, including that a stop under a
   supervisor is a restart request; the location of its log; the diagnostic for a
   port already in use; and the procedure for replacing the bearer token.
5. The token-replacement procedure SHALL be recorded in the runbook of
   requirement 4 in the order that leaves no daemon serving a superseded value,
   and SHALL state that no automated path exists yet.
6. The runbook of requirement 4 SHALL NOT describe any command-line flag,
   option, or script that the repository does not ship at the time the
   documentation merges.
7. ADR 0016 SHALL be reachable by link from at least one document outside
   `docs/adr/`.
8. `docs/concepts.md` SHALL state that the agent-memory tier is served by a
   shared process rather than by one process per session, and SHALL link ADR
   0016.
9. `artifacts/core/rules/60-tools.md` SHALL state that a peer-writer refusal is
   the rare case on a machine converted to the shared MCP daemon, while keeping
   the refusal documented as the degraded path an agent must still handle.
10. Every statement in ADR 0016 asserting that MemPalace mints a bearer token on
    a loopback bind SHALL be corrected, including any open question whose
    premise rests on that assertion. The correction SHALL leave the ADR's
    decision unchanged and SHALL be marked as a correction rather than silently
    rewritten.
11. This spec's implementation SHALL NOT restate the per-CLI integration facts
    that `docs/cli-matrix.md` carries. Prose that needs them SHALL link the
    matrix row.
12. The documentation SHALL carry a diagram of the two-layer coordination
    topology, placed where a reader first meets that topology.
13. Every operator procedure this spec requires whose steps have a
    consequential order SHALL carry a diagram of that order. Converting a
    machine and replacing the bearer token each qualify.
14. Every diagram SHALL ship with a form that a later contributor can diff and
    amend — either a text-based source rendered at read time, or a generated
    image committed alongside the input that produced it. A diagram whose only
    committed form is an opaque binary SHALL NOT be introduced.
15. Every diagram SHALL remain legible on both a light and a dark reading
    surface.

## Scenarios

**Scenario:** An operator converts a machine and can then run it

```text
Given  a reader who has only read README.md
When   they follow its memory section to the MCP daemon runbook
Then   they can start the daemon, confirm it is serving, read its log,
       recognise a port collision, and replace its token without reading
       any script's source
```

**Scenario:** A reader is not told the contention problem is solved when it is not

```text
Given  a machine that has NOT been converted to the shared MCP daemon
When   a reader consults README.md about concurrent sessions
Then   the text distinguishes the layer that is active from the layer that
       requires conversion, and does not present single-writer behaviour as
       already in force
```

**Scenario:** A false claim is rejected rather than propagated

```text
Given  a statement in ADR 0016 that MemPalace mints a token on a loopback bind
When   the implementation checks it against the installed MemPalace source
Then   the statement is corrected in the ADR, the correction cites the source
       line that refutes it, and every open question resting on the same
       premise is corrected in the same change
```

**Scenario:** A documented procedure names a flag that does not exist

```text
Given  a draft runbook describing a --rotate flag for the token
When   the repository ships no such flag
Then   the draft is rejected and the manual procedure is documented instead,
       stating that no automated path exists yet
```

**Scenario:** A reader grasps the topology before reading a paragraph about it

```text
Given  a reader who has never heard of the two coordination layers
When   they reach the section of README.md that introduces them
Then   a diagram shows both layers, which one requires conversion, and where
       the palace sits relative to them
```

**Scenario:** A diagram that cannot be amended is refused

```text
Given  a diagram contributed as an image file with no accompanying source
When   a later contributor needs to correct one label in it
Then   the contribution is refused, because nothing committed lets them
       regenerate or diff it
```

## Out of scope

- Building the token-rotation tooling itself. This spec documents the manual
  procedure; the automated path is a separate ticket.
- Any change to `docs/cli-matrix.md` rows 7c, 7d or 10, which already carry the
  per-CLI facts and remain the machine-readable source of truth.
- Repairing a machine left in an unrecognisable arrangement, and deciding the
  transcript hook's write path. Both are separate derived specs of ADR 0016.
- Correcting the content-coverage claim in `docs/cli-matrix.md` row 8, which
  belongs to the transcript-fidelity work.
- Any change to the daemon's behaviour, its supervisor units, or its scripts.

## Open questions

- None.
