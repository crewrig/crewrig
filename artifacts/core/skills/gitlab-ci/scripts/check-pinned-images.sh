#!/usr/bin/env bash
# check-pinned-images.sh — flag GitLab CI container references that are not
# pinned to an immutable @sha256: digest.
#
# Usage: check-pinned-images.sh <pipeline-file-or-directory>
#
# Rationale: a `image: node:22` or `image: node:latest` reference is a moving
# target — the registry can re-point the tag to a different image at any time,
# silently changing what runs in your pipeline. Pinning to a digest
# (`image: node@sha256:<64-hex>`) makes the reference immutable, exactly as
# pinning a GitHub Action to a commit SHA does.
#
# Scanned surface (text scan; no registry call, no Docker, no live GitLab):
#   - `image: <ref>`                       (job-level, global, and default:)
#   - `image:` long form → its `name: <ref>`
#   - `services:` list entries: `- <ref>`  and `- name: <ref>` / `name: <ref>`
#
# Directory mode scans `<dir>/.gitlab-ci.yml` plus any YAML under `<dir>/.gitlab/`
# (the conventional local-include location). A bare variable reference with no
# tag (e.g. `$CI_REGISTRY_IMAGE`) is skipped — there is nothing to evaluate
# statically.
#
# Limitation: only inline forms (value on the same line) are matched. A `name:`
# spread across multiple YAML lines is not detected.

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

# An immutable reference is digest-pinned: <name>@sha256:<64 hex chars>.
digest_re='@sha256:[0-9a-fA-F]{64}$'

# Strip surrounding quotes from a captured scalar.
unquote() {
    local v="$1"
    v="${v%\"}"; v="${v#\"}"
    v="${v%\'}"; v="${v#\'}"
    printf '%s' "$v"
}

# Decide whether a container reference is acceptably pinned. Returns 0 (pinned
# or not-applicable) or 1 (a finding). A pure variable expansion with no tag is
# treated as not-applicable: there is no static digest to demand.
check_ref() {
    local value="$1" file="$2" lineno="$3"
    value="$(unquote "$value")"
    [ -z "$value" ] && return 0
    case "$value" in
        # Bare variable with no `:tag` and no digest — nothing to evaluate.
        \$*)
            case "$value" in
                *:*|*@*) ;;          # has a tag/digest part — fall through to the check
                *) return 0 ;;
            esac
            ;;
    esac
    if [[ "$value" =~ $digest_re ]]; then
        return 0
    fi
    echo "${C_RED}[UNPINNED]${C_RESET} ${file}:${lineno}: ${value}"
    return 1
}

for f in "${files[@]}"; do
    lineno=0
    in_image_block=0
    in_services_block=0
    block_indent=-1
    # shellcheck disable=SC2094  # check_ref() only echoes; it does not write to "$f".
    while IFS= read -r line || [ -n "$line" ]; do
        lineno=$((lineno + 1))

        # Skip blank and comment-only lines (but they do not close a block).
        case "$line" in
            ''|'#'*|*[![:space:]]*'#') : ;;
        esac

        # Current line indentation (number of leading spaces).
        stripped="${line#"${line%%[![:space:]]*}"}"
        indent=$(( ${#line} - ${#stripped} ))

        # Close an open block when indentation returns to/under the opener and
        # the line carries content.
        if { [ "$in_image_block" -eq 1 ] || [ "$in_services_block" -eq 1 ]; } \
            && [ -n "$stripped" ] && [ "$indent" -le "$block_indent" ]; then
            in_image_block=0
            in_services_block=0
            block_indent=-1
        fi

        # `image:` — short inline form, or open the long-form mapping block.
        if [[ "$line" =~ ^[[:space:]]*image:[[:space:]]*(.*)$ ]]; then
            val="${BASH_REMATCH[1]}"
            val="${val%%#*}"                       # drop trailing comment
            val="${val#"${val%%[![:space:]]*}"}"   # ltrim
            val="${val%"${val##*[![:space:]]}"}"   # rtrim
            if [ -n "$val" ]; then
                check_ref "$val" "$f" "$lineno" || violations=$((violations + 1))
            else
                in_image_block=1
                in_services_block=0
                block_indent=$indent
            fi
            continue
        fi

        # `services:` — open the list block (entries handled below).
        if [[ "$line" =~ ^[[:space:]]*services:[[:space:]]*$ ]]; then
            in_services_block=1
            in_image_block=0
            block_indent=$indent
            continue
        fi

        # Inside an image: mapping or a services: entry — a `name:` scalar.
        if { [ "$in_image_block" -eq 1 ] || [ "$in_services_block" -eq 1 ]; } \
            && [[ "$line" =~ ^[[:space:]]*-?[[:space:]]*name:[[:space:]]*([^[:space:]#]+) ]]; then
            check_ref "${BASH_REMATCH[1]}" "$f" "$lineno" || violations=$((violations + 1))
            continue
        fi

        # Inside services: — a bare list item `- <image-ref>`.
        if [ "$in_services_block" -eq 1 ] \
            && [[ "$line" =~ ^[[:space:]]*-[[:space:]]+([^[:space:]#]+) ]]; then
            check_ref "${BASH_REMATCH[1]}" "$f" "$lineno" || violations=$((violations + 1))
            continue
        fi
    done < "$f"
done

if [ "$violations" -eq 0 ]; then
    echo "${C_GREEN}[OK]${C_RESET} all image/service references are pinned to a @sha256: digest"
    exit 0
fi

echo "${C_RED}${violations} unpinned image/service reference(s) found${C_RESET}" >&2
exit 1
