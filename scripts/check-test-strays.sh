#!/bin/bash
# check-test-strays.sh — CI guard for stray commands in test suites (issue #738, spec 0170).
#
# A script with a stray command line (e.g. `some-bogus-command`) will print
# `some-bogus-command: command not found` to stderr and, unless `set -e` is
# active, continue executing. Because tests are wired as `bash <suite>`, a
# stray command inside one fails without anything consuming its status.
#
# Fast validation strategy (spec 0170):
# 1. Static syntax check (`bash -n`) is run across all test suites in milliseconds.
# 2. Runtime execution for stray command detection is strictly scoped to the
#    suites modified or added in the changeset (git diff --name-only <base> HEAD -- scripts/tests/test-*.sh).
# 3. When no test suites are modified, zero suites are executed at runtime.
# 4. Changes to non-test scripts under scripts/ do NOT trigger runtime execution
#    of unchanged test suites.
#
# Usage:
#   bash scripts/check-test-strays.sh [--cache-dir DIR] [--base-ref REF] [--jobs N]
#
# Options:
#   --cache-dir DIR   Directory for the content-addressed verdict cache
#                     (default: .ci-cache).
#   --base-ref REF    Base ref to diff against for changeset detection.
#                     Default: $GITHUB_BASE_REF, then
#                     $CI_MERGE_REQUEST_TARGET_BRANCH_NAME.
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

# --- Collect all test suites ------------------------------------------------

all_suites=()
for suite in "$TESTS_DIR"/test-*.sh; do
  [ -f "$suite" ] || continue
  all_suites+=("$suite")
done

# --- 1. Static syntax validation across all test suites (spec 0170 R1) -------

for suite in ${all_suites[@]+"${all_suites[@]}"}; do
  if ! err_out="$(bash -n "$suite" 2>&1)"; then
    echo "FAILED: $(basename "$suite") has syntax errors:" >&2
    echo "$err_out" >&2
    exit 1
  fi
done

# --- sha256 helper (portable across Linux/macOS) ----------------------------

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$@"
  else
    shasum -a 256 "$@"
  fi
}

# --- Resolve the base ref (spec 0171 R1) ------------------------------------

if [ -z "$BASE_REF" ]; then
  if [ -n "${GITHUB_BASE_REF:-}" ]; then
    BASE_REF="$GITHUB_BASE_REF"
  elif [ -n "${CI_MERGE_REQUEST_TARGET_BRANCH_NAME:-}" ]; then
    BASE_REF="$CI_MERGE_REQUEST_TARGET_BRANCH_NAME"
  elif [ -n "${CI_COMMIT_BEFORE_SHA:-}" ] && [ "$CI_COMMIT_BEFORE_SHA" != "0000000000000000000000000000000000000000" ]; then
    BASE_REF="$CI_COMMIT_BEFORE_SHA"
  elif git -C "$REPO_DIR" rev-parse --verify HEAD~1 >/dev/null 2>&1; then
    BASE_REF="HEAD~1"
  fi
fi

# --- 2. Scope execution to changeset-modified suites (spec 0170 R2-R5) ------

suites=()
if [ -n "$BASE_REF" ]; then
  if merge_base="$(git -C "$REPO_DIR" merge-base "$BASE_REF" HEAD 2>/dev/null)"; then
    changed_files="$(git -C "$REPO_DIR" diff --name-only "$merge_base" HEAD -- scripts/tests/ 2>/dev/null || true)"
    if [ -z "$changed_files" ]; then
      echo "OK: zero runtime strays across all test suites."
      exit 0
    fi
    for rel in $changed_files; do
      abs="$REPO_DIR/$rel"
      if [ -f "$abs" ] && [[ "$(basename "$abs")" == test-*.sh ]]; then
        suites+=("$abs")
      fi
    done
    if [ ${#suites[@]} -eq 0 ]; then
      echo "OK: zero runtime strays across all test suites."
      exit 0
    fi
  else
    # Fallback if merge-base fails
    suites=(${all_suites[@]+"${all_suites[@]}"})
  fi
else
  # Fallback when no base-ref is provided
  suites=(${all_suites[@]+"${all_suites[@]}"})
fi

# --- Determine execution set from content-addressed cache -------------------

to_run=()
for suite in ${suites[@]+"${suites[@]}"}; do
  key="$(sha256 "$suite" | awk '{print $1}')"
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
