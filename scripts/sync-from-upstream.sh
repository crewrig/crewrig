#!/bin/bash
# sync-from-upstream.sh — forwarding shim (spec 0253 R3). The command is
# scripts/sync-from-upstream.ts; this file stays so every caller of
# `bash scripts/sync-from-upstream.sh` (the Bash test, adopters' habits and scripts,
# and every sync that restores this very path from upstream) still reaches it.
# Fails closed: with node absent it writes one Error: line and exits 1; below the
# floor it exits with the floor guard's status and the command is not run.
# `exec` is the last statement, so a sync that overwrites this file while running is
# never read again (spec 0253 R21).
# Usage: bash scripts/sync-from-upstream.sh [--preserve-history]
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
if ! command -v node >/dev/null 2>&1; then
  echo "Error: node was not found on PATH; this command needs Node.js 24 or later (https://nodejs.org/en/download)." >&2
  exit 1
fi
node "$DIR/lib/node-floor-guard.js" || exit $?
exec node "$DIR/sync-from-upstream.ts" "$@"
