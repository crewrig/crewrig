#!/bin/bash
# test-check-core-paths.sh — Regression tests for check-core-paths.sh (spec 0031).
#
# check-core-paths.sh is the CI guard that rejects "phantom" manifest entries —
# a .crewrig/core-paths.txt line naming a strict/adopt-on-edit path that does
# not resolve to tracked content at HEAD. This is the parity sibling mandated by
# the repo convention "every check-*.sh has a test-*.sh".
#
# Cases:
#   a. Phantom strict entry → exit 1, stderr names the failing entry.
#   b. Phantom adopt-on-edit entry → exit 1, stderr names the failing entry.
#   c. Fully resolvable manifest → exit 0 with the OK line on stdout.
#   d. Phantom excluded entry → exit 0 (excluded is org-owned, NOT checked).
#
# Usage:
#   bash scripts/tests/test-check-core-paths.sh

# -e intentionally omitted: pass/fail counters control the harness; adding -e
# would abort on expected non-zero exits from the script under test.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT_UNDER_TEST="$SCRIPT_DIR/check-core-paths.sh"

if [ ! -f "$SCRIPT_UNDER_TEST" ]; then
  echo "FATAL: cannot find $SCRIPT_UNDER_TEST" >&2
  exit 2
fi

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

pass=0
fail=0

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# init_git_repo <dir>
init_git_repo() {
  local dir="$1"
  git -C "$dir" init -q
  git -C "$dir" config user.email "test@example.com"
  git -C "$dir" config user.name "Test"
  git -C "$dir" config commit.gpgsign false
}

# make_initial_commit <repo> [<file> <content>]...
make_initial_commit() {
  local repo="$1"; shift
  while [ "$#" -ge 2 ]; do
    local file="$1" content="$2"; shift 2
    mkdir -p "$repo/$(dirname "$file")"
    printf '%s' "$content" > "$repo/$file"
    git -C "$repo" add "$file"
  done
  git -C "$repo" commit -q -m "initial"
}

# write_manifest <repo> <content>
# Write .crewrig/core-paths.txt (read from disk by the script — not committed).
write_manifest() {
  local repo="$1" content="$2"
  mkdir -p "$repo/.crewrig"
  printf '%s' "$content" > "$repo/.crewrig/core-paths.txt"
}

# run_check <repo>
# Run the script under test with CREWRIG_REPO_DIR set, capturing stdout, stderr,
# and exit code into the globals CHECK_EXIT / CHECK_STDOUT / CHECK_STDERR.
run_check() {
  local repo="$1" out_file err_file
  out_file="$(mktemp "$TMP_ROOT/out.XXXXXX")"
  err_file="$(mktemp "$TMP_ROOT/err.XXXXXX")"
  CHECK_EXIT=0
  ( CREWRIG_REPO_DIR="$repo" bash "$SCRIPT_UNDER_TEST" >"$out_file" 2>"$err_file" ) || CHECK_EXIT=$?
  CHECK_STDOUT="$(cat "$out_file")"
  CHECK_STDERR="$(cat "$err_file")"
  rm -f "$out_file" "$err_file"
}

