#!/bin/bash
# test-setup-mempalace-rc-guard.sh — Regression test for the `set -e` swallow
# of ensure_mempalace_http()'s exit-1 / exit-2 status at the four setup
# scripts' MemPalace HTTP call sites (issue #1243, spec 0113 delta-02 R17-R20).
#
# Unit under test: the call-site fragment
#   _mempalace_rc=0
#   ensure_mempalace_http "$REPO_DIR" <cli> || _mempalace_rc=$?
#   case "$_mempalace_rc" in ... esac
# at scripts/setup-claude-interactive.sh, scripts/setup-copilot-interactive.sh,
# scripts/setup-gemini-interactive.sh, and scripts/setup-antigravity-interactive.sh.
#
# All four scripts run under their OWN `set -e`. Before this fix the call site
# was a bare
#   ensure_mempalace_http "$REPO_DIR" <cli>
#   _mempalace_rc=$?
# and a non-zero return from ensure_mempalace_http (rc 1 = no usable serving
# daemon, rc 2 = daemon verified serving but registration write failed — both
# documented, non-exceptional outcomes per spec 0113 delta-02 R19/R20) tripped
# `set -e` at the call itself, aborting the script before `_mempalace_rc=$?`
# ever ran. The `case` statement, and every step after it (org MCP servers,
# team, expertise, level, profile, overlays, session recording, usage
# capture), was silently skipped.
#
# None of the four interactive scripts are runnable end-to-end in CI (fzf
# prompts, the `agy` guard, the launchd/systemd chroma daemon — same
# constraint documented in scripts/tests/test-setup-mcp-merge.sh's header).
# The hermetic surface here is the exact call-site fragment: extracted from
# the real file text via grep/awk (not a hand-copied reimplementation, so this
# test tracks the actual call site and would catch a future regression) and
# executed in an isolated harness script under its OWN `set -e`, with
# ensure_mempalace_http stubbed to return 0, 1, and 2 in turn.
#
# Assertions per (script, rc):
#   - the harness reaches a trailing marker (__SURVIVED__) — the core
#     regression check. Run against the pre-fix file text (the two-line shape,
#     no `  _mempalace_rc=0` anchor line), extract_fragment's anchor grep finds
#     nothing and the harness never even gets built; run anyway with the old
#     shape spliced in directly, the bare call aborts the harness under its own
#     `set -e` before `_mempalace_rc=$?` runs for rc=1/rc=2 — both checked by
#     hand against the pre-fix file text while authoring this test.
#   - the documented case-branch text for that rc is printed.
#   - (rc=0 only, sanity) the success path still behaves as documented.
#
# HERMETIC: no HOME writes, no interactive scripts run, no network access.
# Every fragment runs inside a throwaway harness script under a temp root
# removed on exit.
#
# Usage:
#   bash scripts/tests/test-setup-mempalace-rc-guard.sh

# -e intentionally omitted: pass/fail counters drive the harness, and some
# harness runs are EXPECTED to exit non-zero (matches
# scripts/tests/test-setup-mcp-merge.sh's house style).
set -uo pipefail

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
SETUP_DIR="$REPO_DIR/scripts"

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

pass=0
fail=0
ok()  { echo "  ok: $1"; pass=$((pass + 1)); }
bad() { echo "  FAIL: $1" >&2; fail=$((fail + 1)); }

# extract_fragment <script-path> — prints the lines from the real
# `  _mempalace_rc=0` anchor through the matching `  esac` (inclusive),
# extracted from the actual file text, not reimplemented.
extract_fragment() {
  local path="$1" start end
  start="$(grep -nx '  _mempalace_rc=0' "$path" | head -1 | cut -d: -f1)"
  if [ -z "$start" ]; then
    echo "FATAL: no '  _mempalace_rc=0' anchor line in $path" >&2
    return 1
  fi
  end="$(awk -v s="$start" 'NR>=s && /^  esac$/ { print NR; exit }' "$path")"
  if [ -z "$end" ]; then
    echo "FATAL: no matching esac after line $start in $path" >&2
    return 1
  fi
  sed -n "${start},${end}p" "$path"
}

