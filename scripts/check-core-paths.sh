#!/bin/bash
# check-core-paths.sh — Reject phantom entries in the core-paths manifest.
#
# Per spec 0031 (Requirement 5), continuous integration MUST fail a pull
# request when any entry in .crewrig/core-paths.txt does not resolve to
# tracked content at the repository HEAD. A "phantom" entry — a manifest
# line naming a path with no tracked content — makes an adopter's
# sync-from-upstream.sh run skip-with-warning at best, and historically
# aborted the whole sync. This guard catches such an entry before it can
# reach the canonical branch.
#
# Policy semantics (spec 0020) mirror sync-from-upstream.sh:
#   strict / adopt-on-edit  Upstream-owned content — MUST resolve at HEAD.
#   excluded                Org-owned — not guaranteed tracked in every
#                           clone, so explicitly NOT checked.
# The path/policy split logic below is intentionally identical to the
# manifest parser in sync-from-upstream.sh (first whitespace field = path,
# second token = policy, default `strict`; blank/`#` lines skipped; CRLF
# tolerated).
#
# Usage:
#   bash scripts/check-core-paths.sh
#
# Exits 0 if every strict/adopt-on-edit entry resolves at HEAD, non-zero
# (with a per-entry failure list) otherwise.

set -euo pipefail

REPO_DIR="${CREWRIG_REPO_DIR:-"$(cd "$(dirname "$0")/.." && pwd)"}"
MANIFEST="$REPO_DIR/.crewrig/core-paths.txt"

if [ ! -f "$MANIFEST" ]; then
  echo "Error: manifest not found: $MANIFEST" >&2
  exit 2
fi

# Parse the manifest into parallel arrays of paths and policies.
# `while read` rather than `mapfile` for bash 3.2 compat (macOS default).
PATHS=()
POLICIES=()
while IFS= read -r line || [ -n "$line" ]; do
  # Strip a trailing carriage return (tolerate CRLF manifests).
  line="${line%$'\r'}"
  # Skip blank lines and comments.
  [[ -z "$line" || "$line" == \#* ]] && continue
  # Split off the first whitespace-delimited field (path) and the rest (policy).
  path="${line%%[[:space:]]*}"
  rest="${line#"$path"}"
  policy="${rest#"${rest%%[![:space:]]*}"}"   # ltrim
  policy="${policy%%[[:space:]]*}"             # first token only
  [ -z "$policy" ] && policy="strict"
  PATHS+=("$path")
  POLICIES+=("$policy")
done < "$MANIFEST"

failures=()
checked=0
for i in "${!PATHS[@]}"; do
  path="${PATHS[$i]}"
  policy="${POLICIES[$i]}"

  # Org-owned entries are not guaranteed tracked content in every clone.
  [ "$policy" = "excluded" ] && continue

  checked=$((checked + 1))
  if ! git -C "$REPO_DIR" cat-file -e "HEAD:$path" 2>/dev/null; then
    echo "  FAIL $path ($policy) — does not resolve to tracked content at HEAD" >&2
    failures+=("$path")
  fi
done

if [ "${#failures[@]}" -gt 0 ]; then
  echo "" >&2
  echo "FAILED: ${#failures[@]} core-paths manifest entr(y/ies) do not resolve at HEAD:" >&2
  for p in "${failures[@]}"; do
    echo "  - $p" >&2
  done
  echo "" >&2
  echo "Every strict/adopt-on-edit entry in .crewrig/core-paths.txt must resolve to" >&2
  echo "tracked content at HEAD (spec 0031). Either commit the missing content, or" >&2
  echo "remove the manifest entry (and its docs/layers.md row, per the co-maintenance" >&2
  echo "rule in AGENTS.md)." >&2
  exit 1
fi

echo "OK: all $checked strict/adopt-on-edit core-paths entries resolve at HEAD."
