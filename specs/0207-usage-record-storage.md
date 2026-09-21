---
id: "0207"
slug: usage-record-storage
status: draft
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 1170
version: 1.0.0
---

# Usage record storage — append-only local journal of record, MemPalace as indexed mirror

## Intent

This specification defines the storage contract every usage record reaches
after capture: a durable record of consumption an organization can trust
before it decides whether to run any shared memory service at all. Every
record the capture step hands over is written once, keyed by its own
identifier, to a local journal that alone constitutes the record of truth
and remains fully readable, correctable, and queryable with no other system
present. When the shared MemPalace daemon is reachable, the same record is
additionally mirrored into an indexed, cross-tool-visible copy inside the
project's own memory space, slimmed down and pointing back at the journal
for its full detail; when the daemon is not reachable, mirroring simply
waits, and nothing about writing or reading a record is affected. A person
operating without MemPalace never notices its absence; a person operating
with it gets the same journal plus a searchable index that catches up on
its own once the daemon returns. Retention stays in the operator's hands:
records persist until an explicit, period-scoped prune removes them from
the journal and its mirror together, and the storage layer never decides on
its own that a record has aged out, nor ever holds a conversation's own
text inside a usage record.

## Requirements

1. The storage contract SHALL accept only records that validate against the
   usage-record schema; a record that fails validation SHALL be rejected
   with a reason and SHALL NOT be stored in the journal or the mirror.
2. A write SHALL be idempotent on the record's own identifier: writing a
   record whose identifier already exists in the journal SHALL change
   nothing already stored for that identifier.
3. The journal SHALL be append-only: no journal entry SHALL be mutated in
   place, and a correction to a previously written record SHALL take the
   form of a new entry carrying the `corrects` field, never an edit of the
   entry it corrects.
4. A write SHALL NOT block or fail the capture step because the shared
   MemPalace daemon is unreachable; the storage contract SHALL return a
   write outcome to the capture step regardless of the daemon's
   reachability.
5. The journal write for a record SHALL complete before any attempt to
   mirror that same record.
6. The journal SHALL be partitioned per source CLI and per period, such
   that every record for a given CLI and period is locatable without
   scanning records outside that CLI and period.
7. Every journal entry SHALL hold the complete record exactly as the
   storage contract received it, including its raw sub-object.
8. The journal SHALL be fully readable, correctable by new entries, and
   queryable with no dependency on the shared MemPalace daemon or on
   MemPalace being installed at all.
9. The journal SHALL live under the framework's own user-space directory,
   and that location SHALL be overridable by the adopting organization.
10. When the shared MemPalace daemon is reachable, the storage contract
    SHALL create exactly one mirrored drawer per record, placed in the
    project's own memory space, in a room dedicated to usage records.
11. A mirrored drawer's content SHALL carry the record's normalized fields
    with its raw status set to externalized and a reference pointing back
    at the record's own journal entry, and SHALL NOT carry the record's
    full raw sub-object.
12. The storage contract SHALL mark, in state local to the storage
    contract, whether each record has already been mirrored, so that a
    later catch-up can determine which records are still pending.
13. A catch-up, run either at the next write opportunity or on an explicit
    command, SHALL create exactly the mirrored drawers still pending for
    records already in the journal, creating none already mirrored and
    leaving none pending unmirrored that the daemon can now reach.
14. A failure to mirror a record, for any reason including the shared
    MemPalace daemon becoming unreachable during the attempt, SHALL NOT
    alter, remove, or roll back that record's own journal entry.
15. The storage contract SHALL provide retrieval of records by session
    identifier, by agent identifier together with that agent's parent
    session, by period, by task-handoff key, and by external asset
    reference.
16. A retrieval SHALL accept an optional fidelity filter that narrows the
    returned records to one declared fidelity.
17. Every record a retrieval returns SHALL carry the schema version that
    record was written under.
18. No journal entry or mirrored drawer SHALL ever be removed by an
    automatic expiry; removal SHALL occur only through an explicit prune
    naming the period to remove.
19. An explicit prune of a period SHALL remove both the journal entries for
    that period and their mirrored drawers together, leaving neither
    behind on its own.
20. Once a period has been pruned, that period SHALL be recorded as
    pruned, so that a later backfill over the same source history does not
    silently repopulate it without an explicit instruction to do so.
21. The organization-facing documentation for this storage contract SHALL
    carry a personal-data note stating the nature of the data the journal
    and its mirror hold, who can read that data, and how an organization
    purges it.
22. A continuous-integration suite SHALL verify, with no shared MemPalace
    daemon present, that a batch of schema-valid records written through
    the storage contract yields a journal whose every entry validates
    against the usage-record schema; that rewriting the same batch adds no
    entry; that a correction adds an entry and mutates none; and that
    reads by session, by agent, by period, and by task-handoff key each
    return exactly the records expected for that read.
