# Usage capture architecture and mechanisms

<!-- crewrig-doc: section=reference nav_order=115 published=true title="Usage capture architecture" -->

The usage-capture seam implements spec 0206, deriving one usage record for every completed model-request a CLI source records, plus one summary record for every non-interactive CLI invocation. This page documents the capture architecture, the per-CLI adapter mechanics, the cursor semantics, the in-repo-absolute-path installation contract, and the documented gaps.

This page is one stage of the usage feature; the [usage architecture overview](usage-overview.md) shows how the stages fit together.

## Architecture overview

The capture step is a **Node module tree** under `scripts/lib/usage-capture/`, invoked by two TypeScript entry points that run as a direct `node` command line, with no POSIX shell in between (spec 0243). The `.sh` files of the same names remain as [forwarding shims](#forwarding-shims):

- **Live capture:** `hooks/usage-capture.ts` — a sibling hook to `hooks/mempalace-transcript.ts` (session recording, spec 0247), wired by in-repo absolute path into the existing `Stop` / `SessionEnd` / `AfterModel` / `agentStop` events on Claude Code, Gemini CLI, Copilot CLI, and Antigravity (statusline display). On every CLI it is enabled by a **usage-capture opt-in of its own**, independent from the MemPalace session-recording opt-in in both directions (spec 0211): capture works on a machine where MemPalace is absent, and session recording works without capture. The question defaults to `no`; once capture is registered it becomes `keep`/`remove`, and `remove` is the removal path (see *Hook wiring* below; Antigravity keeps its statusline opt-in and removal of spec 0206 R20–R21).
- **Backfill:** `scripts/usage-backfill.ts` — a command-line tool that replays the same per-CLI adapters against records already present on a machine, taking the same derivation rules the live path uses.

No storage backend, write format, or retention policy is implemented by this specification (spec 0206 R25). The capture module exposes a pure interface `sink.submit(record) → { status: 'stored' | 'duplicate' | 'rejected', reason? }` — the three outcomes spec 0207 R24 defines — and resolves to spec 0207's own storage contract: `scripts/lib/usage-store/journal.js`'s `write(record)` (see [Usage storage](usage-storage.md)). The hand-over from spec 0206's original spool is complete (see *Spool hand-over to spec 0207* below); a machine that ran 0206 before the hand-over has any leftover `~/.crewrig/usage/spool/` files drained into the journal on the next write, and `CREWRIG_USAGE_ROOT` is unchanged throughout.

### Module tree structure

```text
scripts/lib/usage-capture/
├── index.js                 # Main dispatcher: capture({ cli, event, payload })
├── hook-run.ts              # In-process runner the hooks import lazily: calls index.js, no spawned process
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

**Payload-delivery mechanism:** The hook `hooks/antigravity-statusline-shim.ts` is wired into `statusLine.command` of `~/.gemini/antigravity-cli/settings.json` (only when that value is empty; see *Installation contract* below). The shim streams the payload to the prior status-line command when one was recorded and copies that command's output through unchanged, so the user-visible display is unaffected; with no prior command it prints nothing, never the raw payload. It then runs the capture step in its own process.

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
| `raw` | Subset | Per-CLI allow-list of top-level envelope keys, each copied unaltered when present: Antigravity `conversation_id`, `status`, `duration_seconds`, `num_turns`, `usage`; Claude Code `session_id`, `modelUsage`, `usage`, `total_cost_usd`, `duration_ms`, `num_turns`; Gemini CLI `session_id` and `stats` reduced to `stats.models`; Copilot CLI `currentModel`, `modelMetrics`, `pricing`, `total_nano_aiu`, `request_multiplier`; any other CLI `session_id`, `sessionId`, `model`, `usage`. Every CLI also keeps `timestamp` and `terminal_timestamp` | Never `response`, `result`, or other conversation text (spec 0206 R18) |
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

**Source key derivation:** the lowercase SHA-256 hex digest of the decoded absolute source path, defined once as `sourceKey()` in `scripts/lib/usage-capture/cursor.js`. The hook's guard and the adapters both call that one definition (`stampPath()` builds `<usage root>/state/<cli>/<sourceKey>.stamp`), so the stamp the guard looks for is always the one capture wrote.

**Head digest mechanism:** If the first 4096 bytes of the source change (file rotation, truncation, or overwrite), the digest mismatches and the adapter resets `byteOffset` to 0, re-deriving from the file's beginning. This detects when the journal file has been replaced rather than appended to.

**Stamp sidecar:** After a successful capture pass, a zero-byte file `<sourceKey>.stamp` is touched (via `utimes()`) to the source's own mtime. The hook's guard (`hooks/usage-capture.ts`) decides from the Node.js standard library and `cursor.js` alone, without loading the capture module graph, and returns without capture work when all of these hold: a source path was obtained, it is absolute on the running platform, it names an existing file, a stamp exists for it, and the source is not newer than the stamp. The source path is the fixed `<home>/.copilot/session-store.db` for Copilot CLI and, for the other two CLIs, the top-level `transcript_path` string of the payload parsed as JSON (`transcriptPath` when that is falsy) — read from the parsed value, never from the raw text, so a Windows path escaped as `C:\\Users\\x\\t.jsonl` in the payload is decoded before any decision. A payload that does not parse as a JSON object, a missing or non-string key, a relative path, a missing file or a missing stamp all fall through to capture: a wrong guess costs one capture run, never a lost record. Node.js starts on every firing; the guard saves loading the module graph and the re-parse. This sidecar is the fast path's only visible artifact on the filesystem.

**Backfill idempotence:** A second backfill run over the same source set adds zero new records, because the sink's recordId-based dedup (via `fs.linkSync()`) recognizes records already written to the journal.

**Spec 0207 prune rule:** The 0207 implementation's prune-by-period command SHALL NOT touch `~/.crewrig/usage/state/`. Resetting a cursor would make the next backfill re-derive pruned records, defeating the retention policy. The state directory is cursor-owned and off-limits.

## Installation contract: in-repo absolute-path wiring

The capture step is wired by **in-repo absolute path**, never copied into any CLI's home directory. This is the same treatment `hooks/worktree-git-guard.ts` carries (spec 0169, spec 0248).

### Hook wiring (Claude Code, Gemini CLI, Copilot CLI)

Each CLI's interactive setup asks a usage-capture question of its own (spec 0211), after its session-recording block and whatever that block's answer was. It is never gated on MemPalace: the capture command carries no MemPalace setting, and its records go to the file-system journal of spec 0207.

The registered entries come from one **capture fragment** per CLI, holding exactly the capture events (spec 0206 R13–R14) and nothing else:

- **Claude Code:** `hooks/claude-usage-capture-hooks.json` — `Stop` and `SessionEnd`, in `~/.claude/settings.json`
- **Gemini CLI:** `hooks/gemini-usage-capture-hooks.json` — `AfterModel`, in `~/.gemini/settings.json`
- **Copilot CLI:** `hooks/copilot-usage-capture-hooks.json` — `agentStop` and `sessionEnd`, in `~/.copilot/hooks/copilot-transcript-hooks.json` (the user-level file session recording also uses)

The transcript manifests (`hooks/*-transcript-hooks.json`) carry no capture entry, so accepting session recording registers no capture command. The fragments hold the direct form `node "<token>/hooks/usage-capture.ts" <cli-id> <Event>`, with the token each CLI expands on macOS and Linux (`$CLAUDE_PROJECT_DIR`, `${GEMINI_PROJECT_DIR}`, `${COPILOT_PROJECT_DIR:-$PWD}`). Setup never installs a token: it renders each command through `scripts/hook-wiring.ts render <cli>`, which replaces the token with the physical (symlink-resolved) absolute path of the checkout's `hooks/usage-capture.ts`. The Bash setups reach that tool through `node`, and no configuration content is ever placed on a process argument list.

#### Command line per CLI

`scripts/lib/hook-command.ts` is the single source of the command line each CLI receives, in the form the interpreter that CLI uses on Windows parses (rows 37–37f of [`cli-matrix.md`](cli-matrix.md)):

| CLI | Command line | Why |
|---|---|---|
| Claude Code (Git Bash), and all four CLIs on macOS and Linux | `node "<abs>" <args>` | POSIX quoting; the path stays in double quotes, so a space works |
| Gemini CLI, Copilot CLI (Windows PowerShell 5.1) | the same text, with the absolute path spelled out | those CLIs do not expand `$GEMINI_PROJECT_DIR` or `${COPILOT_PROJECT_DIR:-$PWD}` correctly on Windows and reject a `NAME=value` prefix (row 37c); Copilot CLI only under the `command` or `powershell` key, never `bash` |
| Antigravity CLI on Windows, `statusLine.command` and the hooks surface (`cmd.exe`) | `set NoDefaultCurrentDirectoryInExePath=1&& node <abs> <args>`, path unquoted (the **guarded form**) | a double-quoted argument does not group in `cmd.exe` (row 37b), and `cmd.exe` looks a bare `node` up in the working directory before `PATH` (rows 37e and 37f); the prefix makes it skip that step |

Every absolute path uses forward slashes on Windows (rows 37b and 37d). The module refuses, names the character and the path, and writes nothing when the checkout path holds `"`, `$`, a backtick, a backslash, a carriage return or a newline; for `cmd.exe` it also refuses whitespace and any of `& | < > ^ % ( )`. Only the checkout path is judged: the `&&` and `=` of the guarded prefix belong to the template. See *Parity gaps* in [`cli-matrix.md`](cli-matrix.md) for the checkout-path-with-space case, which applies to both Antigravity CLI surfaces on Windows.

**The guarded form (spec 0243 delta-03).** On Windows, Antigravity CLI runs both of its command surfaces through `cmd /c "<command>"`. That `cmd.exe` searches the current directory for a bare `node` before `PATH`, so a `node.cmd`, `node.bat` or `node.exe` planted there runs instead of Node.js (CWE-427). The status line runs in the directory `agy` was started in, which may be any repository; the hooks run in `~\.gemini\config`. `cmd.exe` leaves out the current-directory step when the variable `NoDefaultCurrentDirectoryInExePath` exists, and `set` is a builtin that no file can replace. The variable lives only in that `cmd.exe` process and its children, so no machine policy changes. The measurement on #1392 found the guarded form running the real `node` against every planted candidate on both surfaces; rows 37e and 37f record it with its caveats.

The module produces the guarded form for a surface only when that surface's row and its entry in `MEASURED_SURFACES` record a guarded-form result in which every planted candidate was bypassed (state (e) of spec 0243 R32). In every other state it refuses the status line with the single diagnostic that state gives (unmeasured, the recorded shape, the working-directory lookup, or a hijacked guarded form, the last two naming #1392), and no row writes the hooks surface on Windows. It never reads [`cli-matrix.md`](cli-matrix.md) at run time; a test that does read it keeps the rows and the constant in step. macOS and Linux never receive the prefix.

**What the guard does not cover (R36).** It closes the implicit current-directory step of the `cmd.exe` search only. A `PATH` that itself names the current directory is not covered: a `.` entry, an empty entry, a relative entry, or an entry the user can write that comes before the real `node`. The module never reads, rewrites or judges `PATH`. Recovery: remove such an entry; it is machine configuration, outside setup's writes.

#### Recognition and rewrite on the next setup run

A capture command is recognised by its whole shape: an optional interpreter or environment prefix (`bash`, `sh`, `node`, `env`, `NAME=value`), then a script path ending in `/hooks/usage-capture.sh` or `/hooks/usage-capture.ts`, double-quoted, single-quoted or bare, then exactly the arguments `<cli-id> <Event>`, where `<cli-id>` is `claude-code`, `gemini-cli` or `copilot-cli`. The path may point anywhere. This covers every form crewrig wrote: the direct form, the `bash "<abs>/hooks/usage-capture.sh"` form and the former coupled deployment's commands, the unquoted Gemini one included. An operator hook that runs a script of the same name with other arguments, or that chains it behind another command, is not a capture command: setup never counts, keeps, rewrites, re-points or removes it. The Bash library (`scripts/lib/usage-capture-optin.sh`, now a forwarding function shim) and the TypeScript module (`scripts/lib/hook-recognition.ts`) accept and reject the same commands, proven by one shared corpus (`scripts/tests/fixtures/usage-capture/recognition-corpus.json`) that both suites run.

On every run of a setup script, a machine that already has a capture command registered and does not remove it is brought to the direct form:

- **Rewrite.** Each legacy command becomes `node "<abs>/hooks/usage-capture.ts" <cli-id> <Event>`, in the shape of the table above. Event, selector, key order, every other key and every other entry are kept exactly as they were.
- **Only where the target exists.** A command whose path points at another checkout is rewritten only when a `hooks/usage-capture.ts` sits next to the registered `.sh`. Otherwise it is left as it is — it still works through that checkout's own shell script — and setup says why.
- **One command per event.** When an event holds a legacy and a direct command, exactly one survives, chosen by the live-path rule of spec 0211 R11: the first whose path resolves, else the first whose path cannot be judged (relative, or holding `$` or `~`), else the first.
- **Idempotent.** A second run writes nothing and creates no backup.
- **Reported.** Setup names each command it rewrote, left or dropped as a duplicate, with the event and the reason, and ends with a count (`rewrote N, left M, dropped K duplicate(s)`). The disclosure printed before enabling capture names the direct form and the Node.js 24 requirement.

The rewrite is parameterised by a hook descriptor (script basename, argument shape, per-CLI arguments), so the other hook rows register a descriptor without changing the mechanism.

The question depends on what is already registered:

- **Nothing registered:** `no`/`yes`, default `no`. Setup first discloses the events, the path, the file it changes, that no prompt or response text is recorded, and that MemPalace is not required. An empty or canceled answer is `no`: nothing is written, and setup prints how to enable capture later.
- **Already registered:** `keep`/`remove`, default `keep`.
  - `keep` rewrites to the direct form as above and leaves exactly one capture command per event. It re-points a command only when its path no longer resolves, and says so. A path setup cannot judge is never treated as gone and is left as it is.
  - `remove` backs the file up, deletes every capture command, and deletes a matcher group or an event key only when that deletion emptied it. Every other entry is as it was. When enable created the file, the file stays, holding the empty shell capture was added to (`{}` on Claude Code and Gemini CLI, `{"version": 1, "hooks": {}}` on Copilot CLI). `remove` adds no Node.js requirement of its own beyond the setup entry's (Node.js 24).

Every read and write of a capture entry goes through the setup module `scripts/lib/setup/usage-capture.ts` (reached from the Bash callers through the forwarding function shim `scripts/lib/usage-capture-optin.sh`) and `scripts/hook-wiring.ts`. Each write backs up an existing file first, ends at mode 0600, leaves every other hook entry and every non-hook setting as it was, refuses a configuration that is not a JSON object, and leaves the file byte-identical when it fails. Backups are owner-only too: each is created at 0600, earlier `<file>.bak.*` copies the user owns are narrowed to 0600, and a symbolic link is never followed, since a configuration may hold the MemPalace bearer token. The session-recording opt-in writes through the same library, so it never removes, duplicates or re-points a registered capture command.

**Node.js floor at setup.** Setup never writes the direct form when the `node` it finds runs a major version below 24, and the disclosure does not render either: it runs the floor guard (`scripts/lib/node-floor-guard.js`), prints its diagnostic, and leaves every installed command as it is.

On Gemini CLI, setup merges `~/.gemini/settings.json` in place (spec 0214): it never rebuilds the file from its template, so every hook entry survives a re-run whatever the answers. A re-run that declines (or cancels) session recording leaves the session-recording hooks and the worktree git guard an earlier run registered in place, and setup says so, as Claude Code and Copilot CLI do on the same re-run. The guard's command is the one exception to "as it was": every setup run rewrites it to the direct `node` form, whatever the answer (spec 0248 R30), which keeps the registered hook and removes nothing.

The hook is **never copied** to `~/.claude/hooks/`, `~/.gemini/hooks/`, or `~/.copilot/hooks/`. Its whole job is to reach `scripts/lib/usage-capture/`, so it lives at the repository path where that module tree is a sibling.

### Forwarding shims

`hooks/usage-capture.sh` and `hooks/antigravity-statusline-shim.sh` remain, each reduced to a shim that invokes its TypeScript counterpart with the arguments and standard input it received. An installation whose registered command still names the `.sh` path therefore keeps capturing until setup rewrites it. The capture shim exits zero with both streams empty on every failure, including a `node` missing from the search path, and does not `exec`, so that Node.js's own status never reaches the CLI. The status-line shim redirects nothing, because the prior status-line command's output must still reach Antigravity CLI.

### Statusline wiring (Antigravity CLI)

`hooks/antigravity-statusline-shim.ts` is installed into `statusLine.command` of `~/.gemini/antigravity-cli/settings.json` **only when that value is empty** (spec 0206 R20). The prior value and the installed command are recorded in `<usage root>/state/antigravity-statusline.json` (`priorStatusLineCommand`, `installedStatusLineCommand`). Removal restores exactly the prior value (spec 0206 R21).

The command is written by `scripts/hook-wiring.ts statusline install` in the same form as the table above (`node "<abs>/hooks/antigravity-statusline-shim.ts"` on macOS and Linux) and is not copied to `~/.gemini/antigravity-cli/`. On a later setup run, `statusline rewrite` moves a legacy `.sh` command to the direct form in three ordered writes: the marker with the new command as installed and the old one as a transitional `previousInstalledStatusLineCommand`, then the settings file, then the marker again without the transitional key. Setup recognises the status line as the framework's when it equals either recorded value, so a crash between two writes still leaves a state the next run resolves, and the framework's own status line never reads as foreign.

On Windows the command is the guarded form `set NoDefaultCurrentDirectoryInExePath=1&& node <abs>/hooks/antigravity-statusline-shim.ts` (see *Command line per CLI*). Setup treats it as follows (spec 0243 R34):

- **Recognition.** Only the exact prefix counts: `set`, one space, the variable name in this letter case, `=1`, `&&` with no space before it, one space, then `node`, an unquoted forward-slash absolute path and the shim's arguments. `keep` writes nothing for it and creates no backup, `remove` restores the prior command as before, and a re-point rebuilds it from the registered checkout. Any byte of difference — another variable, a second `set`, a space before `&&`, another letter case, a quoted path, other arguments — makes it an unrecognised shape: setup leaves it byte-identical and reports it. The usage-capture signature never accepts the prefix. An operator who wants a `set …&&` prefix of their own keeps it outside the framework's command.
- **Upgrade.** A framework status line still in the bare `node <abs>` form is rewritten to the guarded form on the next run, in the three ordered writes above, after a 0600 backup, and the rewrite is reported. When the guarded form cannot be produced (the entry is not in state (e)), the bare command is left byte-identical and reported with the status-line diagnostic: it is never kept silently as if it were current.
- **Propagation (R35).** The variable is inherited by `node` and by every process it starts, including the prior command the shim hands to `%ComSpec%`. That prior command and anything it launches therefore no longer find a program in the current directory without a path. This is intended: a prior status line that relied on that lookup was exposed to the same hijack. When the marker records a non-empty `priorStatusLineCommand`, setup's install and rewrite messages say that it now runs with the current-directory lookup disabled. Recovery: name that program by an explicit path in the prior command.
- **Not covered (R36).** A `PATH` entry that names the current directory, as stated under *Command line per CLI*. Recovery: remove the entry.

The Antigravity CLI hooks surface receives the same guarded form, recognised the same way, once rows C2 and C3 wire it; every process a guarded hook launches inherits the variable too.

To run the prior command, the shim hands it, with the payload on standard input, to the platform's default command interpreter (`sh` on macOS and Linux, `%ComSpec%` on Windows, never a POSIX shell there). It copies the command's standard output byte for byte and lets its standard error through. A prior command that exits non-zero, cannot be started or closes its input early changes neither the shim's output nor its exit status, and capture still runs.

### Checkout-location dependency

Moving, renaming, or deleting the checkout breaks the wired absolute path. The triggering CLI then sees a non-zero status from a command that never started, and no capture runs.

**This is the accepted cost of the in-repo absolute path** — the same cost `hooks/worktree-git-guard.ts` has carried since spec 0169 (its `.sh` path is now a forwarding shim, spec 0248), and the one session recording carries since spec 0247 wired `hooks/mempalace-transcript.ts` the same way (`docs/cli-matrix.md` row 8b): a moved checkout stops the recording, and re-running setup from a durable checkout repairs it. Mitigations, in order of operator experience:

0. **Linked-worktree protection:** Each installer calls `warn_if_linked_worktree` and warns when the checkout is a linked git worktree (detected via `git rev-parse --git-common-dir` differing from `.git`). The warning message is:

   ```text
   WARNING: this checkout is a linked git worktree (<path>).
            The usage capture wiring above points INTO this checkout — running
            'git worktree remove' on it breaks the wired hook silently
            until this installer is re-run against a durable checkout.
   ```

   **Recommendation:** Run the installers from the main checkout, not from a linked worktree created via `git worktree add`.

1. Each installer prints the wired absolute path at install time, so the dependency is disclosed rather than discovered.
2. `docs/usage-capture.md` (this file) states the dependency and names the recovery: re-run the installer from a durable checkout. On Claude Code, Gemini CLI and Copilot CLI, answering `keep` at the usage-capture question re-points a registered command whose path no longer resolves at that checkout's capture script, and reports each re-pointed path (spec 0211 R11).
3. The data itself is recoverable regardless: `node scripts/usage-backfill.ts --reset-cursors` re-derives from the CLIs' own durable history everything a dead live path missed. Run `node scripts/lib/node-floor-guard.js` first on an unverified Node.js: the commands need Node.js 24 or later.

### Runtime requirement: Node.js 24 at firing time

The hooks are `node` command lines that Node.js runs by stripping types, which needs **Node.js 24 or later when the hook fires**. Setup checks the floor before it writes the direct form (see *Node.js floor at setup*), but nothing checks it afterwards. A Node.js downgraded after setup makes the hooks fail with Node.js's own non-zero status, and the triggering CLI reports a hook error, until setup is re-run on a supported Node.js. For Claude Code, Gemini CLI and Copilot CLI, the records a failing hook missed can be re-derived with `node scripts/usage-backfill.ts`.

A legacy `.sh` command that setup has not rewritten yet runs the same TypeScript file through its forwarding shim. On a Node.js below 24 the capture shim still exits zero with both streams empty, so capture stops without any visible error until Node.js is upgraded; the status-line shim exits zero too, but lets Node.js's own error text through on standard error.

### Exit status and blocking

The hooks exit with status zero and write nothing to standard output or standard error on every failure (spec 0206 R15), so that a capture problem never reaches the CLI. Two deliberate exceptions exist, both for `hooks/usage-capture.ts` only:

- **Missing dependency (spec 0243 R12).** If a package a later change adds cannot be resolved when the hook fires, the hook writes one line naming the package and telling the user to re-run setup, and exits with status **1**. It never exits with status 2, which some CLIs read as "block". No third-party package is imported today, so no firing takes this path yet.
- **Downgraded Node.js.** Node.js's own status, as described above.

The status-line shim exits zero in every configuration.

Whether status 1 lets the turn continue is a property of each CLI and of each event. The table below quotes the vendors' own pages for the exact events the capture hooks are wired to. The pages were retrieved as raw text on 2026-09-30 (the Claude Code and Gemini CLI `.md` renderings, and the HTML of the Copilot page) and read sentence by sentence, not through a summarising fetch tool. The hook writes its one diagnostic line to standard error only and leaves standard output empty, so the clauses below that depend on standard output apply with empty output.

**None of the three pages documents status 1 as blocking, or as altering the turn, for a wired event.** The probe of 2026-10-01 (last column, method below) confirms it on every wired event.

| CLI and event | Source | Vendor text on status 1 or non-zero | Status 1 blocks the turn? | Status |
|---|---|---|---|---|
| Claude Code `Stop` | [`code.claude.com/docs/en/hooks#other-exit-codes`](https://code.claude.com/docs/en/hooks#other-exit-codes) and [`#exit-code-2-behavior-per-event`](https://code.claude.com/docs/en/hooks#exit-code-2-behavior-per-event), retrieved 2026-09-30 | "Without valid JSON on stdout, Claude Code treats exit code 1 as a non-blocking error and proceeds with the action, even though 1 is the conventional Unix failure code." With empty stdout, "it's a non-blocking error for most hook events: the action proceeds, and the transcript shows a `<hook name> hook error` notice". `Stop` has no row of its own for status 1; its row in the exit-2 table reads "Prevents Claude from stopping, continues the conversation", which is the behaviour of status 2 | No. The page names `WorktreeCreate` and `WorktreeRemove` as the events where any non-zero status acts, and `Stop` is not one of them. A hook-error notice appears in the transcript | probed 2026-10-01 (macOS, Claude Code 2.1.285): does not block, and Claude does not continue the conversation. Interactive transcript shows `Stop hook error: Failed with non-blocking status code: <stderr line>`; headless prints nothing |
| Claude Code `SessionEnd` | [`code.claude.com/docs/en/hooks#other-exit-codes`](https://code.claude.com/docs/en/hooks#other-exit-codes) and [`#sessionend`](https://code.claude.com/docs/en/hooks#sessionend), retrieved 2026-09-30 | The same two sentences as for `Stop`. The exit-2 table marks `SessionEnd` as not able to block and gives "Shows stderr to user only", and the event's section says "SessionEnd hooks have no decision control. They can't block session termination but can perform cleanup tasks." | No. The session ends whatever the status | probed 2026-10-01 (macOS, Claude Code 2.1.285): does not block. The terminal shows `SessionEnd hook [<command>] failed: <stderr line>` after exit, headless and interactive |
| Gemini CLI `AfterModel` | [`geminicli.com/docs/hooks/reference#global-hook-mechanics`](https://geminicli.com/docs/hooks/reference#global-hook-mechanics) and [`#aftermodel`](https://geminicli.com/docs/hooks/reference#aftermodel), retrieved 2026-09-30 | Global mechanics: "`Other`: Warning. A non-fatal failure occurred; the CLI continues with a warning." The `AfterModel` entry lists one exit status only: "Exit Code 2 (Block Response): Aborts the turn and discards the model's output." It says nothing about status 1, so the global rule is the only text that covers it | No. Status 1 falls under `Other`, which the page calls a non-fatal warning. Only status 2, and the JSON fields `decision: "deny"` and `continue: false`, abort the turn | probed 2026-10-01 (macOS, Gemini CLI 0.46.0): does not block; the response is kept. A `Hook(s) [<name>] failed for event AfterModel` warning (interactive) or `Hook system message: Warning: <stderr line>` (headless) appears, once per firing |
| Copilot CLI `agentStop` | [`docs.github.com/en/copilot/reference/hooks-configuration#exit-codes-for-command-hooks`](https://docs.github.com/en/copilot/reference/hooks-configuration#exit-codes-for-command-hooks) and [`#hook-events`](https://docs.github.com/en/copilot/reference/hooks-configuration#hook-events), retrieved 2026-09-30 | "Other non-zero: Logged as a hook failure. The run continues (fail-open). Exception: `preToolUse` is fail-closed". Also "For most events, non-zero exits and timeouts are logged and skipped—agent execution continues." The events table marks `agentStop` "Output processed: Yes — can block and force continuation", which is done with `decision: "block"` in the hook's JSON output, not with a status | No. `preToolUse` is the only event the page makes fail-closed. The hook prints no JSON, so the `agentStop` block path is never taken | probed 2026-10-01 (macOS, Copilot CLI 1.0.87): does not block or force continuation. No visible notice; logged only |
| Copilot CLI `sessionEnd` | [`docs.github.com/en/copilot/reference/hooks-configuration#exit-codes-for-command-hooks`](https://docs.github.com/en/copilot/reference/hooks-configuration#exit-codes-for-command-hooks) and [`#hook-events`](https://docs.github.com/en/copilot/reference/hooks-configuration#hook-events), retrieved 2026-09-30 | The same two sentences as for `agentStop`. The events table marks `sessionEnd` "Output processed: No" | No. The session terminates and no hook output is read | probed 2026-10-01 (macOS, Copilot CLI 1.0.87): does not block. No visible notice; logged only |
| Antigravity CLI | none | `hooks/antigravity-transcript-hooks.json` carries no capture hook | Not applicable: the status-line shim always exits zero. Its hook exit semantics are unmeasured (the vendor `hooks.md` cited under *Documented gaps* was not available for this check) | not applicable |

An earlier revision of this section said that Copilot CLI does not process the output of `agentStop`. The page says the opposite: `agentStop` output is processed, and a `block` decision forces another turn. That does not change the conclusion for status 1, but it is why the hook must keep printing nothing to standard output on that event.

Status 2 is never probed, because it blocks on Claude Code `Stop`. If a probe shows that status 1 blocks a CLI's turn, that CLI's exit-1 behaviour is not shipped: the path becomes a delta of spec 0243 that exits zero with the diagnostic only.

**R12 was confirmed on the wired events.** On 2026-10-01 a direct project-scoped hook was registered on exactly the events `hooks/*-usage-capture-hooks.json` wires, in the same entry shape. It wrote one line to standard error, nothing to standard output, and exited with status 1; one real turn per CLI ran headless and interactive, and every wired event fired each time. Full results: [issue #1398](https://github.com/crewrig/crewrig/issues/1398#issuecomment-5935751970). The case `X1` of the spec 0237 probe (`record <cli> X1 --exit 1`) still fires on each CLI's prompt event (`UserPromptSubmit`, `BeforeAgent`, `userPromptSubmitted`, see `docs/runbooks/windows-hook-parsing-probe.md`), so it does not by itself cover `Stop`, `SessionEnd`, `AfterModel`, `agentStop` or `sessionEnd`.

**Where the R12 diagnostic is visible is an accepted gap (spec 0243 R37).** Writing the line to standard error does not by itself make it reach the user. The same probe measured what the user sees, on macOS, on every wired event, headless and interactive ([issue #1398](https://github.com/crewrig/crewrig/issues/1398#issuecomment-5935751970)):

- **Claude Code 2.1.285** (`Stop`, `SessionEnd`) shows it once per event. On `Stop`, the transcript shows `Stop hook error: Failed with non-blocking status code: <line>`, in interactive mode only. On `SessionEnd`, the terminal shows `SessionEnd hook [<command>] failed: <line>` after exit.
- **Gemini CLI 0.46.0, interactive** (`AfterModel`) shows a generic notice once per firing: `⚠ Hook(s) [<name>] failed for event AfterModel. Press F12 to see the debug drawer for more details.` The diagnostic text itself, the package name and "re-run setup", appears only in the debug drawer behind F12.
- **Gemini CLI 0.46.0, headless** (`AfterModel`) prints the line itself on standard error, `Hook system message: Warning: <line>`, once per firing.
- **Copilot CLI 1.0.87** (`agentStop`, `sessionEnd`) shows nothing. The failure reaches only `~/.copilot/logs/process-*.log` (`[ERROR] [rust:hooks] … Hook command failed with code 1`, then the standard-error line), so a Copilot CLI user is not told to re-run setup.

On Gemini CLI, in both modes, `AfterModel` fires once per streamed chunk (three times for a one-word reply), so the notice or the line can repeat several times in one turn. The measurement covers macOS only; Linux and Windows visibility was not measured. Antigravity CLI is out of reach: no capture hook is wired for it, and its status-line shim always exits zero (spec 0243 R14).

This state is accepted as an explicit gap for as long as spec 0243 R11 holds. No entry point imports a third-party package, so no firing takes the R12 path and no user can meet the gap. See also *Parity gaps* in `docs/cli-matrix.md`.

**Obligation on the change that makes the path reachable (spec 0243 R38).** The trigger is the first change that makes `hooks/usage-capture.ts`, or a module it loads, depend on a third-party package; that change must also amend R11. In the same pull request it must:

- (a) make the diagnostic reach the user on every CLI whose capture fragment wires `hooks/usage-capture.ts`, during the session or at its end. A line written only to a log file does not count, nor does a generic notice that does not show the diagnostic text itself, such as the interactive Gemini CLI notice. Where a CLI offers no surface that reaches the user, the change records a per-CLI `[GAP]` in `docs/cli-matrix.md` → *Parity gaps* with that evidence instead;
- (b) show the diagnostic at most once per turn on Gemini CLI, whatever the number of `AfterModel` firings;
- (c) keep the exit-status contract of R12, never status 2, and probe any exit status or standard-output content its mechanism adds on each wired event, as #1398 did, to show it does not block or alter the turn;
- (d) cite here one probe result per wired CLI and event, recorded on its ticket, showing the outcome of (a) and (b).

The mechanism is left to that change. A setup or doctor check may complement an in-session surface but cannot satisfy (a) on its own, and a review of that change treats a missing item (a) to (d) as unmet.

## Backfill command

```bash
node scripts/usage-backfill.ts [--reset-cursors]
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

## Attribution resolution and the sidecar

When `submit(record, ctx)` hands the record to the storage contract, the record's attribution is resolved from one of four ordered channels (spec 0208 R1): explicit human declaration, the `CREWRIG_TASK` environment variable, the current worktree or branch, or the session-start protocol. Attribution is a **one-time resolution** — once resolved at hand-over, it is never re-derived, and the journal entry itself stays byte-identical to what capture produced (spec 0208 R16).

The resolving channel and its outcome (attributed or unattributed, with failure reason if validation failed) are recorded in a `.attr.json` sidecar beside the journal entry, for durable, inspectable audit without mutating the record schema (which closes on exactly `taskHandoffKey` and `externalAsset` fields). Backfill performs the same resolution over historical records, using the same pure `resolveAttribution(record, ctx)` function; context for backfill sets `declarations: false` and `cwd: null` to disable the live channels (channels 1, 3, 4) and resolve only from `CREWRIG_TASK`, so a historical record has no attribution unless the environment explicitly provides one.

See [Usage attribution](usage-attribution.md) for the full contract, the channels, the declaration record, the ledger, and rollup surfaces.

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

**Evidence** (the full chain is also recorded in `docs/cli-matrix.md` → *Parity gaps* → usage-capture granularity; each link is independent):

1. **No hook payload carries usage.** The vendor's own `~/.gemini/antigravity-cli/builtin/skills/agy-customizations/docs/hooks.md`, read field by field, lists no token or model field on any event (#1167 triage).
2. **The session store is opaque.** The per-conversation store a hook's `transcriptPath` points at is sqlite whose payload columns are protobuf blobs with no shipped `.proto`; no field could be tied to a token count with confidence (#1167, #1169). This adapter does not read it.
3. **No local telemetry exporter.** Telemetry is outbound-only (`enableTelemetry`, internal `AnalyticsService`) and the binary carries no `OTEL_*` string (#1167).
4. **Independent upstream reproduction.** On [google-antigravity/antigravity-cli#366](https://github.com/google-antigravity/antigravity-cli/issues/366) ("Support Gemini CLI-compatible OTLP/OpenTelemetry token usage export", open as of 2026-09-24, no maintainer decision), a [2026-07-31 comment](https://github.com/google-antigravity/antigravity-cli/issues/366#issuecomment-5140583537) reproduces the gap with commands and outputs: `agy --output-format=json --print="…"` returns a `usage` object for a print-mode run (the run-total the headless envelope channel already captures), `--log-file` output holds zero `token` or `usage` matches, the `conversations/*.db` payload columns are protobuf blobs in which only one of five known token counts could be located, and `OTEL_*` variables produce nothing — "interactive use is not measurable by any route I could find".

`~/.gemini/antigravity-cli/settings.json` is Antigravity's *configuration* file, the same file `statusLine.command` is wired into (see *Payload-delivery mechanism* above); it is not a session or conversation record, and `conversation_id` is a field of the statusline payload itself (see the field table above). The statusline payload is therefore the only usage-bearing channel this adapter has, and it names no per-request or per-turn identifier. Revisit when #366 ships.

### Gemini CLI trigger measurement

The Gemini capture step rides `AfterModel` only; `AfterAgent` stays unregistered (spec 0206 R14: an extra end-of-turn event only after a measurement shows `AfterModel` insufficient). The measurements behind that choice, from the spec 0206 pre-freeze probes on #1169:

- **Probe 1** — `AfterModel` fires **5 times per prompt** (streaming chunks); its payload carries only partial `usageMetadata`, so the session record stays the source and the hook is the trigger.
- **Probe 7** — a full re-parse of the largest source measured costs **~142–168 ms** worst case (a Claude Code session deduplicated to 3,376 records). No Gemini-specific re-parse timing was taken; the figure is the cross-CLI worst case.
- **PLAN v3 estimates, not probe results** — Node start-up adds an estimated **~40–60 ms** per spawn, and the stamp test (see *Cursor semantics and the stamp sidecar*) was expected to keep 4 of the 5 firings from spawning Node. That 4-of-5 figure is a PLAN v3 assumption, not a measurement, and it described the shell wrapper: since spec 0243 every firing starts Node.js, and the guard only spares the firings it clears the loading of the capture module graph. The fast path compares modification times (`hooks/usage-capture.ts`: the source must not be newer than its stamp), not record content, so any write to the session file during the turn, the user's own message included, sends that firing down the slow path. Neither figure was measured; the budgets of spec 0243 R15 (750 ms fast path, 2000 ms slow path, measured on `windows-latest`) bound the per-firing cost instead.

A Gemini-specific timing that shows the per-firing cost too high is the measurement R14 names; until one exists, registering `AfterAgent` would be an unmeasured extra event.

### OpenTelemetry oracle — abandoned

Spec 0206 → *Out of scope* deferred native OpenTelemetry export, as an oracle or enrichment layer, to a later ticket. That ticket was not opened: the user ratified abandoning it on #1174 (2026-09-24, recorded on epic #1166). Reasons:

- It covers at most two CLIs of four: Claude Code has no file exporter (an OTLP receiver process would be needed) and Antigravity exposes none (see the R22 evidence above).
- #1169 probe 9 showed Gemini's `telemetry.outfile` is concatenated raw SDK objects, not OTLP; its Gemini-specific `token.usage` metric dropped a second model's points in an auto-routed turn, so only the `gemini_cli.api_response` events (which do carry all six token fields) could serve, through one more bespoke parser; and `logPrompts` defaults to `true`, writing response text to disk unless overridden.
- Enabling it repurposes the user's own CLI telemetry configuration.

Copilot CLI does ship such an exporter (`COPILOT_OTEL_FILE_EXPORTER_PATH`, content capture off by default), but it reports the same vendor accounting the adapter already reads per call from `assistant_usage_events`, so as an oracle it would only catch a silent semantic drift. Shape drift stays covered by the per-generation fixtures (spec 0206 R27) and `uncaptured` emission on an unknown fingerprint. **Reopen condition:** a drift in a CLI's own record reaches the store undetected by the fingerprint and fixture guard (a mis-derived record found after the fact), or Claude Code ships a local file exporter — whichever comes first.

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

This section states what the capture seam itself keeps. What a usage record holds, and never holds, is stated in [Usage storage → Personal data](usage-storage.md#personal-data).

- **Capture state.** `<usage root>/state/` holds the per-source cursors and stamp sidecars (read positions in each CLI's own session record, keyed by a hash of the source path), the memoized CLI versions, and the Antigravity status-line marker, which records the prior and the installed `statusLine.command`. See [Cursor semantics and the stamp sidecar](#cursor-semantics-and-the-stamp-sidecar).
- **No staged hook payload on the default path.** `hooks/usage-capture.ts` and `hooks/antigravity-statusline-shim.ts` read the payload the CLI gives them from standard input into memory and pass it to the capture step in the same process. They write it to no file outside the usage root's own record files, so the transient payload file the former shell wrappers created, and the hazard of a killed hook leaving it behind, no longer exist for a hook that fires (spec 0243 R10). The forwarding `.sh` shims only pipe standard input through. The one exception is the test-only override (`CREWRIG_USAGE_CAPTURE_TEST` and `CREWRIG_USAGE_CAPTURE_CLI` both set), which stages the payload in an owner-only (0600) temporary file for one call and removes it when the call returns. What the CLIs' own payloads can carry is unchanged and is why the hook never persists them: the CLIs' hook documentation, checked on 2026-09-24, lists the model request and response in Gemini CLI's `AfterModel` payload (`llm_request`, `llm_response`) and the turn's last assistant text in Claude Code's `Stop` payload (`last_assistant_message`). The non-interactive wrapper `scripts/lib/usage-headless.sh` still stages the whole output of a run wrapped by `usage_headless_run` in a temporary file, without a trap, and that file can hold the model's reply text. `usage_headless_agy_rewrite_json_response` stages no reply: it rewrites the caller's own output file in place.
- **What adapters copy into `raw`.** Each interactive adapter copies only the key paths its table in [Per-adapter field sources](#per-adapter-field-sources) enumerates, never message content. The headless envelope adapter also copies only an allow-listed subset of the envelope (see [Headless envelope](#headless-envelope-run-total-all-clis)), never the reply text or tool input the envelope carries.

Retention, who can read each location, and removal are stated once for the whole feature, in the [organization note](usage-organization.md).
