#!/usr/bin/env bash
# usage-query.sh — read usage records by session, by agent+parent, by
# period, by task-handoff key, or by external asset reference (spec 0207
# R15-R17). Output is JSONL, one verbatim record per line.
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
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec node --disable-warning=ExperimentalWarning "$SCRIPT_DIR/lib/usage-store/query.js" "$@"
