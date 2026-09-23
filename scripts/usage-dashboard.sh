#!/usr/bin/env bash
# usage-dashboard.sh — the usage dashboard (spec 0210): one view model over
# the usage store and the comparative prices, in three delivery forms.
# Reference figures, never an invoice. Never reaches the network.
#
# Usage:
#   bash scripts/usage-dashboard.sh page   [filters] [--as-of-today] [--out <path>]
#   bash scripts/usage-dashboard.sh serve  [--port <n>]
#   bash scripts/usage-dashboard.sh report [filters] [--as-of-today] [--json]
#
# Filters: --session <id> | --agent <id> --parent <id> | --task-key <key>
#   | --asset <kind>:<ref> | --cli <cli> | --fidelity <f> | --no-ledger
#   | --from <YYYY-MM-DD> | --to <YYYY-MM-DD> | --period <YYYY-MM>
#   | --model <id> | --bucket day|week|month | --currency <ISO4217>
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec node --disable-warning=ExperimentalWarning "$SCRIPT_DIR/lib/usage-dashboard/cli.js" "$@"
