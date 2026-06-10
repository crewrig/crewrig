#!/bin/bash
set -e

GEMINI_HOME="${HOME}/.gemini"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MODE="${1:-install}"   # "install" (copy) or "link" (symlink)
TYPE="$2"
NAME="$3"

if [ -z "$TYPE" ]; then
  echo "Usage: $0 <install|link> <type> [name]"
  echo "Types: commands, skills, hooks, agents, policies, mcp-servers, themes"
  exit 1
fi

# Normalize singular/plural
case "$TYPE" in
  command)    TYPE="commands" ;;
  skill)      TYPE="skills" ;;
  hook)       TYPE="hooks" ;;
  agent)      TYPE="agents" ;;
  policy)     TYPE="policies" ;;
  mcp-server) TYPE="mcp-servers" ;;
  theme)      TYPE="themes" ;;
esac

# Resolve the overlay source tier. Default is the community sandbox; the org
# tier (spec 0019 — only skills/ and agents/) is searched as a fallback so a
# single-component install covers org symmetrically with Copilot/Claude.
SRC_DIR="$REPO_DIR/artifacts/community/$TYPE"
if [ ! -d "$SRC_DIR" ] && [ -d "$REPO_DIR/artifacts/org/$TYPE" ]; then
  SRC_DIR="$REPO_DIR/artifacts/org/$TYPE"
fi

if [ ! -d "$SRC_DIR" ]; then
  echo "Error: directory artifacts/community/$TYPE (and artifacts/org/$TYPE) does not exist."
  exit 1
fi

# --- File/directory component (commands, skills, hooks, agents, policies) ---
place_component() {
  local src="$1"
  local dest_dir="$2"
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

# --- JSON merge component (mcp-servers, themes) ---
merge_json() {
  local json_file="$1"
  local settings_key="$2"
  local settings_file="$GEMINI_HOME/settings.json"
  local entry_name
  entry_name=$(basename "$json_file" .json)

  if ! command -v jq >/dev/null 2>&1; then
    echo "  Error: jq is required for merging JSON components."
    exit 1
  fi

  [ ! -f "$settings_file" ] && echo "{}" > "$settings_file"

  cp "$settings_file" "${settings_file}.bak"
  jq --arg key "$settings_key" \
     --arg name "$entry_name" \
     --slurpfile val "$json_file" \
     '.[$key] = ((.[$key] // {}) + {($name): $val[0]})' \
     "${settings_file}.bak" > "$settings_file"

  echo "  Merged: $entry_name into $settings_key"
}

# --- Dispatch ---
case "$TYPE" in
  commands|skills|hooks|agents|policies)
    DEST="$GEMINI_HOME/$TYPE"
    mkdir -p "$DEST"

    if [ -n "$NAME" ]; then
      FOUND=""
      for candidate in "$SRC_DIR/$NAME" "$SRC_DIR/$NAME.toml" "$SRC_DIR/$NAME.md"; do
        if [ -e "$candidate" ]; then
          place_component "$candidate" "$DEST"
          FOUND=1
          break
        fi
      done
      if [ -z "$FOUND" ]; then
        echo "Error: '$NAME' not found in artifacts/community/$TYPE"
        exit 1
      fi
    else
      for item in "$SRC_DIR"/*; do
        [ -e "$item" ] && place_component "$item" "$DEST"
      done
    fi
    ;;

  mcp-servers|themes)
    KEY="mcpServers"
    [ "$TYPE" = "themes" ] && KEY="themes"

    if [ -n "$NAME" ]; then
      JSON="$SRC_DIR/$NAME.json"
      if [ ! -f "$JSON" ]; then
        echo "Error: '$NAME.json' not found in artifacts/community/$TYPE" >&2
        exit 1
      fi
      merge_json "$JSON" "$KEY"
    else
      for item in "$SRC_DIR"/*.json; do
        [ -f "$item" ] && merge_json "$item" "$KEY"
      done
    fi
    ;;

  *)
    echo "Error: unknown component type '$TYPE'"
    exit 1
    ;;
esac
