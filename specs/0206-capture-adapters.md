---
id: "0206"
slug: capture-adapters
status: draft
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 1169
version: 1.0.0
---

# Capture adapters — own-record capture of token usage per CLI, with declared fidelity

## Intent

This specification realizes the capture strategy chosen for the token-consumption
epic: a per-CLI capture step that reads each CLI's own durable session record and
produces usage records conforming to the CLI-agnostic contract, at points already
registered in each CLI's own lifecycle. A person inspecting a session afterward
finds one usage record for every request Claude Code, Gemini CLI, and Copilot CLI
served, each record deduplicated and attributed to its session and, when the
request came from a subordinate agent, to that agent; Antigravity CLI, whose own
session record exposes no field a token count can be tied to with confidence,
instead yields a coarser record from a live channel it already exposes, honestly
labeled and paired with a documented gap. Every framework-launched, non-interactive
run of any of the four CLIs additionally yields one record summarizing that run's
consumption. A capture step unable to recognize the shape of what it read leaves a
record of that failure rather than a silent zero, and the whole capture step can
run once more against records already present on a machine without duplicating
what an earlier run already produced.

## Requirements

1. Every record this specification's capture step emits SHALL declare the fidelity
   matching the channel it came from: `per-request` for a record derived from a
   CLI's own request-level record, `run-total` for a record derived from a
   non-interactive run's own structured summary, and `session-cumulative` for a
   record derived from Antigravity CLI's live status channel.
2. The capture step for Claude Code SHALL derive one record for each completed
   model response its session's own record or a subordinate agent's own record
   carries, taking the parent-session and agent linkage that record already
   assigns; a response with no subordinate-agent linkage SHALL yield a record
   whose agent identifier is null, never omitted. The record's idempotency key
   SHALL be that response's own request identifier when present, and SHALL fall
   back to that same response's own unique entry identifier when the request
   identifier is absent; both identifiers SHALL be treated as equally
   authoritative for deduplication.
3. The capture step for Gemini CLI SHALL derive one record for each completed
   model response its session's own record carries, reading that record — not
   the several per-prompt notifications the model-response event emits, which
   carry only a partial usage-metadata object and only the requested, not the
   serving, model — and treating those notifications solely as the trigger to
   read what the record has gained since the last capture. The record's
   idempotency key SHALL be that response's own message identifier in the
   session record.
4. The capture step for Copilot CLI SHALL derive one record for each row its own
   call-record store commits for a completed model call, including a row a
   subordinate-agent call generates. The record's idempotency key SHALL be that
   row's own identifier.
5. The capture step for Antigravity CLI SHALL derive its records from a live
   status channel the CLI already exposes for a user-configured display, never
   from that CLI's own session record, since no field of that record could be
   tied to a token count with confidence. The record's idempotency key SHALL be a
   fixed derivation from the session identifier and the status channel's own
   snapshot instant, since that channel carries no per-request identifier of its
   own.
6. When Claude Code's session record carries several completed-response entries
   sharing one request identifier, the capture step SHALL recognize them as one
   unit and SHALL derive exactly one record for that identifier, never one
   record per entry.
7. The capture step for Gemini CLI SHALL derive the record's net-input token
   class as the response's own combined input count minus that same response's
   own reported cached-token count, both read from the session record, never
   the combined count copied unreduced.
8. Every captured record SHALL populate its five token-count classes from the
   source's own reported counts for the matching class, recording a class the
   source genuinely did not report as zero, and SHALL carry the source's
   original fields unaltered in the record's raw sub-object, conforming to
   requirements 2 through 5 of the usage record contract.
9. The capture step for Claude Code SHALL preserve any distinct cache-write tier
   the session's own record reports as a structured sub-value in the record's
   cache-write class, never collapsed into one summed figure.
10. Each adapter SHALL derive the record's interaction class from a signal its
    own source already carries — the newest input's own shape and the source's
    own stop reason for Claude Code, the row's own initiator value for Copilot
    CLI, the response's own tool-call presence in the session record for Gemini CLI — and
    SHALL record `unknown` whenever that source exposes no such signal, never a
    class inferred from token counts or timing.
