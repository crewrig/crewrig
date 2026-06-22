#!/bin/bash
# build-antigravity-extension.sh — Generate an Antigravity CLI plugin from extension.json
#
# Usage:
#   bash scripts/build-antigravity-extension.sh <extension-dir-or-name> [output-dir]
#
# Reads extension.json (or falls back to gemini-extension.json) and generates
# a complete Antigravity CLI plugin directory suitable for `agy plugin install`.
#
# When a bare extension name is given it is resolved by searching:
#   extensions/core/  →  extensions/library/  →  extensions/org/
# in that order. An error is raised when the same name appears in multiple tiers.
#
# The output directory defaults to dist-antigravity-plugin/<name>/ relative to
# the repository root.
#
# Prerequisites: jq

set -euo pipefail

command -v jq >/dev/null 2>&1 || { echo "Error: jq is required. Install with: brew install jq"; exit 1; }

# Shared pivot helpers (spec 0042). Render commands from pivot `commands/*.md`
# sources — NOT from Gemini `.toml` outputs.  Sourced for extract_body / yaml_field.
# shellcheck source=lib/render-command.sh
. "$(cd "$(dirname "$0")" && pwd)/lib/render-command.sh"

EXT_ARG="${1:?Usage: build-antigravity-extension.sh <extension-dir-or-name> [output-dir]}"

# Accept either a directory (back-compatible) or a bare extension name resolved
# by tier search.  The tier is a SOURCE-side concern only; the built plugin
# keeps its bare name.
if [ -d "$EXT_ARG" ]; then
  EXT_DIR="$EXT_ARG"
else
  REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
  EXT_DIR=""
  for tier in core library org; do
    if [ -d "$REPO_DIR/extensions/$tier/$EXT_ARG" ]; then
      if [ -n "$EXT_DIR" ]; then
        echo "Error: extension '$EXT_ARG' exists in multiple tiers; names must be unique."
        exit 1
      fi
      EXT_DIR="$REPO_DIR/extensions/$tier/$EXT_ARG"
    fi
  done
  if [ -z "$EXT_DIR" ]; then
    echo "Error: extension directory or name '$EXT_ARG' not found."
    exit 1
  fi
fi
EXT_DIR="$(cd "$EXT_DIR" && pwd)"
REPO_DIR="$(cd "$EXT_DIR/../../../.." && pwd 2>/dev/null || cd "$(dirname "$0")/.." && pwd)"
# Re-derive REPO_DIR from the script location for safety.
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# --- Locate manifest ---
MANIFEST=""
if [ -f "$EXT_DIR/extension.json" ]; then
  MANIFEST="$EXT_DIR/extension.json"
elif [ -f "$EXT_DIR/gemini-extension.json" ]; then
  MANIFEST="$EXT_DIR/gemini-extension.json"
  echo "Warning: Using legacy gemini-extension.json (no Antigravity-specific config available)"
else
  echo "Error: No extension.json or gemini-extension.json found in $EXT_DIR"
  exit 1
fi

# --- Read universal metadata ---
NAME=$(jq -r '.name' "$MANIFEST")
VERSION=$(jq -r '.version' "$MANIFEST")
DESCRIPTION=$(jq -r '.description' "$MANIFEST")

# --- Output directory ---
OUTPUT_DIR="${2:-$REPO_DIR/dist-antigravity-plugin/$NAME}"
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

echo "Building Antigravity CLI plugin: $NAME v$VERSION"
echo "  Source: $EXT_DIR"
echo "  Output: $OUTPUT_DIR"

# --- Generate plugin.json at output root ---
# Use antigravity.pluginName when present and non-empty; fall back to manifest name.
PLUGIN_NAME=$(jq -r '.antigravity.pluginName // ""' "$MANIFEST" 2>/dev/null)
if [ -z "$PLUGIN_NAME" ] || [ "$PLUGIN_NAME" = "null" ]; then
  PLUGIN_NAME="$NAME"
fi
jq -n \
  --arg name "$PLUGIN_NAME" \
  --arg version "$VERSION" \
  --arg description "$DESCRIPTION" \
  '{
    name: $name,
    version: $version,
    description: $description
  }' > "$OUTPUT_DIR/plugin.json"
echo "  Generated: plugin.json (name: $PLUGIN_NAME)"

# --- Copy MCP server artifacts ---
# Copy dist/ and package.json when mcpServers is defined in the manifest.
MCP_SERVERS=$(jq '.mcpServers // {}' "$MANIFEST")
if [ "$MCP_SERVERS" != "{}" ] && [ "$MCP_SERVERS" != "null" ]; then
  if [ -d "$EXT_DIR/dist" ]; then
    cp -r "$EXT_DIR/dist" "$OUTPUT_DIR/dist"
    echo "  Copied: dist/"
  fi
  if [ -f "$EXT_DIR/package.json" ]; then
    cp "$EXT_DIR/package.json" "$OUTPUT_DIR/package.json"
    echo "  Copied: package.json"
  fi
