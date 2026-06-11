#!/bin/bash
set -e

GEMINI_HOME="${HOME}/.gemini"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Unlink every upstream extension (core + library). The adopter-owned org tier
# is opt-in: pass --include-org (or set INCLUDE_ORG=1). The removal TARGET
# ($GEMINI_HOME/extensions/<name>) is keyed on the bare installed name, matching
# the flat install TARGET (the tier never appears in the installed name).
tiers=(core library)
if [ "$1" = "--include-org" ] || [ -n "${INCLUDE_ORG:-}" ]; then
  tiers+=(org)
fi

for tier in "${tiers[@]}"; do
  for dir in "$REPO_DIR"/extensions/"$tier"/*/; do
    [ -d "$dir" ] || continue
    name="$(basename "$dir")"
    target="$GEMINI_HOME/extensions/$name"
    if [ -e "$target" ] || [ -L "$target" ]; then
      rm -rf "$target"
      echo "  Removed: $name"
    fi
  done
done
