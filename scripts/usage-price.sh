#!/bin/bash
# usage-price.sh — forwarding shim (spec 0253 R3). The command is scripts/usage-price.ts;
# this file stays so every caller of `bash scripts/usage-price.sh` (the Bash tests, the
# Taskfile before it was rewritten, scripts/lib/usage-store/mirror.js, and
# artifacts/core/rules/60-tools.md until it was rewritten) still reaches it.
# Fails closed: with node absent it writes one Error: line and exits 1; below the
# floor it exits with the floor guard's status and the command is not run.
# Usage:
#   bash scripts/usage-price.sh --session <id>
#   bash scripts/usage-price.sh --agent <id> --parent <parentSessionId>
#   bash scripts/usage-price.sh --period <YYYY-MM> [--cli <cli>]
#   bash scripts/usage-price.sh --task-key <key>
#   bash scripts/usage-price.sh --asset <kind>:<ref>
#   ... any of the above plus --fidelity <per-request|run-total|session-cumulative>
#   ... any of the above plus --currency <ISO4217> [--as-of-today] [--no-store]
#   ... any of the above plus --rollup (one JSON object, per-fidelity sums + mixed marker)
#   bash scripts/usage-price.sh --refresh-pricelist [--sha <sha>]
#   bash scripts/usage-price.sh --refresh-fx [--fx-mirror frankfurter]
#   bash scripts/usage-price.sh --cross-check <modelId>
#
# Selectors compose (#1205): --session, --agent+--parent, --period,
# --task-key, --asset, --cli and --fidelity are ANDed. With --rollup,
# --period is a placement bound instead (spec 0209 delta-01,
# docs/usage-pricing.md).
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
if ! command -v node >/dev/null 2>&1; then
  echo "Error: node was not found on PATH; this command needs Node.js 24 or later (https://nodejs.org/en/download)." >&2
  exit 1
fi
node "$DIR/lib/node-floor-guard.js" || exit $?
exec node "$DIR/usage-price.ts" "$@"
