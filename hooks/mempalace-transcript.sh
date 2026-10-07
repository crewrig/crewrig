#!/bin/bash
# mempalace-transcript.sh — forwarding shim (spec 0247 R2, delta-01). The hook
# is hooks/mempalace-transcript.ts; this file remains only so an installation
# whose wired command line still names this `.sh` path keeps recording until
# setup rewrites it to the direct `node` form.
#
# On a toolchain that cannot start the hook (no `node`, or a `node` below the
# Node.js 24 floor) it prints one diagnostic line and exits 0, so a failed
# start never fails the user's turn (R6). It then still writes the
# Antigravity acknowledgement `{}` (R5) exactly when the hook would have been
# in Antigravity mode or ended with a first argument `antigravity-cli`: a
# non-empty first argument other than `claude-code`, `gemini-cli` and
# `copilot-cli`. Once the floor holds, `exec` hands the process to the
# TypeScript entry so its status, standard output and standard error reach the
# CLI unchanged, standard input untouched.
#
# Usage: bash hooks/mempalace-transcript.sh [<event> | <cli-id> [<event>]]
#        (payload on stdin)

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

antigravity_ack() {
  case "${1:-}" in
    "" | claude-code | gemini-cli | copilot-cli) ;;
    *) printf '{}\n' ;;
  esac
}

if ! command -v node >/dev/null 2>&1; then
  echo "mempalace-transcript: node required" >&2
  antigravity_ack "${1:-}"
  exit 0
fi

# The floor guard prints its own diagnostic below the floor; standard input is
# left for the entry, so it is not forwarded to this probe.
if ! node "$DIR/../scripts/lib/node-floor-guard.js" </dev/null; then
  antigravity_ack "${1:-}"
  exit 0
fi

exec node "$DIR/mempalace-transcript.ts" "$@"
