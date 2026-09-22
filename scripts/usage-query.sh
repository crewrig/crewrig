#!/usr/bin/env bash
# usage-query.sh — read usage records by session, by agent+parent, by
# period, by task-handoff key, or by external asset reference (spec 0207
# R15-R17, spec 0208 R15). Output is JSONL, one record per line — verbatim
# unless a ledger override applies; --no-ledger returns the entry verbatim.
#
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
#   ... --task-key/--asset plus --rollup [--combined] (spec 0208 R20-R24; one
#       JSON object instead of one record per line)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec node --disable-warning=ExperimentalWarning "$SCRIPT_DIR/lib/usage-store/query.js" "$@"
