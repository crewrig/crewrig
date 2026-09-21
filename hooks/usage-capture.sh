#!/bin/bash
# usage-capture.sh — sibling hook to hooks/mempalace-transcript.sh (spec 0206
# R15: never a branch inside it, so a change to either script cannot alter
# the other's failure behavior). Derives usage records from a CLI's own
# session record and hands them to the spec 0207 storage boundary via the
# scripts/lib/usage-capture/ module tree.
#
# THIS FILE IS NEVER COPIED OUT OF THE REPOSITORY (PLAN v3 step 11/step 14).
# Its whole job is to reach the sibling module tree, so every CLI installer
# wires the manifest command to THIS file's own in-repo absolute path
# instead — the same treatment hooks/worktree-git-guard.sh already carries
# (scripts/setup-{claude,gemini,copilot}-interactive.sh, and the Antigravity
# statusline shim's own setup wiring).
#
# Usage: bash hooks/usage-capture.sh <cli> <event>   (payload on stdin)
#   <cli>   claude-code | gemini-cli | copilot-cli
#   <event> the firing lifecycle event name, forwarded to cli.js verbatim
#
# Exit code: ALWAYS 0 (R15). No `set -e`, no `set -o pipefail`, no trap, no
# `exec` — `exec` replaces the process image, so an EXIT trap would not
# survive it and Node's own exit status (127 missing node, non-zero OOM or
# unhandled rejection) would reach the triggering CLI, which R15 forbids.
# A capture failure never reaches the triggering CLI's own exit status; it is
# instead handed to scripts/lib/usage-capture/index.js, which turns it into
# an `uncaptured` record (R16).
#
# Environment:
#   CREWRIG_USAGE_ROOT          overrides the default ${HOME}/.crewrig/usage
#                                (also honoured by cursor.js / spool.js —
#                                PLAN v3 named edit 2).
#   CREWRIG_USAGE_CAPTURE_CLI   test-only override of the resolved cli.js
#                                path. Read ONLY when
#                                CREWRIG_USAGE_CAPTURE_TEST is non-empty
#                                (PLAN v3 observation): a wrong production
#                                value must never silently no-op the live
#                                capture path.
#   CREWRIG_USAGE_CAPTURE_TEST  set by scripts/tests/test-usage-capture.sh to
#                                gate the override above. Unset on every
#                                installed machine.

CLI_NAME="$1"
EVENT_NAME="$2"

# Resolve the module tree, ${BASH_SOURCE[0]}-anchored, $PWD-independent — the
# same idiom hooks/worktree-git-guard.sh l. 65 already uses. This is what
# makes wiring by in-repo absolute path correct: whatever the invoking
# manifest names as THIS file's own path, DIR resolves relative to it, never
# to the caller's cwd.
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
CLI_JS="$DIR/../scripts/lib/usage-capture/cli.js"
if [ -n "${CREWRIG_USAGE_CAPTURE_TEST:-}" ] && [ -n "${CREWRIG_USAGE_CAPTURE_CLI:-}" ]; then
  CLI_JS="$CREWRIG_USAGE_CAPTURE_CLI"
fi

CREWRIG_USAGE_ROOT="${CREWRIG_USAGE_ROOT:-${HOME}/.crewrig/usage}"

# Read the payload FIRST and unconditionally, before any decision, so the
# fast path below can never consume the bytes Node needs on the slow path.
payload="$(cat)"

# source_key <path> — THE CANONICAL sourceKey derivation, textually mirrored
# from scripts/lib/usage-capture/cursor.js's own sourceKey() export. Keep the
# two definitions in sync: sha256 hex digest of the source's own absolute
# path, lowercase, no salt.
source_key() {
  if command -v sha256sum >/dev/null 2>&1; then
    printf '%s' "$1" | sha256sum | awk '{print $1}'
  else
    printf '%s' "$1" | shasum -a 256 | awk '{print $1}'
  fi
}

# Extract the transcript path. Copilot CLI carries no such field — its
# source is the fixed store path instead. For the other CLIs, one bash
# regex accepts both the snake_case and the camelCase spelling and any
# whitespace around the colon — the same tolerance
# hooks/mempalace-transcript.sh l. 201 already buys with
# `jq -r '.transcript_path // .transcriptPath // empty'`.
src=""
if [ "$CLI_NAME" = "copilot-cli" ]; then
  src="${HOME}/.copilot/session-store.db"
elif [[ $payload =~ \"transcript(_p|P)ath\"[[:space:]]*:[[:space:]]*\"([^\"]+)\" ]]; then
  src="${BASH_REMATCH[2]}"
fi

# Fast path: taken ONLY when the extraction produced a usable, resolvable
# path AND a stamp already exists AND the source is not newer than it. Every
# assumption this extraction still makes (the value is not JSON-escaped, the
# path holds no `"`) fails TOWARD Node — an unusable `src` fails the
# precondition below and falls through, so the cost of a wrong guess is one
# Node start-up, never a lost record.
if [ -n "$src" ]; then
  stamp="$CREWRIG_USAGE_ROOT/state/$CLI_NAME/$(source_key "$src").stamp"
  if [[ "$src" == /* && -f "$src" && -f "$stamp" && ! "$src" -nt "$stamp" ]]; then
    exit 0
  fi
fi

# Slow path: hand the buffered payload to Node through a temp file, never a
# pipe (a writer piped into a short-lived reader is the SIGPIPE hazard
# docs/scripting-conventions.md Rule 6 and scripts/check-pipefail-grep.sh
# govern).
tmp="$(mktemp)"
printf '%s' "$payload" > "$tmp"
CREWRIG_USAGE_ROOT="$CREWRIG_USAGE_ROOT" node --disable-warning=ExperimentalWarning "$CLI_JS" \
  --cli "$CLI_NAME" --event "$EVENT_NAME" --payload-file "$tmp" >/dev/null 2>&1
rm -f "$tmp"

exit 0
