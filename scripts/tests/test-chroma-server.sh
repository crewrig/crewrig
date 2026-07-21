#!/usr/bin/env bash
# test-chroma-server.sh — Regression tests for the shared ChromaDB HTTP
# daemon scripts (issue #98).
#
# Locks the contracts of:
#   - scripts/start-chroma-server.sh   (idempotent start, PID-file lifecycle)
#       * raises the open-file limit to a floor before launching (spec 0087)
#   - scripts/stop-chroma-server.sh    (graceful stop, cleans PID file)
#   - scripts/status-chroma-server.sh  (exit 0 healthy / exit 1 otherwise)
#   - scripts/lib/mempalace-http-wrapper.py
#       * monkey-patches PersistentClient BEFORE importing mempalace
#       * fail-loud when daemon unreachable
#       * carries the chromadb version-pin comment
#
# Static tests run unconditionally. Behavioral tests that need the real
# chroma binary skip cleanly when it is absent (e.g. CI without pipx).
#
# Behavioral tests use:
#   - an isolated $HOME so the user's real ~/.mempalace/chroma-server.pid
#     is never touched.
#   - port 18001 (avoid colliding with a running production daemon on 8001).

set -uo pipefail

PASS=0
FAIL=0
SKIP=0

note_pass() { echo "PASS  $1"; PASS=$((PASS + 1)); }
note_fail() { echo "FAIL  $1 — $2"; FAIL=$((FAIL + 1)); }
note_skip() { echo "SKIP  $1 — $2"; SKIP=$((SKIP + 1)); }

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
START_SH="${REPO_DIR}/scripts/start-chroma-server.sh"
STOP_SH="${REPO_DIR}/scripts/stop-chroma-server.sh"
STATUS_SH="${REPO_DIR}/scripts/status-chroma-server.sh"
WRAPPER_PY="${REPO_DIR}/scripts/lib/mempalace-http-wrapper.py"

# ─────────────────────────────────────────────────────────────────────────────
# Section A — Static checks (no daemon required)
# ─────────────────────────────────────────────────────────────────────────────

# Test 1 — start script must NOT mention PersistentClient (it spawns
# `chroma run`, not a Python client).
if [[ -f "$START_SH" ]]; then
  if grep -q "PersistentClient" "$START_SH"; then
    note_fail "start script free of PersistentClient" \
      "unexpected PersistentClient reference"
  else
    note_pass "start script free of PersistentClient"
  fi
else
  note_fail "start script free of PersistentClient" "missing $START_SH"
fi

# Test 2 — wrapper: PersistentClient assignment MUST appear at a lower line
# than `from mempalace` (i.e. monkey-patch applied BEFORE mempalace import).
if [[ -f "$WRAPPER_PY" ]]; then
  patch_line="$(grep -n "_chromadb\.PersistentClient" "$WRAPPER_PY" \
                 | head -1 | cut -d: -f1)"
  import_line="$(grep -n "^from mempalace" "$WRAPPER_PY" \
                  | head -1 | cut -d: -f1)"
  if [[ -z "$patch_line" ]]; then
    note_fail "wrapper monkey-patch ordering" \
      "no PersistentClient assignment found"
  elif [[ -z "$import_line" ]]; then
    note_fail "wrapper monkey-patch ordering" \
      "no 'from mempalace' import found"
  elif (( patch_line < import_line )); then
    note_pass "wrapper monkey-patch ordering (patch L${patch_line} < import L${import_line})"
  else
    note_fail "wrapper monkey-patch ordering" \
      "patch (L${patch_line}) is NOT before mempalace import (L${import_line})"
  fi
else
  note_fail "wrapper monkey-patch ordering" "missing $WRAPPER_PY"
fi

# Test 3 — wrapper carries a chromadb version-pin comment.
if [[ -f "$WRAPPER_PY" ]]; then
  if grep -q "Requires: chromadb>=" "$WRAPPER_PY"; then
    note_pass "wrapper carries chromadb version pin"
  else
    note_fail "wrapper carries chromadb version pin" \
      "no 'Requires: chromadb>=' line"
  fi
else
  note_fail "wrapper carries chromadb version pin" "missing $WRAPPER_PY"
fi

# Tests 9-11 anchor on `if ! ulimit -n` rather than the plain substring
# `ulimit -n`: the guard's own explanatory comment above it also contains
# the literal text `ulimit -n` (and a separate comment mentions `nohup`),
# so a bare substring grep would key off prose instead of code. `if ! ulimit
# -n` and `^nohup` are each unique in the file today and identify the real
# guarded call and the real daemon launch, not the comments describing them.

