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
#   --base-ref REF    Base ref to diff against for changeset detection,
#                     used verbatim. Default: $GITHUB_BASE_REF, then
#                     $CI_MERGE_REQUEST_TARGET_BRANCH_NAME, then
#                     $CI_COMMIT_BEFORE_SHA, then HEAD~1.
#                     The two forge variables carry a BARE branch name, and a
#                     CI checkout is detached with only
#                     refs/remotes/<remote>/<name>, so they are resolved via
#                     resolve_remote_ref (scripts/lib/base-ref-resolve.sh):
#                     `<name>` first, then `<remote>/<name>` (issue #1401).
#   --jobs N          Maximum number of suites to run in parallel
#                     (default: the runner's CPU count).
#
# Fail-safe (spec 0170 R6): when no base ref is available, the base ref does
# not resolve to a commit, or it resolves but shares no merge-base with HEAD,
# every suite is scanned. That fallback is slow, so it is announced loudly:
# `check-test-strays: WARNING: ...` on stderr, plus a `::warning::` workflow
# annotation on stdout when GITHUB_ACTIONS=true.
#

set -euo pipefail

REPO_DIR="${CREWRIG_REPO_DIR:-"$(cd "$(dirname "$0")/.." && pwd)"}"
TESTS_DIR="$REPO_DIR/scripts/tests"

# The lib lives next to this script, NOT under $REPO_DIR (which tests point at
# a fixture without scripts/lib).
# shellcheck source=lib/base-ref-resolve.sh
source "$(dirname "$0")/lib/base-ref-resolve.sh"

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

# base_remote — the remote of the repo under check (same idiom as
# check-spec-id-reserved.sh), `origin` when there is none. Never fails.
base_remote() {
  local remote
  remote="$({ git -C "$REPO_DIR" remote 2>/dev/null | grep -E -m1 'crewrig|origin' \
    || git -C "$REPO_DIR" remote 2>/dev/null | head -1; } || true)"
  printf '%s' "${remote:-origin}"
}

# resolve_env_base <bare-branch-name> — sets BASE_REF to the remote-tracking
# form when the bare name does not verify; on failure BASE_REF keeps the raw
# name so the fallback warning can cite it.
RAW_BASE_REF=""
resolve_env_base() {
  local resolved
  RAW_BASE_REF="$1"
  BASE_REF="$1"
  if resolved="$(resolve_remote_ref "$1" "$(base_remote)" "$REPO_DIR")"; then
    BASE_REF="$resolved"
  fi
}

# warn_full_scan <detail> — loud, non-fatal announcement of the scan-everything
# fail-safe (spec 0170 R6): stderr always, `::warning::` on stdout under GitHub
# Actions.
warn_full_scan() {
  echo "check-test-strays: WARNING: $1 Falling back to a full scan of every test suite (slow)." >&2
  if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
    echo "::warning::check-test-strays: $1 Falling back to a full scan of every test suite (slow)."
  fi
}

if [ -z "$BASE_REF" ]; then
  if [ -n "${GITHUB_BASE_REF:-}" ]; then
    resolve_env_base "$GITHUB_BASE_REF"
  elif [ -n "${CI_MERGE_REQUEST_TARGET_BRANCH_NAME:-}" ]; then
    resolve_env_base "$CI_MERGE_REQUEST_TARGET_BRANCH_NAME"
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
    # Fallback if merge-base fails (spec 0170 R6): say which of the two
    # reasons applies, citing the raw name and, when different, the resolved ref.
    if ! git -C "$REPO_DIR" rev-parse --verify --quiet "${BASE_REF}^{commit}" >/dev/null 2>&1; then
      warn_full_scan "base ref '${RAW_BASE_REF:-$BASE_REF}' did not resolve to a commit."
    elif [ -n "$RAW_BASE_REF" ] && [ "$RAW_BASE_REF" != "$BASE_REF" ]; then
      warn_full_scan "base ref '$RAW_BASE_REF' resolved to '$BASE_REF' but it has no merge-base with HEAD."
    else
      warn_full_scan "base ref '$BASE_REF' resolved but it has no merge-base with HEAD."
    fi
    suites=(${all_suites[@]+"${all_suites[@]}"})
  fi
else
  # Fallback when no base-ref is provided
  warn_full_scan "no base ref could be determined (no --base-ref, no forge base-branch variable, no HEAD~1)."
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
