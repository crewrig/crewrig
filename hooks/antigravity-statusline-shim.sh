#!/bin/bash
# antigravity-statusline-shim.sh — the Antigravity CLI capture channel (spec
# 0206 PLAN v3 step 13). Antigravity exposes no lifecycle hook event for
# usage capture — the display-command invocation the CLI already makes for a
# user-configured status line IS the only trigger this channel has. This
# shim tees the payload to the capture step's Antigravity adapter
# (scripts/lib/usage-capture/adapters/antigravity.js, via cli.js — the same
# module tree hooks/usage-capture.sh reaches) and then reproduces the
# payload it received UNCHANGED on stdout, so the operator's own status-line
# display is not altered by this ticket's own capture step.
#
# THIS FILE IS NEVER COPIED OUT of the repository, exactly like
# hooks/usage-capture.sh (spec 0206 PLAN v3 step 11): its whole job is to
# reach the sibling module tree, so scripts/setup-antigravity-interactive.sh
# wires statusLine.command to THIS file's own in-repo absolute path,
# installed only when that value was previously empty (R20).
#
# Exit code: ALWAYS 0, the same R15 contract hooks/usage-capture.sh carries —
# a capture failure here must never break the status-line display, and the
# reproduced payload is written BEFORE the capture step runs, so the display
# is never blocked on it either.
#
# Environment: the same CREWRIG_USAGE_ROOT / CREWRIG_USAGE_CAPTURE_CLI /
# CREWRIG_USAGE_CAPTURE_TEST contract hooks/usage-capture.sh documents.

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
CLI_JS="$DIR/../scripts/lib/usage-capture/cli.js"
if [ -n "${CREWRIG_USAGE_CAPTURE_TEST:-}" ] && [ -n "${CREWRIG_USAGE_CAPTURE_CLI:-}" ]; then
  CLI_JS="$CREWRIG_USAGE_CAPTURE_CLI"
fi

payload="$(cat)"

# Reproduce the payload unchanged FIRST: the display must never wait on, or
# be altered by, the capture step below.
printf '%s' "$payload"

tmp="$(mktemp)"
printf '%s' "$payload" > "$tmp"
CREWRIG_USAGE_ROOT="${CREWRIG_USAGE_ROOT:-${HOME}/.crewrig/usage}" \
  node --disable-warning=ExperimentalWarning "$CLI_JS" --cli antigravity --event statusline --payload-file "$tmp" >/dev/null 2>&1
rm -f "$tmp"

exit 0
