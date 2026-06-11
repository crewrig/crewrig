#!/bin/bash
# import-claude-history.sh — Backfill MemPalace with pre-existing Claude Code transcripts.
#
# Claude Code stores every session as a .jsonl file under
# ~/.claude/projects/<project-hash>/<session-id>.jsonl. This script feeds those
# files into MemPalace via 'mempalace mine --mode convos', so that work done
# BEFORE MemPalace was installed becomes searchable from any future session.
#
# The import is idempotent: 'mempalace mine' tracks already-filed files and
# skips them on subsequent runs.

set -e
# shellcheck source=scripts/lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

CLAUDE_PROJECTS="${CLAUDE_PROJECTS_DIR:-$HOME/.claude/projects}"
WING_NAME="${MEMPALACE_HISTORY_WING:-transcripts}"
AGENT_LABEL="${MEMPALACE_HISTORY_AGENT:-claude-code}"
EXTRACT_MODE="${MEMPALACE_EXTRACT:-exchange}"

echo "===================================================="
echo "  Claude Code → MemPalace history import"
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
if [ ! -d "$CLAUDE_PROJECTS" ]; then
  echo "Error: Claude projects directory not found: $CLAUDE_PROJECTS"
  echo "Override with CLAUDE_PROJECTS_DIR=<path> if your install uses a different location."
  exit 1
fi

PROJECT_COUNT=$(find "$CLAUDE_PROJECTS" -maxdepth 1 -mindepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')
SESSION_COUNT=$(find "$CLAUDE_PROJECTS" -name "*.jsonl" -type f 2>/dev/null | wc -l | tr -d ' ')
TOTAL_SIZE=$(find "$CLAUDE_PROJECTS" -name "*.jsonl" -type f -print0 2>/dev/null | xargs -0 du -ch 2>/dev/null | tail -1 | awk '{print $1}')

if [ "$SESSION_COUNT" -eq 0 ]; then
  echo "No .jsonl session files found under $CLAUDE_PROJECTS — nothing to import."
  exit 0
fi

echo "Source:       $CLAUDE_PROJECTS"
echo "Projects:     $PROJECT_COUNT"
echo "Sessions:     $SESSION_COUNT files (~$TOTAL_SIZE)"
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
  "$MEMPALACE_PY" -m mempalace mine "$CLAUDE_PROJECTS" \
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
"$MEMPALACE_PY" -m mempalace mine "$CLAUDE_PROJECTS" \
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
