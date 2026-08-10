#!/bin/bash
# manage-claude-component.sh — Install or link Claude Code overlay-tier components
#
# Usage:
#   bash scripts/manage-claude-component.sh <install|link> <type> [name]
#
# Types: claude-skills, policies, mcp-servers
# Default mode: install (copy). Link mode shows security disclaimer.
#
# Every type resolves over the served overlay tiers — library, community, org —
# and never over `core`, whose landing zone is the committed project tree and
# whose delivery is the build rather than an install (spec 0119 R5/R6). Which
# tiers happen to be populated no longer decides which tiers are reachable.

set -e

CLAUDE_HOME="${HOME}/.claude"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/component-resolve.sh
. "$(dirname "$0")/lib/component-resolve.sh"

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
  echo "WARNING: Symlink mode — the installed component is a link into this"
  echo "         repository, so a branch switch changes it in place."
  echo "         For claude-skills the link target is the regenerable staging"
  echo "         tree dist/<tier>/, which a rebuild replaces wholesale: an edit"
  echo "         to the authoring source under artifacts/ takes effect only"
  echo "         after 'bash scripts/build-components.sh' has run."
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
# Each fragment in artifacts/<tier>/mcp-servers/ is a JSON file shaped like:
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

# --- The single-component installers handed to the shared drivers ------------
# Each reads DEST from the dispatch arm below, which is what lets one driver
# serve every type without the resolver library knowing any landing zone.
install_into_dest() {
  place_component "$1" "$DEST"
}

register_json_entry() {
  case "$1" in
    *.json) ;;
    *)
      echo "Error: '$1' is not a JSON MCP declaration." >&2
      return 1
      ;;
  esac
  register_mcp_server "$1"
}

# --- Dispatch by type ---
case "$TYPE" in
  claude-skills)
    # R2: the assisted setup installs skills from dist/<tier>/.claude/skills
    # (setup-claude-interactive.sh), so this command reads the same basis rather
    # than the authoring sources. A miss triggers one prune-and-rebuild of the
    # served overlay staging roots, because a compiled tree is stale by default.
    DEST="$CLAUDE_HOME/skills"
    mkdir -p "$DEST"
    component_set_staging_roots ".claude/skills"
    if [ -n "$NAME" ]; then
      component_install_named install_into_dest "$NAME" "$TYPE" claude "${COMPONENT_ROOTS[@]}" || exit $?
    else
      component_install_all install_into_dest claude "${COMPONENT_ROOTS[@]}" || exit $?
    fi
    ;;

  policies)
    # Never compiled: the authoring source IS what installs, so there is no
    # staging tree to refresh and no rebuild to trigger.
    DEST="$CLAUDE_HOME/rules"
    mkdir -p "$DEST"
    component_set_artifact_roots "policies"
    if [ -n "$NAME" ]; then
      component_install_named install_into_dest "$NAME" "$TYPE" "" "${COMPONENT_ROOTS[@]}" || exit $?
    else
      component_install_all install_into_dest "" "${COMPONENT_ROOTS[@]}" || exit $?
    fi
    ;;

  mcp-servers)
    component_set_artifact_roots "mcp-servers"
    if [ -n "$NAME" ]; then
      component_install_named register_json_entry "$NAME" "$TYPE" "" "${COMPONENT_ROOTS[@]}" || exit $?
    else
      component_install_all register_json_entry "" "${COMPONENT_ROOTS[@]}" || exit $?
    fi
    ;;

  *)
    echo "Error: unknown type '$TYPE'"
    echo "Types: claude-skills, policies, mcp-servers"
    exit 1
    ;;
esac
