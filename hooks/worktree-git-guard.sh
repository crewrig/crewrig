#!/bin/bash
# worktree-git-guard.sh — Pre-tool guard that intercepts prohibited whole-tree
# git operations in shared ticket worktrees unless an exclusive claim is held (spec 0153).

set -e

# Read input from stdin if available
INPUT=""
if [ ! -t 0 ]; then
  INPUT=$(cat)
fi

# Extract command string and cwd from payload or env
CMD=""
CWD=""
if [ -n "$INPUT" ]; then
  CMD=$(echo "$INPUT" | jq -r '.tool_input.command // .command // .tool_input // empty' 2>/dev/null || true)
  CWD=$(echo "$INPUT" | jq -r '.cwd // .workspace_dir // .project_dir // empty' 2>/dev/null || true)
fi

if [ -z "$CMD" ] && [ -n "$1" ]; then
  CMD="$1"
fi
if [ -z "$CWD" ]; then
  CWD="$(pwd -P)"
fi

# Only enforce when inside a ticket worktree under .worktrees/
if ! echo "$CWD" | grep -q '/\.worktrees/'; then
  exit 0
fi

# Extract ticket id from worktree path
TICKET_ID=$(echo "$CWD" | sed -n 's|.*/\.worktrees/\([^/]*\).*|\1|p')
if [ -z "$TICKET_ID" ]; then
  exit 0
fi

# Check if command contains prohibited whole-tree operations
IS_PROHIBITED=0

case "$CMD" in
  *"git reset --hard"*|*"git checkout -- ."*|*"git checkout ."*|*"git clean "*|*"git clean"*|*"git worktree remove --force"*|*"git worktree remove -f"*)
    IS_PROHIBITED=1
    ;;
  *"git stash"*)
    if ! echo "$CMD" | grep -qE "git stash (list|show|pop|apply|drop)"; then
      IS_PROHIBITED=1
    fi
    ;;
esac

if [ "$IS_PROHIBITED" -eq 1 ]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
  CLAIM_SCRIPT="$SCRIPT_DIR/scripts/worktree-claim.sh"
  if [ -x "$CLAIM_SCRIPT" ]; then
    CLAIM_STATUS=$("$CLAIM_SCRIPT" status --ticket "$TICKET_ID" 2>/dev/null || true)
    if ! echo "$CLAIM_STATUS" | grep -q "state: claimed"; then
      echo "mempalace-git-guard: prohibited whole-tree operation in shared worktree '.worktrees/$TICKET_ID' refused (Spec 0114 R2 / Spec 0153 R2). Take an exclusive claim via 'bash scripts/worktree-claim.sh take --agent <name>' or use 'run' before attempting whole-tree git operations." >&2
      exit 1
    fi
  fi
fi

exit 0
