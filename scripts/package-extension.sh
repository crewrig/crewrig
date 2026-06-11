#!/bin/bash
set -e

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if [ -z "$EXT" ]; then
  echo "Error: EXT variable is required (e.g., EXT=hello-world)."
  exit 1
fi

# Resolve the bare EXT name to its SOURCE dir extensions/<tier>/<name>/,
# searching every tier (first match; hard-error on a duplicate name).
EXT_DIR=""
for tier in core library org; do
  if [ -d "$REPO_DIR/extensions/$tier/$EXT" ]; then
    if [ -n "$EXT_DIR" ]; then
      echo "Error: extension '$EXT' exists in multiple tiers; names must be unique." >&2
      exit 1
    fi
    EXT_DIR="$REPO_DIR/extensions/$tier/$EXT"
  fi
done

if [ -z "$EXT_DIR" ]; then
  echo "Error: extension '$EXT' not found." >&2
  exit 1
fi

mkdir -p "$REPO_DIR/dist"
cd "$EXT_DIR" && npm pack --pack-destination "$REPO_DIR/dist"
echo "Packaged: $EXT"