# ---------------------------------------------------------------------------
# Case a — Phantom strict entry → exit 1, stderr names the failing entry.
# ---------------------------------------------------------------------------
{
  repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  init_git_repo "$repo"
  make_initial_commit "$repo" "real.txt" "tracked content"
  write_manifest "$repo" $'real.txt\tstrict\nphantom.txt\tstrict\n'

  run_check "$repo"

  if [ "$CHECK_EXIT" -eq 1 ]; then
    echo "PASS  case-a: phantom strict entry fails the check (exit 1)"
    pass=$((pass + 1))
  else
    echo "FAIL  case-a: expected exit 1, got $CHECK_EXIT"
    fail=$((fail + 1))
  fi

  if echo "$CHECK_STDERR" | grep -qF "FAIL phantom.txt (strict)"; then
    echo "PASS  case-a: stderr names the failing strict entry"
    pass=$((pass + 1))
  else
    echo "FAIL  case-a: stderr did not name phantom.txt (strict)"
    echo "      actual stderr: $CHECK_STDERR"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case b — Phantom adopt-on-edit entry → exit 1, stderr names the failing entry.
# ---------------------------------------------------------------------------
{
  repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  init_git_repo "$repo"
  make_initial_commit "$repo" "real.txt" "tracked content"
  write_manifest "$repo" $'real.txt\tstrict\nphantom.txt\tadopt-on-edit\n'

  run_check "$repo"

  if [ "$CHECK_EXIT" -eq 1 ]; then
    echo "PASS  case-b: phantom adopt-on-edit entry fails the check (exit 1)"
    pass=$((pass + 1))
  else
    echo "FAIL  case-b: expected exit 1, got $CHECK_EXIT"
    fail=$((fail + 1))
  fi

  if echo "$CHECK_STDERR" | grep -qF "FAIL phantom.txt (adopt-on-edit)"; then
    echo "PASS  case-b: stderr names the failing adopt-on-edit entry"
    pass=$((pass + 1))
  else
    echo "FAIL  case-b: stderr did not name phantom.txt (adopt-on-edit)"
    echo "      actual stderr: $CHECK_STDERR"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case c — Fully resolvable manifest → exit 0 with the OK line on stdout.
# ---------------------------------------------------------------------------
{
  repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  init_git_repo "$repo"
  make_initial_commit "$repo" \
    "real.txt"  "tracked content" \
    "other.txt" "other tracked content"
  write_manifest "$repo" $'real.txt\tstrict\nother.txt\tadopt-on-edit\n'

  run_check "$repo"

  if [ "$CHECK_EXIT" -eq 0 ]; then
    echo "PASS  case-c: fully resolvable manifest passes the check (exit 0)"
    pass=$((pass + 1))
  else
    echo "FAIL  case-c: expected exit 0, got $CHECK_EXIT"
    echo "      actual stderr: $CHECK_STDERR"
    fail=$((fail + 1))
  fi

  if echo "$CHECK_STDOUT" | grep -qF "OK: all 2 strict/adopt-on-edit core-paths entries resolve at HEAD."; then
    echo "PASS  case-c: OK line emitted on stdout with the checked count"
    pass=$((pass + 1))
  else
    echo "FAIL  case-c: missing/incorrect OK line"
    echo "      actual stdout: $CHECK_STDOUT"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case d — Phantom excluded entry → exit 0 (excluded is org-owned, skipped, NOT
#          failed). Confirms the policy carve-out matches sync-from-upstream.sh.
# ---------------------------------------------------------------------------
{
  repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  init_git_repo "$repo"
  make_initial_commit "$repo" "real.txt" "tracked content"
  # phantom-excluded.txt resolves nowhere at HEAD, but `excluded` is skipped.
  write_manifest "$repo" $'real.txt\tstrict\nphantom-excluded.txt\texcluded\n'

  run_check "$repo"

  if [ "$CHECK_EXIT" -eq 0 ]; then
    echo "PASS  case-d: phantom excluded entry is skipped, not failed (exit 0)"
    pass=$((pass + 1))
  else
    echo "FAIL  case-d: expected exit 0, got $CHECK_EXIT"
    echo "      actual stderr: $CHECK_STDERR"
    fail=$((fail + 1))
  fi

  # Only the strict entry should be counted (the excluded one is not checked).
  if echo "$CHECK_STDOUT" | grep -qF "OK: all 1 strict/adopt-on-edit core-paths entries resolve at HEAD."; then
    echo "PASS  case-d: excluded entry omitted from the checked count"
    pass=$((pass + 1))
  else
    echo "FAIL  case-d: excluded entry was counted or OK line malformed"
    echo "      actual stdout: $CHECK_STDOUT"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
total=$((pass + fail))
echo ""
echo "Results: $pass/$total passed"
[ "$fail" -eq 0 ] && exit 0 || exit 1
