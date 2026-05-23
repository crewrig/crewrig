#!/usr/bin/env bash
# test-e2e-assert-lib.sh — Regression for tests/e2e/lib/assert.sh.
#
# Locks ADR 0004 Decisions 1, 2, 6:
#   - Functions return 0 on PASS, 1 on FAIL. PASS is silent.
#   - FAIL emits a TAP-compatible diag block "# FAIL <name>" + expected/actual.
#   - MemPalace probes preflight `mempalace` on PATH.
#   - `assert_git_branch_pushed` checks a remote ref via ls-remote.

set -uo pipefail

PASS=0
FAIL=0
SKIP=0

note_pass() { echo "# PASS $1"; PASS=$((PASS + 1)); }
note_fail() { echo "# FAIL $1 — $2"; FAIL=$((FAIL + 1)); }
note_skip() { echo "# SKIP $1: $2"; SKIP=$((SKIP + 1)); }

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LIB="${REPO_DIR}/tests/e2e/lib/assert.sh"

if [[ ! -f "$LIB" ]]; then
  note_fail "assert.sh present" "missing at $LIB"
  echo "# $PASS passed / $FAIL failed / $SKIP skipped"
  exit 1
fi
note_pass "assert.sh present"

# Sourceable under `set -euo pipefail` (drop -e while sourcing to avoid
# tripping on the lib's `set -o nounset`-only stance; the lib doc says
# the SOURCING scenario uses -euo pipefail).
set +e
# shellcheck disable=SC1090
source "$LIB"
src_rc=$?
set -e
if (( src_rc == 0 )); then
  note_pass "assert.sh sources cleanly"
else
  note_fail "assert.sh sources cleanly" "source returned $src_rc"
fi

TMP="$(mktemp -d -t crewrig-assert-lib.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

# Diag-block contract: any FAIL must emit "# FAIL <name>" on stderr.
# Helper: run the assertion in a subshell, capture stderr, return its rc.
run_capture() {
  # $1 = path to stderr capture file; rest = command
  local errfile="$1"; shift
  set +e
  ( "$@" ) 2>"$errfile" >/dev/null
  local rc=$?
  set -e
  echo "$rc"
}

# ---------- assert_file_exists -------------------------------------------
present="$TMP/present"; : > "$present"
absent="$TMP/absent"

err="$TMP/err.1"
rc="$(run_capture "$err" assert_file_exists "$present")"
if [[ "$rc" == 0 && ! -s "$err" ]]; then
  note_pass "assert_file_exists: PASS is silent"
else
  note_fail "assert_file_exists: PASS is silent" "rc=$rc, stderr bytes=$(wc -c <"$err")"
fi

err="$TMP/err.2"
rc="$(run_capture "$err" assert_file_exists "$absent")"
if [[ "$rc" != 0 ]] && grep -q '^# FAIL assert_file_exists' "$err"; then
  note_pass "assert_file_exists: missing → FAIL+diag"
else
  note_fail "assert_file_exists: missing → FAIL+diag" "rc=$rc stderr=$(head -c 200 "$err")"
fi

# ---------- assert_file_contains -----------------------------------------
hay="$TMP/hay"; printf 'alpha\nbeta\n' > "$hay"
err="$TMP/err.3"
rc="$(run_capture "$err" assert_file_contains "$hay" '^beta$')"
if [[ "$rc" == 0 && ! -s "$err" ]]; then
  note_pass "assert_file_contains: match → silent PASS"
else
  note_fail "assert_file_contains: match → silent PASS" "rc=$rc"
fi

err="$TMP/err.4"
rc="$(run_capture "$err" assert_file_contains "$hay" '^zzz$')"
if [[ "$rc" != 0 ]] && grep -q '^# FAIL assert_file_contains' "$err"; then
  note_pass "assert_file_contains: no match → FAIL+diag"
else
  note_fail "assert_file_contains: no match → FAIL+diag" "rc=$rc"
fi

err="$TMP/err.5"
rc="$(run_capture "$err" assert_file_contains "$absent" 'x')"
if [[ "$rc" != 0 ]] && grep -q 'no such file' "$err"; then
  note_pass "assert_file_contains: absent file → FAIL+diag"
else
  note_fail "assert_file_contains: absent file → FAIL+diag" "rc=$rc"
fi

# ---------- assert_file_absent -------------------------------------------
err="$TMP/err.6"
rc="$(run_capture "$err" assert_file_absent "$absent")"
if [[ "$rc" == 0 && ! -s "$err" ]]; then
  note_pass "assert_file_absent: missing → silent PASS"
else
  note_fail "assert_file_absent: missing → silent PASS" "rc=$rc"
fi

err="$TMP/err.7"
rc="$(run_capture "$err" assert_file_absent "$present")"
if [[ "$rc" != 0 ]] && grep -q '^# FAIL assert_file_absent' "$err"; then
  note_pass "assert_file_absent: present → FAIL+diag"
