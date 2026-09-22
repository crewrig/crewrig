# Usage attribution

<!-- crewrig-doc: section=reference nav_order=135 published=true title="Usage attribution" -->

The usage attribution contract (spec 0208) resolves every usage record to the macro-task it served — either a CrewRig task-handoff key from the session-start protocol or another ticketing system, or an external work-tracking asset such as a forge issue — and provides an append-only ledger to correct or override that attribution after the fact without touching the record itself. A record's attribution resolves once, at capture time, from exactly one of four ordered declaration channels, and no later mutation of the record ever changes what resolution produced.

## What attribution is

**Attribution** answers the question "what task was this usage record serving?" A record carries no task information at capture time; attribution is resolved later, when the record is handed to storage, by evaluating four possible sources in fixed order:

1. **Explicit human declaration** — the operator has declared a task explicitly via the `usage-task.sh` command.
2. **Environment variable** — the `CREWRIG_TASK` environment variable names a task.
3. **Worktree or branch derivation** — the current directory's own worktree path (`.worktrees/<NNNN>`) or checked-out branch name matches a CrewRig ticket-branch convention.
4. **Session-start protocol** — the framework's own session-start protocol has established or resumed a task-handoff drawer for this session and recorded its key.

A record for which **none** of the four channels produces a valid value carries no attribution, recorded as `unattributed` together with the name of the first present channel and its validation failure.

**Resolution** evaluates the four channels in the fixed order above and stops at the first channel that is present — one that supplies a candidate value at all. A lower-ranked channel is never consulted, even if the first present channel's value fails validation.

## Declaration channels

### Channel 1: Explicit human declaration

The operator declares a task-handoff key and/or an external asset reference explicitly:

```bash
bash scripts/usage-task.sh set --channel explicit --task-key 1171
bash scripts/usage-task.sh set --channel explicit --asset forge-issue:crewrig/crewrig#1171
bash scripts/usage-task.sh set --channel explicit --task-key 1171 --asset forge-issue:crewrig/crewrig#1171
```

A later explicit declaration replaces the earlier one in full (R2 — "full replacement, never merge"). This channel carries the highest priority.

### Channel 2: Environment variable

The `CREWRIG_TASK` environment variable, when set, declares a task-handoff key and/or an external asset reference:

```bash
CREWRIG_TASK=1171 bash scripts/usage-capture.sh
CREWRIG_TASK='forge-issue:crewrig/crewrig#1171' bash scripts/usage-capture.sh
CREWRIG_TASK='1171:forge-issue:github.com/owner/repo#number' bash scripts/usage-capture.sh  # both key and asset
```

The syntax is `<key>`, `<kind>:<ref>`, or `<key>:<kind>:<ref>` (colon-delimited). This channel is present when the variable is set and non-empty.

### Channel 3: Worktree or branch derivation

When the session runs inside a CrewRig worktree (`.worktrees/<NNNN>/` directory) or on a ticket-branch (branches matching `<prefix>/<NNNN>-<slug>`), the ticket identifier is derived entirely offline from filesystem data — the `.git/` directory structure, the `HEAD` file, and the git config — without any subprocess call:

1. **Worktree path** — the segment `.worktrees/866/` yields ticket `866`.
2. **Spec-file resolution** (for spec-branch `spec/<NNNN>-<slug>` or `spec/<NNNN>-<slug>-delta-<NN>`) — the spec file `specs/<NNNN>-<slug>.md` or `specs/<NNNN>-<slug>.delta-<NN>.md` is read; if present and carries a `related-issue: <NNNN>` field, that ticket number becomes the task-handoff key.
3. **Ticket-branch grammar** (for branches matching `<prefix>/<NNNN>-<slug>` where the prefix is not `spec/`) — the ticket number `<NNNN>` is extracted directly.

When a ticket identifier is resolved, the channel additionally derives a `forge-issue` external asset reference (if a recognized forge is reachable):

- The checked-out branch's own configured upstream remote is consulted first; if none exists, the remote named `origin` is used (R8).
- The remote's URL is parsed entirely offline (no network call) to extract the host and owner/repository pair.
- If the host is `github.com` or `gitlab.com` (or a custom host named via `CREWRIG_FORGE_HOSTS`), a `forge-issue` asset is populated as `<owner>/<repo>#<ticket>`.
- If no qualifying remote is found or the remote URL's host is not recognized, the ticket-handoff key alone is returned, together with a stated reason explaining which rule step found no qualifying remote.

