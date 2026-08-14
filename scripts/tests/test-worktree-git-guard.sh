#!/bin/bash
# test-worktree-git-guard.sh — Regression test suite for hooks/worktree-git-guard.sh (spec 0153).

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
GUARD_SCRIPT="$SCRIPT_DIR/hooks/worktree-git-guard.sh"

pass=0
fail=0

run_test() {
  local name="$1" input_json="$2" expected_exit="$3"
  local actual_exit=0
  local output
  output=$(echo "$input_json" | bash "$GUARD_SCRIPT" 2>&1) || actual_exit=$?

  if [ "$actual_exit" -eq "$expected_exit" ]; then
    echo "PASS  $name"
    pass=$((pass + 1))
  else
    echo "FAIL  $name (expected exit $expected_exit, got $actual_exit)"
    echo "      output: $output"
    fail=$((fail + 1))
  fi
}

# Case 1: Non-worktree path -> exit 0
run_test "case-1: non-worktree cwd passes cleanly" \
  '{"cwd":"/tmp/some-dir","tool_input":{"command":"git reset --hard"}}' 0

# Case 2: Worktree path with safe command -> exit 0
run_test "case-2: worktree cwd with safe command passes cleanly" \
  '{"cwd":"/tmp/repo/.worktrees/771","tool_input":{"command":"git status"}}' 0

# Case 3: Worktree path with prohibited command without claim -> exit 1
run_test "case-3: worktree cwd with git reset --hard without claim fails" \
  '{"cwd":"/tmp/repo/.worktrees/771","tool_input":{"command":"git reset --hard"}}' 1

run_test "case-4: worktree cwd with git clean -fd without claim fails" \
  '{"cwd":"/tmp/repo/.worktrees/771","tool_input":{"command":"git clean -fd"}}' 1

echo ""
echo "Results: $pass/$((pass + fail)) passed"
[ "$fail" -eq 0 ] && exit 0 || exit 1
