#!/bin/bash
# manage-claude-component.sh — Install or link Claude Code community components
#
# Usage:
#   bash scripts/manage-claude-component.sh <install|link> <type> [name]
#
# Types: claude-skills, policies, mcp-servers
# Default mode: install (copy). Link mode shows security disclaimer.

set -e

CLAUDE_HOME="${HOME}/.claude"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MODE="${1:-install}"
TYPE="$2"
NAME="$3"

if [ -z "$TYPE" ]; then
  echo "Usage: $0 <install|link> <type> [name]"
  echo "Types: claude-skills, policies, mcp-servers"
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
  claude-skill)  TYPE="claude-skills" ;;
  policy)        TYPE="policies" ;;
  mcp-server)    TYPE="mcp-servers" ;;
esac

SRC_DIR="$REPO_DIR/artifacts/community/$TYPE"
if [ ! -d "$SRC_DIR" ]; then
  # For claude-skills, the source is the built overlay output. Since spec 0019
  # (ADR-0011), overlay tiers build into the gitignored staging tree
  # dist/<tier>/.claude/skills/ — NOT into the committed .claude/skills/ tree
  # (which now carries `core` only). Prefer the community staging root, then
  # org. Run `bash scripts/build-components.sh` first to populate dist/.
  SRC_DIR=""
  for staging in "$REPO_DIR/dist/community/.claude/skills" "$REPO_DIR/dist/org/.claude/skills"; do
    if [ -d "$staging" ]; then
      SRC_DIR="$staging"
      break
    fi
  done
  if [ -z "$SRC_DIR" ]; then
    echo "Error: source directory not found for type '$TYPE'"
    echo "       Overlay skills build into dist/{community,org}/.claude/skills/ —"
    echo "       run 'bash scripts/build-components.sh' first."
    exit 1
  fi
fi

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

# --- Register an MCP server via 'claude mcp add --scope user' ---
# Claude Code reads MCP servers from ~/.claude.json (managed by 'claude mcp ...').
# Each fragment in artifacts/community/mcp-servers/ is a JSON file shaped like:
#   { "command": "...", "args": ["..."], "env": { ... } }
register_mcp_server() {
  local json_file="$1"
  command -v jq >/dev/null 2>&1 || { echo "Error: jq required."; exit 1; }
  command -v claude >/dev/null 2>&1 || {
    echo "Error: 'claude' CLI required to register MCP servers."; exit 1;
  }

  local entry_name
  entry_name=$(basename "$json_file" .json)

  if claude mcp list 2>/dev/null | grep -qE "^${entry_name}:[[:space:]]"; then
    echo "  ${entry_name}: already registered, skipping"
    return 0
  fi

  local cmd
  cmd=$(jq -r '.command // empty' "$json_file")
  if [ -z "$cmd" ]; then
    echo "  ${entry_name}: missing 'command' field, skipping"
    return 1
  fi

  local args=()
  while IFS= read -r arg; do
    args+=("$arg")
  done < <(jq -r '.args // [] | .[]' "$json_file")

  if claude mcp add --scope user "$entry_name" -- "$cmd" "${args[@]}" >/dev/null 2>&1; then
    echo "  ${entry_name}: registered (scope=user)"
  else
    echo "  ${entry_name}: FAILED — re-run manually: claude mcp add --scope user $entry_name -- $cmd ${args[*]}"
    return 1
  fi
}

# --- Dispatch by type ---
case "$TYPE" in
  claude-skills)
    DEST="$CLAUDE_HOME/skills"
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
    DEST="$CLAUDE_HOME/rules"
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
    if [ -n "$NAME" ]; then
      JSON="$SRC_DIR/$NAME.json"
      [ ! -f "$JSON" ] && { echo "Error: '$NAME.json' not found"; exit 1; }
      register_mcp_server "$JSON"
    else
      for item in "$SRC_DIR"/*.json; do
        [ -f "$item" ] && register_mcp_server "$item"
      done
    fi
    ;;

  *)
    echo "Error: unknown type '$TYPE'"
    echo "Types: claude-skills, policies, mcp-servers"
    exit 1
    ;;
esac
