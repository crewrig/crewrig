#!/bin/bash
# manage-workspace-component.sh — Install or link Gemini CLI overlay-tier components
#
# Usage:
#   bash scripts/manage-workspace-component.sh <install|link> <type> [name]
#
# Types: commands, skills, hooks, agents, policies, mcp-servers, themes
# Default mode: install (copy). Link mode shows a security disclaimer but does
# NOT prompt — scripts/install-workspace.sh drives this script seven times in
# one run, so a per-type confirmation would fire seven times for one
# `task link-workspace`. The asymmetry with the other three commands is recorded
# in docs/cli-matrix.md row 12 with that reason.
#
# Every type resolves over the served overlay tiers — library, community, org —
# and never over `core` (spec 0119 R5/R6). `skills` and `agents` resolve from
# the compiled staging tree because the assisted setup does
# (setup-gemini-interactive.sh installs both from dist/<tier>/.gemini, R2); the
# other five resolve from the authoring sources, which is also what the setup
# reads wherever it touches the same landing zone.

set -e

GEMINI_HOME="${HOME}/.gemini"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/component-resolve.sh
. "$(dirname "$0")/lib/component-resolve.sh"

MODE="${1:-install}"   # "install" (copy) or "link" (symlink)
TYPE="$2"
NAME="$3"

if [ -z "$TYPE" ]; then
  echo "Usage: $0 <install|link> <type> [name]"
  echo "Types: commands, skills, hooks, agents, policies, mcp-servers, themes"
  exit 1
fi

# --- Security disclaimer for link mode (no prompt — see the header) ---
if [ "$MODE" = "link" ]; then
  echo "WARNING: Symlink mode — the installed component is a link into this"
  echo "         repository, so a branch switch changes it in place."
  echo "         For skills and agents the link target is the regenerable"
  echo "         staging tree dist/<tier>/, which a rebuild replaces wholesale:"
  echo "         an edit to the authoring source under artifacts/ takes effect"
  echo "         only after 'bash scripts/build-components.sh' has run."
  echo "Only use if you trust all branches in this repository."
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

  mkdir -p "$GEMINI_HOME"
  [ ! -f "$settings_file" ] && echo "{}" > "$settings_file"

  cp "$settings_file" "${settings_file}.bak"
  jq --arg key "$settings_key" \
     --arg name "$entry_name" \
     --slurpfile val "$json_file" \
     '.[$key] = ((.[$key] // {}) + {($name): $val[0]})' \
     "${settings_file}.bak" > "$settings_file"

  echo "  Merged: $entry_name into $settings_key"
}

# --- The single-component installers handed to the shared drivers ------------
install_into_dest() {
  place_component "$1" "$DEST"
}

merge_json_entry() {
  case "$1" in
    *.json) ;;
    *)
      echo "Error: '$1' is not a JSON $TYPE declaration." >&2
      return 1
      ;;
  esac
  merge_json "$1" "$KEY"
}

# --- Dispatch ---
case "$TYPE" in
  commands|skills|hooks|agents|policies)
    DEST="$GEMINI_HOME/$TYPE"
    mkdir -p "$DEST"

    # R2: only the two types the assisted setup reads from compiled output
    # resolve from the staging tree; the rest stay on the authoring sources,
    # where neither route reads compiled output either.
    case "$TYPE" in
      skills) component_set_staging_roots ".gemini/skills"; REFRESH_CLI="gemini" ;;
      agents) component_set_staging_roots ".gemini/agents"; REFRESH_CLI="gemini" ;;
      *)      component_set_artifact_roots "$TYPE";         REFRESH_CLI="" ;;
    esac

    if [ -n "$NAME" ]; then
      component_install_named install_into_dest "$NAME" "$TYPE" "$REFRESH_CLI" "${COMPONENT_ROOTS[@]}" || exit $?
    else
      component_install_all install_into_dest "$REFRESH_CLI" "${COMPONENT_ROOTS[@]}" || exit $?
    fi
    ;;

  mcp-servers|themes)
    KEY="mcpServers"
    [ "$TYPE" = "themes" ] && KEY="themes"

    component_set_artifact_roots "$TYPE"
    if [ -n "$NAME" ]; then
      component_install_named merge_json_entry "$NAME" "$TYPE" "" "${COMPONENT_ROOTS[@]}" || exit $?
    else
      component_install_all merge_json_entry "" "${COMPONENT_ROOTS[@]}" || exit $?
    fi
    ;;

  *)
    echo "Error: unknown component type '$TYPE'"
    exit 1
    ;;
esac
