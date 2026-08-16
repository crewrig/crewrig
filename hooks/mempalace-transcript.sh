#!/bin/bash
# mempalace-transcript.sh — Shared session transcript hook for Claude Code, Gemini CLI,
#                            GitHub Copilot CLI and Antigravity CLI
#
# Persists session exchanges (user prompts, tool usage, agent responses) to
# MemPalace's "transcripts" wing. Called by tool-specific hook registrations.
#
# Input:  JSON on stdin (hook event data from any of the four CLIs).
#         Antigravity ALSO passes the lifecycle event name as the first positional
#         argument, because its payload carries no `hook_event_name` field. Any
#         other caller passes no argument, which is what keeps every
#         Antigravity-specific path below dormant for them (spec 0116 R11).
# Output: nothing on stdout for Claude Code, Gemini CLI and Copilot CLI — all
#         logging goes to stderr. For Antigravity, a single `{}` on stdout: the
#         CLI requires a JSON object from every handler, and an empty one is
#         non-steering (only `{"decision": "continue"}` blocks a Stop).
#
# Environment:
#   MEMPALACE_TRANSCRIPT_ENABLED - set to "1" to enable (default: disabled)
#   MEMPALACE_TRANSCRIPT_QUIET   - set to "1" to silence success logging;
#                                  failures are still logged
#                                  (default: disabled / success logs shown)
#   MEMPALACE_MCP_HOST           - shared MemPalace MCP HTTP daemon host (ADR-0016)
#                                  (default: 127.0.0.1)
#   MEMPALACE_MCP_PORT           - shared MemPalace MCP HTTP daemon port (ADR-0016)
#                                  (default: 41893)
#   GEMINI_SESSION_ID / CLAUDE_SESSION_ID / COPILOT_SESSION_ID - session id
#   GEMINI_PROJECT_DIR / CLAUDE_PROJECT_DIR - project directory
#   (GitHub Copilot CLI does NOT export a $COPILOT_PROJECT_DIR — the project
#    path is read from the hook stdin JSON payload, with $PWD as fallback.)
#
# Inner Python payload exit codes (surfaced by the hook as `rc=<n>` on the
# failure log line, alongside the matching stderr prefix). The hook itself
# always exits 0 — a failed persistence never fails the agent's turn.
#   3  ADD_FAILED:              the drawer write was refused
#   4  DAEMON_UNREACHABLE:      the shared ChromaDB daemon did not answer
#
# Requires: jq, curl

set -euo pipefail

# --- Antigravity CLI: the event name arrives as an argument (spec 0116 R5) ---
# The Antigravity payload carries no `hook_event_name`, so the manifest tells the
# hook which event fired. Empty for Claude Code / Gemini CLI / Copilot CLI, whose
# manifests pass no argument — every Antigravity-specific path below is gated on
# it, which is what makes requirement 11 (no regression) true by construction.
CREWRIG_ANTIGRAVITY_EVENT="${1:-}"

# Antigravity requires a JSON object on stdout from every handler (spec 0116 R10).
# An empty object is the non-steering answer for the one event registered here:
# on `Stop`, only `"decision":"continue"` blocks the stop, and an object without
# that key cannot. The other three CLIs get nothing on stdout, exactly as before.
antigravity_ack() {
  if [ -n "$CREWRIG_ANTIGRAVITY_EVENT" ]; then
    printf '{}\n'
  fi
}

# ONE exit trap, installed here and never replaced. Two reasons it lives at the
# top rather than at each `exit 0`:
#   - the acknowledgement then survives an abort. `set -euo pipefail` makes a
#     malformed payload abort at the first `jq` read, long before any explicit
#     call site would be reached, and R10 is not conditional on the payload
#     parsing.
#   - a later `trap ... EXIT` REPLACES rather than appends, so the temp-file
#     cleanup that used to install its own trap now routes through here. Adding
#     a second `trap ... EXIT` anywhere below would silently disarm this one.
# `${_HOOK_ERR:-}` because the variable is only assigned much further down.
_hook_cleanup() {
  rm -f "${_HOOK_ERR:-}"
  antigravity_ack
}
trap _hook_cleanup EXIT

# --- Guard: opt-in only ---
if [ "${MEMPALACE_TRANSCRIPT_ENABLED:-0}" != "1" ]; then
  exit 0
fi

