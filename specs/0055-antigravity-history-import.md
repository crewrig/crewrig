---
id: "0055"
slug: antigravity-history-import
status: implemented
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 425
version: 1.0.0
---

# Spec 0055 — Antigravity CLI history import

## Intent

A dedicated import script backfills the MemPalace transcript wing with
Antigravity CLI session history, making past `agy` conversations searchable
from any future agent session. The script reads Antigravity CLI's global
JSONL session-store — a single file distinct from Gemini CLI's per-session
JSON layout — and files its records idempotently into MemPalace, mirroring
what `scripts/import-gemini-history.sh` does for Gemini CLI sessions.

## Requirements

1. A script `scripts/import-antigravity-history.sh` SHALL exist that
   backfills the MemPalace transcript wing with Antigravity CLI session
   history.
2. The script SHALL read session history from
   `~/.gemini/antigravity-cli/history.jsonl` as the canonical
   Antigravity CLI session-store path.
3. The script SHALL process the source as a JSONL file — each line is a
   separate JSON record — rather than reading a directory of per-session
   JSON files.
4. The script SHALL be idempotent: re-running it on a store that has
   already been imported SHALL NOT create duplicate MemPalace entries for
   records that were previously filed.
5. The script SHALL exit with a non-zero status code and print a
   diagnostic message to stderr when
   `~/.gemini/antigravity-cli/history.jsonl` does not exist at invocation
   time.
6. The script SHALL print a pre-import summary to stdout listing the
   resolved source path and the number of records found before any
   MemPalace write is performed.
7. The script SHALL offer a dry-run preview step (interactively, via fzf)
   before performing the actual import, consistent with the pattern
   established by `scripts/import-gemini-history.sh`.
8. The script SHALL exit with a non-zero status and a diagnostic message
   when the `mempalace` Python package is not importable from any
   candidate interpreter.

## Scenarios

**Scenario:** Happy path — first-time import of an existing history file

Given `~/.gemini/antigravity-cli/history.jsonl` exists and contains one
  or more JSON-line records, and MemPalace is installed and reachable
When  the user runs `scripts/import-antigravity-history.sh` and confirms
  both the dry-run and the actual import when prompted
Then  each record from the JSONL file is filed into the MemPalace
  transcript wing, the script exits zero, and a completion summary is
  printed to stdout

**Scenario:** Idempotent re-run

Given the script has been run once and all records have been filed into
  MemPalace
When  the user runs `scripts/import-antigravity-history.sh` again with the
  same source file unchanged
Then  no duplicate entries are created in MemPalace and the script exits
  zero

**Scenario:** Missing session-store

Given `~/.gemini/antigravity-cli/history.jsonl` does not exist on the
  filesystem
When  the user runs `scripts/import-antigravity-history.sh`
Then  the script prints a diagnostic message naming the expected path and
  how to override it, writes nothing to MemPalace, and exits with a
  non-zero status code

**Scenario:** MemPalace not installed

Given `mempalace` is not importable from any candidate Python interpreter
When  the user runs `scripts/import-antigravity-history.sh`
Then  the script prints an installation hint, writes nothing, and exits
  with a non-zero status code

**Scenario:** User cancels at the confirmation prompt

Given the session-store exists and MemPalace is installed
When  the user runs the script, views the dry-run preview, but answers
  "no" at the "Proceed with the import?" fzf prompt
Then  the script prints "Import canceled.", writes nothing to MemPalace,
  and exits zero

## Out of scope

- The Antigravity CLI setup script (`scripts/setup-antigravity.sh`) —
  qualified by spec 0054.
- The Antigravity CLI workspace layout (directory structure and
  configuration files) — qualified by spec 0052.
- The Antigravity CLI build pipeline integration — qualified by spec 0053.
- Importing Gemini CLI session history (`scripts/import-gemini-history.sh`
  and its per-session JSON format) — pre-existing script, not modified by
  this spec.
- Any migration or back-fill of records already present in MemPalace from
  a previous import run (covered by the idempotency requirement above).
- Automatic or scheduled invocation of the import script — the script is
  run on-demand by the user.
- Support for a non-default session-store path beyond an environment
  variable override (consistent with `GEMINI_TMP_DIR` in the Gemini
  importer).

## Open questions

- Should the environment variable that overrides the source path follow the
  pattern `ANTIGRAVITY_HISTORY_FILE` (parallel to `GEMINI_TMP_DIR` on the
  Gemini importer) or a different name? The Gemini importer overrides a
  directory; this one overrides a single file path, so the naming
  convention may differ. Recommend `ANTIGRAVITY_HISTORY_FILE` unless the
  implementer has a preference.
