#!/bin/bash
# build-claude-plugin.sh — Generate a Claude Code plugin from extension.json
#
# Usage:
#   bash scripts/build-claude-plugin.sh <extension-dir> [output-dir]
#
# Reads extension.json (or falls back to gemini-extension.json) and generates
# a complete Claude Code plugin directory.
#
# Prerequisites: jq

set -euo pipefail

command -v jq >/dev/null 2>&1 || { echo "Error: jq is required. Install with: brew install jq"; exit 1; }

# Shared pivot helpers (spec 0042). The Claude plugin command form is rendered
# from the pivot `commands/*.md` source — NOT from the Gemini `.toml` output —
# so this builder consumes the same single source of truth as
# build-extension-pivot.sh. Sourced for extract_body / yaml_field.
# shellcheck source=lib/render-command.sh
. "$(cd "$(dirname "$0")" && pwd)/lib/render-command.sh"

EXT_ARG="${1:?Usage: build-claude-plugin.sh <extension-dir-or-name> [output-dir]}"

# Accept either an extension directory (back-compatible) or a bare extension
# name. A bare name is resolved to its SOURCE dir extensions/<tier>/<name>/,
# searching every tier (first match; hard-error on a duplicate name). The tier
# is a SOURCE-side concern only; the built plugin keeps its bare name.
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

# --- Locate manifest ---
MANIFEST=""
if [ -f "$EXT_DIR/extension.json" ]; then
  MANIFEST="$EXT_DIR/extension.json"
elif [ -f "$EXT_DIR/gemini-extension.json" ]; then
  MANIFEST="$EXT_DIR/gemini-extension.json"
  echo "Warning: Using legacy gemini-extension.json (no Claude-specific config available)"
else
  echo "Error: No extension.json or gemini-extension.json found in $EXT_DIR"
  exit 1
fi

# --- Read universal metadata ---
NAME=$(jq -r '.name' "$MANIFEST")
VERSION=$(jq -r '.version' "$MANIFEST")
DESCRIPTION=$(jq -r '.description' "$MANIFEST")

# --- Output directory ---
OUTPUT_DIR="${2:-$EXT_DIR/dist-claude-plugin/$NAME}"
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

echo "Building Claude Code plugin: $NAME v$VERSION"
echo "  Source: $EXT_DIR"
echo "  Output: $OUTPUT_DIR"

# --- Generate .claude-plugin/plugin.json ---
mkdir -p "$OUTPUT_DIR/.claude-plugin"
AUTHOR_NAME=$(jq -r '.claude.author.name // "Unknown"' "$MANIFEST" 2>/dev/null)
jq -n \
  --arg name "$NAME" \
  --arg version "$VERSION" \
  --arg description "$DESCRIPTION" \
  --arg author "$AUTHOR_NAME" \
  '{
    name: $name,
    description: $description,
    version: $version,
    author: { name: $author }
  }' > "$OUTPUT_DIR/.claude-plugin/plugin.json"
echo "  Generated: .claude-plugin/plugin.json"

# --- Generate .mcp.json (resolve ${extensionPath}) ---
MCP_SERVERS=$(jq '.mcpServers // {}' "$MANIFEST")
if [ "$MCP_SERVERS" != "{}" ]; then
  echo "$MCP_SERVERS" | jq --arg path "$OUTPUT_DIR" '
    { mcpServers: walk(if type == "string" then gsub("\\$\\{extensionPath\\}"; $path) else . end) }
  ' > "$OUTPUT_DIR/.mcp.json"
  echo "  Generated: .mcp.json"

  # The .mcp.json typically references ${extensionPath}/dist/index.js — copy
  # the compiled MCP server so the resolved path inside the plugin is valid.
  # package.json is also needed for ESM type resolution by node at runtime.
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
CLAUDE_CONTEXT=$(jq -r '.claude.contextFileName // ""' "$MANIFEST" 2>/dev/null)
if [ -n "$CLAUDE_CONTEXT" ] && [ -f "$EXT_DIR/$CLAUDE_CONTEXT" ]; then
  cp "$EXT_DIR/$CLAUDE_CONTEXT" "$OUTPUT_DIR/$CLAUDE_CONTEXT"
  echo "  Copied: $CLAUDE_CONTEXT"
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

