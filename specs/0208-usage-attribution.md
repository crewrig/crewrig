---
id: "0208"
slug: usage-attribution
status: draft
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 1171
version: 1.0.0
---

# Usage attribution — declaration channels, an attribution ledger, and per-fidelity rollups

## Intent

This specification attributes a usage record to the macro-task it served —
either a CrewRig multi-CLI ticket, named by its own task-handoff key, or an
external work-tracking asset such as a forge issue, a Jira ticket, or a
shared file — so that a person or a downstream tool asking "what was this
session, this agent, or this whole reporting period doing" gets an answer
that holds regardless of which of the four CLIs produced the record or which
session carried it, can correct a wrong or a missing answer after the fact
without touching the record that answer describes, and can read a rollup for
a task or an asset that never collapses a coarse cumulative snapshot into the
same sum as a set of fine-grained per-request counts, nor silently drops the
records a source could never read at all.

## Requirements

1. Every usage record's attribution SHALL resolve, offline and within the
   capture step's own non-blocking contract, from exactly one of four
   ordered declaration channels, evaluated in this order: an explicit
   declaration made in the current session; the `CREWRIG_TASK` environment
   variable; the current working directory's own worktree path or checked-out
   branch name, when either matches the framework's own ticket-worktree or
   ticket-branch naming convention; a local file the framework's own
   session-start protocol maintains, naming the session's established
   task-handoff key. A record for which none of the four channels yields a
   candidate value SHALL carry no attribution, recorded as unattributed.
2. Resolution SHALL evaluate the four channels in the fixed order of
   requirement 1 and SHALL stop at the first channel that is present — one
   that supplies a candidate value at all, whether or not that value
   ultimately validates. A channel ranked lower than the first present
   channel SHALL NOT be consulted, regardless of whether the first present
   channel's own candidate value passes or fails validation.
3. When the first present channel's candidate value passes its own kind's
   syntactic validation, that value SHALL become the record's attribution;
   when it fails, the record SHALL carry no attribution, recorded as
   unattributed together with the failing channel's name and the validation
   failure, and no repaired, normalized-beyond-pattern, or guessed
   replacement value SHALL be substituted for it.
4. The declaration channel that produced a record's attribution, or that
   produced its unattributed outcome together with a validation failure,
   SHALL be durably recorded for that record, inspectable without
   recomputation, without amending the usage-record schema (spec 0205) or
   its `attribution` block's fixed field set.
5. The worktree-or-branch channel, when it is the first present channel and
   its candidate value validates, SHALL populate a task-handoff key from the
   ticket identifier the matched worktree path or branch name carries, and,
   when the repository's own configured forge remote resolves to a
   recognized forge host (GitHub, GitLab, or Gitea), SHALL additionally
   populate a `forge-issue` external asset built from that same ticket
   identifier and the remote's own owner-and-repository pair, entirely
   offline. A repository carrying no forge remote, or a remote matching no
   recognized forge host, SHALL yield the task-handoff key alone from this
   channel.
6. A task-handoff key or an external asset reference that this
   specification's channels populate for the same macro task SHALL be
   textually identical wherever that macro task is being worked from, across
   every CLI and every session, so that the storage contract's own retrieval
   by task-handoff key and by external asset reference (spec 0207
   requirement 15) returns every record belonging to that macro task without
   any further reconciliation step at read time.
7. A declared or derived external asset reference SHALL match one of the
   syntactic forms spec 0205's own kind registry defines: a forge issue as
   an owner-and-repository pair followed by an issue number, a Jira key, or
   a shared file path or URL; a reference matching none of the registered
   kinds' forms SHALL be treated as a validation failure under requirement
   3, never accepted under an invented or unregistered kind.
8. Validating a declared or derived external asset reference, or a declared
   or derived task-handoff key, SHALL check only that value's own syntactic
   shape and SHALL perform no network call, forge query, or other online
   check to confirm the referenced asset or task exists; resolving an
   asset's title, state, or other live metadata is out of scope of this
   specification's validation.
9. This specification SHALL introduce no new `attribution.externalAsset.kind`
   value beyond the registry spec 0205 already defines; a future kind
   remains an additive registry change under that specification, not this
   one.
