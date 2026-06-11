#!/bin/bash
set -e

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Package every upstream extension (core + library). The adopter-owned org tier
# is opt-in: pass --include-org (or set INCLUDE_ORG=1).
tiers=(core library)
if [ "$1" = "--include-org" ] || [ -n "${INCLUDE_ORG:-}" ]; then
  tiers+=(org)
fi

for tier in "${tiers[@]}"; do
  for dir in "$REPO_DIR"/extensions/"$tier"/*/; do
    if [ -d "$dir" ]; then
      EXT="$(basename "$dir")" bash "$REPO_DIR/scripts/package-extension.sh"
    fi
  done
done
