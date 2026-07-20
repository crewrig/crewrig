#!/bin/bash
# test-check-no-machine-paths.sh — Regression tests for check-no-machine-paths.sh
# (spec 0081).
#
# check-no-machine-paths.sh is the CI guard that fails the build when a tracked
# file reintroduces a machine-specific absolute home path (/Users/<user>/… or
# /home/<user>/…), naming the offender. This is the parity sibling mandated by
# the repo convention "every check-*.sh has a test-*.sh".
#
# The guard reads tracked content via `git grep`, so each fixture repo is
# `git init`-ed and the fixture files are committed before the guard runs.
#
# Cases:
#   a. Clean tree (no home paths) → exit 0 with the OK line on stdout.
#   b. A `/Users/eviluser/secret` line → exit 1 and the path is named on stderr.
#   c. A `/Users/<user>/` placeholder → not flagged (exit 0): the '<' is outside
#      the owner character class, so neutral placeholders stay legal.
#   d. A `/home/agent/x` benign-owner path → not flagged (exit 0).
#   e. A single line holding BOTH a benign `/home/agent/…` path and a real leak
#      → exit 1 and the leak is named (token pass, not a whole-line filter).
#
# Usage:
#   bash scripts/tests/test-check-no-machine-paths.sh

# -e intentionally omitted: pass/fail counters control the harness; adding -e
# would abort on expected non-zero exits from the script under test.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT_UNDER_TEST="$SCRIPT_DIR/check-no-machine-paths.sh"

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
# Fixtures must be tracked — the guard searches via `git grep`.
make_initial_commit() {
  local repo="$1"; shift
  while [ "$#" -ge 2 ]; do
    local file="$1" content="$2"; shift 2
    mkdir -p "$repo/$(dirname "$file")"
    printf '%s\n' "$content" > "$repo/$file"
    git -C "$repo" add "$file"
  done
  git -C "$repo" commit -q -m "initial"
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
# Case a — Clean tree → exit 0 with the OK line on stdout.
# ---------------------------------------------------------------------------
{
  repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  init_git_repo "$repo"
  make_initial_commit "$repo" "clean.txt" 'a report using $HOME and <user> placeholders'

  run_check "$repo"

  if [ "$CHECK_EXIT" -eq 0 ]; then
    echo "PASS  case-a: clean tree passes the check (exit 0)"
    pass=$((pass + 1))
  else
    echo "FAIL  case-a: expected exit 0, got $CHECK_EXIT"
    echo "      actual stderr: $CHECK_STDERR"
    fail=$((fail + 1))
  fi

  if echo "$CHECK_STDOUT" | grep -qF "OK: no machine-specific home-directory paths"; then
    echo "PASS  case-a: OK line emitted on stdout"
    pass=$((pass + 1))
  else
    echo "FAIL  case-a: missing OK line"
    echo "      actual stdout: $CHECK_STDOUT"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case b — A /Users/eviluser/secret line → exit 1, path named on stderr.
# ---------------------------------------------------------------------------
{
  repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  init_git_repo "$repo"
  make_initial_commit "$repo" "leak.txt" 'config loaded from /Users/eviluser/secret/config.json'

  run_check "$repo"

  if [ "$CHECK_EXIT" -eq 1 ]; then
    echo "PASS  case-b: reintroduced home path fails the check (exit 1)"
    pass=$((pass + 1))
  else
    echo "FAIL  case-b: expected exit 1, got $CHECK_EXIT"
    fail=$((fail + 1))
  fi

  if echo "$CHECK_STDERR" | grep -qF "/Users/eviluser/"; then
    echo "PASS  case-b: stderr names the offending path"
    pass=$((pass + 1))
  else
    echo "FAIL  case-b: stderr did not name /Users/eviluser/"
    echo "      actual stderr: $CHECK_STDERR"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case c — A /Users/<user>/ placeholder → not flagged (exit 0).
# ---------------------------------------------------------------------------
{
  repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  init_git_repo "$repo"
  make_initial_commit "$repo" "placeholder.txt" 'see /Users/<user>/config and $HOME/config'

  run_check "$repo"

  if [ "$CHECK_EXIT" -eq 0 ]; then
    echo "PASS  case-c: neutral placeholder is not flagged (exit 0)"
    pass=$((pass + 1))
  else
    echo "FAIL  case-c: expected exit 0, got $CHECK_EXIT"
    echo "      actual stderr: $CHECK_STDERR"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case d — A /home/agent/x benign-owner path → not flagged (exit 0).
# ---------------------------------------------------------------------------
{
  repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  init_git_repo "$repo"
  make_initial_commit "$repo" "container.txt" 'container home is /home/agent/workspace here'

  run_check "$repo"

  if [ "$CHECK_EXIT" -eq 0 ]; then
    echo "PASS  case-d: benign owner 'agent' is not flagged (exit 0)"
    pass=$((pass + 1))
  else
    echo "FAIL  case-d: expected exit 0, got $CHECK_EXIT"
    echo "      actual stderr: $CHECK_STDERR"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case e — One line with BOTH a benign path and a real leak → exit 1, leak named
#          (confirms token extraction, not a whole-line grep -v filter).
# ---------------------------------------------------------------------------
{
  repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  init_git_repo "$repo"
  make_initial_commit "$repo" "mixed.txt" 'mount /home/agent/data over /Users/eviluser/secret/x'

  run_check "$repo"

  if [ "$CHECK_EXIT" -eq 1 ]; then
    echo "PASS  case-e: leak on a mixed line still fails (exit 1)"
    pass=$((pass + 1))
  else
    echo "FAIL  case-e: expected exit 1, got $CHECK_EXIT"
    fail=$((fail + 1))
  fi

  if echo "$CHECK_STDERR" | grep -qF "/Users/eviluser/"; then
    echo "PASS  case-e: stderr names the leaked path on the mixed line"
    pass=$((pass + 1))
  else
    echo "FAIL  case-e: stderr did not name the leak on the mixed line"
    echo "      actual stderr: $CHECK_STDERR"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case f — A slash-less home root at end of line → exit 1, path named. Guards
#          the regression where the deny pattern required a trailing slash after
#          the owner, letting `export HOME=/Users/<user>` (no trailing slash,
#          EOL) escape. The tolerant `(/|$)` delimiter must catch it.
# ---------------------------------------------------------------------------
{
  repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  init_git_repo "$repo"
  make_initial_commit "$repo" "envfile.sh" 'export HOME=/Users/eviluser'

  run_check "$repo"

  if [ "$CHECK_EXIT" -eq 1 ]; then
    echo "PASS  case-f: slash-less EOL home root fails the check (exit 1)"
    pass=$((pass + 1))
  else
    echo "FAIL  case-f: expected exit 1, got $CHECK_EXIT"
    fail=$((fail + 1))
  fi

  if echo "$CHECK_STDERR" | grep -qF "/Users/eviluser"; then
    echo "PASS  case-f: stderr names the slash-less offending path"
    pass=$((pass + 1))
  else
    echo "FAIL  case-f: stderr did not name /Users/eviluser"
    echo "      actual stderr: $CHECK_STDERR"
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
