#!/usr/bin/env bash
# usage-task.sh — write, read, or clear the current session's usage-
# attribution declaration record (spec 0208 R2/R3).
#
# Usage:
#   bash scripts/usage-task.sh set --channel explicit|protocol [--task-key <key>] [--asset <kind>:<ref>] [--session <id>]
#   bash scripts/usage-task.sh show [--session <id>]
#   bash scripts/usage-task.sh clear [--session <id>]
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec node --disable-warning=ExperimentalWarning "$SCRIPT_DIR/lib/usage-store/declaration.js" "$@"
