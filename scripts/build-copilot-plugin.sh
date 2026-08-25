#!/bin/bash
# build-copilot-plugin.sh — Generate a Copilot CLI plugin from extension.json
#
# Usage:
#   bash scripts/build-copilot-plugin.sh <extension-dir-or-name> [output-dir]
#
# Reads extension.json and generates a complete Copilot CLI plugin directory
# suitable for `copilot plugin install`. An extension with no committed
# extension.json fails naming the migration tool (spec 0183 R14) — there is
# no gemini-extension.json fallback.
#
# When a bare extension name is given it is resolved by searching:
#   extensions/core/  →  extensions/library/  →  extensions/org/
# in that order. An error is raised when the same name appears in multiple tiers.
#
# The output directory defaults to dist-copilot-plugin/<name>/ relative to
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

EXT_ARG="${1:?Usage: build-copilot-plugin.sh <extension-dir-or-name> [output-dir]}"

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
OUTPUT_DIR="${2:-$REPO_DIR/dist-copilot-plugin/$NAME}"
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

echo "Building Copilot CLI plugin: $NAME v$VERSION"
echo "  Source: $EXT_DIR"
echo "  Output: $OUTPUT_DIR"

# --- Generate plugin.json at output root ---
# `copilot.pluginName` is retired (spec 0183 R7): it was reducible from the
# manifest's own `.name`, and this reader already fell back to it.
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

# --- Generate .mcp.json (spec 0180 R7/R9/R10) ---
# Delivered at the plugin root, "source": "plugin" — Copilot CLI 1.0.80's own
# installed-plugin registry (probed empirically: a plugin directory carrying
# .mcp.json was registered, `copilot mcp list --json` returned exactly the
# declared server tagged "source": "plugin"). Translated through the shared
# org-channel translator (ext_mcp_native) and rewritten to Copilot's own
# ${COPILOT_PLUGIN_ROOT} spelling — confirmed by a live, non-interactive
# `copilot -p` session actually spawning the stdio server with that token
# expanded (docs/runbooks/extension-mcp-token-probe.md, Q1, 2026-08-25):
# every one of the three candidate forms resolves, because Copilot defaults
# a plugin-sourced server's `cwd` to its own plugin root.
# mcpDelivery gate (spec 0180 v2-F5): the SAME row scripts/build-extension.sh's
# render_plugin reads to decide whether an R15 gap is owed, so the emit
# decision and the gap decision read one shared fact and cannot disagree.
MCP_DELIVERABLE=$(ext_mcp_delivery copilot)
if [ "$MCP_DELIVERABLE" = "true" ]; then
  MCP_SERVERS_NATIVE=$(ext_mcp_native copilot "$MANIFEST")
  if [ "$MCP_SERVERS_NATIVE" != "{}" ]; then
    jq -n --argjson servers "$MCP_SERVERS_NATIVE" '{ mcpServers: $servers }' > "$OUTPUT_DIR/.mcp.json"
    echo "  Generated: .mcp.json"

    # R16: the named build output travels WITH the declaration. package.json is
    # also needed for ESM type resolution by node at runtime (same rationale as
    # the Claude and Antigravity builders).
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
  echo "Warning: extension declares mcpServers, which has no expressible delivery on target 'copilot' — recorded as an observed gap by the parent render" >&2
fi

# --- Render context file (spec 0181 R1/R11) ---
# Copilot CLI's plugin surface carries no context/instructions concept
# (`copilot plugin --help`; pinned live in
# tests/extension-context-delivery-evidence.md) — the context is delivered
# as a user-invocable skill instead, the SAME surface this builder already
# uses for commands below. The output path itself
# (skills/<name>-context/SKILL.md) is the render's own knowledge
# (scripts/lib/extension-targets.json's contextOutput column), never
# authored.
CONTEXT_SOURCE=$(jq -r '.context.source // ""' "$MANIFEST" 2>/dev/null)
if [ -n "$CONTEXT_SOURCE" ] && [ -f "$EXT_DIR/$CONTEXT_SOURCE" ]; then
  CONTEXT_OUTPUT=$(render_context_target_output copilot "$NAME")
  mkdir -p "$OUTPUT_DIR/$(dirname "$CONTEXT_OUTPUT")"
  CONTEXT_BODY=$(render_context "$EXT_DIR/$CONTEXT_SOURCE" copilot "$MANIFEST" "$EXT_DIR")
  CONTEXT_RC=$?
  if [ "$CONTEXT_RC" -eq 0 ]; then
    {
      echo "---"
      echo "name: ${NAME}-context"
      echo "description: \"Agent-facing context for the ${NAME} extension.\""
      echo "user-invocable: true"
      echo "---"
      echo ""
      printf '%s\n' "$CONTEXT_BODY"
    } > "$OUTPUT_DIR/$CONTEXT_OUTPUT"
    echo "  Rendered: $CONTEXT_OUTPUT"
  else
    echo "Error: rendering context for target 'copilot' failed" >&2
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

# --- Render pivot commands to Copilot skills ---
# Spec 0042: the command source of truth is the pivot `commands/<name>.md`, NOT
# the Gemini `commands/<name>.toml`.  The `convertToSkills` manifest flag means
# "render pivot `.md` → Copilot skill" (same pattern as Claude and Antigravity).
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

# --- Copy agents (flattened to <name>.agent.md) ---
# Copilot's native plugin agent format is a flat file with .agent.md extension,
# not a subdirectory.  Each agents/<name>/AGENT.md source is flattened to
# agents/<name>.agent.md in the output.
AGENTS_ENABLED=$(ext_subject_present "$MANIFEST" agents)
AGENTS_LOCATION=$(ext_subject_location "$MANIFEST" agents "agents/")
if [ "$AGENTS_ENABLED" = "true" ] && [ -d "$EXT_DIR/$AGENTS_LOCATION" ]; then
  mkdir -p "$OUTPUT_DIR/agents"
  for agent_dir in "$EXT_DIR/$AGENTS_LOCATION"*/; do
    [ -d "$agent_dir" ] || continue
    agent_name=$(basename "$agent_dir")
    cp "$agent_dir/AGENT.md" "$OUTPUT_DIR/agents/$agent_name.agent.md"
    echo "  Copied agent (flattened): $agent_name"
  done
fi

# --- Deliver hook handlers (spec 0179) ---
# The per-CLI `copilot.hooks` key is retired (0065 delta-01 R1/R10; this
# builder no longer reads it — build-extension.sh's render_plugin emits
# hooks.json from the generic declaration via scripts/lib/extension-hooks.sh,
# AFTER this builder runs, per 0065 delta-01 R9). What this builder still
# owns is delivering the extension's own hook HANDLER scripts, because the
# emitted command's ${COPILOT_PLUGIN_ROOT}/hooks/<handler> form resolves to a
# path nothing else copies here. Copied whenever the manifest declares any
# generic hooks at all, regardless of which map on Copilot specifically — a
# conservative, deliberately coarse test that never under-delivers.
if jq -e '(.hooks // []) | length > 0' "$MANIFEST" >/dev/null 2>&1 && [ -d "$EXT_DIR/hooks" ]; then
  cp -r "$EXT_DIR/hooks" "$OUTPUT_DIR/hooks"
  echo "  Copied: hooks/"
fi

echo ""
echo "Plugin built: $OUTPUT_DIR"
echo "Install with: copilot plugin install $OUTPUT_DIR"
