#!/bin/bash
# check-no-machine-paths.sh — Reject machine-specific home paths in tracked files.
#
# Per spec 0081 (Requirements 5 and 6), continuous integration MUST fail a pull
# request when any tracked file reintroduces a machine-specific absolute
# home-directory path — the `/Users/<user>/…` or `/home/<user>/…` shape — and
# the check MUST name the offending path in its output. The guard MUST detect
# reintroduction through a GENERIC pattern and MUST NOT hard-code any specific
# login value, so the guard itself never carries a login into a tracked file
# (R6).
#
# Design:
#   - Deny the generic shape `/(Users|home)/<owner>/`. The owner character class
#     excludes `<`, `$`, `{`, so neutral placeholders like `/Users/<user>/`,
#     `$HOME/…`, or `${HOME}/…` never match and stay legal.
#   - Subtract a single benign owner, `agent` — the only non-machine-specific
#     owner present in the tracked tree: the e2e container's non-root user
#     created in `docker/e2e/base.Dockerfile` (`debian:bookworm-slim`, uid/gid
#     1000). Every other owner is machine-specific and is flagged.
#   - Match with a per-token pass (grep -oE), NOT a whole-line filter: a line
#     that holds both a benign `/home/agent/…` path and a real leak must still
#     surface the leak.
#
# Usage:
#   bash scripts/check-no-machine-paths.sh
#
# Exits 0 when no non-benign home path is present (prints an OK line), non-zero
# (with a per-offender `path:line: <path>` list on stderr) otherwise.

set -euo pipefail

REPO_DIR="${CREWRIG_REPO_DIR:-"$(cd "$(dirname "$0")/.." && pwd)"}"

# Generic machine-specific home-path shape. Owner class excludes '<', '$', '{'
# so placeholders and shell-variable forms fall out for free.
PATTERN='/(Users|home)/[A-Za-z0-9._-]+/'

# Sole benign owner present in the tracked tree (docker/e2e/base.Dockerfile).
BENIGN_OWNER='agent'

failures=0
while IFS= read -r hit; do
  # git grep -n emits `path:line:content`; split off path and line number.
  file="${hit%%:*}"
  rest="${hit#*:}"
  lineno="${rest%%:*}"
  content="${rest#*:}"

  # Extract each home-path token on this line and check its owner segment.
  while IFS= read -r token; do
    [ -z "$token" ] && continue
    owner="${token#/*/}"    # strip '/Users/' or '/home/' prefix
    owner="${owner%%/*}"    # keep the owner segment only
    if [ "$owner" != "$BENIGN_OWNER" ]; then
      echo "$file:$lineno: $token" >&2
      failures=$((failures + 1))
    fi
  done < <(printf '%s\n' "$content" | grep -oE "$PATTERN")
done < <(git -C "$REPO_DIR" grep -nE "$PATTERN" -- \
           . \
           ':(exclude)scripts/check-no-machine-paths.sh' \
           ':(exclude)scripts/tests/test-check-no-machine-paths.sh' || true)

if [ "$failures" -gt 0 ]; then
  echo "" >&2
  echo "FAILED: $failures machine-specific home-directory path(s) in tracked files (spec 0081)." >&2
  echo "" >&2
  echo "Tracked files must not contain absolute /Users/<user>/ or /home/<user>/ paths." >&2
  echo "Replace them with a neutral placeholder (\$HOME, <user>, <repo>). The benign" >&2
  echo "container owner '$BENIGN_OWNER' (docker/e2e/base.Dockerfile) is allowed; a new" >&2
  echo "benign owner requires a one-line, commented addition citing its source." >&2
  exit 1
fi

echo "OK: no machine-specific home-directory paths in tracked files."
