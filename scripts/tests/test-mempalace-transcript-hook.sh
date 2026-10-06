#!/bin/bash
# test-mempalace-transcript-hook.sh — Regression tests for hooks/mempalace-transcript.sh.
#
# Pins the contracts surfaced by issues #90–#94, and spec 0161/0164:
#
#   #90 — The curl invocation MUST be guarded by `--max-time 5`
#   #91 — Hook fires on every PostToolUse — too frequent for parallel agents.
#         When the hook event is `PostToolUse`, the script MUST exit 0
#         WITHOUT spawning curl.
#   #92 — PROJECT_NAME wrong in git worktrees.
#         PROJECT_DIR derivation MUST use `git rev-parse --show-toplevel`.
#   #93 — stderr silently swallowed.
#         The curl invocation MUST NOT merge stderr into stdout via `2>&1`.
#   spec 0164 — Python bypassed replaced with direct HTTP JSON RPC via curl.
#
# Observation boundary (spec 0247 R32, issue #1329): every behavioural case
# observes the hook from the outside, through a loopback stub daemon
# (scripts/tests/fixtures/mempalace-transcript/stub-daemon.ts) that records
# what the shared MemPalace MCP daemon would see — never through a fake
# `curl` on PATH. The same inputs and expected outcomes therefore hold
# against the shell hook and its TypeScript successor, which spawns no curl.
# The three source-text cases (#90, #92, #93) still read the shell file.
#
# Usage:
#   bash scripts/tests/test-mempalace-transcript-hook.sh
#
# Exit code: 0 if all tests pass, 1 if any test fails.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
HOOK="$SCRIPT_DIR/hooks/mempalace-transcript.sh"

if [ ! -f "$HOOK" ]; then
  echo "FATAL: cannot find $HOOK" >&2
  exit 2
fi

if ! command -v node >/dev/null 2>&1; then
  echo "FATAL: node is required to run the stub daemon" >&2
  exit 2
fi

STUB_DAEMON="$SCRIPT_DIR/scripts/tests/fixtures/mempalace-transcript/stub-daemon.ts"
if [ ! -f "$STUB_DAEMON" ]; then
  echo "FATAL: cannot find $STUB_DAEMON" >&2
  exit 2
fi

# The stub listens on loopback only; keep any configured HTTP proxy away from it.
export NO_PROXY="127.0.0.1,localhost${NO_PROXY:+,$NO_PROXY}"
export no_proxy="127.0.0.1,localhost${no_proxy:+,$no_proxy}"

pass=0
fail=0
skip=0

# ONE exit trap, installed once and never replaced (plan review v1-F5): a
# later `trap ... EXIT` would replace this one, so every case registers its
# temp dir and every stub registers its pid instead of re-installing a trap.
_CLEANUP_DIRS=""
_STUB_PIDS=""
cleanup() {
  local pid dir
  for pid in $_STUB_PIDS; do
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  done
  for dir in $_CLEANUP_DIRS; do
    rm -rf "$dir"
  done
}
trap cleanup EXIT

# new_tmpdir — create a temp dir registered for cleanup and assign it to the
# global NEW_TMPDIR. It does not print the path: `VAR="$(new_tmpdir)"` would
# register the dir inside a subshell, and the registration would be lost.
new_tmpdir() {
  NEW_TMPDIR="$(mktemp -d)"
  _CLEANUP_DIRS="$_CLEANUP_DIRS $NEW_TMPDIR"
}

# start_stub <mode> <dir> — start the stub daemon in the background and wait
# for its port file (the readiness signal), polling every 100 ms for up to
# 5 s. Sets STUB_PID, STUB_PORT and STUB_LOG (one JSON line per request).
start_stub() {
  local mode="$1" dir="$2" tries=0
  STUB_LOG="$dir/stub-requests.jsonl"
  local port_file="$dir/stub-port"
  rm -f "$port_file"
  : > "$STUB_LOG"
  node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON "$STUB_DAEMON" \
    --port-file "$port_file" --log "$STUB_LOG" --mode "$mode" \
    >"$dir/stub-stdout" 2>"$dir/stub-stderr" &
  STUB_PID=$!
  _STUB_PIDS="$_STUB_PIDS $STUB_PID"
  while [ ! -s "$port_file" ]; do
    tries=$((tries + 1))
    if [ "$tries" -gt 50 ]; then
      echo "FATAL: stub daemon did not report a port within 5 s: $(cat "$dir/stub-stderr" 2>/dev/null)" >&2
      exit 2
    fi
    sleep 0.1
  done
  STUB_PORT="$(tr -d '[:space:]' < "$port_file")"
}

