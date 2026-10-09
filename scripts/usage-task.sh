#!/bin/bash
# usage-task.sh — forwarding shim (spec 0253 R3). The command is scripts/usage-task.ts;
# this file stays so every caller of `bash scripts/usage-task.sh` (the Bash tests, the
# Taskfile before it was rewritten, scripts/lib/usage-store/mirror.js, and
# artifacts/core/rules/60-tools.md until it was rewritten) still reaches it.
# Fails closed: with node absent it writes one Error: line and exits 1; below the
# floor it exits with the floor guard's status and the command is not run.
# Usage:
#   bash scripts/usage-task.sh set --channel explicit|protocol [--task-key <key>] [--asset <kind>:<ref>] [--session <id>]
#   bash scripts/usage-task.sh show [--session <id>]
#   bash scripts/usage-task.sh clear [--session <id>]
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
if ! command -v node >/dev/null 2>&1; then
  echo "Error: node was not found on PATH; this command needs Node.js 24 or later (https://nodejs.org/en/download)." >&2
  exit 1
fi
node "$DIR/lib/node-floor-guard.js" || exit $?
exec node "$DIR/usage-task.ts" "$@"
