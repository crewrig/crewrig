# Usage storage

<!-- crewrig-doc: section=reference nav_order=130 published=true title="Usage storage" -->

The usage storage contract (spec 0207) provides an append-only local journal of usage records — the source of truth for consumption data — with optional mirroring into the shared MemPalace memory space when that daemon is reachable. A record written to the journal persists whether or not MemPalace is present; a record mirrored into MemPalace becomes queryable by session, agent, task, and external asset reference without altering the journal itself.

This page is one stage of the usage feature; the [usage architecture overview](usage-overview.md) shows how the stages fit together.

## On-disk layout

The journal partitions records by their source CLI and calendar month, storing one immutable file per record. This design differs from the spec's informative JSONL layout for two reasons:

1. The spec's `.state/` directory would collide with the directory spec 0206 (capture) already owns, so state tracking is placed elsewhere.
2. One-file-per-record with filesystem link primitives provides O(1) idempotency (spec R2) and prevents interleaving (R26) without an index or scan, whereas an appended JSONL file cannot.

```text
<root>/journal/<cli>/<YYYY-MM>/<recordId>.json        # one record per file
<root>/journal/<cli>/<YYYY-MM>/<recordId>.wing.json   # sidecar: the wing derivation
<root>/journal/<cli>/<YYYY-MM>/<recordId>.attr.json   # sidecar: the attribution channel and outcome (spec 0208)
<root>/declarations/session/<key>.json                # session-scoped declaration record (spec 0208)
<root>/declarations/project/<key>.json                # project-scoped declaration record (spec 0208)
<root>/ledger/<YYYY-MM>/<entryId>.json                # append-only attribution ledger entry (spec 0208)
<root>/prices/<cli>/<YYYY-MM>/<recordId>.price.json   # derived: computed price per record (spec 0209)
<root>/mirror/pending/<cli>/<YYYY-MM>/<recordId>       # marker: record awaiting mirroring
<root>/mirror/mirrored/<cli>/<YYYY-MM>/<recordId>      # marker: record already mirrored
<root>/mirror/unreachable.stamp                        # timestamp: daemon was unreachable
<root>/cache/wings/<key>.json                          # memo: resolved wing for a project root
<root>/pruned/<cli>/<YYYY-MM>.json                     # marker: period was pruned (R20)
<root>/locks/*.lock                                    # advisory locks for drain and mirror
<root>/tmp/.*                                          # temp files from write/mirror (swept)
<root>/spool/                                          # legacy: 0206's pre-hand-over buffer, drained if present
```

`<root>` defaults to `~/.crewrig/usage` and is overridable via `CREWRIG_USAGE_ROOT`.

### Record period derivation

The period `YYYY-MM` is always the UTC calendar month of `timing.requestInstant` (never `captureInstant`). This ensures a backfill run today over an August request lands in August—otherwise a prune of August would leave it behind (R19).

### Wing sidecar

Each journal entry is accompanied by a `.wing.json` sidecar carrying the MemPalace wing the record resolved to at write time, plus its derivation method and the project root. The sidecar is immutable after the entry is written and never re-derived by a later mirror path; if a sidecar is lost (killed between write and link), it is repaired by the next write of the same record ID using the seven-rule cascade described in *Wing resolution* below.

### Attribution sidecar

Each journal entry is accompanied by a `.attr.json` sidecar carrying the attribution channel that resolved the record's task and the outcome (attributed or unattributed, with failure reason if validation failed). The sidecar is immutable after the entry is written. Spec 0208 records the channel and outcome because the record schema closes on exactly two fields (`taskHandoffKey` and `externalAsset`) and forbids adding new fields; the sidecar provides a durable, inspectable audit trail of which channel resolved the attribution without mutating the record itself (spec 0208 R16 — writing a ledger entry never mutates a record).

## Write outcomes

The `write(record)` function returns exactly one of three outcomes (R24):

- **`stored`** — the record is new and was written to the journal. The mirror catch-up is then triggered.
- **`duplicate`** — the record's ID already exists in the journal. Nothing changes; no mirror hand-off occurs.
- **`rejected`** — the record failed schema validation or the period is marked as pruned (and `CREWRIG_USAGE_ALLOW_PRUNED` is not `1`). The record is not stored.

