#!/usr/bin/env bash
# test-e2e-structural-lib.sh — Regression for tests/e2e/lib/structural.sh.
#
# Locks ADR 0004 Decisions 1, 3, 6:
#   - assert_stdout_matches: stdin or file form, ERE.
#   - assert_json_shape: jq-driven JSON-shape probe.
#   - assert_gitmoji_title: PCRE `^\p{Emoji}…`, MUST run under GNU grep
#     (inside crewrig/e2e-base:latest — BSD grep on macOS lacks \p{Emoji}).

set -uo pipefail

PASS=0
FAIL=0
SKIP=0

note_pass() { echo "# PASS $1"; PASS=$((PASS + 1)); }
note_fail() { echo "# FAIL $1 — $2"; FAIL=$((FAIL + 1)); }
note_skip() { echo "# SKIP $1: $2"; SKIP=$((SKIP + 1)); }

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LIB="${REPO_DIR}/tests/e2e/lib/structural.sh"

if [[ ! -f "$LIB" ]]; then
  note_fail "structural.sh present" "missing at $LIB"
  echo "# $PASS passed / $FAIL failed / $SKIP skipped"
  exit 1
fi
note_pass "structural.sh present"

# shellcheck disable=SC1090
source "$LIB"

TMP="$(mktemp -d -t crewrig-structural-lib.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

run_capture() {
  local errfile="$1"; shift
  set +e
  ( "$@" ) 2>"$errfile" >/dev/null
  local rc=$?
  set -e
  echo "$rc"
}

# ---------- assert_stdout_matches: stdin form ----------------------------
err="$TMP/err.1"
set +e
( echo "alpha-line" | assert_stdout_matches '^alpha-' ) 2>"$err" >/dev/null
rc=$?
set -e
if [[ "$rc" == 0 && ! -s "$err" ]]; then
  note_pass "assert_stdout_matches stdin: match → silent PASS"
else
  note_fail "assert_stdout_matches stdin: match → silent PASS" "rc=$rc"
fi

err="$TMP/err.2"
set +e
( echo "alpha-line" | assert_stdout_matches '^zzz$' ) 2>"$err" >/dev/null
rc=$?
set -e
if [[ "$rc" != 0 ]] && grep -q '^# FAIL assert_stdout_matches' "$err"; then
  note_pass "assert_stdout_matches stdin: miss → FAIL+diag"
else
  note_fail "assert_stdout_matches stdin: miss → FAIL+diag" "rc=$rc"
fi

# ---------- assert_stdout_matches: file form -----------------------------
fixture="$TMP/fx"; printf 'gamma\n' > "$fixture"
err="$TMP/err.3"
rc="$(run_capture "$err" assert_stdout_matches '^gamma$' "$fixture")"
if [[ "$rc" == 0 && ! -s "$err" ]]; then
  note_pass "assert_stdout_matches file: match → silent PASS"
else
  note_fail "assert_stdout_matches file: match → silent PASS" "rc=$rc"
fi

err="$TMP/err.4"
rc="$(run_capture "$err" assert_stdout_matches 'x' "$TMP/nope")"
if [[ "$rc" != 0 ]] && grep -q 'no such file' "$err"; then
  note_pass "assert_stdout_matches file: absent → FAIL+diag"
else
  note_fail "assert_stdout_matches file: absent → FAIL+diag" "rc=$rc"
fi

# ---------- assert_json_shape --------------------------------------------
if ! command -v jq >/dev/null 2>&1; then
  note_skip "assert_json_shape" "jq not on PATH"
else
  empty="$TMP/empty.json"; echo '{}' > "$empty"
  err="$TMP/err.5"
  rc="$(run_capture "$err" assert_json_shape "$empty" '.' '{}')"
  if [[ "$rc" == 0 && ! -s "$err" ]]; then
    note_pass "assert_json_shape: {} matches '.' → silent PASS"
  else
    note_fail "assert_json_shape: {} matches '.' → silent PASS" "rc=$rc err=$(cat "$err")"
  fi

  one="$TMP/one.json"; echo '{"a":1}' > "$one"
  err="$TMP/err.6"
  rc="$(run_capture "$err" assert_json_shape "$one" '.a' '1')"
  if [[ "$rc" == 0 && ! -s "$err" ]]; then
    note_pass "assert_json_shape: .a == 1 → silent PASS"
  else
    note_fail "assert_json_shape: .a == 1 → silent PASS" "rc=$rc"
  fi

  err="$TMP/err.7"
  rc="$(run_capture "$err" assert_json_shape "$one" '.a' '2')"
  if [[ "$rc" != 0 ]] && grep -q '^# FAIL assert_json_shape' "$err"; then
    note_pass "assert_json_shape: mismatch → FAIL+diag"
  else
    note_fail "assert_json_shape: mismatch → FAIL+diag" "rc=$rc"
  fi

  err="$TMP/err.8"
  rc="$(run_capture "$err" assert_json_shape "$TMP/missing.json" '.' '{}')"
  if [[ "$rc" != 0 ]] && grep -q 'no such file' "$err"; then
    note_pass "assert_json_shape: absent → FAIL+diag"
  else
    note_fail "assert_json_shape: absent → FAIL+diag" "rc=$rc"
  fi
fi

# ---------- assert_gitmoji_title (docker-only) ---------------------------
# `grep -P '\p{Emoji}'` is GNU-grep specific. macOS BSD grep cannot run
# this — execute inside crewrig/e2e-base:latest if available.
if ! command -v docker >/dev/null 2>&1; then
  note_skip "assert_gitmoji_title (docker)" "docker not on PATH"
elif ! docker image inspect crewrig/e2e-base:latest >/dev/null 2>&1; then
  note_skip "assert_gitmoji_title (docker)" "image crewrig/e2e-base:latest not built locally (run task e2e:build)"
else
  out="$TMP/gitmoji.out"
  if docker run --rm \
       -v "$REPO_DIR:/work:ro" -w /work \
       --entrypoint bash crewrig/e2e-base:latest -c '
    set -u
    source tests/e2e/lib/structural.sh
    pass=0; fail=0
    # Positive cases (must PASS)
    for t in "🐳 Add docker" "✨ Initial commit"; do
      if assert_gitmoji_title "$t" 2>/dev/null; then
        echo "OK POS: $t"; pass=$((pass+1))
      else
        echo "BAD POS: $t"; fail=$((fail+1))
      fi
    done
    # Negative cases (must FAIL)
    for t in "Add foo" "🐳"; do
      if assert_gitmoji_title "$t" 2>/dev/null; then
        echo "BAD NEG: $t"; fail=$((fail+1))
      else
        echo "OK NEG: $t"; pass=$((pass+1))
      fi
    done
    echo "DONE pass=$pass fail=$fail"
    exit $fail
  ' > "$out" 2>&1; then
    if grep -q 'DONE pass=4 fail=0' "$out"; then
      note_pass "assert_gitmoji_title (docker): 2 positive + 2 negative"
    else
      note_fail "assert_gitmoji_title (docker)" "unexpected output: $(tail -5 "$out")"
    fi
  else
    note_fail "assert_gitmoji_title (docker)" "container exited non-zero: $(tail -10 "$out")"
  fi
fi

echo "# $PASS passed / $FAIL failed / $SKIP skipped"
(( FAIL == 0 )) || exit 1