11. A record the capture step derives from Antigravity CLI's status channel
    SHALL always carry the interaction class `unknown`, since that channel
    exposes no signal distinguishing what a request served.
12. Every record the capture step derives from a subordinate-agent call, on any
    CLI whose own record exposes one, SHALL carry that call's own parent-session
    identifier and agent identifier, drawn from whichever field the source's own
    record already assigns to that call, never inferred from timing or file
    adjacency alone.
13. The capture step for Claude Code and for Copilot CLI SHALL run at the event
    already registered for end-of-turn and end-of-session processing on that
    CLI, added as an additional command bound to those same events; this
    specification's implementation SHALL NOT register a new event for either
    CLI.
14. The capture step for Gemini CLI SHALL run at the event already registered
    for model-response processing, performing no derivation on a firing that
    finds nothing new in the session record; one additional end-of-turn event
    MAY be registered to run the same capture step only after a measurement of
    the model-response event's own cost finds it insufficient, and this
    specification's implementation SHALL leave that additional event
    unregistered absent such a measurement. The event already registered for
    end-of-session processing SHALL NOT be relied upon as the sole trigger,
    since the CLI does not await it.
15. The capture step SHALL exist as a script independent from the framework's
    own transcript-persistence script, never as a branch added inside it, so a
    change to either script cannot alter the other's failure behavior; the
    capture step's own exit code SHALL never block or fail the triggering CLI's
    own turn, regardless of whether that attempt succeeded.
16. A capture failure SHALL never adopt the transcript-persistence script's own
    distinct exit convention for an unreachable persistence backend; the capture
    step's own failure SHALL instead surface as an uncaptured record carrying
    that failure's own provenance, handed to the storage contract like any other
    record.
17. Each adapter SHALL assert its own source's expected field shape before
    deriving any record from it, and a source whose shape does not match that
    assertion SHALL yield one uncaptured record naming the mismatch in its own
    provenance, never a captured record with an invented or zero-valued token
    class.
18. An adapter reading a source that carries full conversational content
    alongside the fields a usage record needs SHALL read only the fields a usage
    record needs, and SHALL never copy, forward, or otherwise persist any
    prompt or response text found in that source.
19. Every framework-launched, non-interactive run of any of the four CLIs SHALL
    yield one record at `run-total` fidelity, drawn from the structured summary
    that run's own non-interactive output already carries, in addition to any
    per-request record the same run's own session record separately yields.
20. The Antigravity CLI capture channel's own setup SHALL refuse to replace a
    display-command value the user already configured for that channel and the
    framework did not itself install, leaving that value untouched and
    recording the parity gap for that installation instead of installing a
    shim over it.
21. Removing the Antigravity CLI capture channel's own shim SHALL restore
    exactly the display-command value that existed immediately before that
    shim's own installation, never leaving the shim's own value in place.
22. This specification SHALL declare, alongside its Antigravity CLI
    requirements, that per-request and per-subordinate-agent granularity is not
    achieved for that CLI, and SHALL name the evidence for that gap: no field of
    that CLI's own session record could be tied to a token count with
    confidence, and no vendor-documented alternative channel exposes that
    granularity today.
23. This specification's implementation SHALL provide one backfill command
    that replays the capture step for Claude Code, Gemini CLI, and Copilot CLI
    against records already present on a machine, taking the same per-CLI
    derivation these requirements define for the live trigger path, and SHALL
    track, per source, the point up to which it has already derived records so
    a re-run performs no re-derivation of a previously processed unit. The
    backfill command SHALL NOT cover Antigravity CLI, since that CLI's capture
    channel exposes no durable history to replay.
24. The backfill command SHALL operate independently of the four existing
    history-import scripts the framework already ships for its own
    conversational-memory wing, touching none of their sources, targets, or
    state, since those scripts serve a distinct purpose from this
    specification's own usage-record contract.