# stop_stub — stop the stub started last (the EXIT trap catches any other).
stop_stub() {
  kill "$STUB_PID" 2>/dev/null || true
  wait "$STUB_PID" 2>/dev/null || true
}

# closed_port — print a loopback port nothing listens on: bind an ephemeral
# port, then release it. Connecting to it is refused at once, which the shell
# hook reports as DAEMON_UNREACHABLE (unlike an HTTP 500, which it counts as
# persisted).
closed_port() {
  node -e 'const s=require("node:net").createServer();s.listen(0,"127.0.0.1",()=>{const p=s.address().port;s.close(()=>process.stdout.write(String(p)))})'
}

# stub_contents — print the `content` argument of every recorded request.
stub_contents() {
  jq -r '.body.params.arguments.content // empty' "$STUB_LOG" 2>/dev/null
}

record() {
  local outcome="$1"
  local name="$2"
  local detail="${3:-}"
  if [ "$outcome" = "PASS" ]; then
    echo "PASS  $name${detail:+ — $detail}"
    pass=$((pass + 1))
  elif [ "$outcome" = "SKIP" ]; then
    echo "SKIP  $name${detail:+ — $detail}"
    skip=$((skip + 1))
  else
    echo "FAIL  $name${detail:+ — $detail}"
    fail=$((fail + 1))
  fi
}

# -------------------------------------------------------------------------
# Test 1 — Issue #90: curl call must have --max-time 5
# -------------------------------------------------------------------------
if grep -nE 'curl.*--max-time 5' "$HOOK" >/dev/null; then
  record PASS "issue-90: curl invocation uses --max-time 5"
else
  record FAIL "issue-90: curl invocation uses --max-time 5" \
    "no \`curl ... --max-time 5\` pattern found in $HOOK"
fi

# -------------------------------------------------------------------------
# Test 2 — Issue #91: PostToolUse events must NOT reach the daemon.
# Observed at the daemon: the stub records no request. A token file is
# supplied so that a hook which did NOT skip the event would reach the stub.
# -------------------------------------------------------------------------
new_tmpdir; TMPDIR_T2="$NEW_TMPDIR"
echo "token" > "$TMPDIR_T2/token"
start_stub ok "$TMPDIR_T2"

POST_TOOL_JSON='{"hook_event_name":"PostToolUse","tool_name":"Bash","tool_input":{"command":"ls"}}'

(
  export MEMPALACE_MCP_HOST=127.0.0.1 MEMPALACE_MCP_PORT="$STUB_PORT"
  export MEMPALACE_DAEMON_TOKEN_FILE="$TMPDIR_T2/token"
  export MEMPALACE_TRANSCRIPT_ENABLED=1
  printf '%s' "$POST_TOOL_JSON" | bash "$HOOK" >/dev/null 2>&1
) || true
stop_stub

if [ -s "$STUB_LOG" ]; then
  record FAIL "issue-91: PostToolUse skipped (no curl spawn)" \
    "the daemon received a request on PostToolUse: $(cat "$STUB_LOG")"
else
  record PASS "issue-91: PostToolUse skipped (no curl spawn)"
fi

# -------------------------------------------------------------------------
# Test 3 — Issue #92: PROJECT_DIR derivation must use git rev-parse.
# -------------------------------------------------------------------------
if grep -nE 'git[[:space:]]+rev-parse[[:space:]]+--show-toplevel' "$HOOK" >/dev/null; then
  record PASS "issue-92: PROJECT_DIR uses git rev-parse --show-toplevel"
else
  record FAIL "issue-92: PROJECT_DIR uses git rev-parse --show-toplevel" \
    "no \`git rev-parse --show-toplevel\` call found in $HOOK"
fi

