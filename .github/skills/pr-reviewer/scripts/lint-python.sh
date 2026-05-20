#!/usr/bin/env bash
# lint-python.sh — Python linter for PR review.
# Checks: ruff or flake8 (if available), bare print() in non-test files.
# Usage: lint-python.sh <file1.py> [file2.py ...]
#
# Exit 0 = no findings, 1 = findings. Missing both ruff and flake8
# degrades gracefully (exit 0 with a one-line note on stdout).

set -uo pipefail

if [ "$#" -eq 0 ]; then
  echo "lint-python.sh: no files supplied — nothing to check."
  exit 0
fi

findings=0

if command -v ruff >/dev/null 2>&1; then
  if ! out=$(ruff check "$@" 2>&1); then
    printf '%s\n' "$out"
    findings=1
  fi
elif command -v flake8 >/dev/null 2>&1; then
  if ! out=$(flake8 "$@" 2>&1); then
    printf '%s\n' "$out"
    findings=1
  fi
else
  echo "lint-python.sh: neither ruff nor flake8 found — skipping static analysis."
fi

# Bare print() in non-test files.
for file in "$@"; do
  [ -f "$file" ] || continue
  case "$file" in
    *test*|*tests*) continue ;;
  esac
  if hits=$(grep -nE '^\s*print\(' "$file"); then
    while IFS= read -r line; do
      echo "$file:${line%%:*}: bare print() in non-test file"
    done <<<"$hits"
    findings=1
  fi
done

exit "$findings"