Examples:
- `.worktrees/1171/` on a branch with `origin` pointing at `git@github.com:crewrig/crewrig.git` → `taskHandoffKey: "1171"`, `externalAsset: {kind: "forge-issue", ref: "crewrig/crewrig#1171"}`.
- `spec/0208-usage-attribution` on a branch with upstream `hcross` (a fork pointing at `git@github.com:hcross/crewrig.git`) → `taskHandoffKey: "1171"` (from `related-issue`), `externalAsset: {kind: "forge-issue", ref: "hcross/crewrig#1171"}` (from the fork's own upstream).
- The fork-remote residue (R8's documented limitation): a fork clone derives a different `forge-issue` asset ref than a canonical clone for the same task-handoff key — the key itself is unaffected. This is the one case a task key is textually identical across CLIs but its external asset is not. **Recourse:** declare the task explicitly via `--channel explicit` to bypass this derivation and assert the asset you intend.

### Channel 4: Session-start protocol

When the framework's own session-start protocol establishes or resumes a task-handoff drawer, it records the drawer's own task-handoff key with `declaringChannel: "protocol"`. This channel is present only when the session-start protocol has run; a session that never enters the protocol (for instance, a historical backfill or a capture outside the framework) leaves this channel without a candidate value.

This channel carries the lowest priority and is consulted only when channels 1, 2 and 3 are all absent.

## The declaration record

A session's declaration record is a JSON file that holds:

```json
{
  "taskHandoffKey": "1171",
  "declaringChannel": "explicit",
  "timestamp": "2026-09-22T10:00:00Z"
}
```

or:

```json
{
  "taskHandoffKey": "1171",
  "externalAsset": {"kind": "forge-issue", "ref": "crewrig/crewrig#1171"},
  "declaringChannel": "protocol",
  "timestamp": "2026-09-22T10:00:00Z"
}
```

### Writing the declaration record

The `bash scripts/usage-task.sh set` command writes a declaration record:

```bash
bash scripts/usage-task.sh set --channel explicit --task-key 1171 [--session <sessionId>]
bash scripts/usage-task.sh set --channel protocol --task-key 1171 [--session <sessionId>]
```

Optionally, an external asset reference may be included:

```bash
bash scripts/usage-task.sh set --channel explicit --asset forge-issue:crewrig/crewrig#1171
bash scripts/usage-task.sh set --channel explicit --task-key 1171 --asset jira-key:ORC-42
bash scripts/usage-task.sh set --channel explicit --asset shared-file:/path/to/doc.md
bash scripts/usage-task.sh set --channel explicit --asset shared-file:https://example.com/shared-doc
```

A later write replaces the record in full (R2). The `declaringChannel` field distinguishes human-authored declarations (`explicit`) from framework-authored declarations (`protocol`), each with its own semantics (R3).

### Scopes

The declaration record is scoped in one of two ways:

- **Session scope** — when `CREWRIG_SESSION_ID` is set or `--session <id>` is passed, the record is session-specific and lives under `<root>/declarations/session/`.
- **Project scope** — otherwise, the record is project-specific, keyed on the current working directory's checkout root (or its nearest ancestor holding `.git/`, or a hash of the directory path as a fallback), and lives under `<root>/declarations/project/`.

When reading, both scopes are consulted, and the scope with the later timestamp wins (latest-timestamp-wins rule, R2). A project-scope declaration older than `CREWRIG_TASK_DECLARATION_TTL_MS` (default 12 hours) is discarded as stale.

### The `usage-task` command surface

```bash
task usage:task             # Alias for the command below
bash scripts/usage-task.sh set --channel explicit --task-key 1171
bash scripts/usage-task.sh show [--session <sessionId>]
bash scripts/usage-task.sh clear [--session <sessionId>]
```

This command is **repository-level** and **identical on all four CLIs** (Claude Code, Gemini CLI, Copilot CLI, Antigravity); no per-CLI wiring is needed.

## Offline forge derivation

The worktree-or-branch channel (channel 3) derives a `forge-issue` external asset entirely offline using the fixed rule sequence in R8. The resolved remote's URL is parsed to extract the host and `owner/repo` pair. This derivation never performs a network call and never validates that the referenced issue exists.

## The attribution sidecar

Each journal entry is accompanied by a `.attr.json` sidecar carrying the channel that resolved the record's attribution and, if the channel produced an invalid candidate, the validation failure:

```json
{
  "channel": "explicit",
  "outcome": "attributed",
  "reason": null,
  "assetReason": null
}
```

or:

```json
{
  "channel": "env",
  "outcome": "unattributed",
  "reason": "invalid taskHandoffKey: \"...\"",
  "assetReason": null
}
```

The sidecar is immutable after the entry is written and is never re-derived by a later operation. It is stored alongside the entry in the same partition directory:

```text
<root>/journal/<cli>/<YYYY-MM>/<recordId>.json
<root>/journal/<cli>/<YYYY-MM>/<recordId>.attr.json
```

Inspecting a record's attribution sidecar without needing to re-derive it:

```bash
bash scripts/usage-attribute.sh explain --record <recordId> --cli <cli> --period <YYYY-MM>
```

## The attribution ledger

The ledger is an append-only store of retroactive attribution assignments, distinct from the journal. Entries are immutable once written and are keyed by the period of their own `timestamp`:

```text
<root>/ledger/<YYYY-MM>/<entryId>.json
```

An entry names exactly one scope (session, agent+parent, or period) and assigns a task-handoff key and/or an external asset reference to every record belonging to that scope.

### Ledger entry shape

```json
{
  "scope": {"session": "…"},
  "taskHandoffKey": "1171",
  "timestamp": "2026-09-22T10:00:00Z",
  "author": "hcross",
  "reason": "spec-authoring session for #1171"
}
```

All five fields are required. The `author` field records who made the entry; the `reason` field explains why the entry was created.

### Writing a ledger entry

```bash
task usage:attribute add --session <sessionId> --task-key 1171 --reason "session-start protocol established drawer 1171" [--author <name>]
task usage:attribute add --agent <agentId> --parent <parentSessionId> --asset forge-issue:crewrig/crewrig#1171 --reason "agent ran as part of task 1171"
task usage:attribute add --period 2026-09 --task-key 1171 --reason "retroactive: all activity in September was task 1171" [--author <name>]
```

When invoked via `task`, the `--author` defaults to the git user's configured name. When invoked directly via `bash scripts/usage-attribute.sh`, all required fields must be provided.

An identical entry (same scope, key, asset, timestamp, author, and reason) appended twice is a no-op — the ledger uses content-addressed entry IDs, so re-appending is idempotent (R13).

### Reading the ledger

```bash
task usage:attribute list [--session <sessionId> | --agent <agentId> --parent <parentSessionId> | --period <YYYY-MM>]
```

Lists all ledger entries matching the given filters. When no filter is given, all entries are listed.

## Read surface and ledger application

When a record is read from the journal (via `bash scripts/usage-query.sh`), the ledger is consulted:

```bash
bash scripts/usage-query.sh --task-key 1171
bash scripts/usage-query.sh --session <sessionId> --rollup
```

**Ledger application** (R15): If a ledger entry names the session, agent, or period a record belongs to, that entry's task-handoff key and/or external asset reference **replaces** the record's own attribution at read time. The record itself is not modified; only the returned result carries the overridden attribution.

The underlying record and its sidecar remain unchanged — a ledger entry never mutates the journal (R16).

### Bypassing the ledger

To read records with their original attribution, bypassing any ledger overrides:

```bash
bash scripts/usage-query.sh --task-key 1171 --no-ledger
```

This returns the entry verbatim, as it was written.

## Rollups

A rollup aggregates records by task-handoff key or external asset reference, reporting token counts grouped by **fidelity** — the granularity at which a record was captured (per-request, run-total, or session-cumulative):

```bash
bash scripts/usage-query.sh --task-key 1171 --rollup
bash scripts/usage-query.sh --asset forge-issue:crewrig/crewrig#1171 --rollup
bash scripts/usage-query.sh --task-key 1171 --rollup --combined
```

### Rollup output shape

```json
{
  "taskHandoffKey": "1171",
  "byFidelity": {
    "per-request": {"netInput": 12000, "cacheRead": 3000, "cacheWrite": 500, "output": 4000, "reasoning": 800},
    "run-total": {"netInput": 5000, "cacheRead": 1000, "cacheWrite": 200, "output": 2000, "reasoning": 0},
    "session-cumulative": {"netInput": 9000, "cacheRead": 0, "cacheWrite": 0, "output": 2500, "reasoning": 0}
  },
  "uncapturedCount": 1
}
```

Each fidelity's counts are summed independently. For `session-cumulative` records, **only the last snapshot per session** is included in the sum (R20, R22) — never a sum across multiple snapshots of the same session.

### Combined totals

When `--combined` is passed, a `combined` field is added carrying a sum across fidelities:

```json
{
  "taskHandoffKey": "1171",
  "byFidelity": {...},
  "combined": {"netInput": 26000, "cacheRead": 4000, "cacheWrite": 700, "output": 8500, "reasoning": 800, "mixed": ["per-request", "run-total", "session-cumulative"]},
  "uncapturedCount": 1
}
```

The `mixed` field lists every fidelity that contributed to the combined sum. A combined total is never presented without this `mixed` marker (R21).

### Uncaptured records

The `uncapturedCount` field reports how many records attributed to the task or asset were never captured — for example, incomplete requests, crashed processes, or offline captures. This count is reported separately from every token-count sum and is never folded into or represented as a placeholder value within any sum (R24).

A task or asset with zero `uncaptured` records reports that count as zero, never omits it.

## Session-start protocol recording

When the framework's own session-start protocol establishes or resumes a task-handoff drawer, it records the drawer's own task-handoff key with a declaration record named `protocol` (R3). This write happens before any task work in the session begins, establishing channel 4 as a fallback for records captured later in that session.

The session-start protocol documentation — `artifacts/core/rules/60-tools.md` → *Memory Activation Protocol* → *Session Start — Deterministic status-first sweep* and `~/.crewrig/system-context/long-running-task-convention.md` — now names requirement 3's recording step explicitly (R4).

## Prune

The explicit, period-scoped prune (R17, spec 0207 requirement 18) removes the journal entries and ledger entries recorded within a pruned period together:

```bash
bash scripts/usage-prune.sh <cli> <YYYY-MM>
```

This command removes:

1. Every journal entry in the period (with its wing sidecar and attribution sidecar).
2. Every mirrored drawer corresponding to a journal entry in the period.
3. **Every ledger entry whose own timestamp falls within the period** (R17, spec 0207 delta-01 R28).

The period is derived from each record's own `timing.requestInstant`, not `timing.captureInstant`. Ledger entries are keyed by their own `timestamp`'s `YYYY-MM` component. Both are pruned together, leaving neither behind on its own.

After a period is pruned, writes to that period are rejected by default (records are marked as rejected). To restore writability without recovering deleted records:

```bash
bash scripts/usage-prune.sh <cli> <YYYY-MM> --unprune
```

This removes only the pruned marker, allowing new writes to the period again. Rejected records from while the period was pruned remain lost; to recover them, backfill cursors must be reset.

### Purge instructions

To remove all attribution-related storage under `CREWRIG_USAGE_ROOT`:

```bash
rm -rf <root>/journal/ <root>/ledger/ <root>/declarations/ <root>/mirror/ <root>/cache/ <root>/tmp/
```

The attribution ledger and declarations directories are now part of the purge set (R30 extended):

- `<root>/declarations/` — session-scoped and project-scoped declaration records.
- `<root>/ledger/` — the append-only attribution ledger, organized by period.
- `<root>/journal/<cli>/<YYYY-MM>/<recordId>.attr.json` — attribution sidecars, removed together with their corresponding journal entries.

The `<root>/state/` directory is **not** touched — it is owned by spec 0206 (capture) and must not be removed by the storage contract.

## Personal data

### What attribution carries

- **Declaration records** — A task-handoff key (textual identifier) and/or an external asset reference (forge issue, Jira key, or file path/URL). No user identity or personal information beyond the task name itself.
- **Ledger entries** — The author of the entry (the operator's name or a role identifier), a timestamp, a reason (a short text explaining the retroactive change), and a task-handoff key and/or external asset reference.

A task-handoff key may be numerical (a ticket number like `1171`) or a named task identifier; an external asset reference may identify a forge issue, a Jira ticket, or a shared document. These are work-tracking identifiers, not personal data themselves, but they may reveal what a person was working on and when.

### Who can read it

- **Journal readers** — Anyone with read access to `<root>/journal/` can read declaration records and their corresponding records' attribution sidecars.
- **Ledger readers** — Anyone with read access to `<root>/ledger/` can read the ledger, including the author and reason fields.
- **Declaration readers** — Anyone with read access to `<root>/declarations/` can read the declaration records directly.

The storage contract applies no encryption. Filesystem permissions and the operator's own access controls are the sole safeguards.

### How to purge

Purge everything under the root:

```bash
rm -rf <root>/declarations/ <root>/ledger/ <root>/journal/ <root>/mirror/ <root>/cache/ <root>/tmp/
```

Purge a specific period:

```bash
bash scripts/usage-prune.sh <cli> <YYYY-MM>
```

This removes all journal, ledger, and drawer entries for that period.

## See also

- [Usage storage](usage-storage.md) — The journal layout, write outcomes, and mirroring into MemPalace.
- [Usage capture architecture](usage-capture.md) — How records are generated and the point at which attribution is resolved.
- [Usage record format](usage-record-format.md) — The schema and field definitions for usage records (spec 0205).
