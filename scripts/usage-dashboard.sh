#!/bin/bash
# usage-dashboard.sh — forwarding shim (spec 0253 R3). The command is scripts/usage-dashboard.ts;
# this file stays so every caller of `bash scripts/usage-dashboard.sh` (the Bash tests, the
# Taskfile before it was rewritten, scripts/lib/usage-store/mirror.js, and
# artifacts/core/rules/60-tools.md until it was rewritten) still reaches it.
# Fails closed: with node absent it writes one Error: line and exits 1; below the
# floor it exits with the floor guard's status and the command is not run.
# Usage:
#   bash scripts/usage-dashboard.sh page   [filters] [--as-of-today] [--out <path>]
#   bash scripts/usage-dashboard.sh serve  [--port <n>]
#   bash scripts/usage-dashboard.sh report [filters] [--as-of-today] [--json]
#
# Filters: --session <id> | --agent <id> --parent <id> | --task-key <key>
#   | --asset <kind>:<ref> | --cli <cli> | --fidelity <f> | --no-ledger
#   | --from <YYYY-MM-DD> | --to <YYYY-MM-DD> | --period <YYYY-MM>
#   | --model <id> | --bucket day|week|month | --currency <ISO4217>
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
if ! command -v node >/dev/null 2>&1; then
  echo "Error: node was not found on PATH; this command needs Node.js 24 or later (https://nodejs.org/en/download)." >&2
  exit 1
fi
node "$DIR/lib/node-floor-guard.js" || exit $?
exec node "$DIR/usage-dashboard.ts" "$@"