25. The capture step, for every record it derives or fails to derive, SHALL
    hand that record to the storage contract a sibling specification defines,
    and this specification SHALL implement no storage backend, write format, or
    retention policy of its own.
26. The capture step for Claude Code and for Copilot CLI SHALL complete within
    the same triggering event's own execution, without deferring its work to a
    coarser event for latency reasons, at the source sizes this specification's
    own measurement found complete in under one second.
27. The repository SHALL hold, for each CLI and for each format generation
    that CLI's own source has exhibited, at least one anonymized fixture
    exercising that generation's real shape with synthetic values, and a
    continuous-integration check SHALL derive records from every such fixture,
    validate each derived record against the usage-record schema, and assert
    that the count of records a fixture yields matches that fixture's own
    expected count.
28. The same continuous-integration check SHALL also derive a record from at
    least one fixture whose shape does not match any adapter's own fingerprint,
    and SHALL fail if that fixture does not yield an uncaptured record.
29. The implementation realizing this specification SHALL record, once, on the
    ticket's own logbook, a backfill run over real local history for Claude
    Code, Gemini CLI, and Copilot CLI whose derived record count for each CLI
    equals that CLI's own distinct-request count, and a second run of that same
    backfill adding zero records.
30. Every adapter SHALL record the model identifier exactly as its own source
    reports it, including a placeholder value standing for an unresolved
    automatic selection, conforming to requirement 8 of the usage record
    contract; no adapter SHALL translate, resolve, or reconcile that value
    against any other source's own reported identifier for the same request.

## Scenarios

**Scenario:** Claude Code happy path — per-request capture

```text
Given a Claude Code session record whose completed responses each carry a
      request identifier, a model identifier, and a token-usage object
When  the capture step runs at the session's end-of-turn event
Then  the capture step derives one captured record per response, each
      carrying its own model identifier, five token classes populated from
      that response's own usage object, per-request fidelity, and the
      response's own raw fields preserved unaltered
```

**Scenario:** Gemini CLI happy path — session-record capture at the model-response event

```text
Given a Gemini CLI prompt whose model-response event fires five times while
      the response streams, and whose session record gains one completed
      response entry carrying the serving model and the six token counts
When  the capture step runs at each firing of that event
Then  the firings that find no new completed entry derive nothing, the
      firing that finds the completed entry derives exactly one captured
      record from the session record, and that record carries per-request
      fidelity and the serving model exactly as the record reports it
```

**Scenario:** Copilot CLI happy path — call-record row capture

```text
Given a Copilot CLI session whose call-record store commits one row per
      completed model call, each row carrying its own identifier, model,
      five token counts, and an initiator value
When  the capture step runs at the session's end-of-turn event
Then  the capture step derives one captured record per row, each carrying
      that row's own identifier as its idempotency key and per-request
      fidelity
```

**Scenario:** Antigravity CLI happy path — status-channel capture

```text
Given an Antigravity CLI session whose own session record exposes no
      attributable token field, and whose status channel reports a
      cumulative usage snapshot alongside a display-label model identifier
When  the capture step reads that status channel
Then  the capture step derives one captured record carrying
      session-cumulative fidelity, an interaction class of unknown, and
      the display-label model identifier recorded verbatim
```

**Scenario:** Streaming duplicates deduplicated

```text
Given a Claude Code session record whose completed-response entries
      include several entries sharing one request identifier, each
      carrying identical usage
When  the capture step runs
Then  the capture step recognizes the shared identifier and derives
      exactly one captured record for it, never one record per entry
```

**Scenario:** Claude Code identity fallback when the request identifier is absent

```text
Given a Claude Code completed-response entry whose own request identifier
      is absent, but whose own unique entry identifier is present
When  the capture step derives a record for that entry
Then  the capture step uses the entry's own unique identifier as the
      record's idempotency key, and the record is derived exactly as it
      would be had the request identifier been present
```

**Scenario:** Gemini net input derivation

