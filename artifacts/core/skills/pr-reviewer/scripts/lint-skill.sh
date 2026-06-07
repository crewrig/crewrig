#!/usr/bin/env bash
# lint-skill.sh — SKILL.md frontmatter validator for PR review.
# Checks: required fields, version bumped vs base branch.
# Usage: lint-skill.sh <SKILL.md> [SKILL.md ...]
# Env: BASE_REF (default: origin/main)
#
# Exit 0 = no findings, 1 = findings. yq is preferred but absent triggers
# a grep-based fallback for the required keys.

set -uo pipefail

if [ "$#" -eq 0 ]; then
  echo "lint-skill.sh: no files supplied — nothing to check."
  exit 0
fi

BASE_REF="${BASE_REF:-origin/main}"
REQUIRED=(name description license compatibility metadata.provenance.version)
findings=0

HAS_YQ=0
if command -v yq >/dev/null 2>&1; then
  HAS_YQ=1
else
  echo "lint-skill.sh: yq not found — using grep fallback for required keys."
fi

check_key() {
  local file="$1" key="$2"
  if [ "$HAS_YQ" -eq 1 ]; then
    local value
    value=$(yq -r ".$key // \"\"" "$file" 2>/dev/null)
    [ -n "$value" ] && [ "$value" != "null" ]
  else
    # Grep fallback: handle nested keys (last segment).
    local leaf="${key##*.}"
    grep -Eq "^[[:space:]]*${leaf}:[[:space:]]*\S" "$file"
  fi
}

extract_version() {
  local file="$1"
  if [ "$HAS_YQ" -eq 1 ]; then
    yq -r '.metadata.provenance.version // ""' "$file" 2>/dev/null
  else
    awk '/^[[:space:]]*version:/ {gsub(/[" ]/,"",$2); print $2; exit}' "$file"
  fi
}

for file in "$@"; do
  [ -f "$file" ] || { echo "$file: not a regular file"; findings=1; continue; }

  for key in "${REQUIRED[@]}"; do
    if ! check_key "$file" "$key"; then
      echo "$file: missing required frontmatter key: $key"
      findings=1
    fi
  done

  head_version=$(extract_version "$file")
  base_version=$(git show "${BASE_REF}:${file}" 2>/dev/null | extract_version /dev/stdin 2>/dev/null || true)
  if [ -z "$base_version" ]; then
    # Try via temp file because yq on /dev/stdin can misbehave.
    if base_blob=$(git show "${BASE_REF}:${file}" 2>/dev/null); then
      tmp=$(mktemp)
      printf '%s\n' "$base_blob" > "$tmp"
      base_version=$(extract_version "$tmp")
      rm -f "$tmp"
    fi
  fi

  if [ -n "$base_version" ] && [ "$head_version" = "$base_version" ]; then
    echo "$file: version not bumped vs $BASE_REF (still $head_version)"
    findings=1
  fi
done

exit "$findings"