# -------------------------------------------------------------------------
# Test 4 — Issue #93: stderr must not be merged into stdout.
# -------------------------------------------------------------------------
CURL_LINE="$(grep -nE 'curl -K - -s -S' "$HOOK" || true)"
if [ -z "$CURL_LINE" ]; then
  record FAIL "issue-93: stderr not merged with stdout on curl call" \
    "cannot locate curl invocation line"
elif echo "$CURL_LINE" | grep -q '2>&1'; then
  record FAIL "issue-93: stderr not merged with stdout on curl call" \
    "found '2>&1' on curl invocation: $CURL_LINE"
else
  record PASS "issue-93: stderr not merged with stdout on curl call"
fi

# -------------------------------------------------------------------------
# Test 7/8 — spec 0074 / issue #510 (R1/R2): success logging is gated by
# MEMPALACE_TRANSCRIPT_QUIET.
# -------------------------------------------------------------------------
new_tmpdir; TMPDIR_T7="$NEW_TMPDIR"
start_stub ok "$TMPDIR_T7"

STOP_JSON_T7='{"hook_event_name":"Stop"}'
export TOKEN_PATH_MOCK="$TMPDIR_T7/token"
echo "token" > "$TOKEN_PATH_MOCK"
export MEMPALACE_PATH="$TMPDIR_T7/palace"

STDERR_QUIET="$TMPDIR_T7/stderr-quiet"
(
  export MEMPALACE_MCP_HOST=127.0.0.1 MEMPALACE_MCP_PORT="$STUB_PORT"
  export MEMPALACE_TRANSCRIPT_ENABLED=1
  export MEMPALACE_TRANSCRIPT_QUIET=1
  printf '%s' "$STOP_JSON_T7" | bash "$HOOK" >/dev/null 2>"$STDERR_QUIET"
) || true

if grep -q 'mempalace-transcript: persisted' "$STDERR_QUIET"; then
  record FAIL "issue-510-r1: success log suppressed when MEMPALACE_TRANSCRIPT_QUIET=1" \
    "found 'persisted' line on stderr: $(grep 'mempalace-transcript: persisted' "$STDERR_QUIET")"
else
  record PASS "issue-510-r1: success log suppressed when MEMPALACE_TRANSCRIPT_QUIET=1"
fi

STDERR_DEFAULT="$TMPDIR_T7/stderr-default"
(
  export MEMPALACE_MCP_HOST=127.0.0.1 MEMPALACE_MCP_PORT="$STUB_PORT"
  export MEMPALACE_TRANSCRIPT_ENABLED=1
  unset MEMPALACE_TRANSCRIPT_QUIET
  printf '%s' "$STOP_JSON_T7" | bash "$HOOK" >/dev/null 2>"$STDERR_DEFAULT"
) || true
stop_stub

if grep -q 'mempalace-transcript: persisted' "$STDERR_DEFAULT"; then
  record PASS "issue-510-r2: success log present when MEMPALACE_TRANSCRIPT_QUIET unset"
else
  record FAIL "issue-510-r2: success log present when MEMPALACE_TRANSCRIPT_QUIET unset" \
    "no 'persisted' line on stderr: $(cat "$STDERR_DEFAULT")"
fi

# -------------------------------------------------------------------------
# Test 9 — spec 0074 / issue #510 (R3): failure logging is UNCONDITIONAL.
# The daemon is unreachable: a released loopback port refuses the connection
# (an HTTP 500 would not do — the shell hook counts any HTTP answer without
# a JSON-RPC error as persisted).
# -------------------------------------------------------------------------
STDERR_FAIL="$TMPDIR_T7/stderr-fail"
CLOSED_PORT_T9="$(closed_port)"
(
  export MEMPALACE_MCP_HOST=127.0.0.1 MEMPALACE_MCP_PORT="$CLOSED_PORT_T9"
  export MEMPALACE_TRANSCRIPT_ENABLED=1
  export MEMPALACE_TRANSCRIPT_QUIET=1
  printf '%s' "$STOP_JSON_T7" | bash "$HOOK" >/dev/null 2>"$STDERR_FAIL"
) || true

if grep -q 'mempalace-transcript: FAILED to persist' "$STDERR_FAIL"; then
  record PASS "issue-510-r3: failure log still emitted when MEMPALACE_TRANSCRIPT_QUIET=1"
