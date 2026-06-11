#!/bin/bash
# test-mempalace-transcript-hook.sh — Regression tests for hooks/mempalace-transcript.sh.
#
# Pins the contracts surfaced by issues #90–#94:
#
#   #90 — Direct Python import causes SQLite contention.
#         The Python invocation MUST be wrapped by `timeout` (or equivalent
#         guard) so a hung MemPalace lock cannot stall the calling CLI.
#
#   #91 — Hook fires on every PostToolUse — too frequent for parallel agents.
#         When the hook event is `PostToolUse`, the script MUST exit 0
#         WITHOUT spawning the Python subprocess.
#
#   #92 — PROJECT_NAME wrong in git worktrees.
#         PROJECT_DIR derivation MUST use `git rev-parse --show-toplevel`,
#         not `basename "$(pwd)"`, so that worktree paths resolve to the
#         canonical repository root.
#
#   #93 — stderr silently swallowed.
#         The Python invocation MUST NOT merge stderr into stdout via
#         `2>&1` — that hides import errors and MemPalace failures from
#         the log line.
#
#   #94 — No timeout (explicit `timeout` keyword check).
#         The Python invocation line MUST be prefixed with `timeout `.
#
# Usage:
#   bash scripts/tests/test-mempalace-transcript-hook.sh
#
# Exit code: 0 if all tests pass, 1 if any test fails.

# -e is intentionally omitted: pass/fail is tracked through counters.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
HOOK="$SCRIPT_DIR/hooks/mempalace-transcript.sh"

if [ ! -f "$HOOK" ]; then
  echo "FATAL: cannot find $HOOK" >&2
  exit 2
fi

pass=0
fail=0

record() {
  local outcome="$1"
  local name="$2"
  local detail="${3:-}"
  if [ "$outcome" = "PASS" ]; then
    echo "PASS  $name${detail:+ — $detail}"
    pass=$((pass + 1))
  else
    echo "FAIL  $name${detail:+ — $detail}"
    fail=$((fail + 1))
  fi
}

# -------------------------------------------------------------------------
# Test 1 — Issue #90: Python call must be guarded by a timeout wrapper.
#
# Heuristic: locate the line that invokes "$MEMPALACE_PYTHON" and assert
# that `timeout` appears on (or immediately before) that line. The fix may
# inline `timeout 5 "$MEMPALACE_PYTHON" ...` or use a variable, both are
# accepted.
# -------------------------------------------------------------------------
if grep -nE '(^|[[:space:]])timeout[[:space:]].*\$MEMPALACE_PYTHON|(^|[[:space:]])timeout[[:space:]].*"\$MEMPALACE_PYTHON"' "$HOOK" >/dev/null; then
  record PASS "issue-90: Python invocation guarded by timeout wrapper"
else
  record FAIL "issue-90: Python invocation guarded by timeout wrapper" \
    "no \`timeout ... \$MEMPALACE_PYTHON\` pattern found in $HOOK"
fi

# -------------------------------------------------------------------------
# Test 2 — Issue #91: PostToolUse events must NOT spawn Python.
#
# Behavioral test. We point MEMPALACE_PYTHON to a wrapper that creates a
# marker file whenever it is invoked, then feed a `PostToolUse` hook event
# to the script on stdin. If the wrapper ran, the marker exists → FAIL
# (the hook is still firing Python on PostToolUse).
# -------------------------------------------------------------------------
TMPDIR_T2="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_T2"' EXIT

MARKER="$TMPDIR_T2/python-was-called"
FAKE_PY="$TMPDIR_T2/fake-python"
cat > "$FAKE_PY" <<EOF
#!/bin/bash
touch "$MARKER"
# Drain stdin so the heredoc does not deadlock.
cat >/dev/null
echo "OK"
exit 0
EOF
chmod +x "$FAKE_PY"

POST_TOOL_JSON='{"hook_event_name":"PostToolUse","tool_name":"Bash","tool_input":{"command":"ls"}}'

(
  export MEMPALACE_TRANSCRIPT_ENABLED=1
  export MEMPALACE_PYTHON="$FAKE_PY"
  printf '%s' "$POST_TOOL_JSON" | bash "$HOOK" >/dev/null 2>&1
) || true

