#!/bin/bash
# mempalace-transcript.sh — Shared session transcript hook for Gemini CLI and Claude Code
#
# Persists session exchanges (user prompts, tool usage, agent responses) to
# MemPalace's "transcripts" wing. Called by tool-specific hook registrations.
#
# Input: JSON on stdin (hook event data from Gemini CLI or Claude Code)
# Output: none (all logging to stderr, stdout reserved for hook JSON response)
#
# Environment:
#   MEMPALACE_TRANSCRIPT_ENABLED - set to "1" to enable (default: disabled)
#   MEMPALACE_PYTHON             - Python binary with mempalace installed
#                                  (default: python3)
#   GEMINI_SESSION_ID / CLAUDE_SESSION_ID / COPILOT_SESSION_ID - session id
#   GEMINI_PROJECT_DIR / CLAUDE_PROJECT_DIR - project directory
#   (GitHub Copilot CLI does NOT export a $COPILOT_PROJECT_DIR — the project
#    path is read from the hook stdin JSON payload, with $PWD as fallback.)
#
# Requires: jq, mempalace (Python package)

set -euo pipefail

# --- Guard: opt-in only ---
if [ "${MEMPALACE_TRANSCRIPT_ENABLED:-0}" != "1" ]; then
  exit 0
fi

# --- Dependencies ---
command -v jq >/dev/null 2>&1 || { echo "mempalace-transcript: jq required" >&2; exit 0; }

# Detect a portable `timeout` binary. GNU coreutils ships `timeout(1)` on
# Linux out of the box; macOS does not. Homebrew's `coreutils` package
# provides `gtimeout`. Fall back to no timeout protection when neither is
# present — the issue-94 Stop-hook-loop risk returns, but rc=127 on every
# event (issue #210) is a worse failure mode than the rare hung-Python case.
if command -v timeout >/dev/null 2>&1; then
  _HOOK_TIMEOUT="timeout"
elif command -v gtimeout >/dev/null 2>&1; then
  _HOOK_TIMEOUT="gtimeout"
else
  _HOOK_TIMEOUT=""
  echo "mempalace-transcript: neither 'timeout' nor 'gtimeout' on PATH; persistence runs without timeout protection (install coreutils to restore it, e.g. 'brew install coreutils' on macOS)" >&2
fi

MEMPALACE_PYTHON="${MEMPALACE_PYTHON:-python3}"

# --- Read input ---
INPUT=$(cat)

# --- Detect tool and session ---
# Copilot CLI passes context as JSON on stdin and does not export a
# $COPILOT_PROJECT_DIR env var. Extract the project dir / session id from the
# JSON payload first (covers a few candidate field names used by the various
# CLI hook contracts), then fall back to env vars, then $PWD.
COPILOT_PROJECT_DIR_FROM_JSON=$(echo "$INPUT" | jq -r '.workspace_dir // .workspace // .project_dir // .projectDir // .cwd // empty' 2>/dev/null)
COPILOT_SESSION_ID_FROM_JSON=$(echo "$INPUT" | jq -r '.session_id // .sessionId // empty' 2>/dev/null)

SESSION_ID="${GEMINI_SESSION_ID:-${CLAUDE_SESSION_ID:-${COPILOT_SESSION_ID:-${COPILOT_SESSION_ID_FROM_JSON:-unknown}}}}"
# Resolve project dir from the git root so that worktree paths collapse to
# the canonical repository root (issue #92). Fallbacks: env vars from each
# CLI, JSON-embedded project dir from Copilot, then $PWD as last resort.
_GIT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || true)
PROJECT_DIR="${GEMINI_PROJECT_DIR:-${CLAUDE_PROJECT_DIR:-${COPILOT_PROJECT_DIR:-${COPILOT_PROJECT_DIR_FROM_JSON:-${_GIT_ROOT:-$(pwd)}}}}}"
PROJECT_NAME=$(basename "$PROJECT_DIR")
TODAY=$(date +%Y-%m-%d)
ROOM_ID="${PROJECT_NAME}-${TODAY}-${SESSION_ID:0:8}"

# --- Detect event type from input fields ---
HOOK_EVENT=$(echo "$INPUT" | jq -r '.hook_event_name // empty' 2>/dev/null)

# Skip high-frequency PostToolUse events — they generate too many writes
# for parallel agent sessions. Only Stop and SessionEnd carry session-level
# value (issue #91).
if [ "$HOOK_EVENT" = "PostToolUse" ]; then
  exit 0
fi

TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)
TOOL_INPUT=$(echo "$INPUT" | jq -r '.tool_input // empty' 2>/dev/null)

# --- Determine content based on available fields ---
CONTENT=""
ENTRY_TYPE=""

# User prompt (Claude Code: UserPromptSubmit)
PROMPT=$(echo "$INPUT" | jq -r '.prompt // empty' 2>/dev/null)
if [ -n "$PROMPT" ] && [ "$PROMPT" != "null" ]; then
  ENTRY_TYPE="user-prompt"
  CONTENT="[USER] $PROMPT"
fi

