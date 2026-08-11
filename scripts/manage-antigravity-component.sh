#!/bin/bash
# manage-antigravity-component.sh — Install or link Antigravity CLI overlay-tier components
#
# Usage:
#   bash scripts/manage-antigravity-component.sh <install|link> <type> [name]
#
# Types: antigravity-skills, policies, mcp-servers
# Default mode: install (copy). Link mode shows security disclaimer.
#
# Skills are installed into the documented machine-local customization root
# (~/.gemini/config/skills/) — the same location a full setup run uses, per
# spec 0123 R7. Policies still land in ~/.gemini/antigravity-cli/rules and MCP
# servers are still merged into ~/.gemini/antigravity-cli/settings.json: no
# observation covers those two kinds, and asserting a defect there would rest on
# exactly the documentation-only reasoning spec 0123 exists to correct. They
# warrant their own ticket, opened with a probe of their own.
#
# Every type resolves over the served overlay tiers — library, community, org —
# and never over `core` (spec 0119 R5/R6). Skills resolve from the compiled
# staging tree dist/<tier>/.agents/skills, the same basis the assisted setup
# reads (R2); policies and mcp-servers resolve from the authoring sources, which
# before this change were hardcoded to the community tier alone.

set -e

# ANTIGRAVITY_HOME serves THREE destinations below — `rules/` (:policies) and
# `settings.json` (:mcp-servers) as well as skills. Spec 0123 moves ONLY skills,
# so it gets its own root rather than a one-line edit here that would silently
# relocate two kinds the spec explicitly excludes.
ANTIGRAVITY_HOME="${HOME}/.gemini/antigravity-cli"
AGY_CUSTOMIZATION_ROOT="${HOME}/.gemini/config"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/component-resolve.sh
. "$(dirname "$0")/lib/component-resolve.sh"
# shellcheck source=lib/common.sh
. "$(dirname "$0")/lib/common.sh"

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
  echo "WARNING: Symlink mode — the installed component is a link into this"
  echo "         repository, so a branch switch changes it in place."
  echo "         For antigravity-skills the link target is the regenerable"
  echo "         staging tree dist/<tier>/, which a rebuild replaces wholesale:"
  echo "         an edit to the authoring source under artifacts/ takes effect"
  echo "         only after 'bash scripts/build-components.sh' has run."
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

# Names this invocation actually placed. The superseded-placement cleanup below
# is narrowed to them: R8 binds a setup run, and this surface needs only enough
# cleanup to keep R7's placement property true for the component it touched.
PLACED_NAMES=()

# --- Place a file or directory ---
place_component() {
  local src="$1" dest_dir="$2"
  local item_name
  item_name=$(basename "$src")
  [ "$item_name" = ".gitkeep" ] && return
  PLACED_NAMES+=("$item_name")

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

# --- Dispatch by type ---
case "$TYPE" in
  antigravity-skills)
    # R7 — the same location `task setup-antigravity-interactive` places it.
    DEST="$AGY_CUSTOMIZATION_ROOT/skills"
    mkdir -p "$DEST"
    component_set_staging_roots ".agents/skills"
    if [ -n "$NAME" ]; then
      component_install_named install_into_dest "$NAME" "$TYPE" antigravity "${COMPONENT_ROOTS[@]}" || exit $?
    else
      component_install_all install_into_dest antigravity "${COMPONENT_ROOTS[@]}" || exit $?
    fi
    # Keep R7's property true: a copy of the same component left at the
    # superseded placement would otherwise still be there after this run.
    # Narrow by design — only the names this invocation placed.
    if [ ${#PLACED_NAMES[@]} -gt 0 ]; then
      migrate_antigravity_superseded_components \
        "$ANTIGRAVITY_HOME" "$REPO_DIR/artifacts" skills "${PLACED_NAMES[@]}" || exit $?
    fi
    ;;

  policies)
    DEST="$ANTIGRAVITY_HOME/rules"
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
    echo "Types: antigravity-skills, policies, mcp-servers"
    exit 1
    ;;
esac