if [ -f "$MARKER" ]; then
  record FAIL "issue-91: PostToolUse skipped (no Python spawn)" \
    "marker file was created — Python ran on PostToolUse"
else
  record PASS "issue-91: PostToolUse skipped (no Python spawn)"
fi

# -------------------------------------------------------------------------
# Test 3 — Issue #92: PROJECT_DIR derivation must use git rev-parse.
#
# Static check: the script must reference `git rev-parse --show-toplevel`
# so that worktree paths resolve to the canonical repo root rather than
# the worktree directory basename.
# -------------------------------------------------------------------------
if grep -nE 'git[[:space:]]+rev-parse[[:space:]]+--show-toplevel' "$HOOK" >/dev/null; then
  record PASS "issue-92: PROJECT_DIR uses git rev-parse --show-toplevel"
else
  record FAIL "issue-92: PROJECT_DIR uses git rev-parse --show-toplevel" \
    "no \`git rev-parse --show-toplevel\` call found in $HOOK"
fi

# -------------------------------------------------------------------------
# Test 4 — Issue #93: stderr must not be merged into stdout.
#
# Static check: the line that invokes "$MEMPALACE_PYTHON" must NOT carry
# a `2>&1` redirection. Merging stderr into stdout hides MemPalace import
# errors behind the captured "STATUS" string and breaks log triage.
# -------------------------------------------------------------------------
PY_LINE="$(grep -nE '"\$MEMPALACE_PYTHON"' "$HOOK" || true)"
if [ -z "$PY_LINE" ]; then
  record FAIL "issue-93: stderr not merged with stdout on Python call" \
    "cannot locate \$MEMPALACE_PYTHON invocation line"
elif echo "$PY_LINE" | grep -q '2>&1'; then
  record FAIL "issue-93: stderr not merged with stdout on Python call" \
    "found '2>&1' on Python invocation: $PY_LINE"
else
  record PASS "issue-93: stderr not merged with stdout on Python call"
fi

# -------------------------------------------------------------------------
# Test 5 — Issue #94: explicit `timeout ` prefix on the Python call line.
#
# Stricter than test 1: this asserts the canonical `timeout <seconds>`
# shape immediately preceding the Python binary, not just the presence of
# the word `timeout` somewhere nearby. This guards against partial fixes
# (e.g. a comment that mentions timeout but no actual wrapper).
# -------------------------------------------------------------------------
if grep -nE '^[[:space:]]*timeout[[:space:]]+[0-9]+' "$HOOK" | grep -q '$MEMPALACE_PYTHON\|"\$MEMPALACE_PYTHON"'; then
  record PASS "issue-94: explicit \`timeout <n>\` prefix on Python call"
else
  # Allow the timeout to be on a preceding continuation line; check that
  # any line starting with `timeout <digits>` exists in the file.
  if grep -nE '^[[:space:]]*timeout[[:space:]]+[0-9]+' "$HOOK" >/dev/null; then
    # Verify it actually fronts the Python call by checking the next
    # non-blank/non-comment line references $MEMPALACE_PYTHON.
    if awk '
      /^[[:space:]]*timeout[[:space:]]+[0-9]+/ { found=1; next }
      found && /\$MEMPALACE_PYTHON/ { print "match"; exit 0 }
      found && !/^[[:space:]]*(#|$)/ && !/\\$/ { found=0 }
    ' "$HOOK" | grep -q match; then
      record PASS "issue-94: explicit \`timeout <n>\` prefix on Python call"
    else
      record FAIL "issue-94: explicit \`timeout <n>\` prefix on Python call" \
        "\`timeout <n>\` present but not fronting \$MEMPALACE_PYTHON"
    fi
  else
    record FAIL "issue-94: explicit \`timeout <n>\` prefix on Python call" \
      "no \`timeout <n>\` line found in $HOOK"
  fi
fi

# -------------------------------------------------------------------------
# Summary
# -------------------------------------------------------------------------
echo
echo "Summary: $pass passed, $fail failed"

if [ "$fail" -gt 0 ]; then
  exit 1
fi
exit 0