## Environment variables

All variables are optional and have safe defaults.

### Core storage

- **`CREWRIG_USAGE_ROOT`** — Root directory for all usage storage. Defaults to `~/.crewrig/usage`. The only place in the storage contract that reads this variable directly. Must be an absolute path writable by the operator.

### Wing resolution

- **`CREWRIG_USAGE_WING`** — Explicit override of the wing a record resolves to. When set, rule 1 of the wing cascade (below) applies and all other rules are skipped. Useful for backfill operations or for adopting organizations that map project roots differently.

### Mirror

- **`CREWRIG_USAGE_MIRROR`** — Set to `0` to disable automatic mirror catch-up on write. Pending markers are still created; only the detached spawn is skipped. Default: enabled (not `0`).
- **`CREWRIG_USAGE_MIRROR_BACKOFF_MS`** — Backoff duration after MemPalace becomes unreachable before attempting another catch-up. Defaults to `600000` (10 minutes). While this duration is active, no new catch-up is spawned, though pending markers accumulate.
- **`CREWRIG_USAGE_MIRROR_LOCK_STALE_MS`** — Staleness threshold for the mirror catch-up lock. A lock older than this is considered stale and may be forcibly acquired. Defaults to `900000` (15 minutes).
- **`CREWRIG_USAGE_MIRROR_WAIT_MS`** — Only consulted by an *explicit* catch-up (see below). Bound on how long it polls a contended lock before giving up. Defaults to `CREWRIG_USAGE_MIRROR_LOCK_STALE_MS`, so in practice an explicit catch-up always succeeds — a peer that never releases the lock is, by definition, stale by then.

### Drain (spool → journal)

- **`CREWRIG_USAGE_DRAIN_BUDGET_MS`** — Time budget for draining spooled records in a single pass. Once elapsed, draining stops and resumes at the next write opportunity. Set to `0` for unbounded draining. Defaults to `2000` (2 seconds).

### Cleanup

- **`CREWRIG_USAGE_ALLOW_PRUNED`** — When set to `1`, writes to periods already marked as pruned are allowed. Otherwise writes to pruned periods are rejected. Defaults to disallow (empty). Used only during explicit backfill with `--reset-cursors`.
- **`CREWRIG_USAGE_TMP_STALE_MS`** — Staleness threshold for temp files in `<root>/tmp/` (from aborted writes) and in the spool (from 0206 crashes). Files older than this are unlinked. Defaults to `86400000` (24 hours).

## Wing resolution

The MemPalace wing a record resolves to is determined by a seven-rule cascade applied in order. The wing is stored in the record's `.wing.json` sidecar at write time so later mirror operations read the resolved wing instead of re-deriving it. The rules are:

1. **`CREWRIG_USAGE_WING` override** — If the environment variable is set and non-empty, use its value. This rule short-circuits all others and is the primary lever for backfill operations.

2. **In-process cache** — If the project root has been resolved in this process, return the cached result immediately. Lives for the lifetime of the process only; does not persist to disk.

3. **On-disk memo** — Read from `<root>/cache/wings/<key>.json` (where `key` is a truncated sha256 hash of the project root). Useful only for a live checkout (rule 4); memos from ancestor or basename fallback rules are not persisted.

4. **Live checkout** — Run `git -C <projectRoot> rev-parse --git-common-dir` and extract the basename of its dirname. The answer is memoized to disk because it cannot go stale while the directory exists. This is the only rule that writes the memo.

5. **Nearest existing ancestor** — If the project root no longer exists but has an ancestor that does, run `git` against that ancestor. The result is cached in-process but NOT persisted to disk—if the project root reappears later, it must be re-derived rather than replayed from stale cache.

6. **Process cwd** — As a last resort, attempt to derive the wing from the writing process's current working directory. This result is never memoized because it is a property of the writing process, not of the record's project root.

7. **Basename fallback** — Use the basename of the resolved (or attempted) project root. This is the ultimate fallback and always succeeds.

The memo in rule 3 is written ONLY for the live-checkout derivation (rule 4). Answers from ancestor- and basename-fallback paths are cached in-process only.

### Backfill and wing override

When performing a backfill over project roots that no longer exist or have been renamed, use the lever:

