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

pass=0
fail=0
skip=0

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
# Test 2 — Issue #91: PostToolUse events must NOT spawn curl.
# -------------------------------------------------------------------------
TMPDIR_T2="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_T2"' EXIT

CURL_WRAPPER="$TMPDIR_T2/curl"
cat > "$CURL_WRAPPER" <<'INNER'
#!/bin/bash
touch "$TMPDIR_T2/curl_called"
exit 0
INNER
chmod +x "$CURL_WRAPPER"

POST_TOOL_JSON='{"hook_event_name":"PostToolUse","tool_name":"Bash","tool_input":{"command":"ls"}}'

(
  export PATH="$TMPDIR_T2:$PATH"
  export MEMPALACE_TRANSCRIPT_ENABLED=1
  printf '%s' "$POST_TOOL_JSON" | bash "$HOOK" >/dev/null 2>&1
) || true

if [ -f "$TMPDIR_T2/curl_called" ]; then
  record FAIL "issue-91: PostToolUse skipped (no curl spawn)" \
    "curl was executed on PostToolUse"
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
CURL_LINE="$(grep -nE 'curl -s -S' "$HOOK" || true)"
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
TMPDIR_T7="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_T2" "$TMPDIR_T7"' EXIT

OK_CURL="$TMPDIR_T7/curl"
cat > "$OK_CURL" <<'EOF'
#!/bin/bash
echo '{"jsonrpc": "2.0", "id": 1, "result": {"isError": false, "content": [{"text": "OK"}]}}'
exit 0
EOF
chmod +x "$OK_CURL"

STOP_JSON_T7='{"hook_event_name":"Stop"}'
export TOKEN_PATH_MOCK="$TMPDIR_T7/token"
echo "token" > "$TOKEN_PATH_MOCK"
export MEMPALACE_PATH="$TMPDIR_T7/palace"

STDERR_QUIET="$TMPDIR_T7/stderr-quiet"
(
  export PATH="$TMPDIR_T7:$PATH"
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
  export PATH="$TMPDIR_T7:$PATH"
  export MEMPALACE_TRANSCRIPT_ENABLED=1
  unset MEMPALACE_TRANSCRIPT_QUIET
  printf '%s' "$STOP_JSON_T7" | bash "$HOOK" >/dev/null 2>"$STDERR_DEFAULT"
) || true

if grep -q 'mempalace-transcript: persisted' "$STDERR_DEFAULT"; then
  record PASS "issue-510-r2: success log present when MEMPALACE_TRANSCRIPT_QUIET unset"
else
  record FAIL "issue-510-r2: success log present when MEMPALACE_TRANSCRIPT_QUIET unset" \
    "no 'persisted' line on stderr: $(cat "$STDERR_DEFAULT")"
fi

# -------------------------------------------------------------------------
# Test 9 — spec 0074 / issue #510 (R3): failure logging is UNCONDITIONAL.
# -------------------------------------------------------------------------
FAIL_CURL="$TMPDIR_T7/curl-fail"
cat > "$FAIL_CURL" <<'EOF'
#!/bin/bash
echo "error" >&2
exit 1
EOF
chmod +x "$FAIL_CURL"