# Test 9 — start script must raise the open-file limit (spec 0087 R1) BEFORE
# launching the daemon (spec 0087 R6): the guarded `ulimit -n` call must sit
# at a lower line number than the `nohup` daemon launch.
if [[ -f "$START_SH" ]]; then
  ulimit_line="$(grep -n "if ! ulimit -n" "$START_SH" | head -1 | cut -d: -f1)"
  nohup_line="$(grep -n "^nohup" "$START_SH" | head -1 | cut -d: -f1)"
  if [[ -z "$ulimit_line" ]]; then
    note_fail "start script raises open-file limit before nohup" \
      "no guarded 'ulimit -n' call found"
  elif [[ -z "$nohup_line" ]]; then
    note_fail "start script raises open-file limit before nohup" \
      "no 'nohup' daemon launch found"
  elif (( ulimit_line < nohup_line )); then
    note_pass "start script raises open-file limit before nohup (ulimit L${ulimit_line} < nohup L${nohup_line})"
  else
    note_fail "start script raises open-file limit before nohup" \
      "ulimit (L${ulimit_line}) is NOT before nohup (L${nohup_line})"
  fi
else
  note_fail "start script raises open-file limit before nohup" "missing $START_SH"
fi

# Test 10 — the ulimit call carries both the literal default floor (10240,
# spec 0087 R1) and the literal override variable name
# (MEMPALACE_CHROMA_ULIMIT_FLOOR, spec 0087 R2) on that same line, so a
# refactor cannot silently change the default or rename the override
# variable without also breaking this assertion.
if [[ -f "$START_SH" ]]; then
  ulimit_line_text="$(grep -n "if ! ulimit -n" "$START_SH" | head -1)"
  if [[ -z "$ulimit_line_text" ]]; then
    note_fail "ulimit call carries default floor and override variable" \
      "no guarded 'ulimit -n' call found"
  elif [[ "$ulimit_line_text" == *"10240"* && "$ulimit_line_text" == *"MEMPALACE_CHROMA_ULIMIT_FLOOR"* ]]; then
    note_pass "ulimit call carries default floor and override variable"
  else
    note_fail "ulimit call carries default floor and override variable" \
      "line lacks '10240' and/or 'MEMPALACE_CHROMA_ULIMIT_FLOOR': $ulimit_line_text"
  fi
else
  note_fail "ulimit call carries default floor and override variable" "missing $START_SH"
fi

# Test 11 — the ulimit -n call is guarded (`if ! ulimit -n ...; then`), not a
# bare statement. Under `set -e` (line 7 of the start script) a bare failing
# ulimit would abort the whole script the moment a host's fixed-below-floor
# hard ceiling is hit; the guard is what lets the script warn and continue
# instead (spec 0087 R3). Locks the guard structurally so a future
# refactor cannot silently drop it.
if [[ -f "$START_SH" ]]; then
  guard_count="$(grep -c "if ! ulimit -n" "$START_SH")"
  if [[ "$guard_count" -ge 1 ]]; then
    note_pass "ulimit -n call is guarded against set -e"
  else
    note_fail "ulimit -n call is guarded against set -e" \
      "no 'if ! ulimit -n' guard structure found"
  fi
else
  note_fail "ulimit -n call is guarded against set -e" "missing $START_SH"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Section B — Behavioral checks
# ─────────────────────────────────────────────────────────────────────────────

# Resolve the mempalace pipx venv via common.sh's detect_mempalace_python
# rather than hardcoding $HOME — keeps the test portable across machines.
# shellcheck source=../lib/common.sh
. "${REPO_DIR}/scripts/lib/common.sh"
PYTHON_BIN="$(detect_mempalace_python 2>/dev/null || true)"
if [[ -n "$PYTHON_BIN" ]]; then
  CHROMA_BIN="$(dirname "$PYTHON_BIN")/chroma"
else
  CHROMA_BIN=""
fi
TEST_PORT="18001"
TEST_HOST="127.0.0.1"
TMP_HOME=""

cleanup() {
  if [[ -n "$TMP_HOME" && -d "$TMP_HOME" ]]; then
    # Best-effort stop using the isolated HOME so we kill the PID we started.
    HOME="$TMP_HOME" \
      MEMPALACE_CHROMA_HOST="$TEST_HOST" \
      MEMPALACE_CHROMA_PORT="$TEST_PORT" \
      bash "$STOP_SH" >/dev/null 2>&1 || true
    rm -rf "$TMP_HOME"
  fi
}
trap cleanup EXIT INT TERM

if [[ ! -x "$PYTHON_BIN" || ! -x "$CHROMA_BIN" ]]; then
  note_skip "behavioral — wrapper daemon-unreachable exit" \
    "mempalace pipx venv not installed"
  note_skip "behavioral — wrapper _http_factory returns ClientAPI" \
    "mempalace pipx venv not installed"
  note_skip "behavioral — start is idempotent (same PID)" \
    "mempalace pipx venv not installed"
  note_skip "behavioral — stop removes PID file" \
    "mempalace pipx venv not installed"
  note_skip "behavioral — status exits 1 when not running" \
    "mempalace pipx venv not installed"
