#!/bin/bash
# check-pipefail-grep.sh — Reject writer piped into grep -q under pipefail.
#
# Per docs/scripting-conventions.md Rule 6, scripts and test suites MUST NOT pipe
# a writer (such as printf ... | grep -q) directly into grep -q.
# Under `set -o pipefail`, grep -q exits early upon matching, causing the writer
# to receive SIGPIPE (exit code 141), which fails the pipeline on Linux / CI.
# Use a here-string (grep -q ... <<< "$var") or native regex [[ =~ ]].
#
# Scope: scripts/ and hooks/, matching the other scripting convention guards.
#
# Usage:
#   bash scripts/check-pipefail-grep.sh
#
# Override the repository root with CREWRIG_REPO_DIR (used by unit tests
# against temporary fixtures), mirroring the sibling check-*.sh guards.
#
# Exits 0 when no governed script uses the anti-pattern, 1 if violations found,
# 2 on scan error or vacuous input (Rule 4).

set -euo pipefail

REPO_DIR="${CREWRIG_REPO_DIR:-"$(cd "$(dirname "$0")/.." && pwd)"}"

SCAN_TARGETS=""
for d in scripts hooks; do
  if [ -d "$REPO_DIR/$d" ]; then
    SCAN_TARGETS="${SCAN_TARGETS:+$SCAN_TARGETS }$d"
  fi
done

if [ -z "$SCAN_TARGETS" ]; then
  echo "Error: neither scripts/ nor hooks/ exists under $REPO_DIR — nothing to scan." >&2
  exit 2
fi

# Surface the size of the input actually scanned (docs/scripting-conventions.md
# Rule 4): a wedge that makes this guard see zero files must not read as a pass.
scanned="$( (cd "$REPO_DIR" && find $SCAN_TARGETS -type f 2>/dev/null | wc -l) | tr -d '[:space:]' )"
if [ "$scanned" -eq 0 ]; then
  echo "Error: scanned 0 files under $SCAN_TARGETS in $REPO_DIR — refusing to pass vacuously." >&2
  exit 2
fi

# Pattern to detect printf in command position piped into grep -q variants:
# e.g.: printf ... | grep -q, printf ... | grep -Eq, printf ... | grep -qxF
# Using command-position anchor so mentions inside strings (e.g. error messages)
# are not flagged.
ANCHOR='(^[[:space:]]*|[;&|(){}][[:space:]]*|(^|[[:space:]])(if|while|until|then|do|else|elif|time|!)[[:space:]]+)'
PATTERN="${ANCHOR}printf[[:space:]].*\|[[:space:]]*grep[[:space:]]+-[a-zA-Z]*q"

RAW=""
GREP_RC=0
GREP_ERR="$(mktemp)"
RAW="$( cd "$REPO_DIR" && grep -rnE "$PATTERN" $SCAN_TARGETS 2>"$GREP_ERR" )" || GREP_RC=$?
GREP_MSG="$(cat "$GREP_ERR")"
rm -f "$GREP_ERR"

if [ "$GREP_RC" -gt 1 ]; then
  echo "Error: the scan itself failed (grep exit $GREP_RC), so this run proves" >&2
  echo "       nothing about the tree. Refusing to report a clean result." >&2
  echo "       grep said: $GREP_MSG" >&2
  exit 2
fi

# Drop full-line comments and lines carrying the acknowledged-exception marker
HITS="$( printf '%s\n' "$RAW" \
         | grep -vE '^[^:]*:[0-9]+:[[:space:]]*#' \
         | grep -v 'acknowledged-exception:' || true )"

if [ -n "$HITS" ]; then
  hits_count="$(printf '%s\n' "$HITS" | grep -c . | tr -d '[:space:]')"
  echo "FAILED: $hits_count line(s) use printf ... | grep -q under pipefail:" >&2
  echo "" >&2
  printf '%s\n' "$HITS" >&2
  echo "" >&2
  echo "Each line above pipes printf into grep -q, which under set -o pipefail" >&2
  echo "fails with SIGPIPE (exit status 141) on Linux when grep exits on first match." >&2
  echo "See docs/scripting-conventions.md, Rule 6, for the portable replacement" >&2
  echo "(here-strings: grep -q ... <<< \"\$var\" or native regex: [[ \"\$var\" =~ ... ]])." >&2
  echo "If a script deliberately requires this construct, tag the line with" >&2
  echo "'# acknowledged-exception: <reason>'." >&2
  exit 1
fi

echo "OK: no printf ... | grep -q anti-pattern in $SCAN_TARGETS ($scanned file(s) scanned)."
exit 0