10. The implementation realizing this specification SHALL provide an
    append-only attribution ledger, held beside the journal under the same
    root override the storage contract already reads (spec 0207's
    `CREWRIG_USAGE_ROOT`), distinct from the journal and from the usage-record
    schema.
11. Every ledger entry SHALL map exactly one of a session identifier, an
    agent identifier together with that agent's parent session, or a
    period, to a task-handoff key, an external asset reference, or both, and
    SHALL carry the entry's own timestamp, its author, and a stated reason.
12. A read that returns records or a rollup for a session, an agent, or a
    period carrying a matching ledger entry SHALL apply that ledger entry's
    task-handoff key or external asset reference in place of whatever
    attribution, if any, the underlying records themselves carry; a session,
    an agent, or a period carrying no matching ledger entry SHALL be read
    exactly as its underlying records' own attribution states, unattributed
    included.
13. Writing a ledger entry SHALL NOT mutate, correct, or otherwise alter any
    usage record; the `corrects` field spec 0205 defines on a usage record
    SHALL remain reserved for a measurement correction and SHALL NOT be used
    to express a retroactive attribution change.
14. An explicit prune of a period, as the storage contract's own prune
    command already performs (spec 0207 requirements 18 through 20), SHALL
    remove both the journal entries for that period and the attribution
    ledger's own entries recorded within that same period, together, leaving
    neither behind on its own.
15. The implementation realizing this specification SHALL provide one
    command that appends a new attribution-ledger entry and one command that
    lists the ledger's existing entries, filterable at least by the session,
    the agent and parent session, or the period an entry names.
16. This specification SHALL introduce no audit log, history table, or
    diagnostic trail for a retroactive attribution decision beyond the
    ledger's own append-only, timestamped, authored sequence of entries; the
    ledger itself SHALL constitute the complete audit trail for every such
    decision.
17. A rollup for a task-handoff key or for an external asset reference SHALL
    report its measurements grouped by fidelity, always: the sum of every
    `per-request` record's token counts, the sum of every `run-total`
    record's token counts, and, for `session-cumulative` records, the sum
    across sessions of each session's own last snapshot — never a sum across
    more than one snapshot from the same session.
18. A rollup MAY additionally report one combined total across more than one
    fidelity only when that total carries an explicit marker naming every
    fidelity it combines; a rollup reporting its per-fidelity sums alone
    SHALL carry no such marker, and no combined total SHALL be presented
    without one.
19. A rollup SHALL NOT derive a per-request-equivalent or any other delta
    value from two or more `session-cumulative` snapshots of the same
    session; each session's own last snapshot SHALL stand as that session's
    entire contribution to the rollup.
20. A rollup for a task-handoff key or an external asset reference SHALL
    combine every record attributed to that key or reference regardless of
    which of the four CLIs, which session, or which top-level or subordinate
    agent produced it.
21. A rollup SHALL report, separately from every token-count sum, the count
    of `uncaptured` records attributed to the task or the asset; that count
    SHALL NOT be folded into, or represented as a placeholder value within,
    any token-count sum. A task or an asset carrying zero `uncaptured`
    records SHALL report that count as zero, never omit it.
22. A continuous-integration suite SHALL verify, over a fixture exercising
    every declaration channel, that each channel wins its record's
    attribution when every higher-precedence channel is absent, and that a
    malformed candidate value at the first present channel yields an
    unattributed outcome naming that channel and the failure, with no
    lower-precedence channel consulted.
23. A continuous-integration suite SHALL verify, over a fixture holding both
    a capture-time attribution and a ledger entry for the same session, that
    a read applies the ledger entry's attribution in place of the
    capture-time one, and that the underlying record itself is unchanged by
    that read.
24. A continuous-integration suite SHALL verify, over a fixture mixing
    `per-request`, `run-total`, and `session-cumulative` records — including
    more than one `session-cumulative` snapshot for one session and at least
    one `uncaptured` record — attributed to one task-handoff key, that the
    rollup's per-fidelity sums, its `session-cumulative` last-snapshot
    handling, its marked combined total when requested, and its separate
    `uncaptured` count all match the fixture's own expected values.
