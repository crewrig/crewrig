#!/bin/bash
# test-check-figure-labels.sh — Unit test suite for scripts/check-figure-labels.sh (spec 0156 / issue #881).

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
CHECK_SCRIPT="$SCRIPT_DIR/scripts/check-figure-labels.sh"

pass=0
fail=0

run_test() {
  local name="$1"
  local actual_exit=0
  local output
  output=$(bash "$CHECK_SCRIPT" 2>&1) || actual_exit=$?

  if [ "$actual_exit" -eq 0 ]; then
    echo "PASS  $name"
    pass=$((pass + 1))
  else
    echo "FAIL  $name (expected exit 0, got $actual_exit)"
    echo "      output: $output"
    fail=$((fail + 1))
  fi
}

run_test "case-1: check-figure-labels.sh passes on repository figures"

echo ""
echo "Results: $pass/$((pass + fail)) passed"
[ "$fail" -eq 0 ] && exit 0 || exit 1
