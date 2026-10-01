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
#   - Subtract a small, closed set of benign owners — none of them anyone's
#     login, so R6 holds: `agent` (any form) and `ana` (Windows drive-letter
#     form `C:/Users/ana/` only). Each is a `case` arm in is_benign_token below
#     with a one-line comment citing its source. Every other owner, and every
#     other form of `ana`, is machine-specific and is flagged.
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
# so placeholders and shell-variable forms fall out for free. The trailing
# delimiter is tolerant — a slash OR end-of-token/line — so a slash-less home
# root (e.g. `export HOME=/Users/alice` at end of line) is caught too, not just
# paths that continue past the owner segment.
PATTERN='/(Users|home)/[A-Za-z0-9._-]+(/|$)'

# Token shape for the per-token pass: the generic shape, optionally preceded by
# a Windows drive letter so a `C:/Users/<owner>/` token keeps its drive prefix
# (needed to scope the `ana` exemption below to the Windows form).
TOKEN_PATTERN='([A-Za-z]:)?/(Users|home)/[A-Za-z0-9._-]+(/|$)'

# is_benign_token <token> <line-content> — exit 0 when <token> is a declared
# benign home path. Each benign owner is one `case` arm with a one-line comment
# citing its source; a new benign owner requires the same.
is_benign_token() {
  local token="$1" content="$2" path owner re
  path="${token#[A-Za-z]:}"   # strip an optional drive letter
  owner="${path#/*/}"         # strip '/Users/' or '/home/' prefix
  owner="${owner%%/*}"        # keep the owner segment only
  case "$owner" in
    # agent: e2e container's non-root user (docker/e2e/base.Dockerfile, uid/gid 1000).
    agent) return 0 ;;
    # ana: fictional owner of example Windows checkout paths (C:/Users/ana/crewrig) in specs 0243 delta-02/delta-03 and scripts/tests/hook-command.test.ts, where <user> is impossible (spec 0243 R17 refuses cmd.exe metacharacters); Windows drive-letter form only, so a POSIX /Users/ana/ or /home/ana/ leak is still flagged; owner decision on #1326 and #1438.
    ana)
      [ "$path" != "$token" ] || return 1           # drive letter required
      case "$path" in /Users/*) ;; *) return 1 ;; esac
      # The drive letter must start a word: `host:/Users/ana/` is not `C:/`.
      re="(^|[^A-Za-z0-9])${token}"
      [[ "$content" =~ $re ]] && return 0
      return 1 ;;
  esac
  return 1
}

failures=0
while IFS= read -r hit; do
  # git grep -n emits `path:line:content`; split off path and line number.
  file="${hit%%:*}"
  rest="${hit#*:}"
  lineno="${rest%%:*}"
  content="${rest#*:}"

  # Extract each home-path token on this line and check it against the
  # declared benign owners.
  while IFS= read -r token; do
    [ -z "$token" ] && continue
    if ! is_benign_token "$token" "$content"; then
      echo "$file:$lineno: $token" >&2
      failures=$((failures + 1))
    fi
  done < <(printf '%s\n' "$content" | grep -oE "$TOKEN_PATTERN")
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
  echo "owners declared in scripts/check-no-machine-paths.sh are allowed: 'agent'" >&2
  echo "(docker/e2e/base.Dockerfile) and 'ana' (Windows drive-letter form C:/Users/ana/" >&2
  echo "only). A new benign owner requires a one-line, commented addition citing its source." >&2
  exit 1
fi

echo "OK: no machine-specific home-directory paths in tracked files."
