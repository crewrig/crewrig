#!/usr/bin/env bash
# Fails CI if AGENTS.md meets or exceeds the 35 KB threshold.
set -euo pipefail

THRESHOLD=35840
AGENTS_MD="${1:-AGENTS.md}"

SIZE=$(wc -c < "$AGENTS_MD")

if [ "$SIZE" -ge "$THRESHOLD" ]; then
  echo "ERROR: AGENTS.md is ${SIZE} bytes — meets or exceeds the ${THRESHOLD}-byte (35 KB) threshold." >&2
  echo "Extract more content to docs/ to bring AGENTS.md below 35 KB." >&2
  exit 1
fi

echo "OK: AGENTS.md is ${SIZE} bytes (threshold: ${THRESHOLD} bytes / 35 KB)"
