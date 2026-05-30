#!/usr/bin/env bash
# Wrapper that runs `gemini -p "<prompt>"` while polling lsof + tracking
# filesystem writes under ~/.gemini. Output: trace.txt in this dir.
#
# Usage:
#   ./trace-gemini-p.sh "quelle est la couleur du cheval blanc d'henri IV ?"

set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$HERE/trace.txt"
PROMPT="${1:-what colour is the white horse of Henri IV?}"

: > "$OUT"
{
  echo "=== trace-gemini-p.sh ==="
  echo "date: $(date -Iseconds)"
  echo "prompt: $PROMPT"
  echo
} >> "$OUT"

# Marker for post-run "what was modified" diff.
MARKER=/tmp/gemini-trace-marker
touch "$MARKER"

# Launch gemini in background, capture its PID, poll lsof until it exits.
echo "=== gemini stdout/stderr ===" >> "$OUT"
( gemini -p "$PROMPT" ) >> "$OUT" 2>&1 &
GPID=$!

# Accumulator: distinct file paths seen open by the process tree.
FILES_TMP=$(mktemp)
SOCKETS_TMP=$(mktemp)
trap 'rm -f "$FILES_TMP" "$SOCKETS_TMP"' EXIT

# Poll loop. -F pn = field-mode (PID/name only), -p includes the pid.
# We use -R to also catch descendants (rough; lsof on macOS lacks -R for descendants,
# so we widen by ancestor: pgrep + xargs.)
while kill -0 "$GPID" 2>/dev/null; do
  PIDS="$GPID $(pgrep -P "$GPID" 2>/dev/null | tr '\n' ' ')"
  for p in $PIDS; do
    lsof -p "$p" 2>/dev/null | awk 'NR>1 && $5=="REG"  {print $NF}' >> "$FILES_TMP"
    lsof -p "$p" 2>/dev/null | awk 'NR>1 && $5=="IPv4" {print $NF}' >> "$SOCKETS_TMP"
    lsof -p "$p" 2>/dev/null | awk 'NR>1 && $5=="IPv6" {print $NF}' >> "$SOCKETS_TMP"
  done
  sleep 0.2
done

wait "$GPID" 2>/dev/null
EXIT_CODE=$?

{
  echo
  echo "=== gemini exit code: $EXIT_CODE ==="
  echo
  echo "=== REG files opened during run (under HOME or /tmp, deduped) ==="
  sort -u "$FILES_TMP" | grep -E "^($HOME|/tmp|/var/folders)" | head -200
  echo
  echo "=== sockets observed ==="
  sort -u "$SOCKETS_TMP" | head -40
  echo
  echo "=== files MODIFIED under ~/.gemini since trace start ==="
  find ~/.gemini -newer "$MARKER" -type f \
    -not -path '*/antigravity-browser-profile/*' \
    -not -path '*/tmp/*' 2>/dev/null | head -50
  echo
  echo "=== files NEWLY CREATED under ~/.gemini (size+mtime) ==="
  find ~/.gemini -newer "$MARKER" -type f \
    -not -path '*/antigravity-browser-profile/*' \
    -not -path '*/tmp/*' \
    -exec stat -f "%N|%z|%Sm" {} \; 2>/dev/null | sort | head -50
} >> "$OUT"

echo "--- trace complete → $OUT ---"
echo "gemini exit: $EXIT_CODE"