# run_fragment <script-basename> <rc> <extra-stubs> <trailer>
# Builds a throwaway harness combining: a stub ensure_mempalace_http
# returning $rc, any extra stubs (Claude's mcp_register_user /
# mcp_is_registered), the extracted real fragment, a trailing marker echo,
# and an optional trailer. Runs it under the harness's OWN `set -e` and
# prints combined stdout+stderr.
run_fragment() {
  local script="$1" rc="$2" extra_stubs="$3" trailer="$4"
  local path="$SETUP_DIR/$script" fragment harness
  fragment="$(extract_fragment "$path")" || { echo "__EXTRACT_FAILED__"; return; }
  harness="$TMP_ROOT/harness-${script}-${rc}.sh"
  {
    echo '#!/usr/bin/env bash'
    echo 'set -e'
    echo 'REPO_DIR="/placeholder-repo-dir"'
    printf 'ensure_mempalace_http() { return %s; }\n' "$rc"
    if [ -n "$extra_stubs" ]; then
      printf '%s\n' "$extra_stubs"
    fi
    printf '%s\n' "$fragment"
    echo "echo '__SURVIVED__'"
    if [ -n "$trailer" ]; then
      printf '%s\n' "$trailer"
    fi
  } > "$harness"
  bash "$harness" 2>&1
}

# Claude's rc=1/rc=2 arms call mcp_register_user / mcp_is_registered; its
# `claude mcp remove ... >/dev/null 2>&1 || true` line needs no stub — output
# is already suppressed and a command-not-found is folded into `|| true`.
CLAUDE_STUBS='mcp_register_user() { return 0; }
mcp_is_registered() { return 0; }'

# assert_case <script> <rc> <extra_stubs> <trailer> <expected_substring>
assert_case() {
  local script="$1" rc="$2" extra_stubs="$3" trailer="$4" expected="$5" out
  out="$(run_fragment "$script" "$rc" "$extra_stubs" "$trailer")"

  if grep -qF '__SURVIVED__' <<< "$out"; then
    ok "$script rc=$rc: set -e did not abort mid-fragment"
  else
    bad "$script rc=$rc: marker not reached -- output: $out"
  fi

  if grep -qF "$expected" <<< "$out"; then
    ok "$script rc=$rc: documented text printed ('$expected')"
  else
    bad "$script rc=$rc: expected '$expected' not found -- output: $out"
  fi
}

echo "1. scripts/setup-claude-interactive.sh"
assert_case setup-claude-interactive.sh 0 "$CLAUDE_STUBS" \
  'echo "MEMPALACE_INSTALLED=$MEMPALACE_INSTALLED"' 'MEMPALACE_INSTALLED=1'
assert_case setup-claude-interactive.sh 1 "$CLAUDE_STUBS" '' \
  'Converged mempalace to the stdio http-wrapper entry'
assert_case setup-claude-interactive.sh 2 "$CLAUDE_STUBS" '' \
  'Existing mempalace registration kept'

echo "2. scripts/setup-copilot-interactive.sh"
assert_case setup-copilot-interactive.sh 0 '' '' \
  'MemPalace reaches shared memory through the HTTP daemon.'
assert_case setup-copilot-interactive.sh 1 '' '' \
  'WARNING: mempalace stays on the stdio arrangement'
assert_case setup-copilot-interactive.sh 2 '' '' \
  'LOCKOUT WARNING: the daemon is verified serving'

echo "3. scripts/setup-gemini-interactive.sh"
assert_case setup-gemini-interactive.sh 0 '' '' \
  'MemPalace reaches shared memory through the HTTP daemon.'
assert_case setup-gemini-interactive.sh 1 '' '' \
  'WARNING: mempalace stays on the stdio arrangement'
assert_case setup-gemini-interactive.sh 2 '' '' \
  'LOCKOUT WARNING: the daemon is verified serving'

echo "4. scripts/setup-antigravity-interactive.sh"
assert_case setup-antigravity-interactive.sh 0 '' '' \
  'MemPalace reaches shared memory through the HTTP daemon.'
assert_case setup-antigravity-interactive.sh 1 '' '' \
  'WARNING: mempalace stays on the stdio arrangement'
assert_case setup-antigravity-interactive.sh 2 '' '' \
  'LOCKOUT WARNING: the daemon is verified serving'

echo ""
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
