#!/usr/bin/env bash
# ci-changeset-coverage.sh — Fail-safe for the check-components decomposition
# (spec 0147 R5).
#
# The monolithic `check-components` job was split into focused, changeset-gated
# capabilities, each with a `paths:` filter. This script is the fail-safe: it
# reads the focused `paths:` sets from ci/ci-capabilities.yml (via yq — never
# hardcoded, to avoid drift), computes the changed files against the base ref,
# and:
#   - if EVERY changed file is covered by the union of the focused path sets,
#     the focused jobs already covered the change → fast no-op (exit 0);
#   - if ANY changed file is NOT covered, the change would otherwise slip
#     through the focused gates → run the FULL check suite (all commands from
#     the changeset-gated capabilities) so coverage is never reduced (R10).
#
# The focused groups are identified by the `changeset-gated: true` marker in
# the reference (the check-components decomposition). The `changeset-coverage`
# capability itself carries no such marker and no `paths:` filter, so it runs
# on every change on both engines.
#
# Base-ref resolution (first non-empty wins):
#   CI_BASE_REF
#   CI_MERGE_REQUEST_TARGET_BRANCH_SHA
#   CI_COMMIT_BEFORE_SHA
#   origin/main
# If no base can be resolved, the script conservatively runs the full suite.
#
# Prerequisites: yq (mikefarah v4), git.

set -euo pipefail

command -v yq >/dev/null 2>&1 || {
  echo "Error: yq is required. Install with: brew install yq" >&2
  exit 2
}

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="${REPO_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
REFERENCE="$REPO_DIR/ci/ci-capabilities.yml"

if [ ! -f "$REFERENCE" ]; then
  echo "Error: CI reference not found: $REFERENCE" >&2
  exit 2
fi

# --- Resolve the base ref ---------------------------------------------------

base_ref=""
for cand in "${CI_BASE_REF:-}" "${CI_MERGE_REQUEST_TARGET_BRANCH_SHA:-}" "${CI_COMMIT_BEFORE_SHA:-}"; do
  if [ -n "$cand" ] && [ "$cand" != "null" ]; then
    base_ref="$cand"
    break
  fi
done
if [ -z "$base_ref" ]; then
  if git rev-parse --verify origin/main >/dev/null 2>&1; then
    base_ref="origin/main"
  fi
fi

# --- Collect the focused path sets (changeset-gated capabilities) -----------

# Every capability marked `changeset-gated: true` is part of the decomposition.
# Collect the union of their `paths:` filters (across all trigger entries).
focused_paths=""
while IFS= read -r id; do
  [ -z "$id" ] && continue
  while IFS= read -r p; do
    [ -z "$p" ] && continue
    focused_paths="${focused_paths}${p}"$'\n'
  done < <(yq -r ".capabilities[] | select(.id == \"$id\" and .changeset-gated == true) | .trigger[].paths // [] | .[]" "$REFERENCE")
done < <(yq -r '.capabilities[] | select(.changeset-gated == true) | .id' "$REFERENCE")

# --- Compute changed files --------------------------------------------------

if [ -z "$base_ref" ]; then
  echo "ci-changeset-coverage: no base ref resolvable — running the full check suite (fail-safe)."
  run_full_suite=1
else
  changed="$(git -C "$REPO_DIR" diff --name-only "$base_ref" HEAD 2>/dev/null || true)"
  if [ -z "$changed" ]; then
    echo "ci-changeset-coverage: no changed files vs $base_ref — nothing to cover."
    exit 0
  fi

  # A changed file is covered iff it matches at least one focused path glob.
  uncovered=""
  while IFS= read -r file; do
    [ -z "$file" ] && continue
    covered=0
    while IFS= read -r pat; do
      [ -z "$pat" ] && continue
      if [[ "$file" == $pat ]]; then
        covered=1
        break
      fi
    done <<< "$focused_paths"
    if [ "$covered" -eq 0 ]; then
      uncovered="${uncovered}${file}"$'\n'
    fi
  done <<< "$changed"

  if [ -z "$uncovered" ]; then
    echo "ci-changeset-coverage: every changed file is covered by a focused path set — fast no-op."
    exit 0
  fi

  echo "ci-changeset-coverage: uncovered changed file(s):"
  printf '%s' "$uncovered" | sed 's/^/  /'
  echo "ci-changeset-coverage: running the full check suite (fail-safe, R5)."
  run_full_suite=1
fi

# --- Run the full check suite ----------------------------------------------
# All commands from the changeset-gated capabilities, in reference order. The
# changeset-coverage job carries python@3.12 + yq, which satisfies every
# changeset-gated group's requires (they are all satisfiable by that runtime).
failures=0
while IFS= read -r id; do
  [ -z "$id" ] && continue
  while IFS= read -r cmd; do
    [ -z "$cmd" ] && continue
    echo "ci-changeset-coverage: running [$id] $cmd"
    if ! ( cd "$REPO_DIR" && eval "$cmd" ); then
      echo "ci-changeset-coverage: FAILED [$id] $cmd" >&2
      failures=$((failures + 1))
    fi
  done < <(yq -r ".capabilities[] | select(.id == \"$id\" and .changeset-gated == true) | .command[]" "$REFERENCE")
done < <(yq -r '.capabilities[] | select(.changeset-gated == true) | .id' "$REFERENCE")

if [ "$failures" -gt 0 ]; then
  echo "ci-changeset-coverage: $failures command(s) failed in the full check suite." >&2
  exit 1
fi
echo "ci-changeset-coverage: full check suite passed."
