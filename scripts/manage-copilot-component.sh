#!/bin/bash
# manage-copilot-component.sh — Install or link Copilot CLI community components
#
# Usage:
#   bash scripts/manage-copilot-component.sh <install|link> <type> [name]
#
# Types: skills, agents, commands (compiled as skills), mcp-servers
# Default mode: install (copy). Link mode shows security disclaimer.
#
# Skills and agents are installed into the workspace .github/ directories.
# MCP servers are merged into ~/.copilot/mcp-config.json (user-level).

set -e

COPILOT_HOME="${HOME}/.copilot"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MODE="${1:-install}"
TYPE="$2"
NAME="$3"

if [ -z "$TYPE" ]; then
  echo "Usage: $0 <install|link> <type> [name]"
  echo "Types: skills, agents, commands, mcp-servers"
  exit 1
fi

# --- Security disclaimer for link mode ---
if [ "$MODE" = "link" ]; then
  echo "WARNING: Symlink mode — files change with branch switches."
  echo "Only use if you trust all branches in this repository."
  read -p "Continue? [y/N] " -n 1 -r
  echo ""
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
  fi
fi

# --- Normalize type ---
case "$TYPE" in
  skill)      TYPE="skills" ;;
  agent)      TYPE="agents" ;;
  command)    TYPE="commands" ;;
  mcp-server) TYPE="mcp-servers" ;;
esac

# --- Place a file or directory ---
place_component() {
  local src="$1" dest_dir="$2"
  local item_name
  item_name=$(basename "$src")
  [ "$item_name" = ".gitkeep" ] && return

  [ -e "$dest_dir/$item_name" ] || [ -L "$dest_dir/$item_name" ] && rm -rf "$dest_dir/$item_name"

  if [ "$MODE" = "link" ]; then
    ln -s "$src" "$dest_dir/$item_name"
    echo "  Linked: $item_name"
  else
    cp -rf "$src" "$dest_dir/"
    echo "  Copied: $item_name"
  fi
}

# --- Install an agent (flat file: artifacts/*/agents/<name>/AGENT.md -> .github/agents/<name>.md) ---
place_agent() {
  local name="$1"
  local src_file=""
  for search_dir in "$REPO_DIR/artifacts/core/agents" "$REPO_DIR/artifacts/library/agents" "$REPO_DIR/artifacts/community/agents"; do
    [ -f "$search_dir/${name}/AGENT.md" ] && src_file="$search_dir/${name}/AGENT.md" && break
  done
  local dest_file="$REPO_DIR/.github/agents/${name}.md"

  if [ -z "$src_file" ]; then
    echo "Error: '$name' not found in artifacts/*/agents/"
    exit 1
  fi

  if [ -e "$dest_file" ] || [ -L "$dest_file" ]; then
    rm -f "$dest_file"
  fi

  if [ "$MODE" = "link" ]; then
    ln -s "$src_file" "$dest_file"
    echo "  Linked: ${name}.md"
  else
    cp "$src_file" "$dest_file"
    echo "  Copied: ${name}.md"
  fi
}

# --- Merge an MCP server fragment into ~/.copilot/mcp-config.json ---
merge_mcp_server() {
  local json_file="$1"
  command -v jq >/dev/null 2>&1 || { echo "Error: jq required."; exit 1; }

  local entry_name
  entry_name=$(basename "$json_file" .json)
  local config_file="$COPILOT_HOME/mcp-config.json"

  mkdir -p "$COPILOT_HOME"
  [ ! -f "$config_file" ] && echo '{"mcpServers":{}}' > "$config_file"

  cp "$config_file" "${config_file}.bak"
  jq --arg name "$entry_name" \
     --slurpfile val "$json_file" \
     '.mcpServers = ((.mcpServers // {}) + {($name): $val[0]})' \
     "${config_file}.bak" > "$config_file"

  echo "  Merged: $entry_name into mcpServers"
}

# --- Dispatch ---
case "$TYPE" in
  skills|commands)
    # Commands compile as skills for Copilot (no first-class slash-command format).
    DEST="$REPO_DIR/.github/skills"
    mkdir -p "$DEST"

    for SRC_DIR in "$REPO_DIR/artifacts/core/skills" "$REPO_DIR/artifacts/library/skills" "$REPO_DIR/artifacts/community/skills"; do
      [ ! -d "$SRC_DIR" ] && continue
      if [ -n "$NAME" ]; then
        [ -d "$SRC_DIR/$NAME" ] && place_component "$SRC_DIR/$NAME" "$DEST"
      else
        for item in "$SRC_DIR"/*/; do
          [ -d "$item" ] && place_component "$item" "$DEST"
        done
      fi
    done
    ;;

  agents)
    mkdir -p "$REPO_DIR/.github/agents"

    if [ -n "$NAME" ]; then
      place_agent "$NAME"
    else
      for SRC_DIR in "$REPO_DIR/artifacts/core/agents" "$REPO_DIR/artifacts/library/agents" "$REPO_DIR/artifacts/community/agents"; do
        [ ! -d "$SRC_DIR" ] && continue
        for agent_dir in "$SRC_DIR"/*/; do
          [ -d "$agent_dir" ] && place_agent "$(basename "$agent_dir")"
        done
      done
    fi
    ;;

  mcp-servers)
    SRC_DIR="$REPO_DIR/artifacts/community/mcp-servers"
    if [ ! -d "$SRC_DIR" ]; then
      echo "Error: artifacts/community/mcp-servers/ does not exist."
      exit 1
    fi

    if [ -n "$NAME" ]; then
      JSON="$SRC_DIR/$NAME.json"
      [ ! -f "$JSON" ] && { echo "Error: '$NAME.json' not found in artifacts/community/mcp-servers/"; exit 1; }
      merge_mcp_server "$JSON"
    else
      for item in "$SRC_DIR"/*.json; do
        [ -f "$item" ] && merge_mcp_server "$item"
      done
    fi
    ;;

  *)
    echo "Error: unknown type '$TYPE'"
    echo "Types: skills, agents, commands, mcp-servers"
    exit 1
    ;;
esac