fi

# --- Copy context file ---
AGY_CONTEXT=$(jq -r '.antigravity.contextFileName // ""' "$MANIFEST" 2>/dev/null)
if [ -n "$AGY_CONTEXT" ] && [ "$AGY_CONTEXT" != "null" ] && [ -f "$EXT_DIR/$AGY_CONTEXT" ]; then
  cp "$EXT_DIR/$AGY_CONTEXT" "$OUTPUT_DIR/$AGY_CONTEXT"
  echo "  Copied: $AGY_CONTEXT"
fi

# --- Copy skills ---
SKILLS_ENABLED=$(jq -r '.components.skills.enabled // false' "$MANIFEST" 2>/dev/null)
SKILLS_LOCATION=$(jq -r '.components.skills.location // "skills/"' "$MANIFEST" 2>/dev/null)
if [ "$SKILLS_ENABLED" = "true" ] && [ -d "$EXT_DIR/$SKILLS_LOCATION" ]; then
  mkdir -p "$OUTPUT_DIR/skills"
  for skill_dir in "$EXT_DIR/$SKILLS_LOCATION"*/; do
    [ -d "$skill_dir" ] || continue
    skill_name=$(basename "$skill_dir")
    cp -r "$skill_dir" "$OUTPUT_DIR/skills/$skill_name"
    echo "  Copied skill: $skill_name"
  done
fi

# --- Render pivot commands to Antigravity skills ---
# Spec 0042: the command source of truth is the pivot `commands/<name>.md`, NOT
# the Gemini `commands/<name>.toml`.  The `convertToSkills` manifest flag means
# "render pivot `.md` → Antigravity skill" (same as Claude).
COMMANDS_ENABLED=$(jq -r '.components.commands.enabled // false' "$MANIFEST" 2>/dev/null)
CONVERT_TO_SKILLS=$(jq -r '.components.commands.convertToSkills // false' "$MANIFEST" 2>/dev/null)
COMMANDS_LOCATION=$(jq -r '.components.commands.location // "commands/"' "$MANIFEST" 2>/dev/null)
if [ "$COMMANDS_ENABLED" = "true" ] && [ "$CONVERT_TO_SKILLS" = "true" ] && [ -d "$EXT_DIR/$COMMANDS_LOCATION" ]; then
  command -v yq >/dev/null 2>&1 || { echo "Error: yq is required to render pivot commands. Install with: brew install yq"; exit 1; }
  for md_file in "$EXT_DIR/$COMMANDS_LOCATION"*.md; do
    [ -f "$md_file" ] || continue
    cmd_name=$(yaml_field "$md_file" "name")
    [ -z "$cmd_name" ] || [ "$cmd_name" = "null" ] && cmd_name=$(basename "$md_file" .md)
    cmd_desc=$(yaml_field "$md_file" "description")
    cmd_prompt=$(extract_body "$md_file")

    mkdir -p "$OUTPUT_DIR/skills/$cmd_name"

    # Build frontmatter
    {
      echo "---"
      echo "name: $cmd_name"
      echo "description: \"$cmd_desc\""
      echo "user-invocable: true"
      echo "---"
      echo ""
      echo "$cmd_prompt"
    } > "$OUTPUT_DIR/skills/$cmd_name/SKILL.md"
    echo "  Rendered command to skill: $cmd_name"
  done
fi

# --- Copy agents ---
AGENTS_ENABLED=$(jq -r '.components.agents.enabled // false' "$MANIFEST" 2>/dev/null)
AGENTS_LOCATION=$(jq -r '.components.agents.location // "agents/"' "$MANIFEST" 2>/dev/null)
if [ "$AGENTS_ENABLED" = "true" ] && [ -d "$EXT_DIR/$AGENTS_LOCATION" ]; then
  mkdir -p "$OUTPUT_DIR/agents"
  for agent_dir in "$EXT_DIR/$AGENTS_LOCATION"*/; do
    [ -d "$agent_dir" ] || continue
    agent_name=$(basename "$agent_dir")
    cp -r "$agent_dir" "$OUTPUT_DIR/agents/$agent_name"
    echo "  Copied agent: $agent_name"
  done
fi

# --- Generate hooks.json at output root ---
AGY_HOOKS=$(jq '.antigravity.hooks // {}' "$MANIFEST" 2>/dev/null)
if [ "$AGY_HOOKS" != "{}" ] && [ "$AGY_HOOKS" != "null" ]; then
  echo "$AGY_HOOKS" | jq '.' > "$OUTPUT_DIR/hooks.json"
  echo "  Generated: hooks.json"
fi

echo ""
echo "Plugin built: $OUTPUT_DIR"
echo "Validate with: agy plugin validate $OUTPUT_DIR"