else
  record FAIL "issue-510-r3: failure log still emitted when MEMPALACE_TRANSCRIPT_QUIET=1" \
    "no 'FAILED to persist' line on stderr: $(cat "$STDERR_FAIL")"
fi

# -------------------------------------------------------------------------
# Test 23/24 — spec 0161 / issue #866: prompt submissions distinguish
# genuine human prompts from automated harness injections.
# -------------------------------------------------------------------------
new_tmpdir; TMPDIR_T23="$NEW_TMPDIR"
start_stub ok "$TMPDIR_T23"
CONTENT_OUT="$TMPDIR_T23/captured-content.txt"

USER_PROMPT_JSON='{"hook_event_name":"UserPromptSubmit","prompt":"Run the test suite"}'
(
  export MEMPALACE_MCP_HOST=127.0.0.1 MEMPALACE_MCP_PORT="$STUB_PORT"
  export MEMPALACE_TRANSCRIPT_ENABLED=1
  mkdir -p "$TMPDIR_T23/.mempalace/server/111111111111111111111111"
  echo "token" > "$TMPDIR_T23/.mempalace/server/111111111111111111111111/token"
  export HOME="$TMPDIR_T23"
  printf '%s' "$USER_PROMPT_JSON" | bash "$HOOK" >/dev/null 2>&1
) || true
stub_contents > "$CONTENT_OUT"

if [ -f "$CONTENT_OUT" ] && grep -q '^\[USER\] Run the test suite' "$CONTENT_OUT"; then
  record PASS "spec-0161-r1/r2: human prompt classified as [USER] (user-prompt)"
else
  record FAIL "spec-0161-r1/r2: human prompt classified as [USER] (user-prompt)" \
    "captured content: $(cat "$CONTENT_OUT" 2>/dev/null)"
fi

rm -f "$CONTENT_OUT"
: > "$STUB_LOG"
HARNESS_TASK_JSON='{"hook_event_name":"UserPromptSubmit","prompt":"<task-notification>\n<task-id>bqhfosl1o</task-id>\n<summary>CI pass</summary>\n</task-notification>"}'
(
  export MEMPALACE_MCP_HOST=127.0.0.1 MEMPALACE_MCP_PORT="$STUB_PORT"
  export MEMPALACE_TRANSCRIPT_ENABLED=1
  export HOME="$TMPDIR_T23"
  printf '%s' "$HARNESS_TASK_JSON" | bash "$HOOK" >/dev/null 2>&1
) || true

HARNESS_REMINDER_JSON='{"hook_event_name":"UserPromptSubmit","prompt":"<system-reminder>Remember to verify CI</system-reminder>"}'
(
  export MEMPALACE_MCP_HOST=127.0.0.1 MEMPALACE_MCP_PORT="$STUB_PORT"
  export MEMPALACE_TRANSCRIPT_ENABLED=1
  export HOME="$TMPDIR_T23"
  printf '%s' "$HARNESS_REMINDER_JSON" | bash "$HOOK" >/dev/null 2>&1
) || true
stop_stub
stub_contents > "$CONTENT_OUT"

if [ -f "$CONTENT_OUT" ] && grep -q '^\[HARNESS\] <task-notification>' "$CONTENT_OUT" \
   && grep -q '^\[HARNESS\] <system-reminder>' "$CONTENT_OUT"; then
  record PASS "spec-0161-r1/r3: harness injections reclassified as [HARNESS] (harness-injection)"
else
  record FAIL "spec-0161-r1/r3: harness injections reclassified as [HARNESS] (harness-injection)" \
    "captured content: $(cat "$CONTENT_OUT" 2>/dev/null)"
fi

# -------------------------------------------------------------------------
# Test 25/26 — spec 0167 / issue #973: injectable daemon token file path
# and graceful DAEMON_UNREACHABLE exit when token is absent.
# -------------------------------------------------------------------------
new_tmpdir; TMPDIR_T25="$NEW_TMPDIR"
start_stub ok "$TMPDIR_T25"

