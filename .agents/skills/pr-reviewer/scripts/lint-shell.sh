#!/usr/bin/env bash
# lint-shell.sh — Shell script linter for PR review.
# Checks: shellcheck (if available), executable bit (100755), set -e presence.
# Usage: lint-shell.sh <file1.sh> [file2.sh ...]
#
# Exit 0 = no findings, 1 = findings. Missing optional tools degrade
# gracefully (exit 0 with a one-line note on stdout).

set -uo pipefail

if [ "$#" -eq 0 ]; then
  echo "lint-shell.sh: no files supplied — nothing to check."
  exit 0
fi

findings=0

if ! command -v shellcheck >/dev/null 2>&1; then
  echo "lint-shell.sh: shellcheck not found — skipping static analysis."
  HAS_SHELLCHECK=0
else
  HAS_SHELLCHECK=1
fi

for file in "$@"; do
  [ -f "$file" ] || { echo "lint-shell.sh: $file: not a regular file"; findings=1; continue; }

  # Executable bit (git tracked mode).
  mode=$(git ls-files --stage -- "$file" 2>/dev/null | awk '{print $1}')
  if [ -n "$mode" ] && [ "$mode" != "100755" ]; then
    echo "$file: not executable in git (mode $mode; expected 100755)"
    findings=1
  fi

  # set -e / set -euo pipefail presence.
  if ! grep -Eq '^[[:space:]]*set[[:space:]]+-[euox]+' "$file"; then
    echo "$file: missing 'set -e' (or 'set -euo pipefail') near the top"
    findings=1
  fi

  if [ "$HAS_SHELLCHECK" -eq 1 ]; then
    if ! out=$(shellcheck "$file" 2>&1); then
      printf '%s\n' "$out"
      findings=1
    fi
  fi
done

exit "$findings"
