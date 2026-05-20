#!/bin/bash
# import-copilot-history.sh — Backfill MemPalace with pre-existing GitHub Copilot CLI transcripts.
#
# GitHub Copilot CLI stores each session as a directory at
# ~/.copilot/session-state/<session-id>/ containing an events.jsonl transcript.
# This script feeds those files into MemPalace via 'mempalace mine --mode convos',
# so that pre-existing Copilot sessions become searchable like Claude / Gemini ones.
#
# The import is idempotent: 'mempalace mine' tracks already-filed files.

set -e
# shellcheck source=scripts/lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

COPILOT_SESSIONS="${COPILOT_SESSIONS_DIR:-$HOME/.copilot/session-state}"
WING_NAME="${MEMPALACE_HISTORY_WING:-transcripts}"
AGENT_LABEL="${MEMPALACE_HISTORY_AGENT:-copilot-cli}"
EXTRACT_MODE="${MEMPALACE_EXTRACT:-exchange}"

echo "===================================================="
echo "  GitHub Copilot CLI → MemPalace history import"
echo "===================================================="
echo ""

# --- Prerequisites ---
command -v fzf >/dev/null 2>&1 || {
  echo "Error: fzf is required."
  echo "Install with: brew install fzf (macOS) or apt-get install fzf (Linux)"
  exit 1
}

MEMPALACE_PY="$(detect_mempalace_python || true)"
if [ -z "$MEMPALACE_PY" ]; then
  echo "Error: 'mempalace' is not importable from any candidate Python."
  echo "Install MemPalace first: pipx install mempalace"
  exit 1
fi

# --- Source check ---
if [ ! -d "$COPILOT_SESSIONS" ]; then
  echo "Error: Copilot session directory not found: $COPILOT_SESSIONS"
  echo "Override with COPILOT_SESSIONS_DIR=<path> if your install uses a different location."
  exit 1
fi

SESSION_COUNT=$(find "$COPILOT_SESSIONS" -maxdepth 1 -mindepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')
EVENTS_COUNT=$(find "$COPILOT_SESSIONS" -name "events.jsonl" -type f 2>/dev/null | wc -l | tr -d ' ')
TOTAL_SIZE=$(find "$COPILOT_SESSIONS" -name "events.jsonl" -type f -print0 2>/dev/null | xargs -0 du -ch 2>/dev/null | tail -1 | awk '{print $1}')

if [ "$EVENTS_COUNT" -eq 0 ]; then
  echo "No events.jsonl files found under $COPILOT_SESSIONS — nothing to import."
  exit 0
fi

echo "Source:       $COPILOT_SESSIONS"
echo "Sessions:     $SESSION_COUNT directories"
echo "Transcripts:  $EVENTS_COUNT files (~$TOTAL_SIZE)"
echo ""
echo "MemPalace target:"
echo "  Interpreter: $MEMPALACE_PY"
echo "  Wing:        $WING_NAME"
echo "  Agent label: $AGENT_LABEL"
echo "  Extract:     $EXTRACT_MODE  (use MEMPALACE_EXTRACT=general to switch)"
echo ""

# --- Step 1: dry-run preview ---
echo "Step 1 — dry-run preview"
RUN_DRY=$(echo -e "yes\nno" | fzf --height 10% --header "Run a dry-run first to preview what will be filed?")
if [ "$RUN_DRY" = "yes" ]; then
  echo ""
  "$MEMPALACE_PY" -m mempalace mine "$COPILOT_SESSIONS" \
    --mode convos \
    --wing "$WING_NAME" \
    --agent "$AGENT_LABEL" \
    --extract "$EXTRACT_MODE" \
    --dry-run
  echo ""
fi

# --- Step 2: confirm and run ---
echo "Step 2 — actual import"
echo "This will file conversations into MemPalace wing '$WING_NAME'."
echo "Re-runs are safe: already-filed files are skipped automatically."
echo ""
RUN_REAL=$(echo -e "yes\nno" | fzf --height 10% --header "Proceed with the import?")
if [ "$RUN_REAL" != "yes" ]; then
  echo "Import cancelled."
  exit 0
fi

echo ""
"$MEMPALACE_PY" -m mempalace mine "$COPILOT_SESSIONS" \
  --mode convos \
  --wing "$WING_NAME" \
  --agent "$AGENT_LABEL" \
  --extract "$EXTRACT_MODE"

echo ""
echo "===================================================="
echo "  Import complete"
echo "===================================================="
echo ""
echo "Verify with:"
echo "  $MEMPALACE_PY -m mempalace search '<keyword>'"
echo "  $MEMPALACE_PY -m mempalace status"
