#!/bin/bash
# install-copilot-plugin.sh — Install a Copilot CLI plugin from an extension
#
# Usage:
#   bash scripts/install-copilot-plugin.sh <extension-name>
#
# Resolves the named extension by searching extensions/core/, extensions/library/,
# and extensions/org/ in that order, builds the plugin into a temporary output
# directory under dist-copilot-plugin/, and registers it with the `copilot` binary
# via `copilot plugin install`.
#
# Prerequisites: jq, copilot

set -euo pipefail

command -v jq >/dev/null 2>&1 || { echo "Error: jq is required. Install with: brew install jq"; exit 1; }
command -v copilot >/dev/null 2>&1 || {
  echo "Error: 'copilot' CLI is required. Install GitHub Copilot CLI first."; exit 1;
}

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
EXT_NAME="${1:?Usage: install-copilot-plugin.sh <extension-name>}"

# Resolve the bare extension name to its SOURCE dir extensions/<tier>/<name>/,
# searching every tier (first match; hard-error on a duplicate name). The tier
# is a SOURCE-side concern only; the installed plugin keeps its bare name.
EXT_DIR=""
for tier in core library org; do
  if [ -d "$REPO_DIR/extensions/$tier/$EXT_NAME" ]; then
    if [ -n "$EXT_DIR" ]; then
      echo "Error: extension '$EXT_NAME' exists in multiple tiers; names must be unique."
      exit 1
    fi
    EXT_DIR="$REPO_DIR/extensions/$tier/$EXT_NAME"
  fi
done
if [ -z "$EXT_DIR" ]; then
  echo "Error: Extension '$EXT_NAME' not found in extensions/"
  exit 1
fi

# --- Build the plugin into the output directory ---
OUTPUT_DIR="$REPO_DIR/dist-copilot-plugin/$EXT_NAME"
bash "$REPO_DIR/scripts/build-copilot-plugin.sh" "$EXT_DIR" "$OUTPUT_DIR"

# --- Install via copilot ---
copilot plugin install "$OUTPUT_DIR"

echo ""
echo "Plugin '$EXT_NAME' installed. Run: copilot plugin list"
