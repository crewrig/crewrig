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
# PLAN v5 step 8, Option A). A live probe
# (docs/runbooks/extension-mcp-token-probe.md, Q2, 2026-08-25) proved a
# relative command/args does NOT resolve against the plugin directory on
# Antigravity — its MCP server spawns with the CLI's own launch directory as
# CWD, not the plugin root — so build-antigravity-extension.sh's render
# ships mcp_config.json with ${extensionRoot} left UNRESOLVED. This is the
# earliest moment the real installed directory is knowable (R7's "named
# resolver, named moment"): `agy plugin install <dir>` copies verbatim, with
# no rewriting of its own (confirmed by the same probe, Q3), to
# ~/.gemini/config/plugins/<pluginName>/ — a deterministic destination named
# by plugin.json's own `.name` field, not the source directory's basename.
if [ -f "$OUTPUT_DIR/mcp_config.json" ]; then
  PLUGIN_NAME="$(jq -r '.name // empty' "$OUTPUT_DIR/plugin.json" 2>/dev/null)"
  [ -n "$PLUGIN_NAME" ] || PLUGIN_NAME="$EXT_NAME"
  INSTALLED_ROOT="$HOME/.gemini/config/plugins/$PLUGIN_NAME"
  INSTALLED_MCP="$INSTALLED_ROOT/mcp_config.json"
  if [ ! -f "$INSTALLED_MCP" ]; then
    echo "Error: expected $INSTALLED_MCP after install (spec 0180 R16: a target that receives a declaration without the artifacts it names is a failure)." >&2
    exit 1
  fi
  TMP_MCP="$(mktemp)"
  if jq --arg root "$INSTALLED_ROOT" \
      'walk(if type == "string" then gsub("\\$\\{extensionRoot\\}"; $root) else . end)' \
      "$INSTALLED_MCP" > "$TMP_MCP"; then
    mv "$TMP_MCP" "$INSTALLED_MCP"
    echo "  Resolved \${extensionRoot} -> $INSTALLED_ROOT in $INSTALLED_MCP"
  else
    rm -f "$TMP_MCP"
    echo "Error: failed to rewrite \${extensionRoot} in $INSTALLED_MCP" >&2
    exit 1
  fi
fi

echo ""
echo "Plugin '$EXT_NAME' installed. Restart Antigravity CLI to pick up the plugin."