25. A continuous-integration suite SHALL verify that the attribution ledger
    and the rollup commands operate under a root directory relocated through
    the same override the storage contract already reads (spec 0207's
    `CREWRIG_USAGE_ROOT`), producing no ledger entry or rollup result outside
    that relocated root.
26. The organization-facing documentation for this specification SHALL name
    what a task-handoff key or an external asset reference reveals when read
    beside the identifiers a usage record and a ledger entry already carry,
    and SHALL extend spec 0207's own purge instructions to name how the
    attribution ledger, and the per-record channel diagnostic requirement 4
    introduces, are purged alongside the journal and its mirror.

## Scenarios

**Scenario:** Explicit declaration outranks every other channel

```text
Given a session carrying an explicit in-session declaration of a
      task-handoff key, alongside a CREWRIG_TASK environment variable naming
      a different key
When  a usage record's attribution resolves for that session
Then  the record's attribution carries the explicitly declared key, and the
      recorded channel names the explicit declaration, never the
      environment variable
```

**Scenario:** CREWRIG_TASK wins when no explicit declaration was made

```text
Given a session carrying no explicit declaration, a CREWRIG_TASK
      environment variable naming a task-handoff key, and a working
      directory whose branch name also matches the ticket-branch naming
      convention
When  a usage record's attribution resolves for that session
Then  the record's attribution carries the CREWRIG_TASK key, and the
      recorded channel names the environment variable, never the branch
```

**Scenario:** Worktree-or-branch channel derives a task key and a forge issue together

```text
Given a session with no explicit declaration and no CREWRIG_TASK variable,
      whose working directory is checked out on a branch matching the
      ticket-branch naming convention, in a repository whose configured
      forge remote resolves to a recognized forge host
When  a usage record's attribution resolves for that session
Then  the record's attribution carries the branch-derived task-handoff key
      and a forge-issue external asset built from that same ticket
      identifier and the remote's own owner-and-repository pair, resolved
      entirely offline
```

**Scenario:** Local task-handoff file wins when the three higher channels are absent

```text
Given a session with no explicit declaration, no CREWRIG_TASK variable, and
      a working directory matching no ticket-worktree or ticket-branch
      naming convention, whose session-start protocol has nonetheless
      written a local file naming an established task-handoff key
When  a usage record's attribution resolves for that session
Then  the record's attribution carries the key named in that local file,
      and the recorded channel names the local file
```

**Scenario:** No channel resolves and the record is unattributed

```text
Given a session with no explicit declaration, no CREWRIG_TASK variable, a
      working directory matching no ticket-worktree or ticket-branch naming
      convention, and no local task-handoff file
When  a usage record's attribution resolves for that session
Then  the record carries no attribution, and the outcome is recorded as
      unattributed with no channel named
```

**Scenario:** A malformed declared value falls to unattributed without a fallback

```text
Given a session carrying an explicit in-session declaration whose value
      matches none of spec 0205's registered external-asset syntactic
      forms, alongside a CREWRIG_TASK environment variable naming a
      syntactically valid task-handoff key
When  a usage record's attribution resolves for that session
Then  the record carries no attribution, the outcome is recorded as
      unattributed naming the explicit-declaration channel and the
      validation failure, and the CREWRIG_TASK variable is never consulted
```

**Scenario:** A ledger entry overrides capture-time attribution at read time

```text
Given a usage record already written with a capture-time task-handoff key,
      and a later attribution-ledger entry mapping that record's session to
      a different task-handoff key, timestamped after the record's own
      capture instant
When  the record is read
Then  the read reports the ledger entry's task-handoff key in place of the
      record's own capture-time key, and the underlying journal entry
      remains exactly as it was written
```

**Scenario:** Pruning a period removes its ledger entries together with its journal entries

```text
Given a period holding both journal entries and attribution-ledger entries
      recorded within that period
When  an explicit prune is requested for that period
Then  the journal entries and the ledger entries recorded in that period are
      both removed, and neither is left behind on its own
```

**Scenario:** A mixed-fidelity rollup carries an explicit marker on its combined total

```text
Given one task-handoff key attributed to `per-request` records from one CLI
      and `session-cumulative` records from another
When  a rollup for that task-handoff key is read with a combined total
      requested
Then  the rollup reports the `per-request` sum and the `session-cumulative`
      sum separately, and its combined total carries a marker naming both
      fidelities it combines
```

