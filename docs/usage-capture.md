# Usage capture architecture and mechanisms

<!-- crewrig-doc: section=reference nav_order=115 published=true title="Usage capture architecture" -->

The usage-capture seam implements spec 0206, deriving one usage record for every completed model-request a CLI source records, plus one summary record for every non-interactive CLI invocation. This page documents the capture architecture, the per-CLI adapter mechanics, the cursor semantics, the in-repo-absolute-path installation contract, and the documented gaps.

## Architecture overview

The capture step is a **Node module tree** under `scripts/lib/usage-capture/`, invoked by two thin entry points:

- **Live capture:** `hooks/usage-capture.sh` — a sibling hook to `hooks/mempalace-transcript.sh`, wired by in-repo absolute path into the existing `Stop` / `SessionEnd` / `AfterModel` / `agentStop` events on Claude Code, Gemini CLI, Copilot CLI, and Antigravity (statusline display).
- **Backfill:** `scripts/usage-backfill.sh` — a command-line tool that replays the same per-CLI adapters against records already present on a machine, taking the same derivation rules the live path uses.

No storage backend, write format, or retention policy is implemented by this specification (spec 0206 R25). The capture module exposes a pure interface `sink.submit(record) → { status: 'stored' | 'duplicate' | 'rejected', reason? }` — the three outcomes spec 0207 R24 defines — and resolves to spec 0207's own storage contract: `scripts/lib/usage-store/journal.js`'s `write(record)` (see [Usage storage](usage-storage.md)). The hand-over from spec 0206's original spool is complete (see *Spool hand-over to spec 0207* below); a machine that ran 0206 before the hand-over has any leftover `~/.crewrig/usage/spool/` files drained into the journal on the next write, and `CREWRIG_USAGE_ROOT` is unchanged throughout.

### Module tree structure

```text
scripts/lib/usage-capture/
├── index.js                 # Main dispatcher: capture({ cli, event, payload })
├── cli.js                   # CLI entry point: reads payload from file, calls index.js
├── record.js                # Shared normalizer: captured/uncaptured constructors, recordId derivation, fingerprints
├── sink.js                  # Storage boundary: structural precheck + spec 0207's journal
├── cursor.js                # Per-source high-water state at ~/.crewrig/usage/state/<cli>/
├── adapters/
│   ├── claude-code.js       # Reads ~/.claude/projects/<project>/<session>.jsonl + subagents
│   ├── gemini-cli.js        # Reads ~/.gemini/tmp/<project>/chats/ (three generations)
│   ├── copilot-cli.js       # Reads ~/.copilot/session-store.db (SQLite)
│   ├── antigravity.js       # Reads statusline payload from stdin
│   └── headless-envelope.js # Shared: one run-total record from non-interactive output
```

## Per-adapter field sources

Every captured record declares a `formatFingerprint` — a hash of the asserted key-path set, not its content — so a fixture and a live source of the same generation carry the same fingerprint. An unrecognized generation yields an `uncaptured` record naming the mismatch.

### Claude Code

Source: `~/.claude/projects/<project>/<session>.jsonl` + `<session>/subagents/agent-*.jsonl`

Fidelity: `per-request`