# Custom root-CA / native-TLS delegation (spec 0084): inherit user-consented
# trust for any network this hook performs.
if [ -f "${HOME}/.crewrig/tls-env.sh" ]; then
  # shellcheck source=/dev/null
  . "${HOME}/.crewrig/tls-env.sh"
fi

# --- Dependencies ---
command -v jq >/dev/null 2>&1 || { echo "mempalace-transcript: jq required" >&2; exit 0; }
command -v curl >/dev/null 2>&1 || { echo "mempalace-transcript: curl required" >&2; exit 0; }

# --- Read input ---
INPUT=$(cat)

# --- Detect tool and session ---
# Copilot CLI passes context as JSON on stdin and does not export a
# $COPILOT_PROJECT_DIR env var. Extract the project dir / session id from the
# JSON payload first (covers a few candidate field names used by the various
# CLI hook contracts), then fall back to env vars, then $PWD.
COPILOT_PROJECT_DIR_FROM_JSON=$(echo "$INPUT" | jq -r '.workspace_dir // .workspace // .project_dir // .projectDir // .cwd // empty' 2>/dev/null)
COPILOT_SESSION_ID_FROM_JSON=$(echo "$INPUT" | jq -r '.session_id // .sessionId // empty' 2>/dev/null)

if [ -n "$CREWRIG_ANTIGRAVITY_EVENT" ]; then
  # Antigravity: the conversation id IS the session id (spec 0116 R8). Read it
  # explicitly rather than appending to the chain below — Antigravity lives under
  # ~/.gemini/, so an appended fallback would lose to $GEMINI_SESSION_ID if that
  # variable ever appeared.
  _AGY_CONV=$(echo "$INPUT" | jq -r '.conversationId // empty' 2>/dev/null)
  SESSION_ID="${_AGY_CONV:-unknown}"
else
SESSION_ID="${GEMINI_SESSION_ID:-${CLAUDE_SESSION_ID:-${COPILOT_SESSION_ID:-${COPILOT_SESSION_ID_FROM_JSON:-unknown}}}}"
fi
# Resolve project dir from the git root so that worktree paths collapse to
# the canonical repository root (issue #92). Fallbacks: env vars from each
# CLI, JSON-embedded project dir from Copilot, then $PWD as last resort.
_GIT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || true)
if [ -n "$CREWRIG_ANTIGRAVITY_EVENT" ]; then
  # spec 0116 R9: workspacePaths[0] when present, existing fallback chain when not
  # (it was observed empty in a headless run outside a workspace).
  _AGY_WS=$(echo "$INPUT" | jq -r '.workspacePaths[0] // empty' 2>/dev/null)
  PROJECT_DIR="${_AGY_WS:-${_GIT_ROOT:-$(pwd)}}"
else
PROJECT_DIR="${GEMINI_PROJECT_DIR:-${CLAUDE_PROJECT_DIR:-${COPILOT_PROJECT_DIR:-${COPILOT_PROJECT_DIR_FROM_JSON:-${_GIT_ROOT:-$(pwd)}}}}}"
fi
PROJECT_NAME=$(basename "$PROJECT_DIR")
TODAY=$(date +%Y-%m-%d)
ROOM_ID="${PROJECT_NAME}-${TODAY}-${SESSION_ID:0:8}"

# --- Detect event type from input fields ---
HOOK_EVENT=$(echo "$INPUT" | jq -r '.hook_event_name // empty' 2>/dev/null)
if [ -z "$HOOK_EVENT" ] && [ -n "$CREWRIG_ANTIGRAVITY_EVENT" ]; then
  HOOK_EVENT="$CREWRIG_ANTIGRAVITY_EVENT"
fi

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

_is_harness_injection() {
  local payload="$1"
  case "$payload" in
    *"<task-notification"*|*"<system-reminder"*|*"<system-message"*|*"<SYSTEM_MESSAGE"*|*"<task-status"*|*"<command-status"*|*"<harness-notification"*|*"<notification"*|*"[Message] timestamp="*)
      return 0
      ;;
  esac
  if echo "$payload" | grep -Eq '^[[:space:]]*<([a-zA-Z0-9_-]+-(notification|reminder|message|status)|system-[a-zA-Z0-9_-]+|task-[a-zA-Z0-9_-]+|harness-[a-zA-Z0-9_-]+|SYSTEM_MESSAGE|system-reminder|task-notification)[^>]*>'; then
    return 0
  fi
  return 1
}