**Scenario:** Multiple session-cumulative snapshots of one session are never summed

```text
Given one session that produced three `session-cumulative` snapshots at
      increasing cumulative token counts, all attributed to one
      task-handoff key
When  a rollup for that task-handoff key is read
Then  the rollup's `session-cumulative` contribution equals the session's
      last snapshot alone, and no delta or per-request-equivalent value is
      derived from the earlier snapshots
```

**Scenario:** Uncaptured records are counted separately from token sums

```text
Given a task-handoff key attributed to two `captured` records and one
      `uncaptured` record
When  a rollup for that task-handoff key is read
Then  the rollup's token-count sums reflect only the two captured records,
      and the rollup separately reports a count of one `uncaptured` record
```

## Out of scope

- Pricing computation and any monetary value attached to an attributed
  record — seam (e), issue #1172.
- The dashboard and tracked-asset navigation surface, and any online
  resolution of an external asset's title, state, or other live metadata —
  seam (f), issue #1173.
- Any change to MemPalace itself, its retention policy, or its own
  wing-and-drawer conventions.
- Cross-machine aggregation of a rollup — a rollup reads one journal and one
  attribution ledger under one storage root; combining rollups produced on
  separate machines is not addressed here.
- Capture and its per-CLI triggers, and the shape of a captured or
  uncaptured record itself — seam (b), issue #1169 (spec 0206); this
  specification adds no new capture trigger and defines no new field on the
  usage-record schema.
- Storage backends, write mechanics, and the retention and prune mechanics
  themselves — seam (c), issue #1170 (spec 0207); this specification reuses
  that contract's root override and prune semantics without redefining
  them.
- Any new `attribution.externalAsset.kind` value — the registry stays
  exactly the one spec 0205 already defines (requirement 9).
- Amending the usage-record schema itself. Spec 0205's schema
  (`schemas/usage-record/v1.schema.json`) closes its `attribution` block to
  exactly `taskHandoffKey` and `externalAsset`, and its own versioning rule
  reserves any new version for a new sibling schema file, never an in-place
  edit; the declaration channel a record's attribution resolved through is
  therefore recorded alongside the record (requirement 4), never inside it.

## Open questions

(none)

## Attribution outcomes and ledger entries (informative)

This section is informative and non-normative — illustrative shapes for the
implementation, not a constraint any requirement above depends on.

### Declaration channel labels

| Label | Channel | Resolves |
|---|---|---|
| `explicit` | Explicit in-session declaration | Task-handoff key and/or external asset, as declared |
| `env` | `CREWRIG_TASK` environment variable | Task-handoff key and/or external asset, as declared |
| `worktree` | Worktree path or branch name | Task-handoff key, plus a forge-issue external asset when a recognized forge remote resolves |
| `handoff-file` | Local task-handoff file | Task-handoff key only |
| `unattributed` | No channel resolved, or the first present channel's value failed validation | Neither |

### Ledger entry shape

```json
{
  "scope": { "session": "…" },
  "taskHandoffKey": "1171",
  "timestamp": "2026-09-22T10:00:00Z",
  "author": "hcross",
  "reason": "spec-authoring session for #1171 ran on a spec/0208 branch"
}
```

`scope` names exactly one of `session`, `{ "agent": "…", "parent": "…" }`, or
`period`. `externalAsset` MAY stand alongside or in place of
`taskHandoffKey`, in the same shape spec 0205 already defines for a usage
record's own `attribution.externalAsset`.

### Rollup output shape

```json
{
  "taskHandoffKey": "1171",
  "byFidelity": {
    "per-request": { "netInput": 12000, "cacheRead": 3000, "cacheWrite": 500, "output": 4000, "reasoning": 800 },
    "session-cumulative": { "netInput": 9000, "cacheRead": 0, "cacheWrite": 0, "output": 2500, "reasoning": 0 }
  },
  "combined": { "netInput": 21000, "cacheRead": 3000, "cacheWrite": 500, "output": 6500, "reasoning": 800, "mixed": ["per-request", "session-cumulative"] },
  "uncapturedCount": 1
}
```
