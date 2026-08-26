#!/bin/bash
# build-antigravity-extension.sh — Generate an Antigravity CLI plugin from extension.json
#
# Usage:
#   bash scripts/build-antigravity-extension.sh <extension-dir-or-name> [output-dir]
#
# Reads extension.json and generates a complete Antigravity CLI plugin
# directory suitable for `agy plugin install`. An extension with no
# committed extension.json fails naming the migration tool (spec 0183 R14)
# — there is no gemini-extension.json fallback.
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
# Shared manifest accessors (spec 0173/0183): resolve the generic top-level
# section only — the legacy components.<subject>.* shape is rejected by
# ext_assert_current_shape rather than read.
# shellcheck source=lib/extension-manifest.sh
. "$(cd "$(dirname "$0")" && pwd)/lib/extension-manifest.sh"
# Shared context renderer (spec 0181, issue #1007).
# shellcheck source=lib/render-context.sh
. "$(cd "$(dirname "$0")" && pwd)/lib/render-context.sh"

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
# No gemini-extension.json fallback (spec 0183 R14): it is a build output,
# never committed, and reading through it would resurrect exactly the
# dual-shape read this change removes.
MANIFEST="$EXT_DIR/extension.json"
if [ ! -f "$MANIFEST" ]; then
  echo "Error: No extension.json found in $EXT_DIR — run scripts/migrate-extension.sh if this is an old-shape extension (see docs/adoption-guide.md)."
  exit 1
fi
ext_assert_current_shape "$MANIFEST" || exit 1

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
# `antigravity.pluginName` is retired (spec 0183 R7): it was reducible from
# the manifest's own `.name`, and this reader already fell back to it.
PLUGIN_NAME="$NAME"
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

# --- Generate mcp_config.json (spec 0180 R7/R9/R10/R16) ---
# Delivered at the plugin root — the location both plugins.md:18 and
# mcp_servers.md:21 name. Translated through the shared org-channel
# translator (ext_mcp_native), which leaves the neutral ${extensionRoot}
# token UNRESOLVED here on purpose: a live probe
# (docs/runbooks/extension-mcp-token-probe.md, Q2, 2026-08-25) proved a
# RELATIVE command/args does NOT resolve against the plugin directory —
# Antigravity spawns a plugin's MCP server with the CLI's own launch
# directory as CWD, not the plugin root (the opposite of Copilot's default,
# and the opposite of how Antigravity itself fires a HOOK). The token is
# resolved later, at install time, by
# scripts/install-antigravity-extension.sh's post-install rewrite (Option A)
# — the earliest moment the real installed directory is knowable (R7).
# mcpDelivery gate (spec 0180 v2-F5): the SAME row scripts/build-extension.sh's
# render_plugin reads to decide whether an R15 gap is owed, so the emit
# decision and the gap decision read one shared fact and cannot disagree.
MCP_DELIVERABLE=$(ext_mcp_delivery antigravity)
if [ "$MCP_DELIVERABLE" = "true" ]; then
  MCP_SERVERS_NATIVE=$(ext_mcp_native antigravity "$MANIFEST")
  if [ "$MCP_SERVERS_NATIVE" != "{}" ]; then
    jq -n --argjson servers "$MCP_SERVERS_NATIVE" '{ mcpServers: $servers }' > "$OUTPUT_DIR/mcp_config.json"
    echo "  Generated: mcp_config.json"

    # R16: the named build output travels WITH the declaration.
    if [ -d "$EXT_DIR/dist" ]; then
      cp -r "$EXT_DIR/dist" "$OUTPUT_DIR/dist"
      echo "  Copied: dist/"
    fi
    if [ -f "$EXT_DIR/package.json" ]; then
      cp "$EXT_DIR/package.json" "$OUTPUT_DIR/package.json"
      echo "  Copied: package.json"
    fi
  fi
elif jq -e '(.mcpServers // {}) | length > 0' "$MANIFEST" >/dev/null 2>&1; then
  echo "Warning: extension declares mcpServers, which has no expressible delivery on target 'antigravity' — recorded as an observed gap by the parent render" >&2
fi

