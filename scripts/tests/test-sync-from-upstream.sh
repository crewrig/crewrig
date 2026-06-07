#!/bin/bash
# test-sync-from-upstream.sh — Regression tests for sync-from-upstream.sh.
#
# Cases:
#   1. Clean-core sync: no local modifications → exit 0, files reflect upstream
#   2. Dirty-core refusal: core path modified → exit non-zero, stderr names it
#   3. Empty canonical_repo: canonical_repo = "" → exit non-zero, no git fetch
#   4. Absent canonical_repo: key missing entirely → exit non-zero, no git fetch
#
# Usage:
#   bash scripts/tests/test-sync-from-upstream.sh

# -e intentionally omitted: pass/fail counters control the harness; adding -e
# would abort on expected non-zero exits from the script under test.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT_UNDER_TEST="$SCRIPT_DIR/sync-from-upstream.sh"

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
# Initialise a bare-minimum git repo with identity set.
init_git_repo() {
  local dir="$1"
  git -C "$dir" init -q
  git -C "$dir" config user.email "test@example.com"
  git -C "$dir" config user.name "Test"
  git -C "$dir" config commit.gpgsign false
}

# make_initial_commit <repo> [<file> <content>]...
# Create an initial commit with one or more files.
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

# run_case <name> <repo> <expected_exit>
run_case() {
  local name="$1" repo="$2" expected_exit="$3"
  local actual_exit=0
  ( cd "$repo" && CREWRIG_REPO_DIR="$repo" bash "$SCRIPT_UNDER_TEST" >/dev/null 2>&1 ) || actual_exit=$?

  if [ "$actual_exit" -eq "$expected_exit" ]; then
    echo "PASS  $name (exit $actual_exit)"
    pass=$((pass + 1))
  else
    echo "FAIL  $name (expected exit $expected_exit, got $actual_exit)"
    fail=$((fail + 1))
  fi
}

