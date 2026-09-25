#!/usr/bin/env bash
# usage-price.sh — compute comparative reference prices for usage records
# (spec 0209). Never an invoice.
#
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
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec node --disable-warning=ExperimentalWarning "$SCRIPT_DIR/lib/usage-price/cli.js" "$@"
