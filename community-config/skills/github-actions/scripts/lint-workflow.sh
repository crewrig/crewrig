#!/usr/bin/env bash
# lint-workflow.sh — validate GitHub Actions workflow files via actionlint.
#
# Usage: lint-workflow.sh <workflow-file-or-directory>
#
# If a directory is passed, every .yml/.yaml under .github/workflows/ inside
# that directory is linted. If actionlint is missing, the script exits 0 with
# a friendly hint — it is not a hard blocker.

set -euo pipefail

# ANSI colours (disabled when stdout is not a TTY).
if [ -t 1 ]; then
    C_GREEN=$'\033[0;32m'
    C_RED=$'\033[0;31m'
    C_YELLOW=$'\033[0;33m'
    C_RESET=$'\033[0m'
else
    C_GREEN=""
    C_RED=""
    C_YELLOW=""
    C_RESET=""
fi

usage() {
    echo "Usage: $(basename "$0") <workflow-file-or-directory>" >&2
    exit 2
}

if [ "$#" -ne 1 ]; then
    usage
fi

TARGET="$1"

if ! command -v actionlint >/dev/null 2>&1; then
    echo "${C_YELLOW}[SKIP] actionlint not found — install: brew install actionlint${C_RESET}"
    exit 0
fi

# Build the list of files to lint.
files=()
if [ -d "$TARGET" ]; then
    workflows_dir="$TARGET/.github/workflows"
    if [ ! -d "$workflows_dir" ]; then
        workflows_dir="$TARGET"
    fi
    while IFS= read -r -d '' f; do
        files+=("$f")
    done < <(find "$workflows_dir" -type f \( -name '*.yml' -o -name '*.yaml' \) -print0)
elif [ -f "$TARGET" ]; then
    files+=("$TARGET")
else
    echo "${C_RED}[FAIL] not a file or directory: $TARGET${C_RESET}" >&2
    exit 1
fi

if [ "${#files[@]}" -eq 0 ]; then
    echo "${C_YELLOW}[SKIP] no workflow files found under: $TARGET${C_RESET}"
    exit 0
fi

rc=0
for f in "${files[@]}"; do
    if actionlint -no-color "$f"; then
        echo "${C_GREEN}[OK]${C_RESET} $f"
    else
        echo "${C_RED}[FAIL]${C_RESET} $f"
        rc=1
    fi
done

exit "$rc"