23. A continuous-integration suite SHALL verify, against a fake shared
    MemPalace daemon conforming to the readiness and teardown precedent
    already established for this repository's daemon test fixtures, that
    N records written while the daemon is unreachable are all journaled,
    that the daemon subsequently becoming reachable produces a catch-up
    creating exactly N mirrored drawers, and that each of those drawers
    carries an externalized raw status with a reference back to its own
    journal entry.
24. The storage contract SHALL report, for every record it is handed, a
    write outcome that is exactly one of: stored, duplicate, or
    rejected-with-reason.
25. The storage contract SHALL NOT persist any conversation text; it
    SHALL write only the fields the capture step hands it, unaltered, and
    since the capture step already excludes conversation text, no
    conversation text SHALL ever reach the journal or the mirror through
    this contract.

## Scenarios

**Scenario:** Happy path write persists a valid record

```text
Given a schema-valid captured usage record handed to the storage contract
When  the record is written
Then  a journal entry for that record appears, and the entry validates
      against the usage-record schema
```

**Scenario:** Duplicate recordId is a no-op

```text
Given a record already written to the journal under its own recordId
When  the storage contract receives a record carrying that same recordId
      a second time
Then  no new journal entry is added, and the existing entry is unchanged
```

**Scenario:** A correction adds a new entry without touching the original

```text
Given a record already written to the journal
When  a correction record carrying the corrects field pointing at that
      record is written
Then  a new journal entry appears for the correction, and the original
      entry remains exactly as it was written
```

**Scenario:** An invalid record is rejected

```text
Given a candidate record that fails validation against the usage-record
      schema
When  the candidate is handed to the storage contract
Then  the storage contract rejects it with a reason, and no journal entry
      or mirrored drawer is created for it
```

**Scenario:** The shared MemPalace daemon is unreachable

```text
Given the shared MemPalace daemon is unreachable when a record is written
When  the storage contract writes that record
Then  the journal entry is written, the record is marked pending for the
      mirror, and the write returns to the capture step without waiting
      for the daemon or reporting the daemon's absence as a failure
```

**Scenario:** The shared MemPalace daemon returns and catch-up runs

```text
Given N records were written to the journal while the shared MemPalace
      daemon was unreachable, and none of them were mirrored
When  the shared MemPalace daemon becomes reachable and a catch-up runs
Then  exactly N mirrored drawers are created, each carrying the record's
      normalized fields, an externalized raw status, and a reference back
      to its own journal entry
```

**Scenario:** Records are read by period and by session

```text
Given a journal holding records from more than one session and spanning
      more than one period
When  a read is requested for one period and, separately, for one
      session
Then  the period read returns exactly the records written in that
      period, and the session read returns exactly the records carrying
      that session identifier
```

**Scenario:** Pruning a period removes the journal entries and the mirror together

```text
Given a period holding journal entries, some of which already have a
      mirrored drawer
When  an explicit prune is requested for that period
Then  the journal entries for that period and their mirrored drawers are
      both removed, and the period is recorded as pruned
```

**Scenario:** An organization without MemPalace operates on the journal alone

```text
Given an organization that never runs the shared MemPalace daemon
When  records are written, read, and pruned over time
Then  every one of those operations succeeds using only the journal, and
      no operation depends on a mirror ever having existed
```

## Out of scope

- Capture and its per-CLI triggers, addressed by the capture-adapters
  specification for seam (b), issue #1169.
- Attribution semantics and rollups across records — seam (d), issue
  #1171.
- Pricing computation and any monetary value — seam (e), issue #1172.
- The dashboard and tracked-asset navigation surface — seam (f), issue
  #1173.
- The transcripts wing and the transcript hook that writes to it; this
  contract's mirror lives in a dedicated room of the project's own memory
  space, never in that wing.
- MemPalace's own retention policy, and any change to MemPalace itself.
- Encryption at rest for the journal or the mirror; this specification
  relies on the operating system's own user-directory permissions for
  protection and introduces no cryptographic mechanism of its own.

## Open questions

(none)

## Storage layout (informative)

This section is informative and non-normative — a starting point for the
implementation, not a constraint any requirement above depends on.

Journal path pattern, one file per source CLI and calendar month, one
record per line, append-only:

```text
<user-space directory>/usage/<cli>/<YYYY-MM>.journal
```

Local state tracking what the mirror still owes and what has already been
pruned:

```text
<user-space directory>/usage/.state/mirror-pending.json   # recordIds awaiting a mirrored drawer
<user-space directory>/usage/.state/pruned-periods.json   # {cli, period} pairs already pruned
```

Mirrored drawer content shape — the record's normalized fields, its raw
sub-object replaced by a pointer back at the journal:

```json
{
  "schemaVersion": "...",
  "kind": "captured",
  "recordId": "...",
  "fidelity": "...",
  "provenance": { "...": "..." },
  "identity": { "...": "..." },
  "timing": { "...": "..." },
  "modelId": "...",
  "interaction": "...",
  "tokens": { "...": "..." },
  "attribution": { "...": "..." },
  "rawStatus": "externalized",
  "rawRef": "<cli>/<period>#<recordId>"
}
```
