#!/bin/bash
# antigravity-statusline-shim.sh — the Antigravity CLI capture channel (spec
# 0206 PLAN v3 step 13). Antigravity exposes no lifecycle hook event for
# usage capture — the display-command invocation the CLI already makes for a
# user-configured status line IS the only trigger this channel has. This
# shim tees the payload to the capture step's Antigravity adapter
# (scripts/lib/usage-capture/adapters/antigravity.js, via cli.js — the same
# module tree hooks/usage-capture.sh reaches). When a priorStatusLineCommand
# was configured, the shim streams the payload to it on stdin and forwards its
# stdout. When absent or empty, nothing is emitted on stdout (spec 0241).
#
# THIS FILE IS NEVER COPIED OUT of the repository, exactly like
# hooks/usage-capture.sh (spec 0206 PLAN v3 step 11): its whole job is to
# reach the sibling module tree, so scripts/setup-antigravity-interactive.sh
# wires statusLine.command to THIS file's own in-repo absolute path,
# installed only when that value was previously empty (R20).
#
# Exit code: ALWAYS 0, the same R15 contract hooks/usage-capture.sh carries —
# a capture failure or prior-command failure must never break the status-line display.
#
# Environment: the same CREWRIG_USAGE_ROOT / CREWRIG_USAGE_CAPTURE_CLI /
# CREWRIG_USAGE_CAPTURE_TEST contract hooks/usage-capture.sh documents.

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
CLI_JS="$DIR/../scripts/lib/usage-capture/cli.js"
if [ -n "${CREWRIG_USAGE_CAPTURE_TEST:-}" ] && [ -n "${CREWRIG_USAGE_CAPTURE_CLI:-}" ]; then
  CLI_JS="$CREWRIG_USAGE_CAPTURE_CLI"
fi

payload="$(cat)"

# If a prior status-line command was configured, stream the payload to it
# and reproduce ITS output on stdout. If no prior command was configured,
# emit nothing: the user had no status line before us, so dumping raw JSON
# would pollute the terminal status bar (issue #1363, spec 0241).
CREWRIG_USAGE_ROOT="${CREWRIG_USAGE_ROOT:-${HOME}/.crewrig/usage}"
STATUSLINE_MARKER="$CREWRIG_USAGE_ROOT/state/antigravity-statusline.json"

if [ -f "$STATUSLINE_MARKER" ]; then
  PRIOR_CMD="$(jq -r '.priorStatusLineCommand // empty' "$STATUSLINE_MARKER" 2>/dev/null || true)"
  if [ -n "$PRIOR_CMD" ]; then
    printf '%s' "$payload" | sh -c "$PRIOR_CMD" || true
  fi
fi

tmp="$(mktemp)"
printf '%s' "$payload" > "$tmp"
CREWRIG_USAGE_ROOT="$CREWRIG_USAGE_ROOT" \
  node --disable-warning=ExperimentalWarning "$CLI_JS" --cli antigravity --event statusline --payload-file "$tmp" >/dev/null 2>&1
rm -f "$tmp"

exit 0