else
  note_fail "assert_file_absent: present → FAIL+diag" "rc=$rc"
fi

# ---------- assert_exit_code ---------------------------------------------
err="$TMP/err.8"
rc="$(run_capture "$err" assert_exit_code 0 0)"
if [[ "$rc" == 0 && ! -s "$err" ]]; then
  note_pass "assert_exit_code: equal → silent PASS"
else
  note_fail "assert_exit_code: equal → silent PASS" "rc=$rc"
fi

err="$TMP/err.9"
rc="$(run_capture "$err" assert_exit_code 0 1)"
if [[ "$rc" != 0 ]] && grep -q '^# FAIL assert_exit_code' "$err"; then
  note_pass "assert_exit_code: differ → FAIL+diag"
else
  note_fail "assert_exit_code: differ → FAIL+diag" "rc=$rc"
fi

# ---------- assert_git_branch_pushed -------------------------------------
# Probe network reachability first; SKIP positive case if offline.
if ! command -v git >/dev/null 2>&1; then
  note_skip "assert_git_branch_pushed positive" "git not on PATH"
  note_skip "assert_git_branch_pushed negative" "git not on PATH"
elif ! git -C "$REPO_DIR" remote get-url crewrig >/dev/null 2>&1; then
  note_skip "assert_git_branch_pushed positive" "remote 'crewrig' not configured"
  note_skip "assert_git_branch_pushed negative" "remote 'crewrig' not configured"
elif ! ( cd "$REPO_DIR" && git ls-remote --exit-code --heads crewrig main >/dev/null 2>&1 ); then
  note_skip "assert_git_branch_pushed positive" "crewrig remote unreachable (offline?)"
  note_skip "assert_git_branch_pushed negative" "crewrig remote unreachable (offline?)"
else
  err="$TMP/err.10"
  rc="$(cd "$REPO_DIR" && run_capture "$err" assert_git_branch_pushed crewrig main)"
  if [[ "$rc" == 0 && ! -s "$err" ]]; then
    note_pass "assert_git_branch_pushed: existing → silent PASS"
  else
    note_fail "assert_git_branch_pushed: existing → silent PASS" "rc=$rc"
  fi

  err="$TMP/err.11"
  rc="$(cd "$REPO_DIR" && run_capture "$err" assert_git_branch_pushed crewrig __no_such_branch_zzz__)"
  if [[ "$rc" != 0 ]] && grep -q '^# FAIL assert_git_branch_pushed' "$err"; then
    note_pass "assert_git_branch_pushed: absent → FAIL+diag"
  else
    note_fail "assert_git_branch_pushed: absent → FAIL+diag" "rc=$rc"
  fi
fi

# ---------- assert_drawer_present / assert_drawer_field ------------------
# The MemPalace MCP-only rule applies: positive cases would require a
# populated MemPalace volume in a sidecar. We only lock the preflight diag.
if command -v mempalace >/dev/null 2>&1; then
  note_skip "assert_drawer_present preflight" "mempalace binary present — skipped to avoid hitting live store"
  note_skip "assert_drawer_field preflight"   "mempalace binary present — skipped to avoid hitting live store"
else
  err="$TMP/err.12"
  rc="$(run_capture "$err" assert_drawer_present some-wing some-room 'foo')"
  if [[ "$rc" != 0 ]] && grep -q 'mempalace binary not found' "$err"; then
    note_pass "assert_drawer_present: no binary → FAIL+diag"
  else
    note_fail "assert_drawer_present: no binary → FAIL+diag" "rc=$rc err=$(head -c 200 "$err")"
  fi

  err="$TMP/err.13"
  rc="$(run_capture "$err" assert_drawer_field some-wing some-room some-key writer_agent claude)"
  if [[ "$rc" != 0 ]] && grep -q 'mempalace binary not found' "$err"; then
    note_pass "assert_drawer_field: no binary → FAIL+diag"
  else
    note_fail "assert_drawer_field: no binary → FAIL+diag" "rc=$rc"
  fi
fi

# ---------- Diag-block uniformity ----------------------------------------
# Every FAIL diag captured above must include "expected:" and "actual:" lines.
combined="$TMP/all_err"; cat "$TMP"/err.* > "$combined" 2>/dev/null || true
fail_count=$(grep -c '^# FAIL ' "$combined" || true)
expected_count=$(grep -c '^#   expected:' "$combined" || true)
actual_count=$(grep -c '^#   actual:' "$combined" || true)
if (( fail_count >= 5 )) && (( expected_count == fail_count )) && (( actual_count == fail_count )); then
  note_pass "diag-block uniformity (# FAIL / expected / actual)"
else
  note_fail "diag-block uniformity" "fail=$fail_count expected=$expected_count actual=$actual_count"
fi

echo "# $PASS passed / $FAIL failed / $SKIP skipped"
(( FAIL == 0 )) || exit 1
