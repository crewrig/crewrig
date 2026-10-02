#!/usr/bin/env bash
# ci-changeset-coverage.sh — Exhaustive run of every changeset-gated check
# (spec 0147 delta-01 R21).
#
# The monolithic `check-components` job was split into focused, changeset-gated
# capabilities, each with a `paths:` filter (spec 0147 R1-R4). A pull request
# runs only the capabilities whose `paths:` it touches; the static
# `path-ownership` check (scripts/check-path-ownership.ts) guarantees that every
# tracked file is owned by one of them or carries a reasoned exemption.
#
# This script is the net underneath that guarantee. It has NO diff and NO base
# ref: it reads the capabilities marked `changeset-gated: true` from
# ci/ci-capabilities.yml (via yq — never hardcoded, to avoid drift) and runs
# EVERY command of every one of them, unconditionally, in reference order. It
# is triggered `scheduled` (daily) and `manual` — never on a pull request or a
# push (see the `changeset-coverage` capability and
# .github/workflows/changeset-coverage.yml).
#
# Exit status: 0 when every command passed; 1 when any command failed (the
# remaining commands still run, so one run reports every failure); 2 when yq or
# the reference is missing.
#
# Stray scan (spec 0170 delta-01): every registered suite command in the
# reference is declared as
# `bash scripts/ci-cache-guard.sh --stray-scan -- bash scripts/tests/<suite>`.
# This script `eval`s each reference command as written, so the exhaustive run
# scans every suite for strays through its wrapped command, with no code here.
# scripts/check-test-strays.sh executes no suite and only runs `bash -n`, so
# there is nothing diff-scoped left to cover. The run executes every gated
# command; it does not make each command itself exhaustive.
#
# The changeset-coverage job carries python@3.12 + node@24 + yq, which satisfies
# every changeset-gated group's `requires` (a node@22 capability is therefore
# never changeset-gated).
#
# Prerequisites: yq (mikefarah v4).

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

# --- Run the full check suite ----------------------------------------------
# All commands from the changeset-gated capabilities, in reference order.
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
  echo "ci-changeset-coverage: $failures command(s) failed in the exhaustive run." >&2
  exit 1
fi
echo "ci-changeset-coverage: exhaustive run passed."
