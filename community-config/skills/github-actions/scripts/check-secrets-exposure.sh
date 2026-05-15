#!/usr/bin/env bash
# check-secrets-exposure.sh — flag patterns in GitHub Actions workflows that
# may leak secrets into logs or expand the secret blast radius.
#
# Usage: check-secrets-exposure.sh <workflow-file-or-directory>
#
# Patterns flagged:
#   1. `echo ${{ secrets.* }}`           — secret echoed directly to stdout.
#   2. workflow-level `env:`             — env values accessible to every job.
#   3. `set -x` / `set +x` in `run:`     — shell trace expands env values.
#   4. `toJSON(secrets)` anywhere        — serialises every secret as JSON.

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
    saw_top_level_env=0
    # shellcheck disable=SC2094  # report() only echoes; it does not write to current_file.
    while IFS= read -r line || [ -n "$line" ]; do
        lineno=$((lineno + 1))

        # 1. echo of a secret expression.
        if [[ "$line" =~ echo[[:space:]].*\$\{\{[[:space:]]*secrets\. ]]; then
            report "$current_file" "$lineno" "echo \${{ secrets.* }}" \
                "secret value is written to stdout and persisted in the run log"
        fi

        # 2. workflow-level env: — a line starting at column 0 that is "env:".
        if [[ "$line" =~ ^env:[[:space:]]*$ ]] && [ "$saw_top_level_env" -eq 0 ]; then
            report "$current_file" "$lineno" "top-level env:" \
                "values defined here are inherited by every job and step (broad blast radius)"
            saw_top_level_env=1
        fi

        # 3. set -x / set +x in a shell step.
        if [[ "$line" =~ (^|[^[:alnum:]_])set[[:space:]]+[-+]x([[:space:]]|$) ]]; then
            report "$current_file" "$lineno" "set -x / set +x" \
                "shell xtrace prints every expanded command, including secret env values"
        fi

        # 4. toJSON(secrets) — full secret bag serialisation.
        if [[ "$line" =~ toJSON\([[:space:]]*secrets[[:space:]]*\) ]]; then
            report "$current_file" "$lineno" "toJSON(secrets)" \
                "serialises the entire secrets context — any later echo, env, or file write leaks them all"
        fi
    done < "$current_file"
done

if [ "$violations" -eq 0 ]; then
    echo "${C_GREEN}[OK]${C_RESET} no secret-exposure patterns detected"
    exit 0
fi

echo "${C_RED}${violations} risky pattern(s) found${C_RESET}" >&2
exit 1
