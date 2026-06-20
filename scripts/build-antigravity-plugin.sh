#!/bin/bash
# build-antigravity-plugin.sh — Assemble crewrig compiled components into an Antigravity CLI plugin
#
# Usage:
#   bash scripts/build-antigravity-plugin.sh [output-dir]
#
# Reads compiled components from the Antigravity build output paths and generates
# a self-contained Antigravity CLI plugin directory containing plugin.json,
# skills/, agents/, and an optional hooks.json.
#
# Source paths (spec 0062):
#   Core tier  : <repo>/.agents/skills/  and  <repo>/.agents/agents/
#   Non-core   : dist/<tier>/.agents/skills/  and  dist/<tier>/.agents/agents/
#                for each tier directory under dist/ that contains a .agents/ subtree
#
# Commands are emitted as skills in the Antigravity build; no separate commands/
# directory is produced or included.
#
# The dist/ directory must be present (run scripts/build-components.sh first).

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# --- Guard: dist/ must exist before any write ---
if [ ! -d "$REPO_DIR/dist" ]; then
  echo "Error: dist/ directory not found. Run 'bash scripts/build-components.sh' first." >&2
  exit 1
fi

OUTPUT_DIR="${1:-$REPO_DIR/dist-antigravity-plugin/crewrig}"
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

echo "Building Antigravity CLI plugin: crewrig"
echo "  Core source : $REPO_DIR/.agents/"
echo "  Dist source : $REPO_DIR/dist/<tier>/.agents/"
echo "  Output      : $OUTPUT_DIR"

# --- Generate plugin.json ---
# Populate name (required), plus optional version and description from release
# metadata when available.
PLUGIN_NAME="crewrig"
PLUGIN_VERSION=""
PLUGIN_DESCRIPTION=""

# Read version from package.json at the repo root if present.
if [ -f "$REPO_DIR/package.json" ] && command -v jq >/dev/null 2>&1; then
  PLUGIN_VERSION=$(jq -r '.version // ""' "$REPO_DIR/package.json" 2>/dev/null || true)
  PLUGIN_DESCRIPTION=$(jq -r '.description // ""' "$REPO_DIR/package.json" 2>/dev/null || true)
fi

if command -v jq >/dev/null 2>&1; then
  jq -n \
    --arg name "$PLUGIN_NAME" \
    --arg version "$PLUGIN_VERSION" \
    --arg description "$PLUGIN_DESCRIPTION" \
    '{
      name: $name
    }
    + (if $version != "" then { version: $version } else {} end)
    + (if $description != "" then { description: $description } else {} end)
    ' > "$OUTPUT_DIR/plugin.json"
else
  # Fallback: write minimal plugin.json without jq.
  printf '{"name":"%s"}\n' "$PLUGIN_NAME" > "$OUTPUT_DIR/plugin.json"
fi
echo "  Generated: plugin.json"

# --- Merge skills/ and agents/ from all tiers (spec 0062) ---
# build-components.sh --target antigravity writes:
#   core tier  → <repo>/.agents/<component>/<name>/
#   non-core   → dist/<tier>/.agents/<component>/<name>/
# Commands are emitted as skills; no separate commands/ tree exists.
merge_component() {
  local component="$1"
  local found=0

  # Core tier
  local core_src="$REPO_DIR/.agents/$component"
  if [ -d "$core_src" ]; then
    mkdir -p "$OUTPUT_DIR/$component"
    cp -r "$core_src/." "$OUTPUT_DIR/$component/"
    found=1
  fi

  # Non-core tiers (library, community, org, …)
  if [ -d "$REPO_DIR/dist" ]; then
    for tier_dir in "$REPO_DIR/dist"/*/; do
      [ -d "$tier_dir" ] || continue
      local tier_src="${tier_dir}.agents/$component"
      if [ -d "$tier_src" ]; then
        mkdir -p "$OUTPUT_DIR/$component"
        cp -r "$tier_src/." "$OUTPUT_DIR/$component/"
        found=1
      fi
    done
  fi

  [ "$found" -eq 1 ] && echo "  Merged: $component/"
}

merge_component "skills"
merge_component "agents"

# --- Copy hooks (conditional) ---
HOOKS_SRC="$REPO_DIR/hooks/antigravity-transcript-hooks.json"
if [ -f "$HOOKS_SRC" ]; then
  cp "$HOOKS_SRC" "$OUTPUT_DIR/hooks.json"
  echo "  Copied: hooks.json (from hooks/antigravity-transcript-hooks.json)"
fi

echo ""
echo "Plugin built: $OUTPUT_DIR"
echo "Validate with: agy plugin validate $OUTPUT_DIR"
