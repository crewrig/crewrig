# Usage storage

<!-- crewrig-doc: section=reference nav_order=130 published=true title="Usage storage" -->

The usage storage contract (spec 0207) provides an append-only local journal of usage records — the source of truth for consumption data — with optional mirroring into the shared MemPalace memory space when that daemon is reachable. A record written to the journal persists whether or not MemPalace is present; a record mirrored into MemPalace becomes queryable by session, agent, task, and external asset reference without altering the journal itself.

## On-disk layout

The journal partitions records by their source CLI and calendar month, storing one immutable file per record. This design differs from the spec's informative JSONL layout for two reasons:

1. The spec's `.state/` directory would collide with the directory spec 0206 (capture) already owns, so state tracking is placed elsewhere.
2. One-file-per-record with filesystem link primitives provides O(1) idempotency (spec R2) and prevents interleaving (R26) without an index or scan, whereas an appended JSONL file cannot.

```text
<root>/journal/<cli>/<YYYY-MM>/<recordId>.json        # one record per file
<root>/journal/<cli>/<YYYY-MM>/<recordId>.wing.json   # sidecar: the wing derivation
<root>/mirror/pending/<cli>/<YYYY-MM>/<recordId>       # marker: record awaiting mirroring
<root>/mirror/mirrored/<cli>/<YYYY-MM>/<recordId>      # marker: record already mirrored
<root>/mirror/unreachable.stamp                        # timestamp: daemon was unreachable
<root>/cache/wings/<key>.json                          # memo: resolved wing for a project root
<root>/pruned/<cli>/<YYYY-MM>.json                     # marker: period was pruned (R20)
<root>/locks/*.lock                                    # advisory locks for drain and mirror
<root>/tmp/.*                                          # temp files from write/mirror (swept)
<root>/spool/                                          # 0206-owned: records awaiting drain
```

`<root>` defaults to `~/.crewrig/usage` and is overridable via `CREWRIG_USAGE_ROOT`.

### Record period derivation

The period `YYYY-MM` is always the UTC calendar month of `timing.requestInstant` (never `captureInstant`). This ensures a backfill run today over an August request lands in August—otherwise a prune of August would leave it behind (R19).

### Wing sidecar

Each journal entry is accompanied by a `.wing.json` sidecar carrying the MemPalace wing the record resolved to at write time, plus its derivation method and the project root. The sidecar is immutable after the entry is written and never re-derived by a later mirror path; if a sidecar is lost (killed between write and link), it is repaired by the next write of the same record ID using the seven-rule cascade described in *Wing resolution* below.

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
3. Otherwise, a detached catch-up process (`bash scripts/usage-mirror.sh`) is spawned to move markers from `pending/` to `mirrored/` by creating drawers in MemPalace.

### Unreachable backoff

When a mirror operation fails with a transport error (daemon unreachable), the `unreachable.stamp` file is written. Subsequent write operations check this stamp's age; if it is younger than the backoff window, no new catch-up is spawned, though pending markers continue to accumulate. Once the backoff expires, the next write spawns a fresh catch-up attempt. This prevents thundering-herd spawning when the daemon is down.

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

Records captured by spec 0206 (capture) are written to a spool (`<root>/spool/`) and must be moved into the journal by an explicit drain operation. The drain is triggered automatically on every journal write (if the spool is non-empty) and can be run explicitly via:

```bash
task usage:drain
```

Each spooled record is validated and written to the journal via the standard write path (which may return `stored`, `duplicate`, or `rejected`). Only `stored` and `duplicate` records are unlinked from the spool; `rejected` records are left in place (to avoid losing the only copy of a record 0206 already accepted). The drain is budgeted: it stops once `CREWRIG_USAGE_DRAIN_BUDGET_MS` elapses, leaving the rest for the next write or explicit drain.

### First drain cost

The first drain of a session may incur significant I/O as spooled records accumulate over months or years. The budget defaults to 2 seconds per write; plan accordingly. On first drain, consider raising the budget:

```bash
CREWRIG_USAGE_DRAIN_BUDGET_MS=60000 bash scripts/usage-write.sh  # 60-second budget for first write
```

## Read surface

The `bash scripts/usage-query.sh` command retrieves records from the journal (or from pending mirrors). Output is JSONL, one record per line. Selectors are mutually exclusive (provide exactly one):

- **`--session <id>`** — All records in the session. Requires the full session ID.
- **`--agent <id> --parent <parentSessionId>`** — All records from the named agent within its parent session.
- **`--period <YYYY-MM> [--cli <cli>]`** — All records in a calendar month. If `--cli` is omitted, records from all CLIs are returned.
- **`--task-key <key>`** — All records carrying the task-handoff key in their attribution block.
- **`--asset <kind>:<ref>`** — All records carrying the external asset reference in their attribution block.
- **`--undrained`** — Records still in the spool (spooled file or spool stray from a crash).
- **`--pending`** — Records awaiting mirroring (in `<root>/mirror/pending/`).

All read operations accept an optional `--fidelity <per-request|run-total|session-cumulative>` filter to narrow results.

Records returned by read operations are verbatim journal entries. Each carries its original `schemaVersion`, so downstream processing can handle multiple schema versions if needed.

## Prune and unprune

Records are never automatically removed. Removal is explicit and period-scoped:

```bash
bash scripts/usage-prune.sh <cli> <YYYY-MM>
```

This command:

1. Writes a pruned marker to `<root>/pruned/<cli>/<YYYY-MM>.json` FIRST, protecting the period against repopulation even if the prune crashes mid-operation.
2. Deletes each record's drawer (if mirrored), markers, sidecar, and journal entry in that order.
3. If any mirrored drawer exists and the MemPalace daemon is unreachable, refuses the operation and exits non-zero to preserve consistency.

The command refuses to prune the current or future period unless `--force` is passed.

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

To purge everything the storage contract owns under `CREWRIG_USAGE_ROOT`, remove these directories:

```bash
rm -rf <root>/journal <root>/mirror <root>/cache <root>/tmp
```

**Do NOT remove `<root>/state/`** — that directory is owned by spec 0206 (capture) and must not be touched by the storage contract.

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

This section addresses requirement R21: what data the journal and mirror hold, who can access it, and how to purge it.

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
- **Attribution (optional)** — A CrewRig task-handoff key and/or an external work-tracking asset reference.

### What a record never holds

- **Conversation text** — No message bodies, prompts, or outputs from model inference. Spec 0206 (capture) excludes conversation text at the boundary, so none reaches the journal or mirror.

### Who can read it

- **Journal readers** — Anyone with read access to the operator's `<root>/journal/` directory (typically the operator and CI/CD systems running under their user).
- **Mirror readers** — Anyone with read access to the operator's MemPalace drawer store (typically the operator and CI/CD systems running under the MemPalace daemon user).

The storage contract itself applies no encryption; the operator's filesystem permissions and MemPalace's own access controls are the only safeguards.

### How to purge

**Explicit period prune:**

```bash
bash scripts/usage-prune.sh <cli> <YYYY-MM>
```

**Immediate, complete purge** (all data under `CREWRIG_USAGE_ROOT`):

```bash
rm -rf <root>/journal/ <root>/mirror/ <root>/cache/ <root>/tmp/
```

Neither command touches `<root>/state/` (owned by 0206). After purging, subsequent writes will create new journal entries and mirror drawers starting fresh.

## See also

- [Usage record format](usage-record-format.md) — The schema and field definitions for usage records (spec 0205).
- [Usage capture](usage-capture.md) — How records are generated and written to the spool (spec 0206).
