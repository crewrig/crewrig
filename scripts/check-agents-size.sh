#!/usr/bin/env bash
# Fails CI if AGENTS.md meets or exceeds the 22 000-byte threshold.
set -euo pipefail

THRESHOLD=22000
AGENTS_MD="${1:-AGENTS.md}"

SIZE=$(wc -c < "$AGENTS_MD")

if [ "$SIZE" -ge "$THRESHOLD" ]; then
  echo "ERROR: AGENTS.md is ${SIZE} bytes — meets or exceeds the ${THRESHOLD}-byte (22 000 bytes) threshold." >&2
  echo "Extract more content to docs/ to bring AGENTS.md below 22 000 bytes." >&2
  exit 1
fi

echo "OK: AGENTS.md is ${SIZE} bytes (threshold: ${THRESHOLD} bytes / 22 000 bytes)"
