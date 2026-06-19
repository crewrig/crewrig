#!/usr/bin/env bash
# check-secrets-exposure.sh — flag patterns in a GitLab CI pipeline that may
# leak secrets into job logs or expand the secret blast radius.
#
# Usage: check-secrets-exposure.sh <pipeline-file-or-directory>
#
# Patterns flagged (text scan; no live GitLab, no token read, no network):
#   1. Hardcoded secret literal in `variables:` or a shell assignment
#      (a key named like a credential set to an inline value, not a $VAR ref).
#   2. A well-known token shape appearing as a literal anywhere
#      (glpat-…, ghp_…, AWS AKIA…, a PEM private-key header).
#   3. `echo`/`printf` of a credential-named variable — written to the job log.
#   4. `set -x` / `set +x` in a `script:` — shell xtrace prints expanded values.
#   5. `CI_DEBUG_TRACE: "true"` — turns on full pipeline trace, logging every
#      variable including masked ones.
#
# Masking and protection are GitLab's real defenses (see the skill's
# references/variables-and-secrets.md); this scan catches the hygiene mistakes
# that defeat them before review.
#
# Directory mode scans `<dir>/.gitlab-ci.yml` plus any YAML under `<dir>/.gitlab/`.

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
    echo "Usage: $(basename "$0") <pipeline-file-or-directory>" >&2
    exit 2
}

if [ "$#" -ne 1 ]; then
    usage
fi

TARGET="$1"

files=()
if [ -d "$TARGET" ]; then
    if [ -f "$TARGET/.gitlab-ci.yml" ]; then
        files+=("$TARGET/.gitlab-ci.yml")
    fi
    if [ -d "$TARGET/.gitlab" ]; then
        while IFS= read -r -d '' f; do
            files+=("$f")
        done < <(find "$TARGET/.gitlab" -type f \( -name '*.yml' -o -name '*.yaml' \) -print0)
    fi
elif [ -f "$TARGET" ]; then
    files+=("$TARGET")
else
    echo "${C_RED}[FAIL] not a file or directory: $TARGET${C_RESET}" >&2
    exit 1
fi

if [ "${#files[@]}" -eq 0 ]; then
    echo "no GitLab pipeline file found under: $TARGET"
    exit 0
fi

violations=0

report() {
    local file="$1" line="$2" pattern="$3" risk="$4"
    echo "${C_RED}[RISK]${C_RESET} ${file}:${line}: ${pattern}"
    echo "       ${C_YELLOW}why:${C_RESET} ${risk}"
    violations=$((violations + 1))
}

# A key whose name marks it as a credential.
secret_key='(SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY|ACCESS_?KEY|PRIVATE_?KEY|CREDENTIAL|AUTH|PASSPHRASE)'

for current_file in "${files[@]}"; do
    lineno=0
    # shellcheck disable=SC2094  # report() only echoes; it does not write to current_file.
    while IFS= read -r line || [ -n "$line" ]; do
        lineno=$((lineno + 1))

        # Strip a leading YAML list dash so `- export TOKEN=…` is seen as a
        # shell assignment too.
        probe="${line#"${line%%[![:space:]]*}"}"
        probe="${probe#- }"

        # 1. Hardcoded literal: YAML `KEY: value` or shell `KEY=value` where the
        #    key is credential-named and the value is an inline literal (not a
        #    `$VAR` reference, not empty, not a masked/protected reference).
        if [[ "$probe" =~ ^(export[[:space:]]+)?[A-Za-z0-9_]*${secret_key}[A-Za-z0-9_]*[[:space:]]*[:=][[:space:]]*(.+)$ ]]; then
            val="${BASH_REMATCH[3]}"
            val="${val%%#*}"                       # drop trailing comment
            val="${val#"${val%%[![:space:]]*}"}"   # ltrim
            val="${val%"${val##*[![:space:]]}"}"   # rtrim
            # Unquote.
            val="${val%\"}"; val="${val#\"}"
            val="${val%\'}"; val="${val#\'}"
            case "$val" in
                ''|\$*|'!reference'*|'&'*|'*'*) : ;;   # ref/anchor/empty — fine
                *)
                    report "$current_file" "$lineno" "hardcoded value for a credential-named key" \
                        "a secret committed in the pipeline is readable by anyone with repo access — move it to a masked + protected CI/CD variable"
                    ;;
            esac
        fi

        # 2. Well-known token shapes as literals.
        if [[ "$line" =~ glpat-[A-Za-z0-9_-]{20} ]] \
            || [[ "$line" =~ (ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36} ]] \
            || [[ "$line" =~ AKIA[0-9A-Z]{16} ]] \
            || [[ "$line" =~ BEGIN[[:space:]].*PRIVATE[[:space:]]KEY ]]; then
            report "$current_file" "$lineno" "literal access token / private key" \
                "a recognizable credential literal is committed in the pipeline — revoke it and store it as a masked + protected CI/CD variable"
        fi

        # 3. echo / printf of a credential-named variable.
        if [[ "$line" =~ (echo|printf)[[:space:]].*\$\{?[A-Za-z0-9_]*${secret_key} ]]; then
            report "$current_file" "$lineno" "echo/printf of a credential-named variable" \
                "printing a secret to the job log persists it in the log; masking is best-effort and a transformed value bypasses it"
        fi

        # 4. set -x / set +x — shell xtrace.
        if [[ "$line" =~ (^|[^[:alnum:]_])set[[:space:]]+[-+]x([[:space:]]|$) ]]; then
            report "$current_file" "$lineno" "set -x / set +x" \
                "shell xtrace prints every expanded command, including secret variable values"
        fi

        # 5. CI_DEBUG_TRACE enabled.
        if [[ "$line" =~ CI_DEBUG_TRACE[[:space:]]*:?=?[[:space:]]*[\"\']?(true|1)[\"\']? ]]; then
            report "$current_file" "$lineno" "CI_DEBUG_TRACE enabled" \
                "debug trace logs every variable in the job, including masked and protected ones"
        fi
    done < "$current_file"
done

if [ "$violations" -eq 0 ]; then
    echo "${C_GREEN}[OK]${C_RESET} no secret-exposure patterns detected"
    exit 0
fi

echo "${C_RED}${violations} risky pattern(s) found${C_RESET}" >&2
exit 1
