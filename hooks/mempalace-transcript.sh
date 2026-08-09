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
#   MEMPALACE_PYTHON             - Python binary with mempalace installed
#                                  (default: python3)
#   MEMPALACE_CHROMA_HOST        - shared ChromaDB HTTP daemon host (ADR-0006)
#                                  (default: 127.0.0.1)
#   MEMPALACE_CHROMA_PORT        - shared ChromaDB HTTP daemon port (ADR-0006)
#                                  (default: 8001)
#   MEMPALACE_CHROMA_MAX_CONNECTIONS            - ceiling on total connections
#                                  held open against the daemon (spec 0088,
#                                  shared verbatim with
#                                  scripts/lib/mempalace-http-wrapper.py)
#                                  (default: 8)
#   MEMPALACE_CHROMA_MAX_KEEPALIVE_CONNECTIONS  - ceiling on idle keep-alive
#                                  connections retained between requests
#                                  (spec 0088, shared verbatim with
#                                  scripts/lib/mempalace-http-wrapper.py)
#                                  (default: 4)
#   GEMINI_SESSION_ID / CLAUDE_SESSION_ID / COPILOT_SESSION_ID - session id
#   GEMINI_PROJECT_DIR / CLAUDE_PROJECT_DIR - project directory
#   (GitHub Copilot CLI does NOT export a $COPILOT_PROJECT_DIR — the project
#    path is read from the hook stdin JSON payload, with $PWD as fallback.)
#
# Inner Python payload exit codes (surfaced by the hook as `rc=<n>` on the
# failure log line, alongside the matching stderr prefix). The hook itself
# always exits 0 — a failed persistence never fails the agent's turn.
#   2  IMPORT_ERROR:            chromadb or mempalace unavailable
#   3  ADD_FAILED:              the drawer write was refused
#   4  DAEMON_UNREACHABLE:      the shared ChromaDB daemon did not answer
#   5  LOCK_BYPASS_INEFFECTIVE: the spec-0110 palace-write-lock relief could
#                               not be proven in force on the write path, so
#                               the entry was deliberately not persisted
#
# Requires: jq, mempalace (Python package)

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

  # Temporarily disable `set -e` so a non-zero Python exit does not abort
  # the hook before we can log the failure.
  set +e
  STATUS=$(
    TRANSCRIPT_CONTENT="$TRANSCRIPT_CONTENT" \
    TRANSCRIPT_ROOM="$TRANSCRIPT_ROOM" \
    TRANSCRIPT_AGENT="$TRANSCRIPT_AGENT" \
    ${_HOOK_TIMEOUT:+$_HOOK_TIMEOUT 5} "$MEMPALACE_PYTHON" - 2>"$_HOOK_ERR" <<'PYEOF'
import contextlib, os, sys

# ADR-0006 routing: patch chromadb.PersistentClient -> HttpClient BEFORE
# `mempalace.mcp_server` resolves the symbol (same technique as
# scripts/lib/mempalace-http-wrapper.py's _http_factory). Reuses that
# wrapper's own MEMPALACE_CHROMA_HOST / MEMPALACE_CHROMA_PORT env vars
# and defaults verbatim (spec 0073 R2).
try:
    import chromadb
except ImportError as e:
    print(f"IMPORT_ERROR: {e}", file=sys.stderr)
    sys.exit(2)

_host = os.environ.get("MEMPALACE_CHROMA_HOST", "127.0.0.1")
_port = int(os.environ.get("MEMPALACE_CHROMA_PORT", "8001"))
_max_connections = int(os.environ.get("MEMPALACE_CHROMA_MAX_CONNECTIONS", "8"))
_max_keepalive_connections = int(
    os.environ.get("MEMPALACE_CHROMA_MAX_KEEPALIVE_CONNECTIONS", "4")
)


def _build_pool_settings():
    # Fresh Settings per call, not a shared singleton — chromadb.HttpClient()
    # mutates its settings argument in place (spec 0088; same reasoning as
    # scripts/lib/mempalace-http-wrapper.py's _build_pool_settings()).
    return chromadb.Settings(
        chroma_http_max_connections=_max_connections,
        chroma_http_max_keepalive_connections=_max_keepalive_connections,
    )


def _http_factory(path=None, settings=None, **kwargs):
    return chromadb.HttpClient(host=_host, port=_port, settings=_build_pool_settings())


chromadb.PersistentClient = _http_factory

# Soft, logged, non-blocking skip on daemon-unreachable (spec 0073 R3/R4)
# — deliberately NOT the wrapper's fail-loud sys.exit(1): this is a
# per-event fire-and-forget attempt bounded by the outer bash `timeout 5`
# wrapper, not an MCP server startup gate. Distinct exit code (4) and
# stderr prefix (DAEMON_UNREACHABLE:) keep it greppable alongside the
# existing IMPORT_ERROR:/2 and ADD_FAILED:/3 convention. Passing settings=
# here (spec 0088 R4/delta-01) only changes this call's arguments — the
# try/except control flow below, and R10's soft-skip behavior, are
# unchanged.
try:
    chromadb.HttpClient(host=_host, port=_port, settings=_build_pool_settings()).heartbeat()
except Exception as e:  # acknowledged-exception: broad except intentional — any HttpClient.heartbeat() failure (connection refused, DNS, protocol) means the daemon is unreachable and must soft-skip this persistence attempt (spec 0073 R3); it does not block startup like the wrapper's probe, so it must not be silently swallowed or misclassified either
    print(f"DAEMON_UNREACHABLE: {_host}:{_port} — {e}", file=sys.stderr)
    sys.exit(4)

# --- spec 0110: relieve the palace write lock, for THIS subprocess only ---
#
# Every palace write this subprocess performs already leaves the process
# over HTTP to the shared ChromaDB daemon (the `chromadb.PersistentClient`
# substitution above, spec 0073/0088). `tool_add_drawer` does perform one
# local disk write of its own — `_wal_log` appends to the write-ahead log
# (`mcp_server._wal_log` -> `wal.py`) — but that append sits OUTSIDE
# `ChromaCollection._write_lock()`, so the palace lock never guarded it and
# relieving the lock leaves its exposure exactly as it already was. The
# relief therefore opens no race that did not already exist. The MemPalace
# library nevertheless has
# `ChromaCollection._write_lock()` take the on-disk per-palace lock, so any
# concurrent writer — a sibling agent, the memory server, a mine — made
# every transcript entry fail with `ADD_FAILED: palace ... is held by PID
# ...` and silently ended transcript persistence for the whole session
# (spec 0110 R1).
#
# R2 — THE ORDERING BELOW IS NORMATIVE. This block sits AFTER the
# heartbeat probe above, deliberately. A persistence attempt whose remote
# routing is not established must keep the lock's protection, so the relief
# must never be installed on a path that can still reach the on-disk
# palace. Do not move it earlier.
#
# R6 — the relief is confined to this interpreter: it rebinds an in-memory
# module attribute in the process this hook launched for one entry. It
# writes no file, sets no environment variable for anyone else, and neither
# releases nor removes a lock any other process holds. A concurrently
# running memory server or maintenance writer keeps the exact lock it takes
# today.
_lock_relief_hits = []


@contextlib.contextmanager
def _relieved_palace_lock(palace_path, *args, **kwargs):
    """Stand-in for `mempalace.palace.mine_palace_lock` — records, never locks."""
    _lock_relief_hits.append(palace_path)
    yield


try:
    import mempalace.backends.chroma as _mp_chroma
    import mempalace.palace as _mp_palace
except ImportError as e:
    print(f"IMPORT_ERROR: {e}", file=sys.stderr)
    sys.exit(2)

# R5 — patch every location the write path can resolve the primitive from,
# and do not assume a single one. Today `ChromaCollection._write_lock()`
# resolves it by a LATE import from `mempalace.palace`, so the canonical
# definition is the site that matters; but three sibling modules in the same
# library (`sync`, `miner`, `convo_miner`) bind the symbol at module load
# instead, and if `backends.chroma` ever joins them the canonical patch
# alone would quietly stop taking effect. Rebind the attribute wherever it
# already exists; never create one that does not, since that installs a name
# the library never reads and would mask a genuine relocation instead of
# surfacing it through the R3 guard below.
_relieved_modules = []
for _mp_mod in (_mp_palace, _mp_chroma):
    if hasattr(_mp_mod, "mine_palace_lock"):
        _mp_mod.mine_palace_lock = _relieved_palace_lock
        _relieved_modules.append(_mp_mod.__name__)

# R3/R4 — prove the relief is in force on the path the entry actually
# takes, and decline to persist when it is not. Three stages, cheapest
# first:
#
#   1. Coverage — at least one known location must have exposed the symbol.
#      An empty list means the library relocated it entirely.
#   2. Identity — every location that exposed it must now BE the stand-in.
#      Side-effect free.
#   3. Behavioural probe — enter the very method the write goes through,
#      `ChromaCollection._write_lock()`, and require that it reached the
#      stand-in. This is what makes the guard a statement about the real
#      write path rather than about a module attribute: if `_write_lock` is
#      renamed, or resolves the primitive from a location stage 1 does not
#      cover, the stand-in is never reached and we refuse to persist.
#
# The probe's palace path is synthetic and is NEVER the configured palace.
# The lock key is sha256(realpath(path)), so a synthetic path cannot contend
# with any real palace lock; it is passed only so `_write_lock` takes its
# locking branch instead of its documented palace_path-is-None no-op.
#
# The guard fails closed on purpose: an unprovable relief stops persistence
# rather than silently reverting to the lock-contention failure this spec
# exists to end. Distinct exit status (5) and stderr prefix
# (LOCK_BYPASS_INEFFECTIVE:) per R4 — no other failure this hook reports
# uses either (IMPORT_ERROR:/2, ADD_FAILED:/3, DAEMON_UNREACHABLE:/4).
_LOCK_PROBE_PALACE = "/nonexistent/crewrig-transcript-lock-relief-probe"

_relief_error = None
if not _relieved_modules:
    _relief_error = (
        "no known location exposes mine_palace_lock "
        f"(looked in {_mp_palace.__name__}, {_mp_chroma.__name__})"
    )
else:
    for _mp_mod in (_mp_palace, _mp_chroma):
        _resolved = getattr(_mp_mod, "mine_palace_lock", _relieved_palace_lock)
        if _resolved is not _relieved_palace_lock:
            _relief_error = f"{_mp_mod.__name__}.mine_palace_lock was not replaced"

if _relief_error is None:
    _hits_before = len(_lock_relief_hits)
    try:
        _probe = _mp_chroma.ChromaCollection(None, palace_path=_LOCK_PROBE_PALACE)
        with _probe._write_lock():
            pass
    except Exception as e:  # acknowledged-exception: broad except intentional — the probe's only job is to answer "is the relief in force on the write path"; every failure mode (renamed/removed _write_lock, changed ChromaCollection signature, a real lock acquired and raising MineAlreadyRunning) answers "no" and takes the identical R3 decline-and-report path, so narrowing the catch would let an unanticipated type escape as a bare traceback and forfeit exactly the distinguishability R4 mandates
        _relief_error = f"write-path probe raised {type(e).__name__}: {e}"
    else:
        if len(_lock_relief_hits) == _hits_before:
            _relief_error = (
                "ChromaCollection._write_lock() did not resolve the relieved "
                f"lock (patched: {', '.join(_relieved_modules)})"
            )

if _relief_error is not None:
    print(f"LOCK_BYPASS_INEFFECTIVE: {_relief_error}", file=sys.stderr)
    sys.exit(5)

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
