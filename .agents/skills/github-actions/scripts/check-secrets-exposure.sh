#!/usr/bin/env bash
# check-secrets-exposure.sh — flag patterns in GitHub Actions workflows that
# may leak secrets into logs or expand the secret blast radius.
#
# Usage: check-secrets-exposure.sh <workflow-file-or-directory>
#
# Patterns flagged:
#   1. `echo ${{ secrets.* }}`                          — secret echoed directly to stdout.
#   2. workflow-level `env:` referencing `secrets.*`    — broad blast radius across all jobs.
#   3. `set -x` / `set +x` in `run:`                   — shell trace expands env values.
#   4. `toJSON(secrets)` anywhere                       — serializes every secret as JSON.

set -euo pipefail

if [ -t 1 ]; then
    C_RED=$'\033[0;31m'
    C_GREEN=$'\033[0;32m'
    C_YELLOW=$'\033[0;33m'
    C_RESET=$'\033[0m'
else
    C_RED=""
    C_GREEN=""
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

report() {
    local file="$1" line="$2" pattern="$3" risk="$4"
    echo "${C_RED}[RISK]${C_RESET} ${file}:${line}: ${pattern}"
    echo "       ${C_YELLOW}why:${C_RESET} ${risk}"
    violations=$((violations + 1))
}

for current_file in "${files[@]}"; do
    lineno=0
    in_top_level_env=0
    top_level_env_lineno=0
    saw_top_level_env=0
    # shellcheck disable=SC2094  # report() only echoes; it does not write to current_file.
    while IFS= read -r line || [ -n "$line" ]; do
        lineno=$((lineno + 1))

        # 1. echo of a secret expression.
        if [[ "$line" =~ echo[[:space:]].*\$\{\{[[:space:]]*secrets\. ]]; then
            report "$current_file" "$lineno" "echo \${{ secrets.* }}" \
                "secret value is written to stdout and persisted in the run log"
        fi

        # 2. workflow-level env: that contains ${{ secrets.* }} — broad blast radius.
        # Only enter tracking on the first top-level (column-0) "env:" line.
        if [[ "$line" =~ ^env:[[:space:]]*$ ]] && [ "$saw_top_level_env" -eq 0 ]; then
            in_top_level_env=1
            top_level_env_lineno=$lineno
            saw_top_level_env=1
        elif [ "$in_top_level_env" -eq 1 ] && [ "$lineno" -gt "$top_level_env_lineno" ]; then
            # Exit the block on the first non-indented, non-blank, non-comment line.
            if [[ "$line" =~ ^[^[:space:]#] ]] && [[ -n "$line" ]]; then
                in_top_level_env=0
            elif [[ "$line" =~ \$\{\{[[:space:]]*secrets\. ]]; then
                report "$current_file" "$top_level_env_lineno" "top-level env: references \${{ secrets.* }}" \
                    "secrets defined at workflow level are inherited by every job (broad blast radius)"
                in_top_level_env=0
            fi
        fi

        # 3. set -x / set +x in a shell step.
        if [[ "$line" =~ (^|[^[:alnum:]_])set[[:space:]]+[-+]x([[:space:]]|$) ]]; then
            report "$current_file" "$lineno" "set -x / set +x" \
                "shell xtrace prints every expanded command, including secret env values"
        fi

        # 4. toJSON(secrets) — full secret bag serialization.
        if [[ "$line" =~ toJSON\([[:space:]]*secrets[[:space:]]*\) ]]; then
            report "$current_file" "$lineno" "toJSON(secrets)" \
                "serializes the entire secrets context — any later echo, env, or file write leaks them all"
        fi
    done < "$current_file"
done

if [ "$violations" -eq 0 ]; then
    echo "${C_GREEN}[OK]${C_RESET} no secret-exposure patterns detected"
    exit 0
fi

echo "${C_RED}${violations} risky pattern(s) found${C_RESET}" >&2
exit 1
