#!/usr/bin/env bash
# usage-mirror.sh — run the MemPalace catch-up for pending usage-store
# mirror markers (spec 0207 R13). With no arguments, walks
# <root>/mirror/pending/ only — O(pending), the shape journal.js spawns
# detached after a write. --reconcile additionally recomputes the pending
# set from the WHOLE journal first (spec 0207 step 7(d)), for after
# mirror/ or cache/ is lost, or MemPalace installed later.
#
# Usage:
#   bash scripts/usage-mirror.sh
#   bash scripts/usage-mirror.sh --reconcile
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec node --disable-warning=ExperimentalWarning "$SCRIPT_DIR/lib/usage-store/mirror.js" "$@"