| Field | Source | Derivation | Remarks |
|---|---|---|---|
| `provenance.cli` | Static | `"claude-code"` |  |
| `provenance.cliVersion` | Entry field | `message.version` — fallback `"unknown"` if absent | Identifies the CLI version that served the request |
| `provenance.captureChannel` | Static | `"own-record-tail"` | Captured from the session record's tail |
| `provenance.formatFingerprint` | Assertion result | SHA256 of sorted `["message.usage.input_tokens", "message.usage.output_tokens"]` | Detects format changes across generations |
| `identity.sessionId` | Entry field | `sessionId` (fallback `session_id`) | The session identifier from the record |
| `identity.projectRoot` | Entry field | `cwd` — fallback to caller-provided `cwd` | The working directory at request time |
| `identity.agentId` | Entry field | `agentId` on subagent records, explicitly `null` on main-session records | A Claude Code subagent record carries the **parent's** `sessionId` in its own `sessionId` field; there is no distinct child session id |
| `identity.parentSessionId` | Static | `null` | Satisfied by fields, never by file adjacency |
| `timing.requestInstant` | Entry field | `timestamp` — fallback to capture time if absent | When the request occurred |
| `modelId` | Entry field | `message.model` — fallback `"unknown"` | The literal model identifier reported by the CLI |
| `interaction` | Derived | From `agentId` (agent-internal), `stop_reason` (`tool_use` → tool-continuation, other → user-turn), fallback `unknown` | Signals the newest input's shape |
| `tokens.netInput` | Entry field | `usage.input_tokens` | Total input tokens |
| `tokens.cacheRead` | Entry field | `usage.cache_read_input_tokens` | Tokens read from cache |
| `tokens.cacheWrite` | Entry field | `usage.cache_creation.{ephemeral_5m,ephemeral_1h}_input_tokens` as a structured object, fallback to `usage.cache_creation_input_tokens` | Cache write tiers are preserved per spec 0206 R9 |
| `tokens.output` | Entry field | `usage.output_tokens` | Tokens generated |
| `tokens.reasoning` | Entry field | `usage.output_tokens_details.thinking_tokens` — zero if absent | Thinking tokens (when present) |
| `raw` | Subset | `{ usage, stop_reason }` | Only the enumerated key paths; never `message.content` |
| `rawStatus` | Static | `"complete"` | The full raw block is present |
| `idempotencyKey` | Entry field | `requestId`, fallback to `uuid` | **All entries sharing one `requestId` collapse into one record** (spec 0206 R6); the last entry for a key wins |

**Key collapse (R6 streaming duplicates):** When multiple entries share the same `requestId`, the adapter emits exactly one record, with field values from the last entry. This occurs when a model response is delivered in streaming chunks, each reported as a completed entry. Probed on the authoring machine: 25.8% of interactive `entrypoint: "cli"` records lack `requestId` and fall back to `uuid`.

### Gemini CLI

Source: `~/.gemini/tmp/<project>/chats/<sessionId>.{json,jsonl}` (three generations) + `chats/<sessionId>/<sub>.jsonl` (subagent) + `projects.json` (project root reverse index)

Fidelity: `per-request`

| Field | Source | Derivation | Remarks |
|---|---|---|---|
| `provenance.cli` | Static | `"gemini-cli"` |  |
| `provenance.cliVersion` | Memoized subprocess | `gemini --version` — cached by binary mtime/size, written to `~/.crewrig/usage/state/gemini-cli/version.json` | Not present in the session record; resolved once per binary upgrade |
| `provenance.captureChannel` | Static | `"own-record-tail"` |  |
| `provenance.formatFingerprint` | Assertion result | SHA256 of sorted key paths corresponding to the generation: legacy `.json` (no `kind`), `.json` with `kind` (plus a virtual `container.json` key path), or `.jsonl` `$set`-patch (plus a virtual `container.jsonl` key path) | Detects schema changes; three generations supported. The virtual `container.json`/`container.jsonl` key paths carry the container-shape fact `deriveFromFile` already resolves from the file extension — never an optional field like `summary`, which the CLI fills in asynchronously and is absent on roughly half of live `kind`-carrying sessions (i2-F1) |
| `identity.sessionId` | Header field | Transcript header's own `sessionId` |  |
| `identity.projectRoot` | Reverse index | `~/.gemini/projects.json` structure: `{"projects": {"<absolute path>": "<short name>", …}}` — lookup the header's `projectHash` against the nested `projects` keys | On backfill, `projectHash` is re-verified to match via `sha256()` |
| `identity.agentId` | Static | `null` — no field in the source carries it | See `parentSessionId` below |
| `identity.parentSessionId` | Static | `null` for subagent records — the source exposes no parent-session field | The enclosing directory name is a human-readable hint but not an authoritative identifier; it rides in `raw.sourceDirectory` and is documented as a gap |
| `timing.requestInstant` | Entry field | Response entry's `timestamp` |  |
| `modelId` | Entry field | Response entry's model name — fallback `"unknown"` | The literal model identifier |
| `interaction` | Derived | From `toolCalls` presence: if present → `tool-continuation`, otherwise → `user-turn` | The `tool_use` stop reason is not available in Gemini's output format |
| `tokens.netInput` | Computed | `tokens.input − tokens.cached` — the unreduced `input` is preserved in `raw` | Spec 0206 R7: net input is the combined count minus the cached count |
| `tokens.cacheRead` | Entry field | `tokens.cached` |  |
| `tokens.cacheWrite` | Static | `0` — Gemini's own record reports no cache write | The capture path is request-level; cache writes (if tracked at all) are session-level metadata |
| `tokens.output` | Entry field | `tokens.output` |  |
| `tokens.reasoning` | Entry field | `tokens.thinking` — zero if absent |  |
| `raw` | Subset | Enumerated fields plus the unreduced `input` count | Never `content` or `thoughts` fields |
| `rawStatus` | Static | `"complete"` |  |
| `idempotencyKey` | Entry field | Response entry's message `id` |  |

