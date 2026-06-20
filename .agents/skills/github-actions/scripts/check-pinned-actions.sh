#!/usr/bin/env bash
# check-pinned-actions.sh — flag GitHub Actions references that are not pinned
# to a 40-char commit SHA.
#
# Usage: check-pinned-actions.sh <workflow-file-or-directory>
#
# Rationale: pinning to a tag or branch lets an upstream maintainer push a
# new commit that silently runs in your pipeline. Pinning to a full SHA
# makes the reference immutable.
#
# Local actions (./path) are ignored — they are part of the repository.
#
# Limitation: only inline `uses: owner/repo@ref` forms (value on the same
# line) are matched. Multi-line YAML scalars for `uses:` are not detected.

set -euo pipefail

if [ -t 1 ]; then
    C_RED=$'\033[0;31m'
    C_GREEN=$'\033[0;32m'
    C_RESET=$'\033[0m'
else
    C_RED=""
    C_GREEN=""
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
    echo "no workflow files found under: $TARGET"
    exit 0
fi

violations=0

# Match: <indent>uses: <owner>/<repo>[/path]@<ref>
# Capture group 1 = the value after "uses: ".
uses_re='^[[:space:]]*uses:[[:space:]]*([^[:space:]#][^[:space:]#]*)'
# A pinned reference ends with @<40 hex chars>.
sha_re='@[0-9a-fA-F]{40}$'

for f in "${files[@]}"; do
    lineno=0
    while IFS= read -r line || [ -n "$line" ]; do
        lineno=$((lineno + 1))
        if [[ "$line" =~ $uses_re ]]; then
            value="${BASH_REMATCH[1]}"
            # Strip surrounding quotes if any.
            value="${value%\"}"
            value="${value#\"}"
            value="${value%\'}"
            value="${value#\'}"
            # Skip local actions.
            case "$value" in
                ./*|../*) continue ;;
                docker://*) continue ;;
            esac
            # Must contain '@' and end with a 40-char hex SHA.
            if [[ "$value" != *@* ]] || ! [[ "$value" =~ $sha_re ]]; then
                echo "${C_RED}[UNPINNED]${C_RESET} ${f}:${lineno}: ${value}"
                violations=$((violations + 1))
            fi
        fi
    done < "$f"
done

if [ "$violations" -eq 0 ]; then
    echo "${C_GREEN}[OK]${C_RESET} all action references are pinned to a SHA"
    exit 0
fi

echo "${C_RED}${violations} unpinned action reference(s) found${C_RESET}" >&2
exit 1
