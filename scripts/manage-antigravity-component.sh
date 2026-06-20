#!/bin/bash
# manage-antigravity-component.sh — Install or link Antigravity CLI community components
#
# Usage:
#   bash scripts/manage-antigravity-component.sh <install|link> <type> [name]
#
# Types: antigravity-skills, policies, mcp-servers
# Default mode: install (copy). Link mode shows security disclaimer.
#
# Skills and policies are installed into the Antigravity CLI user home
# (~/.gemini/antigravity-cli/). MCP servers are merged into
# ~/.gemini/antigravity-cli/settings.json (user-level).

set -e

ANTIGRAVITY_HOME="${HOME}/.gemini/antigravity-cli"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MODE="${1:-install}"
TYPE="$2"
NAME="$3"

if [ -z "$TYPE" ]; then
  echo "Usage: $0 <install|link> <type> [name]"
  echo "Types: antigravity-skills, policies, mcp-servers"
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
  antigravity-skill) TYPE="antigravity-skills" ;;
  policy)            TYPE="policies" ;;
  mcp-server)        TYPE="mcp-servers" ;;
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

# --- Merge an MCP server fragment into ~/.gemini/antigravity-cli/settings.json ---
merge_mcp_server() {
  local json_file="$1"
  command -v jq >/dev/null 2>&1 || { echo "Error: jq required."; exit 1; }

  local entry_name
  entry_name=$(basename "$json_file" .json)
  local config_file="$ANTIGRAVITY_HOME/settings.json"

  mkdir -p "$ANTIGRAVITY_HOME"
  [ ! -f "$config_file" ] && echo '{"mcpServers":{}}' > "$config_file"

  cp "$config_file" "${config_file}.bak"
  jq --arg name "$entry_name" \
     --slurpfile val "$json_file" \
     '.mcpServers = ((.mcpServers // {}) + {($name): $val[0]})' \
     "${config_file}.bak" > "$config_file"

  echo "  Merged: $entry_name into mcpServers"
}

# --- Dispatch by type ---
case "$TYPE" in
  antigravity-skills)
    # For antigravity-skills, prefer the built overlay output from the staging tree.
    # Run `bash scripts/build-components.sh --target antigravity` first to populate dist/.
    SRC_DIR=""
    for staging in "$REPO_DIR/dist/community/.agents/skills" "$REPO_DIR/dist/org/.agents/skills"; do
      if [ -d "$staging" ]; then
        SRC_DIR="$staging"
        break
      fi
    done
    if [ -z "$SRC_DIR" ]; then
      echo "Error: source directory not found for type '$TYPE'"
      echo "       Overlay skills build into dist/{community,org}/.agents/skills/ —"
      echo "       run 'bash scripts/build-components.sh --target antigravity' first."
      exit 1
    fi

    DEST="$ANTIGRAVITY_HOME/skills"
    mkdir -p "$DEST"

    if [ -n "$NAME" ]; then
      [ -d "$SRC_DIR/$NAME" ] || { echo "Error: '$NAME' not found"; exit 1; }
      place_component "$SRC_DIR/$NAME" "$DEST"
    else
      for item in "$SRC_DIR"/*/; do
        [ -d "$item" ] && place_component "$item" "$DEST"
      done
    fi
    ;;

  policies)
    SRC_DIR="$REPO_DIR/artifacts/community/policies"
    if [ ! -d "$SRC_DIR" ]; then
      echo "Error: artifacts/community/policies/ does not exist."
      exit 1
    fi

    DEST="$ANTIGRAVITY_HOME/rules"
    mkdir -p "$DEST"

    if [ -n "$NAME" ]; then
      for candidate in "$SRC_DIR/$NAME" "$SRC_DIR/$NAME.md"; do
        if [ -e "$candidate" ]; then
          place_component "$candidate" "$DEST"
          break
        fi
      done
    else
      for item in "$SRC_DIR"/*; do
        [ -e "$item" ] && place_component "$item" "$DEST"
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
    echo "Types: antigravity-skills, policies, mcp-servers"
    exit 1
    ;;
esac
