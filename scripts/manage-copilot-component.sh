#!/bin/bash
# manage-copilot-component.sh — Install or link Copilot CLI overlay-tier components
#
# Usage:
#   bash scripts/manage-copilot-component.sh <install|link> <type> [name]
#
# Types: skills, commands (compiled as skills), mcp-servers
# Default mode: install (copy). Link mode shows security disclaimer.
#
# Skills land in ~/.copilot/skills — the same landing zone the assisted setup
# uses (COPILOT_SKILLS in setup-copilot-interactive.sh), read from the same
# basis, dist/<tier>/.github/skills (spec 0119 R1/R2). This command previously
# wrote into the repository's own .github/skills, which spec 0119 R3 forbids for
# a non-`core` tier and which silently dirtied the committed checkout.
#
# MCP servers are merged into ~/.copilot/mcp-config.json (user-level).
# `agents` is refused; see the dispatch arm for why.

set -e

COPILOT_HOME="${HOME}/.copilot"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/component-resolve.sh
. "$(dirname "$0")/lib/component-resolve.sh"

MODE="${1:-install}"
TYPE="$2"
NAME="$3"

if [ -z "$TYPE" ]; then
  echo "Usage: $0 <install|link> <type> [name]"
  echo "Types: skills, commands, mcp-servers"
  exit 1
fi

# --- Security disclaimer for link mode ---
if [ "$MODE" = "link" ]; then
  echo "WARNING: Symlink mode — the installed component is a link into this"
  echo "         repository, so a branch switch changes it in place."
  echo "         For skills the link target is the regenerable staging tree"
  echo "         dist/<tier>/, which a rebuild replaces wholesale: an edit to"
  echo "         the authoring source under artifacts/ takes effect only after"
  echo "         'bash scripts/build-components.sh' has run."
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

# --- The single-component installers handed to the shared drivers ------------
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
  merge_mcp_server "$1"
}

# --- Dispatch ---
case "$TYPE" in
  skills|commands)
    # Commands compile as skills for Copilot (no first-class slash-command
    # format), so both types share one landing zone and one staging root.
    DEST="$COPILOT_HOME/skills"
    mkdir -p "$DEST"
    component_set_staging_roots ".github/skills"
    if [ -n "$NAME" ]; then
      component_install_named install_into_dest "$NAME" "$TYPE" copilot ${COMPONENT_ROOTS[@]+"${COMPONENT_ROOTS[@]}"} || exit $?
    else
      component_install_all install_into_dest copilot ${COMPONENT_ROOTS[@]+"${COMPONENT_ROOTS[@]}"} || exit $?
    fi
    ;;

  agents)
    # Nothing this command may lawfully serve. spec 0119 R3 bars a non-`core`
    # component from the committed project tree — which is where this arm used
    # to write, .github/agents/<name>.md. R6 bars the `core` tier from a
    # per-component install altogether. And R4 declines to oblige a landing zone
    # for a type whose assisted setup deliberately installs none, deferring to
    # the recorded parity gap instead. The repository-level Copilot agent layout
    # is that gap: see docs/cli-matrix.md rows 4 and 10.
    echo "Error: this command installs no Copilot agent." >&2
    echo "       The repository-level Copilot agent layout is a documented" >&2
    echo "       parity gap (docs/cli-matrix.md rows 4 and 10), and spec 0119" >&2
    echo "       R3/R4/R6 leave this command no landing zone it may serve." >&2
    echo "       Agents ship compiled in .github/agents/ via the build." >&2
    exit 1
    ;;

  mcp-servers)
    component_set_artifact_roots "mcp-servers"
    if [ -n "$NAME" ]; then
      component_install_named register_json_entry "$NAME" "$TYPE" "" ${COMPONENT_ROOTS[@]+"${COMPONENT_ROOTS[@]}"} || exit $?
    else
      component_install_all register_json_entry "" ${COMPONENT_ROOTS[@]+"${COMPONENT_ROOTS[@]}"} || exit $?
    fi
    ;;

  *)
    echo "Error: unknown type '$TYPE'"
    echo "Types: skills, commands, mcp-servers"
    exit 1
    ;;
esac