```text
Given a Gemini CLI session-record entry reporting one combined input count
      that includes a separately reported cached-token count
When  the capture step derives the record's token classes
Then  the record's net-input class equals the combined count reduced by
      the cached count, and the record's raw sub-object still carries the
      entry's original combined figure unaltered
```

**Scenario:** Subagent attribution

```text
Given a Copilot CLI call-record row generated for a subordinate-agent
      call, carrying that call's own parent session identifier and agent
      identifier
When  the capture step derives a record for that row
Then  the record's identity block carries the same parent session
      identifier and agent identifier the row itself assigns, unchanged
```

**Scenario:** Unknown fingerprint yields an uncaptured record

```text
Given a session record whose field shape does not match any adapter's own
      expected shape for that CLI
When  the capture step attempts to derive a record from it
Then  the capture step emits one uncaptured record naming the mismatch in
      its own provenance, and no captured record with an invented or
      zero-valued token class is emitted for that source
```

**Scenario:** Statusline shim declines to overwrite a populated command

```text
Given an Antigravity CLI installation whose display-command setting
      already carries a value the framework did not itself install
When  the capture channel's own setup runs
Then  the setup leaves that value untouched, installs no shim, and records
      the parity gap for that installation instead
```

**Scenario:** Statusline shim restores the original command on removal

```text
Given an Antigravity CLI installation whose display-command setting was
      empty before the shim's own installation
When  the shim is later removed
Then  the display-command setting returns to empty, never left carrying
      the shim's own value
```

**Scenario:** Hook failure does not break transcript persistence

```text
Given the capture step fails to reach the storage contract for a
      completed response
When  the same triggering event also runs the framework's own
      transcript-persistence script
Then  the transcript-persistence script's own outcome is unaffected by the
      capture step's failure, and the capture step's own failure surfaces
      as its own uncaptured record rather than a non-zero exit adopted
      from the transcript-persistence script's own convention
```

**Scenario:** Headless envelope capture

```text
Given the framework launches a CLI non-interactively and requests
      structured output
When  that run completes
Then  the capture step derives one record at run-total fidelity from the
      run's own structured summary, independent of any per-request record
      the same run's own session record separately yields
```

**Scenario:** Backfill idempotence

```text
Given a machine whose Claude Code, Gemini CLI, and Copilot CLI history
      already produced one set of records through one backfill run
When  the same backfill command runs again over the same history
Then  the second run adds no record beyond what the first run already
      produced
```

## Out of scope

- Native OpenTelemetry export as an oracle or enrichment layer for any CLI —
  deferred to a later ticket; the settled probe findings on Claude Code's
  cache-split field and on Gemini CLI's telemetry-outfile serialization are
  recorded here as informative background for that later ticket, never
  realized as a requirement of this specification.
- Macro-task declaration and attribution — seam (d), issue #1171; a record
  this specification's capture step emits carries no attribution block.
- Storage backends, write formats, and retention policy — seam (c), issue
  #1170; this specification names only the interface the capture step hands
  records to (requirement 25).
- Pricing computation and model-identifier-to-vendor-neutral mapping — seam
  (e), issue #1172.
- The dashboard and tracked-asset navigation surface — seam (f), issue #1173.
- Any change to the behavior, output format, or configuration surface of the
  four CLIs themselves, beyond the Antigravity CLI display-command
  installation this specification's own requirements describe.
- API interception of any CLI's model traffic — not shipped; at most a
  documented optional adapter for an adopter already running its own
  gateway, outside this specification.
- Modifying, replacing, or extending the four existing history-import
  scripts the framework already ships for its own conversational-memory
  wing — those feed a different wing for a different purpose (retrieval
  over conversational content) than the backfill command this specification
  defines (usage-record production); the two remain independent (also
  stated as requirement 24).
- Backfilling history for Antigravity CLI — its capture channel exposes no
  durable history to replay (requirement 23).
- The interactive confirmation of Copilot CLI's `/model` backing identifier
  string — left to the follow-up named in Open questions; this
  specification's own capture requirements already source the model
  identifier from the call-record store's own column, independent of that
  confirmation's outcome.

## Open questions

