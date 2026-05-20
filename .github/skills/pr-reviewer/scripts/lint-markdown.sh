#!/usr/bin/env bash
# lint-markdown.sh — Markdown linter for PR review.
# Checks: markdownlint (if available).
# Usage: lint-markdown.sh <file1.md> [file2.md ...]
#
# Exit 0 = no findings, 1 = findings. Missing markdownlint degrades
# gracefully (exit 0 with a one-line note on stdout).

set -uo pipefail

if [ "$#" -eq 0 ]; then
  echo "lint-markdown.sh: no files supplied — nothing to check."
  exit 0
fi

if ! command -v markdownlint >/dev/null 2>&1; then
  echo "lint-markdown.sh: markdownlint not found — skipping."
  exit 0
fi

if out=$(markdownlint "$@" 2>&1); then
  exit 0
fi

printf '%s\n' "$out"
exit 1