# argv recorder (issue #1247): `curl` and `git` wrappers ahead of the real
# binaries on PATH. Each appends its own argv to captured-argv.txt, then execs
# the real binary, so the hook still reaches the stub. A regression back to
# `-H "Authorization: Bearer ..."` shows up as a token substring in that log.
ARGV_RECORDER="$TMPDIR_T25/argv-recorder"
mkdir -p "$ARGV_RECORDER"
for _tool in curl git; do
  _real="$(command -v "$_tool")"
  cat > "$ARGV_RECORDER/$_tool" <<EOF
#!/bin/bash
printf '%s %s\n' "$_tool" "\$*" >> "$TMPDIR_T25/captured-argv.txt"
exec "$_real" "\$@"
EOF
  chmod +x "$ARGV_RECORDER/$_tool"
done

EXPLICIT_TOKEN_FILE="$TMPDIR_T25/custom-token"
echo "custom-secret-token" > "$EXPLICIT_TOKEN_FILE"

(
  export PATH="$ARGV_RECORDER:$PATH"
  export MEMPALACE_MCP_HOST=127.0.0.1 MEMPALACE_MCP_PORT="$STUB_PORT"
  export MEMPALACE_TRANSCRIPT_ENABLED=1
  export MEMPALACE_DAEMON_TOKEN_FILE="$EXPLICIT_TOKEN_FILE"
  unset TOKEN_PATH_MOCK
  printf '%s' "$STOP_JSON_T7" | bash "$HOOK" >/dev/null 2>&1
) || true
stop_stub
jq -r '.authorization // empty' "$STUB_LOG" > "$TMPDIR_T25/captured-auth.txt" 2>/dev/null

if [ -f "$TMPDIR_T25/captured-auth.txt" ] && grep -q 'custom-secret-token' "$TMPDIR_T25/captured-auth.txt"; then
  record PASS "spec-0167-r1: MEMPALACE_DAEMON_TOKEN_FILE injects explicit bearer token"
else
  record FAIL "spec-0167-r1: MEMPALACE_DAEMON_TOKEN_FILE injects explicit bearer token" \
    "captured auth: $(cat "$TMPDIR_T25/captured-auth.txt" 2>/dev/null)"
fi

# Argv-absence guard (#1247): the token must never appear on the argv of any
# process the hook spawns — only on the channel the assertion above proves
# reaches the daemon. This mirrors test-mcp-daemon.sh's own jq-argv guard
# (section 18) so a regression back to `-H "Authorization: Bearer ..."` fails
# loud here too, not just via a capture that happens to still succeed. The
# daemon must have received the token, so the check cannot pass vacuously.
if grep -qF 'Bearer custom-secret-token' "$TMPDIR_T25/captured-auth.txt" 2>/dev/null \
   && [ -f "$TMPDIR_T25/captured-argv.txt" ] \
   && ! grep -qF 'custom-secret-token' "$TMPDIR_T25/captured-argv.txt"; then
  record PASS "issue-1247: bearer token never appears on curl's argv"
else
  record FAIL "issue-1247: bearer token never appears on curl's argv" \
    "captured argv: $(cat "$TMPDIR_T25/captured-argv.txt" 2>/dev/null)"
fi

STDERR_MISSING="$TMPDIR_T25/stderr-missing"
(
  export PATH="$TMPDIR_T25:$PATH"
  export MEMPALACE_TRANSCRIPT_ENABLED=1
  export HOME="$TMPDIR_T25/empty-home"
  mkdir -p "$HOME"
  unset MEMPALACE_DAEMON_TOKEN_FILE TOKEN_PATH_MOCK
  printf '%s' "$STOP_JSON_T7" | bash "$HOOK" >/dev/null 2>"$STDERR_MISSING"
) || true

if grep -q 'DAEMON_UNREACHABLE: token file not found' "$STDERR_MISSING"; then
  record PASS "spec-0167-r3: missing token logs DAEMON_UNREACHABLE diagnostic and exits 0"
else
  record FAIL "spec-0167-r3: missing token logs DAEMON_UNREACHABLE diagnostic and exits 0" \
    "stderr: $(cat "$STDERR_MISSING" 2>/dev/null)"
fi

# -------------------------------------------------------------------------
# Summary
# -------------------------------------------------------------------------
echo
echo "Summary: $pass passed, $fail failed, $skip skipped"

if [ "$fail" -gt 0 ]; then
  exit 1
fi
exit 0
