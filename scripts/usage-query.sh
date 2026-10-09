#!/bin/bash
# usage-query.sh — forwarding shim (spec 0253 R3). The command is scripts/usage-query.ts;
# this file stays so every caller of `bash scripts/usage-query.sh` (the Bash tests, the
# Taskfile before it was rewritten, scripts/lib/usage-store/mirror.js, and
# artifacts/core/rules/60-tools.md until it was rewritten) still reaches it.
# Fails closed: with node absent it writes one Error: line and exits 1; below the
# floor it exits with the floor guard's status and the command is not run.
# Usage:
#   bash scripts/usage-query.sh --session <id>
#   bash scripts/usage-query.sh --agent <id> --parent <parentSessionId>
#   bash scripts/usage-query.sh --period <YYYY-MM> [--cli <cli>]
#   bash scripts/usage-query.sh --task-key <key>
#   bash scripts/usage-query.sh --asset <kind>:<ref>
#   bash scripts/usage-query.sh --undrained
#   bash scripts/usage-query.sh --pending
#   ... any of the above plus --fidelity <per-request|run-total|session-cumulative>
#   ... any of the above plus --no-ledger (skip R15's ledger application)
#   ... any selector plus --rollup [--combined] (spec 0208 R20-R24; one JSON
#       object instead of one record per line)
#
# Selectors compose (#1205): --session, --agent+--parent, --period,
# --task-key, --asset, --cli and --fidelity are ANDed. A listing with
# --period reads only that month's partitions; with --rollup, --period is a
# placement bound instead (spec 0209 delta-01, docs/usage-pricing.md).
# --pending honours --fidelity only; --undrained takes no filter.
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
if ! command -v node >/dev/null 2>&1; then
  echo "Error: node was not found on PATH; this command needs Node.js 24 or later (https://nodejs.org/en/download)." >&2
  exit 1
fi
node "$DIR/lib/node-floor-guard.js" || exit $?
exec node "$DIR/usage-query.ts" "$@"
