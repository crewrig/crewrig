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

# Package the extension's OWN currently-committed version (spec 0183 R17):
# scripts/release-package-extension.sh is now the ONE place a release
# artifact's shape is decided, so this task delegates to it rather than
# hand-producing a source-only `npm pack` tarball — a candidate R17 forbids
# publishing as an extension release.
command -v jq >/dev/null 2>&1 || { echo "Error: jq is required. Install with: brew install jq"; exit 1; }
VERSION="$(jq -r '.version // ""' "$EXT_DIR/extension.json" 2>/dev/null)"
if [ -z "$VERSION" ]; then
  echo "Error: $EXT_DIR/extension.json carries no .version." >&2
  exit 1
fi

OUT_DIR="$REPO_DIR/dist/release/$EXT"
rm -rf "$OUT_DIR"
bash "$REPO_DIR/scripts/release-package-extension.sh" "$EXT" --version "$VERSION" --out "$OUT_DIR"