# Tool usage (Claude Code: PostToolUse / Gemini: AfterTool)
if [ -n "$TOOL_NAME" ] && [ "$TOOL_NAME" != "null" ] && [ -z "$CONTENT" ]; then
  ENTRY_TYPE="tool-use"
  TOOL_CMD=$(echo "$INPUT" | jq -r '.tool_input.command // .tool_input.file_path // .tool_input.pattern // "(no args)"' 2>/dev/null)
  CONTENT="[TOOL] ${TOOL_NAME}: ${TOOL_CMD}"
fi

# Agent response / stop (Claude Code: Stop)
STOP_REASON=$(echo "$INPUT" | jq -r '.stop_hook_active // empty' 2>/dev/null)
if [ "$HOOK_EVENT" = "Stop" ] && [ -z "$CONTENT" ]; then
  ENTRY_TYPE="agent-response"
  CONTENT="[AGENT] Session turn completed"
fi

# Session lifecycle (SessionStart / SessionEnd)
SOURCE=$(echo "$INPUT" | jq -r '.source // empty' 2>/dev/null)
if [ "$HOOK_EVENT" = "SessionStart" ] || [ "$HOOK_EVENT" = "SessionEnd" ]; then
  ENTRY_TYPE="session-lifecycle"
  CONTENT="[SESSION] ${HOOK_EVENT}: ${SOURCE:-unknown}"
fi

# Gemini-specific: BeforeAgent (user prompt equivalent)
USER_INPUT=$(echo "$INPUT" | jq -r '.user_input // .userInput // empty' 2>/dev/null)
if [ -n "$USER_INPUT" ] && [ "$USER_INPUT" != "null" ] && [ -z "$CONTENT" ]; then
  ENTRY_TYPE="user-prompt"
  CONTENT="[USER] $USER_INPUT"
fi

# Gemini-specific: AfterModel (agent response equivalent)
MODEL_RESPONSE=$(echo "$INPUT" | jq -r '.model_response // .modelResponse // empty' 2>/dev/null)
if [ -n "$MODEL_RESPONSE" ] && [ "$MODEL_RESPONSE" != "null" ] && [ -z "$CONTENT" ]; then
  ENTRY_TYPE="agent-response"
  # Truncate long responses to avoid oversized drawers
  CONTENT="[AGENT] ${MODEL_RESPONSE:0:2000}"
fi

# --- Persist to MemPalace via the v3.3.x tool_add_drawer wrapper ---
if [ -n "$CONTENT" ]; then
  # Pass content + room via env vars to avoid heredoc/quoting fragility.
  # Truncate content to 4000 chars to keep drawer size bounded.
  TRANSCRIPT_CONTENT="$(printf '%s' "$CONTENT" | head -c 4000)"
  TRANSCRIPT_ROOM="$ROOM_ID"
  TRANSCRIPT_AGENT="transcript-hook"

  # Capture Python stderr to a dedicated file so import/runtime errors are
  # visible instead of being swallowed into $STATUS (issue #93). The
  # `$_HOOK_TIMEOUT 5` wrapper (resolved at script init to `timeout` or
  # `gtimeout` per portability detection — issue #210) kills a hung Python
  # after 5 seconds so a MemPalace lock cannot stall the calling CLI
  # (issues #90, #94). `set +e`/`set -e` brackets the call so a non-zero
  # Python exit does not abort the hook — STATUS_RC carries the actual
  # outcome.
  _HOOK_ERR="${TMPDIR:-/tmp}/mempalace-hook-$$.err"
  trap 'rm -f "$_HOOK_ERR"' EXIT

  # Temporarily disable `set -e` so a non-zero Python exit does not abort
  # the hook before we can log the failure.
  set +e
  STATUS=$(
    TRANSCRIPT_CONTENT="$TRANSCRIPT_CONTENT" \
    TRANSCRIPT_ROOM="$TRANSCRIPT_ROOM" \
    TRANSCRIPT_AGENT="$TRANSCRIPT_AGENT" \
    ${_HOOK_TIMEOUT:+$_HOOK_TIMEOUT 5} "$MEMPALACE_PYTHON" - 2>"$_HOOK_ERR" <<'PYEOF'
import os, sys
try:
    from mempalace.mcp_server import tool_add_drawer
except ImportError as e:
    print(f"IMPORT_ERROR: {e}", file=sys.stderr)
    sys.exit(2)

result = tool_add_drawer(
    wing="transcripts",
    room=os.environ["TRANSCRIPT_ROOM"],
    content=os.environ["TRANSCRIPT_CONTENT"],
    added_by=os.environ["TRANSCRIPT_AGENT"],
)
if not result.get("success"):
    print(f"ADD_FAILED: {result.get('error', 'unknown')}", file=sys.stderr)
    sys.exit(3)
print("OK")
PYEOF
  )
  STATUS_RC=$?
  set -e
  if [ "$STATUS_RC" -eq 0 ]; then
    echo "mempalace-transcript: persisted ${ENTRY_TYPE} to transcripts/${ROOM_ID}" >&2
  else
    echo "mempalace-transcript: FAILED to persist ${ENTRY_TYPE} (rc=$STATUS_RC): $STATUS" >&2
    if [ -s "$_HOOK_ERR" ]; then
      cat "$_HOOK_ERR" >&2
    fi
  fi
fi

exit 0
