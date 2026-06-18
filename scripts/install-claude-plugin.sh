#!/bin/bash
# install-claude-plugin.sh — Install a Claude Code plugin from an extension
#
# Usage:
#   bash scripts/install-claude-plugin.sh <extension-name>
#
# Builds the Claude Code plugin into a single shared local marketplace home
# (${CLAUDE_CONFIG_DIR:-$HOME/.claude}/local-marketplace/), then registers it
# through the official marketplace mechanism:
#   1. `claude plugin marketplace add <local-marketplace-home>`
#   2. `claude plugin install <name>@<marketplace>`
#
# The shared home lives OUTSIDE the working tree so multiple extensions
# coexist in one marketplace and installs survive branch switches. The
# marketplace manifest is shared and upserts each extension by name.
#
# Claude Code does NOT auto-discover plugins under ~/.claude/plugins/.
# Plugins must be declared in a marketplace and installed via the CLI for
# Claude Code to pick them up. Use `claude --plugin-dir <path>` for dev
# mode if you want to skip the marketplace step.
#
# Prerequisites: jq, claude

set -euo pipefail

command -v jq >/dev/null 2>&1 || { echo "Error: jq is required. Install with: brew install jq"; exit 1; }
command -v claude >/dev/null 2>&1 || {
  echo "Error: 'claude' CLI is required. Install Claude Code first."; exit 1;
}

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
EXT_NAME="${1:?Usage: install-claude-plugin.sh <extension-name>}"

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

# --- Build the plugin into the shared local marketplace home (out of tree) ---
# A single shared home lets multiple extensions coexist in one marketplace and
# survives branch switches: output goes to
# <config>/local-marketplace/<name>/, keyed on CLAUDE_CONFIG_DIR.
MARKET_HOME="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/local-marketplace"
BUILD_PARENT="$MARKET_HOME"
BUILD_DIR="$BUILD_PARENT/$EXT_NAME"
mkdir -p "$BUILD_PARENT"
bash "$REPO_DIR/scripts/build-claude-plugin.sh" "$EXT_DIR" "$BUILD_DIR"

# --- Generate marketplace.json so Claude Code can discover the plugin ---
MARKETPLACE_NAME="$(basename "$REPO_DIR")-local"
MARKETPLACE_DIR="$BUILD_PARENT/.claude-plugin"
mkdir -p "$MARKETPLACE_DIR"

DESCRIPTION=$(jq -r '.description // ""' "$EXT_DIR/extension.json" 2>/dev/null \
  || jq -r '.description // ""' "$EXT_DIR/gemini-extension.json" 2>/dev/null \
  || echo "")
AUTHOR_NAME=$(jq -r '.claude.author.name // .author.name // "Unknown"' "$EXT_DIR/extension.json" 2>/dev/null || echo "Unknown")

# Build the marketplace manifest. If a marketplace.json already exists for
# this build parent, upsert the new plugin entry (filter out any prior entry
# of the same name, then append); otherwise create from scratch. Because every
# extension shares the one local marketplace home, this manifest accumulates
# all installed extensions across repeated runs.
EXISTING_PLUGINS="[]"
if [ -f "$MARKETPLACE_DIR/marketplace.json" ]; then
  EXISTING_PLUGINS=$(jq --arg n "$EXT_NAME" '[.plugins[] | select(.name != $n)]' \
    "$MARKETPLACE_DIR/marketplace.json")
fi

jq -n \
  --arg market_name "$MARKETPLACE_NAME" \
  --arg name "$EXT_NAME" \
  --arg description "$DESCRIPTION" \
  --arg author "$AUTHOR_NAME" \
  --argjson existing "$EXISTING_PLUGINS" \
  '{
    name: $market_name,
    owner: { name: "crewrig contributors" },
    plugins: ($existing + [{
      name: $name,
      description: $description,
      author: { name: $author },
      source: ("./" + $name)
    }])
  }' > "$MARKETPLACE_DIR/marketplace.json"
echo "  Generated marketplace manifest: $MARKETPLACE_NAME"

# --- Register marketplace + install plugin (both idempotent) ---
claude plugin marketplace add "$BUILD_PARENT" --scope user
claude plugin install "$EXT_NAME@$MARKETPLACE_NAME" --scope user

echo ""
echo "Plugin installed via marketplace '$MARKETPLACE_NAME'."
echo "Verify with: claude plugin list"
echo "Restart Claude Code to pick up the plugin."
