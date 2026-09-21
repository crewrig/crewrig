#!/bin/bash
# usage-backfill.sh — replays the capture step for Claude Code, Gemini CLI
# and Copilot CLI against records already present on this machine (spec 0206
# R23), reusing the same per-CLI adapters and cursors the live hook path
# uses (scripts/lib/usage-capture/backfill.js). Does NOT cover Antigravity
# CLI (R23 — its capture channel exposes no durable history to replay) and
# touches none of the four scripts/import-*-history.sh scripts' sources,
# targets or state (R24 — a distinct wing, a distinct purpose).
#
# Usage:
#   bash scripts/usage-backfill.sh [--reset-cursors]
#
# --reset-cursors clears ~/.crewrig/usage/state/<cli>/ for the three covered
# CLIs first, so a machine whose spool was discarded before spec 0207 landed
# can re-derive everything from the CLIs' own durable history — the true
# record of source. It is also the recovery path for a live capture step
# that stopped firing because the wired in-repo absolute path moved out from
# under it (Risks — "the accepted cost of the in-repo absolute path"): this
# script is repo-resident, invoked directly, and depends on no manifest, so
# it re-derives whatever the dead live path missed.

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
node --disable-warning=ExperimentalWarning "$DIR/lib/usage-capture/backfill.js" "$@"
