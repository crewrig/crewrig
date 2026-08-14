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
# Optimization (issue #939, spec 0157): the scan is changeset-aware,
# content-addressed, and parallel. Each suite's verdict is cached under a key
# derived from the suite's own content plus the content of every non-test file
# under scripts/ (root-level scripts/*.sh, scripts/lib/**, and any other non-test
# subdirectory), so a change to any script a suite might invoke invalidates
# every suite's verdict (R4) while a change to one suite invalidates only that
# suite (R2/R7). The execution set is ALL suites whose verdict is a cache-miss —
# never a diff-restricted subset. The git diff against the base ref is used only
# to short-circuit the "no change" case (skip the scan entirely when the diff
# over the whole scripts/ tree is empty).
#
# Usage:
#   bash scripts/check-test-strays.sh [--cache-dir DIR] [--base-ref REF] [--jobs N]
#
# Options:
#   --cache-dir DIR   Directory for the content-addressed verdict cache
#                     (default: .ci-cache).
#   --base-ref REF    Base ref to diff against for the "no change" short-circuit.
#                     Default: $GITHUB_BASE_REF, then
#                     $CI_MERGE_REQUEST_TARGET_BRANCH_NAME, then empty (no
#                     short-circuit; every non-cached suite runs).
#   --jobs N          Maximum number of suites to run in parallel
#                     (default: the runner's CPU count).
#

set -euo pipefail

REPO_DIR="${CREWRIG_REPO_DIR:-"$(cd "$(dirname "$0")/.." && pwd)"}"
TESTS_DIR="$REPO_DIR/scripts/tests"

CACHE_DIR=".ci-cache"
BASE_REF=""
JOBS=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --cache-dir) CACHE_DIR="$2"; shift 2 ;;
    --base-ref)  BASE_REF="$2";  shift 2 ;;
    --jobs)      JOBS="$2";      shift 2 ;;
    *) echo "Error: unknown option '$1'" >&2; exit 2 ;;
  esac
done

if [ ! -d "$TESTS_DIR" ]; then
  echo "Error: tests directory not found: $TESTS_DIR" >&2
  exit 2
fi

# --- sha256 helper (portable across Linux/macOS) ----------------------------

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$@"
  else
    shasum -a 256 "$@"
  fi
}

# --- Resolve the base ref ---------------------------------------------------

if [ -z "$BASE_REF" ]; then
  BASE_REF="${GITHUB_BASE_REF:-${CI_MERGE_REQUEST_TARGET_BRANCH_NAME:-}}"
fi

# --- "no change" short-circuit ----------------------------------------------
# When the base ref resolves and the merge-base diff over the whole scripts/
# tree is empty, there is nothing to validate: exit clean without scanning.
# This is a pure optimization; it never gates which suites run (the execution
# set below is always the cache-miss set).

if [ -n "$BASE_REF" ]; then
  if merge_base="$(git -C "$REPO_DIR" merge-base "$BASE_REF" HEAD 2>/dev/null)"; then
    if [ -z "$(git -C "$REPO_DIR" diff --name-only "$merge_base" HEAD -- scripts/)" ]; then
      echo "OK: zero runtime strays across all test suites."
      exit 0
    fi
  fi
fi

# --- Collect the suites -----------------------------------------------------

suites=()
for suite in "$TESTS_DIR"/test-*.sh; do
  [ -f "$suite" ] || continue
  suites+=("$suite")
done

# --- Per-suite content-addressed verdict key --------------------------------
# The key is sha256(suite content) + sha256 of every non-test file under
# scripts/ (root-level scripts/*.sh, scripts/lib/**, and any other non-test
# subdirectory). A change to any script a suite might invoke invalidates every
# suite's verdict (R4, and the arch-gap closure: a deleted/renamed root-level
# script a suite calls no longer serves a stale verdict), while a change to one
# suite invalidates only that suite (R2/R7). The cost is that a change to any
# non-test script — invoked or not — invalidates all verdicts; accepted in
# exchange for closing the gap without static parsing.

lib_hash=""
shopt -s globstar nullglob
for f in "$REPO_DIR"/scripts/**; do
  [ -f "$f" ] || continue
  case "$f" in
    "$TESTS_DIR"/*) continue ;;
  esac
  lib_hash="${lib_hash}$(sha256 "$f" | awk '{print $1}')"
done

# --- Determine the execution set (all cache-miss suites) ---------------------

to_run=()
for suite in ${suites[@]+"${suites[@]}"}; do
  suite_hash="$(sha256 "$suite" | awk '{print $1}')"
  key="$(printf '%s%s' "$suite_hash" "$lib_hash" | sha256 | awk '{print $1}')"
  marker="$CACHE_DIR/$key/$(basename "$suite").marker"
  if [ -f "$marker" ]; then
    echo "check-test-strays: cache hit, skipping $(basename "$suite")" >&2
  else
    to_run+=("$suite|$key")
  fi
done

if [ ${#to_run[@]} -eq 0 ]; then
  echo "OK: zero runtime strays across all test suites."
  exit 0
fi

# --- Run the execution set in parallel --------------------------------------

if [ -z "$JOBS" ]; then
  JOBS="$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 1)"
fi

run_one() {
  local entry="$1" suite key count marker
  suite="${entry%%|*}"
  key="${entry#*|}"
  count=$(LC_ALL=C bash "$suite" 2>&1 | grep -c "command not found" || true)
  if [ "$count" -ne 0 ]; then
    echo "FAILED: $(basename "$suite") has $count stray 'command not found' errors" >&2
    return 1
  fi
  marker="$CACHE_DIR/$key/$(basename "$suite").marker"
  mkdir -p "$(dirname "$marker")"
  : > "$marker"
  return 0
}
export -f run_one
export CACHE_DIR

failed=0
if ! printf '%s\n' ${to_run[@]+"${to_run[@]}"} | xargs -P "$JOBS" -I{} bash -c 'run_one "$@"' _ {}; then
  failed=1
fi

if [ "$failed" -eq 0 ]; then
  echo "OK: zero runtime strays across all test suites."
fi
exit "$failed"
