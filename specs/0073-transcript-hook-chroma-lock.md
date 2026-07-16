---
id: "0073"
slug: transcript-hook-chroma-lock
status: approved
complexity: small
interaction-mode: AUTO
related-issue: 508
version: 1.0.0
---

# Route the mempalace-transcript hook through the shared ChromaDB HTTP daemon

## Intent

A user who runs the shared `hooks/mempalace-transcript.sh` transcript hook
alongside any other process that talks to the same on-disk MemPalace palace —
a concurrent CLI session, or the `mempalace` MCP server itself — no longer
risks the palace corruption that ADR-0006 already eliminated for the
MCP-server code path. Persisting a transcript entry never depends on the
transcript hook opening its own private connection to the on-disk palace, and
a temporarily unreachable shared persistence path degrades that single
transcript entry silently rather than hanging or aborting the calling CLI
session (Claude Code, Gemini CLI, GitHub Copilot CLI, or Antigravity CLI).

## Requirements

1. The transcript hook SHALL NOT construct a `chromadb.PersistentClient`
   against the on-disk palace when persisting a transcript entry.
2. The transcript hook SHALL route every transcript-persistence attempt
   through the shared ChromaDB HTTP daemon that ADR-0006
   (`docs/adr/0006-chromadb-http-server.md`) already designates as the sole
   owner of the on-disk palace, addressed through that same daemon's existing
   `MEMPALACE_CHROMA_HOST` / `MEMPALACE_CHROMA_PORT` configuration surface.
3. When the shared ChromaDB HTTP daemon is unreachable at the moment a
   transcript entry would be persisted, the transcript hook SHALL record
   that single persistence attempt as a failed, logged event through its
   existing stderr/exit-code reporting convention, and SHALL NOT construct a
   `chromadb.PersistentClient` as a fallback.
4. Regardless of the shared ChromaDB HTTP daemon's reachability, the
   transcript hook SHALL NOT block or abort the calling CLI session; the
   hook process SHALL return control to the caller within the same bounded
   time budget the hook already enforces for a MemPalace persistence
   attempt.
5. This routing and fallback behavior SHALL apply identically everywhere
   `hooks/mempalace-transcript.sh` is registered as a transcript hook —
   Claude Code, Gemini CLI, GitHub Copilot CLI, and Antigravity CLI — since
   all four CLI surfaces invoke this one shared script with no CLI-specific
   branch.
6. The regression-test suite for the transcript hook
   (`scripts/tests/test-mempalace-transcript-hook.sh`) SHALL gain at least
   one automated check asserting that a transcript-persistence attempt made
   while the shared ChromaDB HTTP daemon is unreachable neither hangs the
   hook process nor causes the transcript hook to construct a
   `chromadb.PersistentClient`.

## Scenarios

**Scenario:** Transcript entry persists through the shared daemon when
reachable.

Given the shared ChromaDB HTTP daemon defined in ADR-0006 is running and
reachable at the configured host and port
When a `Stop` or `SessionEnd` hook event fires and
`hooks/mempalace-transcript.sh` attempts to persist a transcript entry
Then the entry is persisted into the `transcripts` wing without the hook
ever constructing a `chromadb.PersistentClient`
And the hook's existing stderr line reports the successful persistence
exactly as it does today.

**Scenario:** Transcript hook degrades gracefully when the shared daemon is
unreachable.

Given the shared ChromaDB HTTP daemon defined in ADR-0006 is not running or
is unreachable at the configured host and port
When a `Stop` or `SessionEnd` hook event fires and
`hooks/mempalace-transcript.sh` attempts to persist a transcript entry
Then the persistence attempt is recorded as a failed, logged event on
stderr without the hook constructing a `chromadb.PersistentClient` as a
fallback
And the hook process still returns control to the calling CLI within its
existing bounded time budget, so the calling CLI session is not blocked or
aborted by the failed attempt
And `scripts/tests/test-mempalace-transcript-hook.sh` gains an automated
check that exercises this exact behavior.

**Scenario:** The fix applies symmetrically across all four registered CLI
surfaces.

Given all four hook registrations (`hooks/claude-transcript-hooks.json`,
`hooks/gemini-transcript-hooks.json`, `hooks/copilot-transcript-hooks.json`,
`hooks/antigravity-transcript-hooks.json`) invoke the same shared
`hooks/mempalace-transcript.sh`
When any one of Claude Code, Gemini CLI, GitHub Copilot CLI, or Antigravity
CLI fires a transcript-persisting hook event
Then the same shared-daemon routing and non-blocking-failure behavior
applies, since the shared script carries no CLI-specific branch for this
behavior.

## Out of scope

- Modifying `scripts/lib/mempalace-http-wrapper.py` or any other part of the
  MCP-server code path; that wrapper already implements the ADR-0006 pattern
  correctly and is untouched by this spec.
- Any change to the shared ChromaDB HTTP daemon's own lifecycle,
  installation, or supervision (the launchd/systemd units, `chroma run`
  startup) — governed entirely by ADR-0006 and unaffected here.
- Introducing new environment variables or a new daemon-addressing
  convention; this spec reuses the existing `MEMPALACE_CHROMA_HOST` /
  `MEMPALACE_CHROMA_PORT` pair verbatim.
- Changing which hook events trigger a persistence attempt (the existing
  `PostToolUse`-skip logic from issue #91 and the `Stop`/`SessionEnd`
  selection) — unrelated to this fix and untouched.
- Any edit to the four per-CLI hook registration files
  (`hooks/*-transcript-hooks.json`); the fix lives entirely inside the one
  shared script they all invoke, so `docs/cli-matrix.md` is not touched (per
  `AGENTS.md` → *CLI Matrix Maintenance*, whose trigger list names the
  per-CLI registration files, not the shared script they call).
- Retrofitting this routing fix into any other MemPalace-invoking script
  outside `hooks/mempalace-transcript.sh`; no other such fire-and-forget
  script exists in the repository at authoring time.
- Alerting, monitoring, or any user-facing surfacing of a sustained daemon
  outage (for example, every transcript entry silently dropping for hours);
  the single per-invocation stderr line this spec requires is the only
  observability surface in scope.
- Treating "the shared daemon is now required for the transcript hook to
  persist anything" as a new dependency needing separate migration
  guidance: the `mempalace` MCP server has already refused to start without
  this same daemon since ADR-0006 shipped (fail-loud, non-zero exit), so any
  user with a working MemPalace MCP surface already satisfies this
  precondition; this spec does not add a standalone-user migration path.

## Open questions

- [AUTO-PARKED] The existing `scripts/tests/test-mempalace-transcript-hook.sh`
  suite is entirely bash-level: it exercises the outer script's contracts
  (timeout wrapping, `PostToolUse` skip, `git rev-parse` project-dir
  derivation, stderr not merged) by substituting `$MEMPALACE_PYTHON` with a
  fake stub, never the real Python payload's internal ChromaDB-client
  selection. Requirement 6 mandates a new automated check for the
  daemon-unreachable path, but whether that check can stay within the
  existing fake-`$MEMPALACE_PYTHON`-stub style (simulating the
  daemon-unreachable exit path without a real or mocked ChromaDB HTTP
  server) or needs a genuine integration test against a live or mocked
  daemon is not resolved here. PLAN/DEV SHALL settle the concrete test
  technique; either approach satisfies Requirement 6 as written.
