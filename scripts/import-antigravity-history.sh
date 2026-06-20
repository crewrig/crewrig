#!/bin/bash
# import-antigravity-history.sh — Backfill MemPalace with pre-existing Antigravity CLI transcripts.
#
# Antigravity CLI stores its session history in a single JSONL file at
# ~/.gemini/antigravity-cli/history.jsonl (one JSON record per line), unlike
# Gemini CLI's per-session JSON layout under ~/.gemini/tmp/. This script feeds
# that file into MemPalace via 'mempalace mine --mode convos', so that work
# done BEFORE MemPalace was installed becomes searchable from any future session.
#
# NOTE — mempalace mine directory vs file:
#   'mempalace mine' accepts a directory path (not a file path directly).
#   Since Antigravity CLI uses a single JSONL file rather than a directory of
#   session files, this script creates a temporary directory, hard-links (or
#   copies) the history file into it, and passes that temp directory to
#   'mempalace mine'. The temp directory is removed automatically on exit.
#   This was verified against the Gemini importer pattern (import-gemini-history.sh)
#   which passes a directory to --mode convos; no file-path variant exists in
#   the public 'mempalace mine' interface.
#
# The import is idempotent: 'mempalace mine' tracks already-filed files and
# skips them on subsequent runs.

set -e
# shellcheck source=scripts/lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

AGY_HISTORY_FILE="${ANTIGRAVITY_HISTORY_FILE:-$HOME/.gemini/antigravity-cli/history.jsonl}"
WING_NAME="${MEMPALACE_HISTORY_WING:-transcripts}"
AGENT_LABEL="${MEMPALACE_HISTORY_AGENT:-antigravity-cli}"
EXTRACT_MODE="${MEMPALACE_EXTRACT:-exchange}"

echo "===================================================="
echo "  Antigravity CLI → MemPalace history import"
echo "===================================================="
echo ""

# --- Prerequisites ---
command -v fzf >/dev/null 2>&1 || {
  echo "Error: fzf is required." >&2
  echo "Install with: brew install fzf (macOS) or apt-get install fzf (Linux)" >&2
  exit 1
}

MEMPALACE_PY="$(detect_mempalace_python || true)"
if [ -z "$MEMPALACE_PY" ]; then
  echo "Error: 'mempalace' is not importable from any candidate Python." >&2
  echo "Install MemPalace first: pipx install mempalace" >&2
  exit 1
fi

# --- Source check ---
if [ ! -f "$AGY_HISTORY_FILE" ]; then
  echo "Error: Antigravity CLI history file not found: $AGY_HISTORY_FILE" >&2
  echo "Override with ANTIGRAVITY_HISTORY_FILE=<path> if your install uses a different location." >&2
  exit 1
fi

RECORD_COUNT=$(grep -c . "$AGY_HISTORY_FILE" 2>/dev/null || echo 0)
TOTAL_SIZE=$(du -h "$AGY_HISTORY_FILE" 2>/dev/null | awk '{print $1}')

echo "Source:        $AGY_HISTORY_FILE"
echo "Records:       $RECORD_COUNT"
echo "File size:     ~$TOTAL_SIZE"
echo ""
echo "MemPalace target:"
echo "  Interpreter: $MEMPALACE_PY"
echo "  Wing:        $WING_NAME"
echo "  Agent label: $AGENT_LABEL"
echo "  Extract:     $EXTRACT_MODE  (use MEMPALACE_EXTRACT=general to switch)"
echo ""

# --- Prepare temp directory (mempalace mine requires a directory, not a file) ---
TMPDIR_MINE=""
cleanup_tmpdir() {
  if [ -n "$TMPDIR_MINE" ] && [ -d "$TMPDIR_MINE" ]; then
    rm -rf "$TMPDIR_MINE"
  fi
}
trap cleanup_tmpdir EXIT

TMPDIR_MINE="$(mktemp -d)"
# Hard-link preferred (no copy overhead); fall back to cp if cross-device.
ln "$AGY_HISTORY_FILE" "$TMPDIR_MINE/history.jsonl" 2>/dev/null \
  || cp "$AGY_HISTORY_FILE" "$TMPDIR_MINE/history.jsonl"

# --- Step 1: dry-run preview ---
echo "Step 1 — dry-run preview"
RUN_DRY=$(echo -e "yes\nno" | fzf --height 10% --header "Run a dry-run first to preview what will be filed?")
if [ "$RUN_DRY" = "yes" ]; then
  echo ""
  "$MEMPALACE_PY" -m mempalace mine "$TMPDIR_MINE" \
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
  echo "Import canceled."
  exit 0
fi

echo ""
"$MEMPALACE_PY" -m mempalace mine "$TMPDIR_MINE" \
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
