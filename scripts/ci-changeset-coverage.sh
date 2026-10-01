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
# Base-ref resolution (first candidate that is set AND resolves wins):
#   CI_BASE_REF
#   CI_MERGE_REQUEST_TARGET_BRANCH_SHA
#   CI_COMMIT_BEFORE_SHA
#   origin/main
# A candidate is UNSET when it is empty, the literal `null`, or all zeros
# (GitHub `before` on a new branch, GitLab `CI_COMMIT_BEFORE_SHA` on a new
# pipeline): the all-zero SHA is not a commit and must never be diffed. A set
# candidate is resolved by `resolve_remote_ref` in scripts/lib/base-ref-resolve.sh
# (a SHA, `origin/x`, a local ref, or a bare branch name such as `release/x`,
# which a CI checkout holds only as `origin/release/x`); it tries the name as
# given first, then `origin/<name>`, so a local branch that diverges from its
# remote-tracking ref wins, which never happens on a CI checkout. Each reading is
# verified to be a commit. A set candidate that does not resolve is reported on
# stderr and skipped (over-inclusive, never under-inclusive: R10). Because the
# fallback `origin/main` can equal HEAD on a `main` push, an EMPTY diff is
# trusted as "nothing to cover" only when no set candidate was skipped; after a
# skipped candidate the emptiness is untrustworthy and the full suite runs.
#
# The diff is merge-base relative: the changed files are those between
# `git merge-base <base> HEAD` and HEAD, i.e. what the change itself introduces,
# not what the base gained since the change was cut (a two-dot diff against a
# diverged `release/**` base would list its whole delta). If no base, no
# merge-base or no diff can be established, the script conservatively runs the
# full suite rather than exiting 0.
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

# shellcheck source=lib/base-ref-resolve.sh
source "$SCRIPT_DIR/lib/base-ref-resolve.sh"

if [ ! -f "$REFERENCE" ]; then
  echo "Error: CI reference not found: $REFERENCE" >&2
  exit 2
fi

# --- Resolve the base ref ---------------------------------------------------

# True when $1 is empty, `null` or all zeros: not a usable base.
is_unset_candidate() {
  case "$1" in
    "" | null) return 0 ;;
  esac
  case "$1" in
    *[!0]*) return 1 ;;
    *) return 0 ;;
  esac
}

base_ref=""
skipped_candidate=0
for cand in "${CI_BASE_REF:-}" "${CI_MERGE_REQUEST_TARGET_BRANCH_SHA:-}" "${CI_COMMIT_BEFORE_SHA:-}" "origin/main"; do
  if is_unset_candidate "$cand"; then
    continue
  fi
  if base_ref="$(resolve_remote_ref "$cand" origin "$REPO_DIR")"; then
    break
  fi
  base_ref=""
  skipped_candidate=1
  echo "ci-changeset-coverage: base candidate '$cand' does not resolve to a commit — skipping." >&2
done

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

# Fail-safe (R10): when the base, the merge-base or the diff cannot be
# established, run the full suite instead of concluding "nothing changed".
merge_base=""
changed=""
if [ -z "$base_ref" ]; then
  echo "ci-changeset-coverage: no base ref resolvable — running the full check suite (fail-safe)."
  run_full_suite=1
elif ! merge_base="$(git -C "$REPO_DIR" merge-base "$base_ref" HEAD)"; then
  echo "ci-changeset-coverage: no merge-base between $base_ref and HEAD — running the full check suite (fail-safe)." >&2
  run_full_suite=1
elif ! changed="$(git -C "$REPO_DIR" diff --name-only "$merge_base" HEAD)"; then
  echo "ci-changeset-coverage: cannot diff $merge_base..HEAD — running the full check suite (fail-safe)." >&2
  run_full_suite=1
else
  echo "ci-changeset-coverage: base $base_ref, merge-base $merge_base."
  if [ -z "$changed" ]; then
    if [ "$skipped_candidate" -eq 0 ]; then
      echo "ci-changeset-coverage: no changed files vs $base_ref — nothing to cover."
      exit 0
    fi
    echo "ci-changeset-coverage: a set base candidate did not resolve and the diff against the fallback $base_ref is empty, so the emptiness cannot be trusted — running the full check suite (fail-safe)." >&2
    run_full_suite=1
  else
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