- Copilot CLI's `/model` backing identifier stayed UNVERIFIED
  in non-interactive mode (probe 10): the only confirmed non-interactive
  sources are the call-record store's own model column — already this
  specification's source for requirement 4 — and two after-the-fact
  lifecycle events, neither a standalone query. Follow-up: the owner
  launches Copilot CLI interactively and issues `/model` to confirm whether
  its displayed identifier matches the call-record store's own column
  value, closing this question for the pricing seam (issue #1172); this
  specification's own requirements do not depend on the outcome.

## Adapter matrix (informative)

| | Claude Code | Gemini CLI | Copilot CLI | Antigravity CLI |
|---|---|---|---|---|
| Record source | `~/.claude/projects/<project>/<session>.jsonl` and `<session>/subagents/agent-<id>.jsonl` | `~/.gemini/tmp/<project-hash>/chats/session-*.jsonl` (the `transcript_path` every hook payload carries; legacy `.json` generations included) and `chats/<parentSessionId>/<sub>.jsonl` for subagents; the `AfterModel` payload is the trigger only (partial usage metadata, requested model) | sqlite `~/.copilot/session-store.db`, table `assistant_usage_events` (read-only WAL) | The live statusline payload (print-mode confirmed to fire); the CLI's own conversation store is opaque protobuf and is not read |
| Trigger | `Stop` / `SessionEnd` (already registered), additional command on the same events | `AfterModel` (already registered) as primary; `AfterAgent` only if a future cost measurement requires it | `agentStop` / `sessionEnd` (already registered), additional command on the same events | The shimmed display-command invocation (no CLI-side hook event exists for this channel) |
| Idempotency key | `requestId`; falls back to the entry's own `uuid` for the ~21.6% of interactive `entrypoint: "cli"` records observed missing it | The response entry's own message `id` in the session record | `assistant_usage_events.id` | `sha256(sessionId + snapshot instant)` — derived, no natural key |
| Token mapping | `input_tokens`→netInput, `cache_read_input_tokens`→cacheRead, `cache_creation_input_tokens` (5m/1h tiers preserved)→cacheWrite, `output_tokens`→output, `output_tokens_details.thinking_tokens`→reasoning | combined input count − `cached`→netInput, `cached`→cacheRead, no cache-write class reported (recorded as zero)→cacheWrite, `output`→output, `thoughts`→reasoning | `input_tokens`→netInput, `cache_read_tokens`→cacheRead, `cache_write_tokens`→cacheWrite, `output_tokens`→output, `reasoning_tokens`→reasoning; the row's own `model` column is authoritative even across a mid-session model change | The payload's own cumulative counters map to the five classes at session-cumulative granularity; any cache split the payload separately reports is preserved as tiers |
| Interaction signals | Newest input's shape + the response's own stop reason | The response entry's own `toolCalls` presence in the session record | The row's own `initiator` value (`user` / `agent` / `sub-agent` / `compaction`) | None exposed; always `unknown` |
| Fidelity | `per-request` | `per-request` | `per-request` | `session-cumulative` |
| Fingerprint | Presence and shape of the record's own `usage` key set | The session record's own `kind` on its first entry and the `tokens` key set on response entries (three format generations exist; each needs its own fixture) | Presence and shape of the call-record store's own schema version and column set | Presence of the payload's own cumulative-usage key set; the payload's `model.id` is a display label, never reconciled against the distinct API identifier a separate command surface reports |

Two channels apply across all four CLIs rather than to one row of the table
above. The headless envelope capture reads the structured summary a
framework-launched, non-interactive run of any of the four CLIs already
returns (for example `--output-format json` on three of the CLIs, or an
equivalent usage-summary output on the fourth), yielding one `run-total`
record per run in addition to whatever per-request records that same run's
own session record separately yields. The backfill command replays the same
per-CLI derivation above against Claude Code, Gemini CLI, and Copilot CLI
history already present on a machine, tracking a high-water mark per source
so a re-run adds nothing already produced; it does not cover Antigravity
CLI, whose channel carries no durable history to replay.
