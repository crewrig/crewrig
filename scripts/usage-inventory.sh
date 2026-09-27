#!/usr/bin/env bash
# usage-inventory.sh — MemPalace-only drawer inventory and purge for the
# usage-record store's usage-records room (spec 0239, issue #1206). Never
# reads the local journal or mirror markers; works even when the local usage
# root does not exist.
#
# Usage:
#   bash scripts/usage-inventory.sh [list] [--wing <name>[,<name>...]] [--cli <cli>] [--period <YYYY-MM>] [--json]
#   bash scripts/usage-inventory.sh delete [--wing <name>[,<name>...]] [--cli <cli>] [--period <YYYY-MM>] [--json] [--commit [--confirm-count <N>]]
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec node --disable-warning=ExperimentalWarning "$SCRIPT_DIR/lib/usage-store/inventory.js" "$@"
