---
id: "0074"
slug: transcript-quiet-logging
status: implemented
complexity: small
interaction-mode: AUTO
related-issue: 510
version: 1.0.0
---

# Silence transcript-hook success logs behind an opt-in quiet switch

## Intent

A user who runs the shared `hooks/mempalace-transcript.sh` transcript hook in
a fast-paced interactive CLI session (Claude Code, Gemini CLI, GitHub Copilot
CLI, or Antigravity CLI) can opt in to silencing the per-entry success
notification that the hook currently prints after nearly every persisted user
prompt, tool use, or agent response. The opt-in is the environment variable
`MEMPALACE_TRANSCRIPT_QUIET` set to `1`, which suppresses only the success log
lines; failure and error notifications remain visible so real persistence
problems are never hidden. When the variable is unset or holds any other
value, the hook behaves exactly as it does today, so the change is backward
compatible for every existing user.

## Requirements

1. When the environment variable `MEMPALACE_TRANSCRIPT_QUIET` is set to `1`,
   the transcript hook SHALL NOT emit any success persistence log line to
   stderr for a persisted transcript entry.
2. When `MEMPALACE_TRANSCRIPT_QUIET` is unset, or is set to any value other
   than `1`, the transcript hook SHALL emit a success persistence log line to
   stderr for each persisted transcript entry, exactly as it does today
   (unchanged, backward-compatible default behavior).
3. Regardless of the value of `MEMPALACE_TRANSCRIPT_QUIET`, the transcript
   hook SHALL still write every failure or error notification for a
   persistence attempt to stderr.
4. The `MEMPALACE_TRANSCRIPT_QUIET` variable — its `1` activation value and
   its default of showing success logs — SHALL be documented in the
   `Environment:` block of the `hooks/mempalace-transcript.sh` header comment.

## Scenarios

**Scenario:** Quiet mode suppresses the success log line.

Given the transcript hook is enabled and `MEMPALACE_TRANSCRIPT_QUIET` is set
to `1`
When a transcript entry is persisted successfully
Then the hook writes no success persistence log line to stderr
And the transcript entry is still persisted unchanged.

**Scenario:** Quiet mode still surfaces a persistence failure.

Given the transcript hook is enabled and `MEMPALACE_TRANSCRIPT_QUIET` is set
to `1`
When a transcript-persistence attempt fails
Then the hook still writes the failure notification for that attempt to
stderr, despite quiet mode being active.

**Scenario:** Default behavior is preserved when quiet mode is unset.

Given the transcript hook is enabled and `MEMPALACE_TRANSCRIPT_QUIET` is unset
When a transcript entry is persisted successfully
Then the hook writes the success persistence log line to stderr exactly as it
does today.

## Out of scope

- Any change to the semantics of `MEMPALACE_TRANSCRIPT_ENABLED`; the quiet
  switch only affects success-log output for an already-enabled hook and does
  not gate whether the hook runs or persists.
- Silencing, suppressing, or altering failure and error log output under any
  value of `MEMPALACE_TRANSCRIPT_QUIET`; error visibility is preserved
  unconditionally.
- Introducing verbosity levels, log-level tiers, or any control surface
  beyond the single binary quiet toggle described here.
- Changing what content is persisted, which hook events trigger a persistence
  attempt, or the format of the success log line itself when it is shown.
- Per-entry-type or per-event filtering of success logs (for example,
  silencing only `tool-use` lines while keeping `session-lifecycle` lines);
  the toggle is all-or-nothing for success logs.
- Any change to the four per-CLI hook registration files
  (`hooks/*-transcript-hooks.json`); the toggle lives entirely inside the one
  shared script they all invoke.

## Open questions