STDERR_FAIL="$TMPDIR_T7/stderr-fail"
(
  export PATH="$TMPDIR_T7:$PATH"
  export MEMPALACE_TRANSCRIPT_ENABLED=1
  export MEMPALACE_TRANSCRIPT_QUIET=1
  # rename to curl
  mv "$FAIL_CURL" "$TMPDIR_T7/curl"
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
TMPDIR_T23="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_T2" "$TMPDIR_T7" "$TMPDIR_T23"' EXIT

RECORD_CURL="$TMPDIR_T23/curl"
CONTENT_OUT="$TMPDIR_T23/captured-content.txt"
cat > "$RECORD_CURL" <<EOF
#!/bin/bash
# extract the payload from -d
payload=""
while [ \$# -gt 0 ]; do
  if [ "\$1" = "-d" ]; then
    payload="\$2"
    break
  fi
  shift
done
content="\$(echo "\$payload" | jq -r '.params.arguments.content // empty')"
echo "\$content" >> "$CONTENT_OUT"
echo '{"jsonrpc": "2.0", "id": 1, "result": {"isError": false, "content": [{"text": "OK"}]}}'
exit 0
EOF
chmod +x "$RECORD_CURL"

USER_PROMPT_JSON='{"hook_event_name":"UserPromptSubmit","prompt":"Run the test suite"}'
(
  export PATH="$TMPDIR_T23:$PATH"
  export MEMPALACE_TRANSCRIPT_ENABLED=1
  mkdir -p "$TMPDIR_T23/.mempalace/server/111111111111111111111111"
  echo "token" > "$TMPDIR_T23/.mempalace/server/111111111111111111111111/token"
  export HOME="$TMPDIR_T23"
  printf '%s' "$USER_PROMPT_JSON" | bash "$HOOK" >/dev/null 2>&1
) || true

if [ -f "$CONTENT_OUT" ] && grep -q '^\[USER\] Run the test suite' "$CONTENT_OUT"; then
  record PASS "spec-0161-r1/r2: human prompt classified as [USER] (user-prompt)"
else
  record FAIL "spec-0161-r1/r2: human prompt classified as [USER] (user-prompt)" \
    "captured content: $(cat "$CONTENT_OUT" 2>/dev/null)"
fi

rm -f "$CONTENT_OUT"
HARNESS_TASK_JSON='{"hook_event_name":"UserPromptSubmit","prompt":"<task-notification>\n<task-id>bqhfosl1o</task-id>\n<summary>CI pass</summary>\n</task-notification>"}'
(
  export PATH="$TMPDIR_T23:$PATH"
  export MEMPALACE_TRANSCRIPT_ENABLED=1
  export HOME="$TMPDIR_T23"
  printf '%s' "$HARNESS_TASK_JSON" | bash "$HOOK" >/dev/null 2>&1
) || true

HARNESS_REMINDER_JSON='{"hook_event_name":"UserPromptSubmit","prompt":"<system-reminder>Remember to verify CI</system-reminder>"}'
(
  export PATH="$TMPDIR_T23:$PATH"
  export MEMPALACE_TRANSCRIPT_ENABLED=1
  export HOME="$TMPDIR_T23"
  printf '%s' "$HARNESS_REMINDER_JSON" | bash "$HOOK" >/dev/null 2>&1
) || true

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
TMPDIR_T25="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_T2" "$TMPDIR_T7" "$TMPDIR_T23" "$TMPDIR_T25"' EXIT

EXPLICIT_TOKEN_CURL="$TMPDIR_T25/curl"
cat > "$EXPLICIT_TOKEN_CURL" <<EOF
#!/bin/bash
auth_header=""
while [ \$# -gt 0 ]; do
  if [ "\$1" = "-H" ] && [[ "\$2" =~ ^Authorization:[[:space:]]*Bearer ]]; then
    auth_header="\$2"
    break
  fi
  shift
done
echo "\$auth_header" > "$TMPDIR_T25/captured-auth.txt"
echo '{"jsonrpc": "2.0", "id": 1, "result": {"isError": false, "content": [{"text": "OK"}]}}'
exit 0
EOF
chmod +x "$EXPLICIT_TOKEN_CURL"

EXPLICIT_TOKEN_FILE="$TMPDIR_T25/custom-token"
echo "custom-secret-token" > "$EXPLICIT_TOKEN_FILE"

(
  export PATH="$TMPDIR_T25:$PATH"
  export MEMPALACE_TRANSCRIPT_ENABLED=1
  export MEMPALACE_DAEMON_TOKEN_FILE="$EXPLICIT_TOKEN_FILE"
  unset TOKEN_PATH_MOCK
  printf '%s' "$STOP_JSON_T7" | bash "$HOOK" >/dev/null 2>&1
) || true

if [ -f "$TMPDIR_T25/captured-auth.txt" ] && grep -q 'custom-secret-token' "$TMPDIR_T25/captured-auth.txt"; then
  record PASS "spec-0167-r1: MEMPALACE_DAEMON_TOKEN_FILE injects explicit bearer token"
else
  record FAIL "spec-0167-r1: MEMPALACE_DAEMON_TOKEN_FILE injects explicit bearer token" \
    "captured auth: $(cat "$TMPDIR_T25/captured-auth.txt" 2>/dev/null)"
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
