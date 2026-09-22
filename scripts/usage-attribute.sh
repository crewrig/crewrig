#!/usr/bin/env bash
# usage-attribute.sh — append to, list, or inspect the append-only
# attribution ledger (spec 0208 R13-R19).
#
# Usage:
#   bash scripts/usage-attribute.sh add (--session <id> | --agent <id> --parent <id> | --period <YYYY-MM>) (--task-key <key> | --asset <kind>:<ref>) --reason <text> [--author <name>]
#   bash scripts/usage-attribute.sh list [--session <id> | --agent <id> --parent <id> | --period <YYYY-MM>]
#   bash scripts/usage-attribute.sh explain --record <recordId> --cli <cli> --period <YYYY-MM>
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec node --disable-warning=ExperimentalWarning "$SCRIPT_DIR/lib/usage-store/ledger.js" "$@"