```bash
CREWRIG_USAGE_WING=<project> bash scripts/usage-backfill.sh
```

This applies rule 1 uniformly to all records in the backfill, overriding their original derivations and resolving every record to the named wing.

## Mirror write path

When a record is successfully stored (`status: stored`), the storage contract may mirror it into the shared MemPalace daemon if that daemon is reachable. Mirroring is entirely asynchronous: the write always completes and returns success to the caller regardless of mirror state.

### Gating: token file

Mirroring is gated by the presence of MemPalace's token file (checked at write time). If the token file does not exist, no marker is created, no stamp is checked, no spawn occurs, and nothing lands under `<root>/mirror/`. The record is written and returned as `stored`; mirroring simply does not happen. This allows operations without MemPalace to run identically to operations with it: the journal alone is sufficient.

### Pending marker and catch-up spawn

When the token file is present:

1. A pending marker is created at `<root>/mirror/pending/<cli>/<period>/<recordId>`.
2. The unreachable stamp is checked. If it exists and is younger than `CREWRIG_USAGE_MIRROR_BACKOFF_MS`, the write returns without spawning.
3. Otherwise, a detached catch-up process (`bash scripts/usage-mirror.sh --from-write`) is spawned to move markers from `pending/` to `mirrored/` by creating drawers in MemPalace.

### Explicit vs. write-time catch-up, and the mirror lock

Every catch-up (write-time or operator-invoked) serializes on a single `mirror.lock` file. The two callers treat contention differently:

- **Write-time (detached, `--from-write`)** — a single, non-blocking lock attempt. If another child already holds the lock, this one exits immediately with nothing done; the sibling in progress owns the drain, and the next write's own spawn will retry if pending markers remain.
- **Explicit (`bash scripts/usage-mirror.sh`, with or without `--reconcile`, invoked by an operator or CI without `--from-write`)** — on a contended lock, polls every 100 ms until the lock is released or goes stale (bounded by `CREWRIG_USAGE_MIRROR_WAIT_MS`, defaulting to `CREWRIG_USAGE_MIRROR_LOCK_STALE_MS`), then runs its own pass. This is what lets an operator run `usage-mirror.sh` right after a batch of writes and rely on every marker pending at that moment having been attempted, rather than silently losing the race to a detached write-time child and returning having mirrored nothing.

Whichever caller does acquire the lock drains `pending/` in a loop — repeating its pass until the directory is empty or a pass makes no further progress — rather than a single pass. This absorbs markers created by sibling writes while the drain was running, instead of stranding them for "the next write" to spawn a fresh catch-up for.

### Unreachable backoff

When a mirror operation fails with a transport error (daemon unreachable), the `unreachable.stamp` file is written. Subsequent write operations check this stamp's age; if it is younger than the backoff window, no new catch-up is spawned, though pending markers continue to accumulate. Once the backoff expires, the next write spawns a fresh catch-up attempt. This prevents thundering-herd spawning when the daemon is down.

When MemPalace answers but cannot serve the call at all (an error without a `success` field, `isError`, or a malformed reply), the catch-up stops its pass after that one call, without writing the stamp, so a backlog costs at most one call per write. A failure MemPalace reports for one record (`success: false`) is logged, and the pass moves on to the next record.

### Drawer structure

A mirrored drawer is created per record, in the project's own memory space under the `usage-records` room. The drawer's content depends on the record's kind:

- **Captured records** — The raw object is externalized. The drawer carries the record's normalized fields with `rawStatus: "externalized"` and `rawRef: "<cli>/<period>#<recordId>"` pointing back at the journal entry. The raw object itself is never copied; only a reference is stored.
- **Uncaptured records** — The record is mirrored unchanged (R27). No raw status or raw reference is added; the record is stored as-is because it has no raw object to externalize.

### One-time reconciliation

If the operator loses the `<root>/mirror/` directory (or if late MemPalace adoption rebuilds it), a one-time reconciliation is available:

```bash
task usage:mirror -- --reconcile
```

This command recomputes the set of pending markers by walking the entire journal and comparing against the `mirrored/` markers. Records without a mirrored marker are added to pending, and a standard catch-up runs. Since each record's wing is read from its sidecar, re-mirroring produces the same content-addressed drawer ID, so existing drawers are re-found and no duplicates are created.