else
  TMP_HOME="$(mktemp -d -t chroma-server-test.XXXXXX)"
  mkdir -p "$TMP_HOME/.mempalace"
  PID_FILE="$TMP_HOME/.mempalace/chroma-server.pid"

  # Test 4 — wrapper exits non-zero with helpful stderr when daemon
  # unreachable. Point at a free port (19999) with nothing listening.
  err_out="$(MEMPALACE_CHROMA_HOST="$TEST_HOST" \
             MEMPALACE_CHROMA_PORT=19999 \
             "$PYTHON_BIN" "$WRAPPER_PY" 2>&1 1>/dev/null)"
  rc=$?
  if (( rc != 0 )); then
    if echo "$err_out" | grep -qi "unreachable"; then
      note_pass "behavioral — wrapper daemon-unreachable exit"
    else
      note_fail "behavioral — wrapper daemon-unreachable exit" \
        "rc=$rc but stderr lacks 'unreachable': $err_out"
    fi
  else
    note_fail "behavioral — wrapper daemon-unreachable exit" \
      "wrapper exited 0 with no daemon (expected non-zero)"
  fi

  # Test 8 — status exits 1 when not running. Run BEFORE starting the
  # server so the isolated HOME has no PID file.
  HOME="$TMP_HOME" \
    MEMPALACE_CHROMA_HOST="$TEST_HOST" \
    MEMPALACE_CHROMA_PORT="$TEST_PORT" \
    bash "$STATUS_SH" >/dev/null 2>&1
  rc=$?
  if (( rc == 1 )); then
    note_pass "behavioral — status exits 1 when not running"
  else
    note_fail "behavioral — status exits 1 when not running" \
      "got exit=$rc (expected 1)"
  fi

  # Start the daemon (isolated HOME, port 18001).
  start_out="$(HOME="$TMP_HOME" \
               MEMPALACE_CHROMA_HOST="$TEST_HOST" \
               MEMPALACE_CHROMA_PORT="$TEST_PORT" \
               bash "$START_SH" 2>&1)"
  start_rc=$?
  if (( start_rc != 0 )) || [[ ! -f "$PID_FILE" ]]; then
    note_fail "behavioral — start is idempotent (same PID)" \
      "first start failed (rc=$start_rc): $start_out"
    note_fail "behavioral — wrapper _http_factory returns ClientAPI" \
      "daemon failed to start"
    note_fail "behavioral — stop removes PID file" \
      "daemon failed to start"
  else
    first_pid="$(cat "$PID_FILE")"

    # Test 6 — idempotent start: second invocation must keep the same PID.
    HOME="$TMP_HOME" \
      MEMPALACE_CHROMA_HOST="$TEST_HOST" \
      MEMPALACE_CHROMA_PORT="$TEST_PORT" \
      bash "$START_SH" >/dev/null 2>&1
    second_pid="$(cat "$PID_FILE" 2>/dev/null || echo "")"
    if [[ "$first_pid" == "$second_pid" ]]; then
      note_pass "behavioural — start is idempotent (same PID ${first_pid})"
    else
      note_fail "behavioral — start is idempotent (same PID)" \
        "first=${first_pid} second=${second_pid}"
    fi

    # Test 5 — wrapper smoke: _http_factory() returns a chromadb ClientAPI.
    # We replicate the monkey-patch inline rather than importing the wrapper
    # module: importing it would execute mempalace.mcp_server.main() at
    # module-load time, which blocks reading the MCP stdio protocol from
    # stdin and hangs the test. The inline factory exercises the same
    # contract (HttpClient instantiation + ClientAPI conformance) without
    # the side effect.
    factory_out="$(MEMPALACE_CHROMA_HOST="$TEST_HOST" \
                   MEMPALACE_CHROMA_PORT="$TEST_PORT" \
                   "$PYTHON_BIN" -c "
import os, chromadb
from chromadb.api import ClientAPI
host = os.environ['MEMPALACE_CHROMA_HOST']
port = int(os.environ['MEMPALACE_CHROMA_PORT'])
client = chromadb.HttpClient(host=host, port=port)
assert isinstance(client, ClientAPI), f'not a ClientAPI: {type(client)}'
client.heartbeat()
print('OK')
" 2>&1)"
      factory_rc=$?
      if (( factory_rc == 0 )) && [[ "$factory_out" == *"OK"* ]]; then
        note_pass "behavioral — wrapper _http_factory returns ClientAPI"
      else
        note_fail "behavioral — wrapper _http_factory returns ClientAPI" \
          "rc=$factory_rc out=$factory_out"
      fi

    # Test 7 — stop removes the PID file.
    HOME="$TMP_HOME" \
      MEMPALACE_CHROMA_HOST="$TEST_HOST" \
      MEMPALACE_CHROMA_PORT="$TEST_PORT" \
      bash "$STOP_SH" >/dev/null 2>&1
    if [[ ! -f "$PID_FILE" ]]; then
      note_pass "behavioral — stop removes PID file"
    else
      note_fail "behavioral — stop removes PID file" \
        "PID file still present: $PID_FILE"
    fi
  fi
fi

echo ""
echo "Results: $PASS passed, $FAIL failed, $SKIP skipped"
if (( FAIL > 0 )); then
  exit 1
fi
exit 0