# run_case_stderr <name> <repo> <expected_exit> <stderr_pattern>
# Like run_case but also checks that stderr matches a grep pattern.
run_case_stderr() {
  local name="$1" repo="$2" expected_exit="$3" pattern="$4"
  local actual_exit=0
  local stderr_out
  stderr_out="$(cd "$repo" && CREWRIG_REPO_DIR="$repo" bash "$SCRIPT_UNDER_TEST" 2>&1 >/dev/null)" || actual_exit=$?

  local ok=1
  if [ "$actual_exit" -ne "$expected_exit" ]; then
    echo "FAIL  $name (expected exit $expected_exit, got $actual_exit)"
    ok=0
  fi
  if ! echo "$stderr_out" | grep -q "$pattern"; then
    echo "FAIL  $name (stderr did not contain: $pattern)"
    echo "      actual stderr: $stderr_out"
    ok=0
  fi

  if [ "$ok" -eq 1 ]; then
    echo "PASS  $name"
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case 1 — Clean-core sync: all paths clean → exit 0
# ---------------------------------------------------------------------------
{
  # Build an "upstream" repo that acts as the canonical remote.
  upstream="$(mktemp -d "$TMP_ROOT/upstream.XXXXXX")"
  init_git_repo "$upstream"
  make_initial_commit "$upstream" \
    "core-file.txt" "upstream content" \
    "other.txt"     "other content"

  # Build the adopting repo that will call sync-from-upstream.sh.
  adopter="$(mktemp -d "$TMP_ROOT/adopter.XXXXXX")"
  init_git_repo "$adopter"

  # Write a minimal crewrig.config.toml pointing at upstream.
  printf 'canonical_repo = "%s"\n' "$upstream" > "$adopter/crewrig.config.toml"

  # Write a manifest listing just core-file.txt.
  mkdir -p "$adopter/.crewrig"
  printf 'core-file.txt\n' > "$adopter/.crewrig/core-paths.txt"

  # Give the adopter an initial commit that matches upstream exactly.
  make_initial_commit "$adopter" \
    "core-file.txt" "upstream content" \
    "other.txt"     "other content"

  run_case "clean-core sync exits 0" "$adopter" 0

  # After sync, the working-tree file should still hold upstream content
  # (in the clean case nothing changes, but restore must succeed).
  synced_content="$(cat "$adopter/core-file.txt" 2>/dev/null)"
  if [ "$synced_content" = "upstream content" ]; then
    echo "PASS  clean-core sync: file content correct"
    pass=$((pass + 1))
  else
    echo "FAIL  clean-core sync: expected 'upstream content', got '$synced_content'"
    fail=$((fail + 1))
  fi

  # Index must not be modified (no staged changes).
  staged="$(git -C "$adopter" diff --cached --name-only)"
  if [ -z "$staged" ]; then
    echo "PASS  clean-core sync: index unchanged"
    pass=$((pass + 1))
  else
    echo "FAIL  clean-core sync: unexpected staged changes: $staged"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case 2 — Dirty-core refusal: local modification → exit non-zero + stderr
# ---------------------------------------------------------------------------
{
  upstream="$(mktemp -d "$TMP_ROOT/upstream.XXXXXX")"
  init_git_repo "$upstream"
  make_initial_commit "$upstream" \
    "core-file.txt" "upstream content"

  adopter="$(mktemp -d "$TMP_ROOT/adopter.XXXXXX")"
  init_git_repo "$adopter"
  printf 'canonical_repo = "%s"\n' "$upstream" > "$adopter/crewrig.config.toml"
  mkdir -p "$adopter/.crewrig"
  printf 'core-file.txt\n' > "$adopter/.crewrig/core-paths.txt"
  make_initial_commit "$adopter" \
    "core-file.txt" "upstream content"

  # Introduce a local modification on the core path.
  printf 'local override content\n' > "$adopter/core-file.txt"

  run_case_stderr \
    "dirty-core refusal exits non-zero" \
    "$adopter" \
    1 \
    "core-file.txt"

  # Working tree must still contain the local modification (unchanged by script).
  content_after="$(cat "$adopter/core-file.txt" 2>/dev/null)"
  if [ "$content_after" = "local override content" ]; then
    echo "PASS  dirty-core refusal: working tree unchanged"
    pass=$((pass + 1))
  else
    echo "FAIL  dirty-core refusal: working tree was unexpectedly modified"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case 3 — Empty canonical_repo → exit non-zero, no git fetch attempted
# ---------------------------------------------------------------------------
{
  adopter="$(mktemp -d "$TMP_ROOT/adopter.XXXXXX")"
  init_git_repo "$adopter"
  # canonical_repo present but empty string.
  printf 'canonical_repo = ""\n' > "$adopter/crewrig.config.toml"
  mkdir -p "$adopter/.crewrig"
  printf 'core-file.txt\n' > "$adopter/.crewrig/core-paths.txt"
  make_initial_commit "$adopter" "core-file.txt" "content"

  run_case_stderr \
    "empty canonical_repo exits non-zero" \
    "$adopter" \
    1 \
    "canonical_repo"
}

# ---------------------------------------------------------------------------
# Case 4 — Absent canonical_repo key → exit non-zero, no git fetch attempted
# ---------------------------------------------------------------------------
{
  adopter="$(mktemp -d "$TMP_ROOT/adopter.XXXXXX")"
  init_git_repo "$adopter"
  # No canonical_repo key at all.
  printf '# empty config\n' > "$adopter/crewrig.config.toml"
  mkdir -p "$adopter/.crewrig"
  printf 'core-file.txt\n' > "$adopter/.crewrig/core-paths.txt"
  make_initial_commit "$adopter" "core-file.txt" "content"

  run_case_stderr \
    "absent canonical_repo exits non-zero" \
    "$adopter" \
    1 \
    "canonical_repo"
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
total=$((pass + fail))
echo ""
echo "Results: $pass/$total passed"
[ "$fail" -eq 0 ] && exit 0 || exit 1
