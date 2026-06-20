#!/bin/bash
# build-antigravity-plugin.sh — Assemble crewrig compiled components into an Antigravity CLI plugin
#
# Usage:
#   bash scripts/build-antigravity-plugin.sh [output-dir]
#
# Reads compiled components from dist/ and generates a self-contained Antigravity
# CLI plugin directory containing plugin.json, skills/, agents/, commands/, and
# an optional hooks.json copied from hooks/antigravity-transcript-hooks.json.
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
echo "  Source: $REPO_DIR/dist"
echo "  Output: $OUTPUT_DIR"

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

# --- Copy skills/ ---
if [ -d "$REPO_DIR/dist/skills" ]; then
  cp -r "$REPO_DIR/dist/skills" "$OUTPUT_DIR/skills"
  echo "  Copied: skills/"
fi

# --- Copy agents/ ---
if [ -d "$REPO_DIR/dist/agents" ]; then
  cp -r "$REPO_DIR/dist/agents" "$OUTPUT_DIR/agents"
  echo "  Copied: agents/"
fi

# --- Copy commands/ ---
if [ -d "$REPO_DIR/dist/commands" ]; then
  cp -r "$REPO_DIR/dist/commands" "$OUTPUT_DIR/commands"
  echo "  Copied: commands/"
fi

# --- Copy hooks (conditional) ---
HOOKS_SRC="$REPO_DIR/hooks/antigravity-transcript-hooks.json"
if [ -f "$HOOKS_SRC" ]; then
  cp "$HOOKS_SRC" "$OUTPUT_DIR/hooks.json"
  echo "  Copied: hooks.json (from hooks/antigravity-transcript-hooks.json)"
fi

echo ""
echo "Plugin built: $OUTPUT_DIR"
echo "Validate with: agy plugin validate $OUTPUT_DIR"