# Antigravity CLI (spec 0116 R7). Placed first: no Antigravity payload carries
# .prompt/.tool_name/.user_input/.model_response, so none of the branches below
# can fire for one, and every later branch guards on an empty $CONTENT.
if [ -n "$CREWRIG_ANTIGRAVITY_EVENT" ]; then
  case "$CREWRIG_ANTIGRAVITY_EVENT" in
    PreInvocation)
      ENTRY_TYPE="session-lifecycle"
      _AGY_N=$(echo "$INPUT" | jq -r '.invocationNum // empty' 2>/dev/null)
      _AGY_MODEL=$(echo "$INPUT" | jq -r '.modelName // empty' 2>/dev/null)
      CONTENT="[SESSION] PreInvocation: invocation ${_AGY_N:-?} (${_AGY_MODEL:-unknown})"
      ;;
    Stop)
      ENTRY_TYPE="agent-response"
      _AGY_REASON=$(echo "$INPUT" | jq -r '.terminationReason // empty' 2>/dev/null)
      CONTENT="[AGENT] Session turn completed (${_AGY_REASON:-unknown})"
      ;;
  esac
fi

# User prompt (Claude Code: UserPromptSubmit)
PROMPT=$(echo "$INPUT" | jq -r '.prompt // empty' 2>/dev/null)
if [ -n "$PROMPT" ] && [ "$PROMPT" != "null" ]; then
  if _is_harness_injection "$PROMPT"; then
    ENTRY_TYPE="harness-injection"
    CONTENT="[HARNESS] $PROMPT"
  else
    ENTRY_TYPE="user-prompt"
    CONTENT="[USER] $PROMPT"
  fi
fi

# Tool usage (Claude Code: PostToolUse / Gemini: AfterTool)
if [ -n "$TOOL_NAME" ] && [ "$TOOL_NAME" != "null" ] && [ -z "$CONTENT" ]; then
  ENTRY_TYPE="tool-use"
  TOOL_CMD=$(echo "$INPUT" | jq -r '.tool_input.command // .tool_input.file_path // .tool_input.pattern // "(no args)"' 2>/dev/null)
  CONTENT="[TOOL] ${TOOL_NAME}: ${TOOL_CMD}"
fi

# Agent response / stop (Claude Code: Stop)
STOP_REASON=$(echo "$INPUT" | jq -r '.stop_hook_active // empty' 2>/dev/null)
TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // .transcriptPath // empty' 2>/dev/null)
if [ "$HOOK_EVENT" = "Stop" ] && [ -z "$CONTENT" ]; then
  ENTRY_TYPE="agent-response"
  SUMMARY=""
  if [ -n "$TRANSCRIPT_PATH" ] && [ -f "$TRANSCRIPT_PATH" ]; then
    SUMMARY=$(tail -n 20 "$TRANSCRIPT_PATH" 2>/dev/null | jq -r 'select(.type=="PLANNER_RESPONSE" or .type=="ASSISTANT_RESPONSE" or .type=="RESPONSE") | .content // (.tool_calls[].name // empty)' 2>/dev/null | tail -n 5 | tr '\n' ' ' | head -c 500)
  fi
  if [ -n "$SUMMARY" ]; then
    CONTENT="[AGENT] $SUMMARY"
  else
    CONTENT="[AGENT] Session turn completed"
  fi
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
  if _is_harness_injection "$USER_INPUT"; then
    ENTRY_TYPE="harness-injection"
    CONTENT="[HARNESS] $USER_INPUT"
  else
    ENTRY_TYPE="user-prompt"
    CONTENT="[USER] $USER_INPUT"
  fi
fi

# Gemini-specific: AfterModel (agent response equivalent)
MODEL_RESPONSE=$(echo "$INPUT" | jq -r '.model_response // .modelResponse // empty' 2>/dev/null)
if [ -n "$MODEL_RESPONSE" ] && [ "$MODEL_RESPONSE" != "null" ] && [ -z "$CONTENT" ]; then
  ENTRY_TYPE="agent-response"
  # Truncate long responses to avoid oversized drawers
  CONTENT="[AGENT] ${MODEL_RESPONSE:0:2000}"
fi

