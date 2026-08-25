#!/bin/bash
# install-antigravity-extension.sh — Install an Antigravity CLI plugin from an extension
#
# Usage:
#   bash scripts/install-antigravity-extension.sh <extension-name>
#
# Resolves the named extension by searching extensions/core/, extensions/library/,
# and extensions/org/ in that order, builds the plugin into a temporary output
# directory under dist-antigravity-plugin/, and registers it with the `agy` binary
# via `agy plugin install`.
#
# Prerequisites: jq, agy

set -euo pipefail

command -v jq >/dev/null 2>&1 || { echo "Error: jq is required. Install with: brew install jq"; exit 1; }
command -v agy >/dev/null 2>&1 || {
  echo "Error: 'agy' CLI is required. Install Antigravity CLI first."; exit 1;
}

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
EXT_NAME="${1:?Usage: install-antigravity-extension.sh <extension-name>}"

# shellcheck source=lib/extension-install.sh
. "$REPO_DIR/scripts/lib/extension-install.sh"

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
# No separate ext_assert_current_shape call here (spec 0183 R13): this
# delegates to build-antigravity-extension.sh, which calls it directly after
# locating the manifest — do NOT add a second call.
OUTPUT_DIR="$REPO_DIR/dist-antigravity-plugin/$EXT_NAME"
bash "$REPO_DIR/scripts/build-antigravity-extension.sh" "$EXT_DIR" "$OUTPUT_DIR"

# --- Install via agy ---
agy plugin install "$OUTPUT_DIR"

# --- Post-install: resolve the neutral ${extensionRoot} token (spec 0180
# PLAN v5 step 8, Option A; spec 0183 R19 for the identity/failure fix) ---
# `agy plugin install <dir>` copies verbatim, with no rewriting of its own
# (docs/runbooks/extension-mcp-token-probe.md Q3), to
# ~/.gemini/config/plugins/<pluginName>/ — a deterministic destination named
# by plugin.json's own `.name` field. ext_antigravity_resolve_tokens (shared
# library, extracted here rather than left inline so the release-from-archive
# path can call the same identity-driven resolution — spec 0183 Blast
# radius) locates that destination through plugin.json's OWN identity, never
# through $EXT_NAME (the source directory's basename), and hard-fails naming
# plugin.json when that identity is absent — no basename fallback survives.
ext_antigravity_resolve_tokens "$OUTPUT_DIR"

echo ""
echo "Plugin '$EXT_NAME' installed. Restart Antigravity CLI to pick up the plugin."
