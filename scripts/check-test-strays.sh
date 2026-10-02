#!/bin/bash
# check-test-strays.sh — static syntax guard for the test suites (issue #738, specs 0170 and 0171).
#
# A script with a stray command line (e.g. `some-bogus-command`) will print
# `some-bogus-command: command not found` to stderr and, unless `set -e` is
# active, continue executing. Because tests are wired as `bash <suite>`, a
# stray command inside one fails without anything consuming its status.
#
# This script no longer detects strays at runtime. It EXECUTES ZERO SUITES, in
# every circumstance (spec 0170 delta-01 R9): it only runs the static syntax
# check (`bash -n`) over every scripts/tests/test-*.sh, which takes a couple of
# seconds at most. It needs no base ref, no merge-base and no git checkout
# history, and it reads and writes no cache.
#
# Runtime stray detection happens once per suite, in the job that already runs
# the suite: every registered suite command is declared as
# `bash scripts/ci-cache-guard.sh --stray-scan -- bash scripts/tests/<suite>`,
# which fails the job when the shell's not-found message appears on the suite's
# output (see scripts/ci-cache-guard.sh for the mode, its exit codes and its
# documented limits).
#
# Usage:
#   bash scripts/check-test-strays.sh
#
# Legacy options: --base-ref REF, --cache-dir DIR and --jobs N (each with its
# value) are still accepted and IGNORED, so existing invocations behave the
# same with or without them. The forge base-branch variables are not read.
# Positional arguments are a usage error (exit 2): no suite can be passed.
#
# Exit status: 0 clean (one `OK:` line), 1 syntax error in a suite (named on
# stderr), 2 usage error or missing tests directory.

set -euo pipefail

REPO_DIR="${CREWRIG_REPO_DIR:-"$(cd "$(dirname "$0")/.." && pwd)"}"
TESTS_DIR="$REPO_DIR/scripts/tests"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --cache-dir|--base-ref|--jobs)
      if [[ $# -lt 2 ]]; then
        echo "Error: option '$1' requires a value" >&2
        exit 2
      fi
      shift 2 ;;
    *) echo "Error: unknown option or argument '$1'" >&2; exit 2 ;;
  esac
done

if [ ! -d "$TESTS_DIR" ]; then
  echo "Error: tests directory not found: $TESTS_DIR" >&2
  exit 2
fi

# --- Static syntax validation across all test suites (spec 0170 R1, R9) ------

count=0
for suite in "$TESTS_DIR"/test-*.sh; do
  [ -f "$suite" ] || continue
  count=$((count + 1))
  if ! err_out="$(bash -n "$suite" 2>&1)"; then
    echo "FAILED: $(basename "$suite") has syntax errors:" >&2
    echo "$err_out" >&2
    exit 1
  fi
done

echo "OK: $count test suites pass the static syntax check; none executed."
