#!/bin/bash
# check-test-strays.sh — CI guard for stray commands in test suites (issue #738).
#
# A script with a stray command line (e.g. `some-bogus-command`) will print
# `some-bogus-command: command not found` to stderr and, unless `set -e` is
# active, continue executing. Because tests are wired as `bash <suite>`, a
# stray command inside one fails without anything consuming its status.
#
# The check here uses the runtime form: executing the suites and grepping for
# the error message. This avoids the ambiguity of parsing bash syntax statically.
#
# Usage:
#   bash scripts/check-test-strays.sh
#

set -euo pipefail

REPO_DIR="${CREWRIG_REPO_DIR:-"$(cd "$(dirname "$0")/.." && pwd)"}"
TESTS_DIR="$REPO_DIR/scripts/tests"

if [ ! -d "$TESTS_DIR" ]; then
  echo "Error: tests directory not found: $TESTS_DIR" >&2
  exit 2
fi

failed=0

for suite in "$TESTS_DIR"/test-*.sh; do
  [ -f "$suite" ] || continue
  
  # Execute the suite and count occurrences of "command not found"
  count=$(LC_ALL=C bash "$suite" 2>&1 | grep -c "command not found" || true)
  if [ "$count" -ne 0 ]; then
    echo "FAILED: $(basename "$suite") has $count stray 'command not found' errors" >&2
    failed=1
  fi
done

if [ "$failed" -eq 0 ]; then
  echo "OK: zero runtime strays across all test suites."
fi
exit "$failed"
