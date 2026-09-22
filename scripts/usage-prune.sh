#!/usr/bin/env bash
# usage-prune.sh — remove a period's journal entries and mirrored drawers
# together (spec 0207 R18-R20). Never automatic.
#
# Usage:
#   bash scripts/usage-prune.sh <cli> <YYYY-MM> [--force]
#   bash scripts/usage-prune.sh <cli> <YYYY-MM> --unprune
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec node --disable-warning=ExperimentalWarning "$SCRIPT_DIR/lib/usage-store/prune.js" "$@"