# --- Render context file (spec 0181 R1/R10) ---
# The per-CLI `antigravity.contextFileName` key is retired — the concept it
# configured has no counterpart in Antigravity's plugin format at all (the
# key named a bare file the build copied to the plugin root, where nothing
# ingested it). The location below (plugins/<name>/rules/AGENTS.md) is
# pinned by a live evidence probe, not assumed:
# tests/extension-context-delivery-evidence.md.
CONTEXT_SOURCE=$(jq -r '.context.source // ""' "$MANIFEST" 2>/dev/null)
if [ -n "$CONTEXT_SOURCE" ] && [ -f "$EXT_DIR/$CONTEXT_SOURCE" ]; then
  AGY_CONTEXT=$(render_context_target_output antigravity "$NAME")
  # Render to a scratch file first — a plain `> "$dest"` redirection creates
  # $dest via the shell before the command's exit status is known, which
  # would leave a stray (truncated/empty) file behind on a resolver failure.
  CONTEXT_TMP=$(mktemp)
  if render_context "$EXT_DIR/$CONTEXT_SOURCE" antigravity "$MANIFEST" "$EXT_DIR" > "$CONTEXT_TMP"; then
    mkdir -p "$OUTPUT_DIR/$(dirname "$AGY_CONTEXT")"
    mv "$CONTEXT_TMP" "$OUTPUT_DIR/$AGY_CONTEXT"
    echo "  Rendered: $AGY_CONTEXT"
  else
    rm -f "$CONTEXT_TMP"
    echo "Error: rendering context for target 'antigravity' failed" >&2
    exit 1
  fi
fi

# --- Copy skills ---
SKILLS_ENABLED=$(ext_subject_present "$MANIFEST" skills)
SKILLS_LOCATION=$(ext_subject_location "$MANIFEST" skills "skills/")
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
COMMANDS_ENABLED=$(ext_subject_present "$MANIFEST" commands)
CONVERT_TO_SKILLS=$(ext_subject_option "$MANIFEST" commands convertToSkills false)
COMMANDS_LOCATION=$(ext_subject_location "$MANIFEST" commands "commands/")
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
AGENTS_ENABLED=$(ext_subject_present "$MANIFEST" agents)
AGENTS_LOCATION=$(ext_subject_location "$MANIFEST" agents "agents/")
if [ "$AGENTS_ENABLED" = "true" ] && [ -d "$EXT_DIR/$AGENTS_LOCATION" ]; then
  mkdir -p "$OUTPUT_DIR/agents"
  for agent_dir in "$EXT_DIR/$AGENTS_LOCATION"*/; do
    [ -d "$agent_dir" ] || continue
    agent_name=$(basename "$agent_dir")
    cp -r "$agent_dir" "$OUTPUT_DIR/agents/$agent_name"
    echo "  Copied agent: $agent_name"
  done
fi

# --- Deliver hook handlers (spec 0179; v2-F1) ---
# The per-CLI `antigravity.hooks` key is retired (0063 delta-01 R1/R19; this
# builder no longer reads it — build-extension.sh's render_plugin emits
# hooks.json AT THE OUTPUT ROOT from the generic declaration via
# scripts/lib/extension-hooks.sh, AFTER this builder runs, per 0063 delta-01
# R18). What this builder still owns is delivering the extension's own hook
# HANDLER scripts into hooks/ — the asymmetry v2-F1 flagged: hooks.json sits
# at the plugin ROOT while Antigravity has no path variable, so its emitted
# command is working-directory-relative and MUST resolve to hooks/<handler>,
# never a bare <handler> sitting beside hooks.json itself. Copied whenever
# the manifest declares any generic hooks at all, regardless of which map on
# Antigravity specifically — a conservative, deliberately coarse test that
# never under-delivers.
if jq -e '(.hooks // []) | length > 0' "$MANIFEST" >/dev/null 2>&1 && [ -d "$EXT_DIR/hooks" ]; then
  cp -r "$EXT_DIR/hooks" "$OUTPUT_DIR/hooks"
  echo "  Copied: hooks/"
fi

echo ""
echo "Plugin built: $OUTPUT_DIR"
echo "Validate with: agy plugin validate $OUTPUT_DIR"
