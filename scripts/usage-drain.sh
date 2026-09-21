#!/usr/bin/env bash
# usage-drain.sh — the operator's one-shot, unbounded drain of 0206's
# spool/ into the journal (spec 0207 R-L). Every hook-triggered write
# already drains under a budget (CREWRIG_USAGE_DRAIN_BUDGET_MS, default
# 2000ms); this command pays the whole cost once, at a time the operator
# chooses (e.g. right after upgrading a machine that ran 0206 before 0207).
#
# Usage:
#   bash scripts/usage-drain.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
export CREWRIG_USAGE_DRAIN_BUDGET_MS="${CREWRIG_USAGE_DRAIN_BUDGET_MS:-0}"
exec node --disable-warning=ExperimentalWarning "$SCRIPT_DIR/lib/usage-store/journal.js"
