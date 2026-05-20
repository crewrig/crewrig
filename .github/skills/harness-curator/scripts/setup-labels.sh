#!/bin/bash
# setup-labels.sh — Bootstrap the GitHub labels used by the Harness Curator.
#
# `gh issue create --label <name>` fails if the label does not exist on
# the target repo, so every fork that may receive curator output must
# pre-create the 9 labels listed below before the first `--apply` run.
# This script is the one-shot, idempotent bootstrap maintainers run once
# per target repo (or any time the label vocabulary changes — re-runs
# are safe, see `gh label create --force` semantics).
#
# Usage:
#   bash scripts/setup-labels.sh [--repo <owner/repo>] [--dry-run]
#
# Options:
#   --repo <owner/repo>  Target repo. Omit to let `gh` resolve from the
#                        current working directory's git remote.
#   --dry-run            Print the plan (one line per label) without
#                        contacting GitHub. Exit 0 unless the args are
#                        malformed.
#
# Exit codes:
#   0   All 9 labels created or updated successfully (or dry-run plan
#       printed).
#   1   Usage error.
#   2   One or more `gh label create` calls failed. Every label is
#       attempted before exit — partial failure does not short-circuit.
#
# Idempotence: `gh label create --force` creates the label if absent,
# otherwise updates its color and description in place. Re-running the
# script after a label vocabulary change is the supported upgrade path.

set -euo pipefail

# --- Args ------------------------------------------------------------------

REPO=""
DRY_RUN=0

usage() {
  # Sentinel-based extraction: print the header doc-block (everything
  # between line 2 and the first `set -euo pipefail` line, exclusive).
  # This stays in sync with the header regardless of its length.
  awk 'NR>1 && /^set -euo pipefail/ {exit} NR>1 {print}' "$0" >&2
}

while [ $# -gt 0 ]; do
  case "$1" in
    --repo)
      [ $# -ge 2 ] || { echo "ERROR: --repo requires a value" >&2; usage; exit 1; }
      REPO="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "ERROR: unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

# --- Label vocabulary ------------------------------------------------------
# Source of truth for the 9 labels the Curator emits. Format per row:
#   name|color|description
# Color values are 6-char hex (no leading #), per `gh label create -c`.
# Keep this in sync with the labels documented in SKILL.md and produced
# by curate.py / apply.py.

LABELS=(
  "harness-feedback|FBCA04|Auto-curated friction report"
  "room:tool|0E8A16|Friction category: tool"
  "room:prompt|0E8A16|Friction category: prompt"
  "room:format|0E8A16|Friction category: format"
  "room:behavior|0E8A16|Friction category: behavior"
  "room:process|0E8A16|Friction category: process"
  "severity:low|C2E0C6|Friction severity: low"
  "severity:med|FBCA04|Friction severity: med"
  "severity:high|D93F0B|Friction severity: high"
)

# --- Dry-run path ----------------------------------------------------------
# Prints one line per label. Stable output shape — tester asserts on it.

if [ "$DRY_RUN" -eq 1 ]; then
  for row in "${LABELS[@]}"; do
    IFS='|' read -r name color desc <<<"$row"
    echo "would create: $name (color=$color, description=$desc)"
  done
  exit 0
fi

# --- Apply path ------------------------------------------------------------
# Per-label `gh label create --force`. Collect failures, attempt all 9
# before exiting non-zero — surfacing the full failure set in one pass
# beats forcing the maintainer to fix-and-rerun nine times.

command -v gh >/dev/null 2>&1 || {
  echo "ERROR: gh CLI is required but not found in PATH" >&2
  exit 1
}

GH_ARGS=()
if [ -n "$REPO" ]; then
  GH_ARGS+=(--repo "$REPO")
fi

FAILURES=()

for row in "${LABELS[@]}"; do
  IFS='|' read -r name color desc <<<"$row"
  if gh label create "$name" \
       --color "$color" \
       --description "$desc" \
       --force \
       "${GH_ARGS[@]}" >/dev/null 2>&1; then
    echo "ok: $name"
  else
    echo "FAIL: $name" >&2
    FAILURES+=("$name")
  fi
done

if [ "${#FAILURES[@]}" -gt 0 ]; then
  echo "" >&2
  echo "ERROR: ${#FAILURES[@]} label(s) failed: ${FAILURES[*]}" >&2
  echo "Re-run after resolving (check gh auth status and repo permissions)." >&2
  exit 2
fi

echo ""
echo "OK: all ${#LABELS[@]} labels bootstrapped${REPO:+ on $REPO}."