# --- Render pivot commands to Claude skills ---
# Spec 0042: the command source of truth is the pivot `commands/<name>.md`, NOT
# the Gemini `commands/<name>.toml` (which is a generated Gemini output). Reading
# the pivot `.md` directly also fixes a latent bug: the prior code ran
# `sed -n '/^prompt *= *"""/,/^"""/p'` over the `.toml`, which required a
# triple-quoted prompt and therefore extracted an EMPTY prompt from any
# single-quoted legacy `.toml`. The `convertToSkills` manifest flag is kept by
# name (a rename is sibling spec 0044 scope); post-flip it means "render pivot
# `.md` → Claude skill", not "convert `.toml` → skill".
COMMANDS_ENABLED=$(jq -r '.components.commands.enabled // false' "$MANIFEST" 2>/dev/null)
CONVERT_TO_SKILLS=$(jq -r '.components.commands.convertToSkills // false' "$MANIFEST" 2>/dev/null)
COMMANDS_LOCATION=$(jq -r '.components.commands.location // "commands/"' "$MANIFEST" 2>/dev/null)
if [ "$COMMANDS_ENABLED" = "true" ] && [ "$CONVERT_TO_SKILLS" = "true" ] && [ -d "$EXT_DIR/$COMMANDS_LOCATION" ]; then
  command -v yq >/dev/null 2>&1 || { echo "Error: yq is required to render pivot commands. Install with: brew install yq"; exit 1; }
  DEFAULT_TOOLS=$(jq -r '.claude.defaultAllowedTools // [] | join("\n")' "$MANIFEST" 2>/dev/null)
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
      if [ -n "$DEFAULT_TOOLS" ]; then
        echo "allowed-tools:"
        echo "$DEFAULT_TOOLS" | while IFS= read -r tool; do
          [ -n "$tool" ] && echo "  - $tool"
        done
      fi
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

# --- Generate hooks/hooks.json ---
CLAUDE_HOOKS=$(jq '.claude.hooks // {}' "$MANIFEST" 2>/dev/null)
if [ "$CLAUDE_HOOKS" != "{}" ] && [ "$CLAUDE_HOOKS" != "null" ]; then
  mkdir -p "$OUTPUT_DIR/hooks"
  echo "{\"hooks\": $CLAUDE_HOOKS}" | jq '.' > "$OUTPUT_DIR/hooks/hooks.json"
  echo "  Generated: hooks/hooks.json"
fi

# --- Generate settings.json ---
CLAUDE_SETTINGS=$(jq '.claude.settings // {}' "$MANIFEST" 2>/dev/null)
if [ "$CLAUDE_SETTINGS" != "{}" ] && [ "$CLAUDE_SETTINGS" != "null" ]; then
  echo "$CLAUDE_SETTINGS" | jq '.' > "$OUTPUT_DIR/settings.json"
  echo "  Generated: settings.json"
fi

# --- Generate .lsp.json ---
CLAUDE_LSP=$(jq '.claude.lsp // {}' "$MANIFEST" 2>/dev/null)
if [ "$CLAUDE_LSP" != "{}" ] && [ "$CLAUDE_LSP" != "null" ]; then
  echo "$CLAUDE_LSP" | jq '.' > "$OUTPUT_DIR/.lsp.json"
  echo "  Generated: .lsp.json"
fi

# --- Copy bin/ ---
CLAUDE_BIN=$(jq -r '.claude.bin // ""' "$MANIFEST" 2>/dev/null)
if [ -n "$CLAUDE_BIN" ] && [ "$CLAUDE_BIN" != "null" ] && [ -d "$EXT_DIR/$CLAUDE_BIN" ]; then
  cp -r "$EXT_DIR/$CLAUDE_BIN" "$OUTPUT_DIR/bin"
  echo "  Copied: bin/"
fi

echo ""
echo "Plugin built: $OUTPUT_DIR"
echo "Test with: claude --plugin-dir $OUTPUT_DIR"
