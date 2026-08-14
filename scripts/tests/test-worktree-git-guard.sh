#!/bin/bash
# test-worktree-git-guard.sh — Regression test suite for hooks/worktree-git-guard.sh
# (spec 0153, incl. spec 0116 delta-03 R29 — Antigravity `PreToolUse` extraction).

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
GUARD_SCRIPT="$SCRIPT_DIR/hooks/worktree-git-guard.sh"

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT
# A real worktree path under a temp root: the cwd-pinned harness below must be
# able to `cd` into it, and the ticket-id extraction (`/\.worktrees/<id>/`) is
# identical to the literal `/tmp/repo/.worktrees/771` used in the payload cases.
WORKTREE_DIR="$TMP_ROOT/repo/.worktrees/771"
mkdir -p "$WORKTREE_DIR"

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

# cwd-pinned variant: Antigravity payloads carry no `.cwd` (the handler's working
# directory is the hooks.json directory), so the cwd must come from the execution
# context or from `workspacePaths[0]`. run_test_in_dir pins the execution cwd.
run_test_in_dir() {
  local dir="$1" name="$2" input_json="$3" expected_exit="$4"
  local actual_exit=0
  local output
  output=$(cd "$dir" && echo "$input_json" | bash "$GUARD_SCRIPT" 2>&1) || actual_exit=$?

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

# --- Antigravity cases (spec 0116 delta-03 R29 + spec 0153 R2) ---------------
# The Antigravity `PreToolUse` payload carries the command under
# `.toolCall.args.CommandLine` (`{toolCall:{name:"run_command",args:{CommandLine:...}}}`),
# not under `.tool_input.command`, which is what the guard historically read.

# R29: CommandLine extraction + refusal (no claim on ticket 771).
run_test_in_dir "$WORKTREE_DIR" "agy-R29: CommandLine git reset --hard refused in worktree" \
  '{"toolCall":{"name":"run_command","args":{"CommandLine":"git reset --hard"}}}' 1

# Same shape, safe command -> allowed.
run_test_in_dir "$WORKTREE_DIR" "agy-R29: CommandLine git status allowed in worktree" \
  '{"toolCall":{"name":"run_command","args":{"CommandLine":"git status"}}}' 0

# Same shape, git stash without a stash list/show/pop/apply/drop verb -> refused.
run_test_in_dir "$WORKTREE_DIR" "agy-R29: CommandLine git stash refused in worktree" \
  '{"toolCall":{"name":"run_command","args":{"CommandLine":"git stash"}}}' 1

# R29 fallback: `.toolCall.args` (an object text here) still matches the case
# substring and refuses.
run_test_in_dir "$WORKTREE_DIR" "agy-R29: .toolCall.args object-text git reset --hard refused" \
  '{"toolCall":{"name":"run_command","args":{"cmd":"git reset --hard"}}}' 1

# `workspacePaths[0]` cwd: no `.cwd` in the payload and the execution cwd is the
# suite's (not a worktree), yet the guard must see the worktree from the payload
# alone — the enforcement-critical half of the cwd-chain extension.
run_test "agy-workspacePaths: worktree root from payload alone refuses git clean -fd" \
  '{"workspacePaths":["/tmp/repo/.worktrees/771"],"toolCall":{"name":"run_command","args":{"CommandLine":"git clean -fd"}}}' 1

echo ""
echo "Results: $pass/$((pass + fail)) passed"
[ "$fail" -eq 0 ] && exit 0 || exit 1