**Generations supported:**

- **Legacy monolithic `<sessionId>.json`:** A single JSON object carrying a `kind` field (or missing it for pre-`kind` installations)
- **Generation 2 `<sessionId>.json` with `kind`:** The header gains a `kind` field (`summary` sometimes rides along too, but it is filled in asynchronously by the Gemini CLI and is not asserted by the fingerprint — i2-F1); entries remain the same shape
- **Generation 3 `<sessionId>.jsonl`:** The file becomes a JSONL journal of `$set`-patch operations. The adapter reduces the patches to entry state before emitting.

**Subagent mystery:** The specification requires that every subagent-linkage value come from a field the source assigns (spec 0206 R12). Gemini CLI's subagent transcripts (`chats/<parentSessionId>/<sub>.jsonl`) carry a header with `directories[0]` and a parent-directory enclosure, but no `parentSessionId` field in the header itself. The parent linkage is therefore preserved in `raw.sourceDirectory` and documented as a gap (see *Documented gaps* below).

### Copilot CLI

Source: `~/.copilot/session-store.db` (SQLite, schema version 8+) + `~/.copilot/session-state/<sessionId>/events.jsonl` (version string only)

Fidelity: `per-request`

| Field | Source | Derivation | Remarks |
|---|---|---|---|
| `provenance.cli` | Static | `"copilot-cli"` |  |
| `provenance.cliVersion` | Two-path resolver | **Live path:** First line of `session-state/<sessionId>/events.jsonl`, field `session.start.data.copilotVersion` (present on 84 of 84 test installations) — fallback to memoized `copilot --version`. **Backfill path (caveat):** Memoized `copilot --version` only, stamping the binary present *today* onto rows an *older* binary may have served. Schema-valid either way; the asymmetry is documented here. | The store itself contains no version field |
| `provenance.captureChannel` | Static | `"sqlite-assistant-usage-events"` | Captured from the SQLite journal table |
| `provenance.formatFingerprint` | Assertion result | Hash of `schema_version` + sorted `assistant_usage_events` column set | Schema changes (e.g., Copilot auto-update from v7 to v8) are detected |
| `identity.sessionId` | Row field | `session_id` from `assistant_usage_events` |  |
| `identity.projectRoot` | Join | `sessions.cwd` (selected **only**, never the adjacent `sessions.summary` which holds conversational content) | Joined on `session_id` |
| `identity.agentId` | Row field | `agent_id` — `null` on top-level rows | Identifies subordinate-agent calls |
| `identity.parentSessionId` | Static | `null` — no parent-session column exists | The store carries `parent_tool_call_id` (preserved in `raw`), not a parent-session identifier |
| `timing.requestInstant` | Row field | `created_at` (ISO 8601 string) |  |
| `modelId` | Row field | `model` column — authoritative across mid-session model changes | The literal model identifier |
| `interaction` | Derived | From `initiator` field | Values map to interaction classes per the schema |
| `tokens.netInput` | Row field | `input_tokens` |  |
| `tokens.cacheRead` | Row field | `cache_read_tokens` |  |
| `tokens.cacheWrite` | Row field | `cache_write_tokens` |  |
| `tokens.output` | Row field | `output_tokens` |  |
| `tokens.reasoning` | Row field | `reasoning_tokens` — zero if column absent (pre-v8 schema) |  |
| `raw` | Subset | Selected row fields plus `parent_tool_call_id` | Never `messages` or conversation content |
| `rawStatus` | Static | `"complete"` |  |
| `idempotencyKey` | Row field | `id` (the row's unique identifier) |  |

**SQLite read mechanics:** The adapter opens `session-store.db` with `node:sqlite`'s `DatabaseSync(path, { readOnly: true })`. If the read-only open fails (a WAL whose `.shm` cannot be attached), it retries once against a temp copy of `.db`, `.db-wal`, and `.db-shm` together. An unavailable `node:sqlite` or a second failure yields one `uncaptured` record.

### Antigravity CLI

Source: `statusLine.command` — a display-refresh payload delivered to a captured statusline hook

Fidelity: `session-cumulative`

| Field | Source | Derivation | Remarks |
|---|---|---|---|
| `provenance.cli` | Static | `"antigravity"` |  |
| `provenance.cliVersion` | Payload field | `version` — no subprocess | Reported in the statusline payload itself |
| `provenance.captureChannel` | Static | `"statusline-shim"` | Captured from the live display channel |
| `provenance.formatFingerprint` | Assertion result | Hash of cumulative-usage key set | Detects payload shape changes |
| `identity.sessionId` | Payload field | `session_id` — `conversation_id` rides in `raw` | The channel exposes both; `session_id` is chosen for consistency |
| `identity.projectRoot` | Payload field | `workspace.project_dir` |  |
| `identity.agentId` | Static | `null` — the channel exposes no agent linkage |  |
| `identity.parentSessionId` | Static | `null` |  |
| `timing.requestInstant` | Derived | The payload's own snapshot instant — **note:** Antigravity's statusline channel does **not** report a timestamp, so `requestInstant` equals `captureInstant` | See *Documented gaps* below |
| `modelId` | Payload field | `model.id` — preserved **verbatim**, including display labels like `"Gemini 3.8 Flash (Medium)"` | Spec 0206 R30: never a value borrowed from another source |
| `interaction` | Static | `"unknown"` | Spec 0206 R11: session-cumulative fidelity carries no per-request distinction |
| `tokens.netInput` | Payload field | `context_window.current_usage.input_tokens` |  |
| `tokens.cacheRead` | Payload field | `context_window.current_usage.cache_read_input_tokens` |  |
| `tokens.cacheWrite` | Payload field | `context_window.current_usage.cache_creation_input_tokens` |  |
| `tokens.output` | Payload field | `context_window.current_usage.output_tokens` |  |
| `tokens.reasoning` | Static | `0` — Antigravity's usage channel carries no reasoning-token field | Specification R8: zero when the source genuinely did not report |
| `raw` | Subset | Cumulative-usage fields plus `conversation_id` | Never the full statusline display |
| `rawStatus` | Static | `"complete"` |  |
| `idempotencyKey` | Derived | `sha256(session_id + snapshot_instant)` — derived because no per-request identifier exists | Spec 0206 R5: keying on session + instant instead of a per-request id |

**Payload-delivery mechanism:** The hook `hooks/antigravity-statusline-shim.sh` is wired into `statusLine.command` of `~/.gemini/antigravity-cli/settings.json` (only when that value is empty; see *Installation contract* below). The shim forwards the payload to the adapter and prints the status line unchanged, so the user-visible display is unaffected.

**Cumulative firing pattern:** The statusline channel fires ten times for one `agy -p` invocation, with progressively richer payloads. The adapter emits a record only when the cumulative token counters differ from the cursor's prior snapshot. This buys **exactly one thing, and no more: a firing whose counters have not moved derives no record.** It does not buy one record per turn. If the counters move multiple times within one turn, multiple records are derived (legal per spec 0206 R5: the fidelity declaration is `session-cumulative`, and the key includes the snapshot instant precisely because the channel carries no per-request identifier).

### Headless envelope (run-total, all CLIs)

Source: Structured summary from `--output-format json` / `--usage-output-file` / equivalent non-interactive output

Fidelity: `run-total`

| Field | Source | Derivation | Remarks |
|---|---|---|---|
| `provenance.cli` | Caller-provided | The CLI that was invoked (claude-code, gemini-cli, copilot-cli, antigravity) |  |
| `provenance.cliVersion` | Memoized subprocess | Per-CLI binary version resolver; same cache as per-request adapters | Cached by binary mtime/size in `~/.crewrig/usage/state/<cli>/version.json` |
| `provenance.captureChannel` | Static | `"headless-envelope"` |  |
| `provenance.formatFingerprint` | Static | `"headless-envelope-run-total"` | Envelope shape varies per CLI but is not generation-mutable within one run |
| `identity.sessionId` | Envelope field | Extracted per CLI; fallback to `run-total-unreported:<launch_instant>` | Claude Code and Copilot report one; Antigravity uses `conversation_id` instead; Gemini may or may not report one depending on the envelope |
| `identity.projectRoot` | Caller-provided | The launching shell's working directory | Owned by the caller (step 15 wrapper) |
| `identity.agentId` | Static | `null` |  |
| `identity.parentSessionId` | Static | `null` |  |
| `timing.requestInstant` | Envelope field | `terminal_timestamp` / `timestamp` when the envelope carries one, fallback to `launchInstant` recorded by the caller **before** the run | The timing is recorded before run and adjusted if the envelope reports a terminal timestamp |
| `modelId` | Envelope field | Per-CLI extraction; **Antigravity and Copilot terminal event both report no model**, so those land on the sentinel `"(unreported)"` — never a value borrowed from another source | Spec 0206 R30 enforced: the value is either from the envelope or the sentinel |
| `interaction` | Static | `"unknown"` | Run-total fidelity carries no per-request distinction |
| `tokens` | Envelope field | Extracted per CLI from the run's final usage summary; zero when the envelope names no value | All five classes are populated from the envelope shape; zero is schema-valid when the source genuinely reports nothing |
| `raw` | Envelope field | The full envelope as received | Preserved for audit trail |
| `rawStatus` | Static | `"complete"` |  |
| `idempotencyKey` | Derived | `run-total:<sessionId>` when a session id is present, fallback to `run-total:sha256(launch_instant + argv_digest)` | Keys are stable across re-runs of the same invocation; the fallback avoids collisions between run-total and per-request keys |

## Usage root directory

The capture system stores all persistent state under a **usage root** directory, configurable via the `CREWRIG_USAGE_ROOT` environment variable:

```text
export CREWRIG_USAGE_ROOT=/path/to/custom/root  # Optional; default is ${HOME}/.crewrig/usage
```

**Default:** `${HOME}/.crewrig/usage`

**Subdirectories:** Under the usage root, the capture system creates and maintains:

- `state/<cli>/` — Cursor files (high-water markers), stamp sidecars, memoized `version.json` per CLI, and configuration like `antigravity-statusline.json` (cursor-owned, never pruned by spec 0207)
- `journal/`, `mirror/`, `cache/`, `pruned/`, `locks/`, `tmp/` — spec 0207's own storage contract; see [Usage storage](usage-storage.md) for the full layout
- `spool/` — legacy directory from spec 0206's original hand-over buffer; present only on a machine that ran 0206 before the hand-over, and drained into the journal on the next write

**Specification 0207 coordination:** The 0207 implementation honors the same `CREWRIG_USAGE_ROOT` variable throughout — the capture step and the storage contract share one root and one `state/` directory.

**Testing:** When running tests, `CREWRIG_USAGE_ROOT` is pointed at a temporary directory (`mktemp -d`) to avoid interfering with the operator's own `~/.crewrig/usage/` directory.

## Cursor semantics and the stamp sidecar

Per-source high-water state lives at `<usage root>/state/<cli>/<sourceKey>.json`, holding:

```json
{
  "byteOffset": 0,
  "headDigest": "sha256(first 4096 bytes)",
  "pendingUnitIds": [],
  "maxRowId": 0,
  "lastSnapshotDigest": null
}
```

**Source key derivation:** `sha256(<absolute source path>)` — the same derivation both the hook and the adapters use, kept in sync by inspection.

**Head digest mechanism:** If the first 4096 bytes of the source change (file rotation, truncation, or overwrite), the digest mismatches and the adapter resets `byteOffset` to 0, re-deriving from the file's beginning. This detects when the journal file has been replaced rather than appended to.

**Stamp sidecar:** After a successful capture pass, a zero-byte file `<sourceKey>.stamp` is touched (via `utimes()`) to the source's own mtime. The hook's fast path uses a bash `-nt` test: `[[ "$src" -nt "$stamp" ]]` costs nothing (builtin mtime comparison) and skips Node entirely when nothing new has appeared. This sidecar is the fast path's only visible artifact on the filesystem.

**Backfill idempotence:** A second backfill run over the same source set adds zero new records, because the sink's recordId-based dedup (via `fs.linkSync()`) recognizes records already written to the journal.

**Spec 0207 prune rule:** The 0207 implementation's prune-by-period command SHALL NOT touch `~/.crewrig/usage/state/`. Resetting a cursor would make the next backfill re-derive pruned records, defeating the retention policy. The state directory is cursor-owned and off-limits.

## Installation contract: in-repo absolute-path wiring

The capture step is wired by **in-repo absolute path**, never copied into any CLI's home directory. This is the same treatment `hooks/worktree-git-guard.sh` already carries.

### Shim wiring (Claude Code, Gemini CLI, Copilot CLI)

Each installer computes the in-repo absolute path and substitutes it into the manifest:

```bash
CAPTURE_ABS="$(cd "$(dirname "$CAPTURE_SCRIPT_SRC")" && pwd -P)/$(basename "$CAPTURE_SCRIPT_SRC")"
```

Then registers the capture command on existing events:

- **Claude Code:** `hooks/claude-transcript-hooks.json` — `Stop` and `SessionEnd`
- **Gemini CLI:** `hooks/gemini-transcript-hooks.json` — `AfterModel`
- **Copilot CLI:** `hooks/copilot-transcript-hooks.json` — `agentStop` and `sessionEnd`

The shim **is never copied** to `~/.claude/hooks/`, `~/.gemini/hooks/`, or `~/.copilot/hooks/`. Its whole job is to reach `scripts/lib/usage-capture/`, so it lives at the repository path where that module tree is a sibling.

### Statusline shim wiring (Antigravity CLI)

The `hooks/antigravity-statusline-shim.sh` is installed into `statusLine.command` of `~/.gemini/antigravity-cli/settings.json` **only when that value is empty** (spec 0206 R20). The prior value and a "framework-installed" marker are recorded in `~/.crewrig/usage/state/antigravity-statusline.json`. Removal restores exactly the prior value (spec 0206 R21).

The shim is **not copied** to `~/.gemini/antigravity-cli/`; it lives at its in-repo absolute path, computed the same way:

```bash
STATUSLINE_ABS="$(cd "$(dirname "$SRC")" && pwd -P)/$(basename "$SRC")"
```

### Checkout-location dependency

Moving, renaming, or deleting the checkout breaks the wired absolute path. The triggering CLI then sees a non-zero status from a command that never started, and no capture runs.

**This is the accepted cost of the in-repo absolute path** — the same cost `hooks/worktree-git-guard.sh` carries since spec 0169. Mitigations, in order of operator experience:

0. **Linked-worktree protection:** Each installer calls `warn_if_linked_worktree` and warns when the checkout is a linked git worktree (detected via `git rev-parse --git-common-dir` differing from `.git`). The warning message is:

   ```text
   WARNING: this checkout is a linked git worktree (<path>).
            The usage-capture wiring above points INTO this checkout — running
            'git worktree remove' on it breaks the wired hook silently
            until this installer is re-run against a durable checkout.
   ```

   **Recommendation:** Run the installers from the main checkout, not from a linked worktree created via `git worktree add`.

1. Each installer prints the wired absolute path at install time, so the dependency is disclosed rather than discovered.
2. `docs/usage-capture.md` (this file) states the dependency and names the recovery: re-run the installer.
3. The data itself is recoverable regardless: `scripts/usage-backfill.sh --reset-cursors` re-derives from the CLIs' own durable history everything a dead live path missed.

## Backfill command

```bash
bash scripts/usage-backfill.sh [--reset-cursors]
```

**Flags:**

- `--reset-cursors`: Clear `<usage root>/state/<cli>/` (cursor files, stamp sidecars, and memoized versions) so a machine whose journal was discarded can re-derive from the CLIs' own durable history. The true record of source is the CLIs themselves, and this flag lets you recover from a lost journal.

**Output:**

The command prints a per-CLI summary:

```text
claude-code: 27,013 stored, 3 duplicate, 0 rejected
gemini-cli: 2,664 stored, 1 duplicate, 0 rejected
copilot-cli: 2,885 stored, 2 duplicate, 0 rejected
```

**Idempotence:** Running the backfill a second time against unchanged source history reports 0 stored and the full duplicate count, proving deduplication is working.

**Recovery use case:** If the live hook path breaks (e.g., checkout moved), run the backfill to re-derive everything the live path missed.

## Spool hand-over to spec 0207

The hand-over is complete. `scripts/lib/usage-capture/sink.js` writes each captured record straight through the storage contract (`scripts/lib/usage-store/journal.js`'s `write(record)`) — no adapter or hook changed in the process, and `CREWRIG_USAGE_ROOT` is the same root throughout.

Before this hand-over, captured records were written to `~/.crewrig/usage/spool/<recordId>.json`, one file per record, verbatim, with no index, partition scheme, retention policy, or prune ledger. That original buffer, `spool.js`, is deleted. A machine that ran 0206's capture step before the hand-over may still carry leftover files under `~/.crewrig/usage/spool/`; the journal's own `drainAndSweep()` drains them into the journal on its first write per process, deleting each spooled file only after that record's journal write returns `stored` or `duplicate` — nothing captured under 0206 is lost.

## Adopted launch sites (non-interactive runs)

These framework-owned launch sites have been adopted to emit one `run-total` record per invocation:

| Script | Location | Mechanism | Verification |
|---|---|---|---|
| `scripts/probe-extension-mcp-token.sh` | Line 143 | Copilot CLI with `--usage-output-file` side channel | Live run verified; output unchanged |
| `scripts/probe-extension-mcp-token.sh` | Line 237 | Antigravity CLI with `--output-format json` + `.response` rewrite | Calibrated against real Antigravity payloads |
| `scripts/probe-antigravity-discovery.sh` | `probe_ask()` primitive | Antigravity CLI with `--output-format json` + `.response` rewrite | Isolated harness verified against stub payloads |
| `scripts/probe-extension-hooks.sh` | Lines ~206, ~235, ~256 | Copilot CLI with `--usage-output-file` | Live run verified; verdict unchanged |

**Excluded sites (with reasons):**

- `mcp list` / `mcp get` / `--version` invocations across all probe scripts — no model call, therefore no usage envelope.
- Vendor-action runs in `.github/workflows/claude.yml` and `.github/workflows/copilot.yml` — outside the framework's shell boundary; the two workflows that exist on commit `39a81c6`.
- e2e harness (`tests/e2e/lib/test-*.sh`, scenario runners) — all wrapped in `docker run --rm` against a container-internal `$HOME` that is deleted at exit. Mounting `~/.crewrig/usage` would break the harness's own isolation contract.

## Documented gaps

### Spec 0206 R22: Antigravity per-request and per-agent granularity

Antigravity's own session record exposes **no field that a token count can be tied to with confidence**. The capture seam therefore reads from the statusline channel instead, which yields session-cumulative records (`fidelity: "session-cumulative"`), not per-request ones.

**Evidence:** Antigravity's own conversation store is opaque protobuf and is not read by this adapter at all (spec 0206's adapter matrix, `specs/0206-capture-adapters.md`) — no field of that store ties to a token count. `~/.gemini/antigravity-cli/settings.json` is Antigravity's *configuration* file, the same file `statusLine.command` is wired into (see *Payload-delivery mechanism* above); it is not a session or conversation record, and `conversation_id` is a field of the statusline payload itself (see the field table above), not something `settings.json` holds. The statusline payload is therefore the only usage-bearing channel this adapter has, and it names no per-request or per-turn identifier. A vendor-documented alternative channel offering per-request granularity does not exist as of 2026-09-21. This gap is honest, documented, and will be revisited if Antigravity publishes a richer API surface.

### Gemini subagent parent-session linkage

Gemini CLI's subagent transcripts are stored in subdirectories (`chats/<parentSessionId>/<sub>.jsonl`), but the transcript header carries no `parentSessionId` field. The enclosing directory name is a human-readable hint but not an authoritative identifier.

**Evidence:** Spec 0206 R12 requires the value to come from a field the source assigns, never from file adjacency. The source does not carry it. The directory name is preserved in `raw.sourceDirectory` for human audit, and this gap is documented here.

### Headless envelopes naming no model

Antigravity CLI's run-total envelope and Copilot CLI's terminal `result` event both omit a `model` field. When `envelope.model` is absent, the record carries the sentinel `"(unreported)"`, never a value borrowed from another source (spec 0206 R30).

**Evidence:** Live runs verified on both CLIs on 2026-09-21. An unreported model is schema-valid, and downstream seams (pricing, attribution) must handle the sentinel.

### Antigravity requestInstant equals captureInstant

Antigravity's statusline channel does not report a snapshot timestamp. Therefore, `timing.requestInstant` is set to the capture instant (when the hook read the payload), not the instant the snapshot was taken.

**Evidence:** The statusline payload carries only the current snapshot data, no timestamp field. This is observable and documented rather than guessed.

### Copilot CLI cliVersion backfill caveat

On the live path, `provenance.cliVersion` comes from the first line of `session-state/<sessionId>/events.jsonl` — the version **that served the call**. On backfill, when that file is absent (16 of 100 test installations), the value is resolved from the memoized `copilot --version` — **the version present today**, which may differ from the version that served the row.

**Evidence:** Copilot CLI auto-updates without operator action; the store on this machine moved from schema v7 to v8 during the authoring window. The value is schema-valid either way, never a token count, and the asymmetry is documented here.

## Personal-data note

A usage record holds:

- **Session identifiers** (session id, project directory, conversation ids)
- **System paths** (project root, where requests were served from)
- **Model identifiers** (which model served each request, including user-chosen labels)
- **Token counts** (consumption metrics)

It does **not** hold:

- Conversation text (prompts, responses, intermediate reasoning)
- Tool invocation details
- File contents or data references

Usage records are a consumption audit, not a conversation log. Treat `~/.crewrig/usage/` with the same confidentiality you would a billing or telemetry database.