# --- Persist to MemPalace via MCP ---
if [ -n "$CONTENT" ]; then
  # Pass content + room via env vars to avoid heredoc/quoting fragility.
  # Truncate content to 4000 chars to keep drawer size bounded.
  TRANSCRIPT_CONTENT="$(printf '%s' "$CONTENT" | head -c 4000)"
  TRANSCRIPT_ROOM="$ROOM_ID"
  TRANSCRIPT_AGENT="transcript-hook"
  _HOOK_ERR="${TMPDIR:-/tmp}/mempalace-hook-$$.err"

  # Temporarily disable `set -e` so a non-zero exit does not abort
  # the hook before we can log the failure.
  set +e
  STATUS=$(
    PALACE_PATH="${MEMPALACE_PATH:-${HOME}/.mempalace/palace}"
    if command -v shasum >/dev/null 2>&1; then
      SHA256=$(printf '%s' "$PALACE_PATH" | shasum -a 256 | awk '{print $1}')
    elif command -v sha256sum >/dev/null 2>&1; then
      SHA256=$(printf '%s' "$PALACE_PATH" | sha256sum | awk '{print $1}')
    else
      echo "DAEMON_UNREACHABLE: neither shasum nor sha256sum on PATH" >&2
      exit 4
    fi
    TOKEN_KEY="${SHA256:0:24}"
    TOKEN_FILE="${HOME}/.mempalace/server/$TOKEN_KEY/token"

    if [ ! -f "$TOKEN_FILE" ]; then
      wildcards=("${HOME}/.mempalace/server/"*"/token")
      if [ ${#wildcards[@]} -gt 0 ] && [ -f "${wildcards[0]}" ]; then
        TOKEN_FILE="${wildcards[0]}"
      fi
    fi

    if [ ! -f "$TOKEN_FILE" ]; then
      echo "DAEMON_UNREACHABLE: token file not found at $TOKEN_FILE" >&2
      exit 4
    fi
    TOKEN="$(cat "$TOKEN_FILE")"
    HOST="${MEMPALACE_MCP_HOST:-127.0.0.1}"
    PORT="${MEMPALACE_MCP_PORT:-41893}"

    PAYLOAD=$(jq -n \
      --arg room "$TRANSCRIPT_ROOM" \
      --arg content "$TRANSCRIPT_CONTENT" \
      --arg added_by "$TRANSCRIPT_AGENT" \
      '{
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "mempalace_add_drawer",
          arguments: {
            wing: "transcripts",
            room: $room,
            content: $content,
            added_by: $added_by
          }
        }
      }')

    CURL_OUT="$(curl -s -S --max-time 5 -X POST "http://${HOST}:${PORT}/mcp" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $TOKEN" \
      -d "$PAYLOAD" 2>"$_HOOK_ERR")"
    CURL_RC=$?

    if [ "$CURL_RC" -ne 0 ]; then
      echo "DAEMON_UNREACHABLE: ${HOST}:${PORT} — curl exit $CURL_RC: $(cat "$_HOOK_ERR" 2>/dev/null | tr '\n' ' ')" >&2
      exit 4
    fi

    MCP_ERR="$(echo "$CURL_OUT" | jq -r '.error.message // empty' 2>/dev/null)"
    if [ -n "$MCP_ERR" ]; then
      echo "ADD_FAILED: $MCP_ERR" >&2
      exit 3
    fi

    IS_ERR="$(echo "$CURL_OUT" | jq -r '.result.isError // false' 2>/dev/null)"
    if [ "$IS_ERR" = "true" ]; then
      TOOL_ERR="$(echo "$CURL_OUT" | jq -r '.result.content[0].text // empty' 2>/dev/null)"
      echo "ADD_FAILED: $TOOL_ERR" >&2
      exit 3
    fi

    echo "OK"
  )
  STATUS_RC=$?
  set -e
  if [ "$STATUS_RC" -eq 0 ]; then
    if [ "${MEMPALACE_TRANSCRIPT_QUIET:-0}" != "1" ]; then
      echo "mempalace-transcript: persisted ${ENTRY_TYPE} to transcripts/${ROOM_ID}" >&2
    fi
  else
    echo "mempalace-transcript: FAILED to persist ${ENTRY_TYPE} (rc=$STATUS_RC): $STATUS" >&2
    if [ -s "$_HOOK_ERR" ]; then
      cat "$_HOOK_ERR" >&2
    fi
  fi
fi

exit 0
