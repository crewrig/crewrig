#!/bin/bash
# install-antigravity-plugin.sh — Build and install the crewrig Antigravity CLI plugin
#
# Usage:
#   bash scripts/install-antigravity-plugin.sh
#
# Builds the Antigravity CLI plugin from dist/ and registers it with the `agy`
# binary via `agy plugin install`, which copies the plugin contents into
# ~/.gemini/config/plugins/crewrig/.
#
# Prerequisites: agy, and a prior run of scripts/build-components.sh

set -euo pipefail

# --- Guard: agy binary must be present BEFORE any filesystem write ---
command -v agy >/dev/null 2>&1 || {
  echo "Error: 'agy' CLI is required. Install Antigravity CLI first."; exit 1;
}

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLUGIN_DIR="${REPO_DIR}/dist-antigravity-plugin/crewrig"

# --- Build ---
bash "$REPO_DIR/scripts/build-antigravity-plugin.sh" "$PLUGIN_DIR"

# --- Install ---
agy plugin install "$PLUGIN_DIR"

echo ""
echo "Plugin installed. Restart Antigravity CLI to pick up the plugin."