## Drain (spool → journal)

Spec 0206's capture step now writes straight through this storage contract's own `write(record)` — the spool hand-over is complete (see [Usage capture](usage-capture.md#spool-hand-over-to-spec-0207)). `<root>/spool/` is therefore a **legacy directory**: it exists only on a machine that ran 0206's capture step before the hand-over, and holds whatever records were spooled at that point. The drain moves any such leftover records into the journal; it is triggered automatically on every journal write (if the spool is non-empty and present at all) and can be run explicitly via:

```bash
task usage:drain
```

Each spooled record is validated and written to the journal via the standard write path (which may return `stored`, `duplicate`, or `rejected`). Only `stored` and `duplicate` records are unlinked from the spool; `rejected` records are left in place (to avoid losing the only copy of a record 0206 already accepted). The drain is budgeted: it stops once `CREWRIG_USAGE_DRAIN_BUDGET_MS` elapses, leaving the rest for the next write or explicit drain. On a machine that never ran 0206's capture step before the hand-over, `<root>/spool/` never exists and the drain is a no-op.

### First drain cost

On a machine that ran 0206's capture step before the spool hand-over, the first drain is a one-time cost that scales with whatever 0206 spooled before the hand-over; the legacy spool no longer grows. Hook-triggered writes drain under the 2-second default budget, so a large leftover spool can take several writes to empty. To pay the whole cost once, at a time you choose, run the one-shot drain, which runs with no budget:

```bash
task usage:drain  # equivalently: bash scripts/usage-drain.sh
```

## Read surface

The `bash scripts/usage-query.sh` command retrieves records from the journal (or from pending mirrors). Output is JSONL, one record per line. Give at least one of `--session`, `--agent` with `--parent`, `--period`, `--task-key`, or `--asset`. Selectors compose: every further selector, plus `--cli` and `--fidelity`, narrows the result (AND), and `--task-key` and `--asset` test the ledger-applied attribution unless `--no-ledger` is given. A listing with `--period` returns only that month's records and reads only its partitions. With `--rollup`, `--period` is a placement bound instead (see [Period rollups](usage-pricing.md#period-rollups)). `--pending` honours `--fidelity` only, and `--undrained` takes no filter.

- **`--session <id>`** — All records in the session. Requires the full session ID.
- **`--agent <id> --parent <parentSessionId>`** — All records from the named agent within its parent session.
- **`--period <YYYY-MM> [--cli <cli>]`** — All records in a calendar month. If `--cli` is omitted, records from all CLIs are returned.
- **`--task-key <key>`** — All records carrying the task-handoff key in their attribution block.
- **`--asset <kind>:<ref>`** — All records carrying the external asset reference in their attribution block.
- **`--undrained`** — Records still in the spool (spooled file or spool stray from a crash).
- **`--pending`** — Records awaiting mirroring (in `<root>/mirror/pending/`).

Every read operation except `--undrained` accepts an optional `--fidelity <per-request|run-total|session-cumulative>` filter to narrow results.

Records returned by read operations are verbatim journal entries, **unless an attribution ledger entry (spec 0208) names a matching session, agent, or period** — in that case, the ledger entry's task-handoff key and/or external asset reference **overrides** the record's own attribution at read time. The underlying record in the journal is never modified (spec 0208 R16); only the returned result carries the overridden attribution.

To read records with their original attribution, bypassing any ledger overrides:

```bash
bash scripts/usage-query.sh --task-key 1171 --no-ledger
```

Each record carries its original `schemaVersion`, so downstream processing can handle multiple schema versions if needed.

## Prune and unprune

Records are never automatically removed. Removal is explicit and period-scoped:

```bash
bash scripts/usage-prune.sh <cli> <YYYY-MM>
```

This command:

1. Writes a pruned marker to `<root>/pruned/<cli>/<YYYY-MM>.json` FIRST, protecting the period against repopulation even if the prune crashes mid-operation.
2. Deletes each record's drawer (if mirrored), markers, sidecars (both `.wing.json` and `.attr.json`), and journal entry in that order.
3. **Walks the registry of derived stores** (spec 0207 delta-01 R28) and removes items from each registered store for that period. The attribution ledger (spec 0208) and the price store (spec 0209) are registered derived stores; every ledger entry and price entry for records in that period is removed. Prices are partitioned by their record's request instant, so a price is removed when its underlying record's period matches the pruned period. For each derived store reached, the prune reports how many items it removed.
4. If any mirrored drawer exists and MemPalace is unreachable or does not confirm the drawer's deletion, refuses the operation and exits non-zero to preserve consistency.

The command refuses to prune the current or future period unless `--force` is passed.

A period for which no derived store has anything recorded still prints a report naming only the journal and mirror removal, with no derived-store entry (spec 0207 delta-01 R32).

### Unprune

To restore writability to a pruned period without recovering deleted records:

```bash
bash scripts/usage-prune.sh <cli> <YYYY-MM> --unprune
```

This removes only the pruned marker, allowing writes to the period again. **It does not restore journal entries, sidecars, or drawers, and does not recover records rejected while the period was pruned.** To recover rejected records, the capture cursors must be reset:

```bash
bash scripts/usage-backfill.sh --reset-cursors
```

**Bold warning:** Once unpruned, new writes to the period will succeed, but previously rejected records (those that failed validation while the period was pruned) remain lost. Use `--reset-cursors` to back-capture those missed records from the original source.

### Total purge

A prune removes one period. Removing everything the feature holds is a separate procedure, because it must also remove the MemPalace drawers and each CLI's capture wiring, in a set order: see [Removing usage data](usage-organization.md#removing-usage-data) in the organization note, which is the only home of that procedure.

## Vendored validator

The validator (`scripts/lib/usage-store/validator/validate.js`) is a precompiled ajv validator generated from `schemas/usage-record/v1.schema.json` (spec 0205). It is committed to the repository because:

1. Validation must work with no `node_modules` on the resolution path (useful in low-footprint environments).
2. The validator's behavior is deterministic once generated; re-running the generator with different ajv versions would produce different output.

The validator is generated by `scripts/build-usage-validator.js` and includes MIT notices for ajv and ajv-formats.

### Validating records externally

To validate a batch of usage records without writing them:

```bash
node scripts/lib/usage-store/validator/validate.js --check <file>
```

### Re-copying on ajv bump

When ajv is updated, the generator must be re-run and the new validator committed:

```bash
npm install  # updates package-lock.json
node scripts/build-usage-validator.js
git add scripts/lib/usage-store/validator/validate.js
```

The new validator is then automatically used on the next run of any storage command.

## Personal data

This section states what the journal and the mirror hold (spec 0207 R21). Retention, who can read each copy, and removal are stated once for the whole feature, in the [organization note](usage-organization.md).

### What a record holds

A usage record carries:

- **Session and agent identifiers** — The session ID, parent session ID (if the request came from an agent), and agent ID or name.
- **Project root path** — An absolute filesystem path to the project directory the session ran against.
- **Model identifiers** — The literal string the source CLI reported for the request (may include placeholders like `"auto"`).
- **Timestamps** — The instant the request occurred and the instant the record was captured (both ISO 8601).
- **Token counts** — Five normalized, non-negative integers: net input, cache read, cache write (single or tiered), output, reasoning.
- **Interaction class** — What the request served: user-turn, tool-continuation, agent-internal, or unknown.
- **Vendor `raw` block** — The source CLI's original fields and values (optional, externalized in the mirror).
- **Provenance** — The source CLI, its version, the capture channel, and a format fingerprint.
- **Attribution (optional)** — A CrewRig task-handoff key and/or an external work-tracking asset reference (captured at write time; see [Usage attribution](usage-attribution.md) for ledger and sidecar details).

A mirrored drawer carries the same record with its `raw` block externalized, as described in [Drawer structure](#drawer-structure) above: the drawer holds a reference to the journal entry, never the `raw` object itself.

### What a record never holds

- **Conversation text** — No message bodies, prompts, or outputs from model inference. Spec 0206 (capture) excludes conversation text at the boundary, and every capture channel, the non-interactive `headless-envelope` channel included, copies only enumerated `raw` fields.

## See also

- [Usage record format](usage-record-format.md) — The schema and field definitions for usage records (spec 0205).
- [Usage capture architecture](usage-capture.md) — How each CLI's usage is derived into records and handed to this storage contract (spec 0206).
