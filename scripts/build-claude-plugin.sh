#!/bin/bash
# build-claude-plugin.sh — Generate a Claude Code plugin from extension.json
#
# Usage:
#   bash scripts/build-claude-plugin.sh <extension-dir> [output-dir]
#
# Reads extension.json (or falls back to gemini-extension.json) and generates
# a complete Claude Code plugin directory.
#
# Prerequisites: jq

set -euo pipefail

command -v jq >/dev/null 2>&1 || { echo "Error: jq is required. Install with: brew install jq"; exit 1; }

# Shared pivot helpers (spec 0042). The Claude plugin command form is rendered
# from the pivot `commands/*.md` source — NOT from the Gemini `.toml` output —
# so this builder consumes the same single source of truth as
# scripts/build-extension.sh. Sourced for extract_body / yaml_field.
# shellcheck source=lib/render-command.sh
. "$(cd "$(dirname "$0")" && pwd)/lib/render-command.sh"
# Shared manifest accessors (spec 0173): resolve the generic top-level
# section first, falling back to legacy components.<subject>.* until S5.
# shellcheck source=lib/extension-manifest.sh
. "$(cd "$(dirname "$0")" && pwd)/lib/extension-manifest.sh"

EXT_ARG="${1:?Usage: build-claude-plugin.sh <extension-dir-or-name> [output-dir]}"

# Accept either an extension directory (back-compatible) or a bare extension
# name. A bare name is resolved to its SOURCE dir extensions/<tier>/<name>/,
# searching every tier (first match; hard-error on a duplicate name). The tier
# is a SOURCE-side concern only; the built plugin keeps its bare name.
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

# --- Locate manifest ---
MANIFEST=""
if [ -f "$EXT_DIR/extension.json" ]; then
  MANIFEST="$EXT_DIR/extension.json"
elif [ -f "$EXT_DIR/gemini-extension.json" ]; then
  MANIFEST="$EXT_DIR/gemini-extension.json"
  echo "Warning: Using legacy gemini-extension.json (no Claude-specific config available)"
else
  echo "Error: No extension.json or gemini-extension.json found in $EXT_DIR"
  exit 1
fi

# --- Read universal metadata ---
NAME=$(jq -r '.name' "$MANIFEST")
VERSION=$(jq -r '.version' "$MANIFEST")
DESCRIPTION=$(jq -r '.description' "$MANIFEST")

# --- Output directory ---
OUTPUT_DIR="${2:-$EXT_DIR/dist-claude-plugin/$NAME}"
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

echo "Building Claude Code plugin: $NAME v$VERSION"
echo "  Source: $EXT_DIR"
echo "  Output: $OUTPUT_DIR"

# --- Generate .claude-plugin/plugin.json ---
mkdir -p "$OUTPUT_DIR/.claude-plugin"
AUTHOR_NAME=$(jq -r '.claude.author.name // "Unknown"' "$MANIFEST" 2>/dev/null)
jq -n \
  --arg name "$NAME" \
  --arg version "$VERSION" \
  --arg description "$DESCRIPTION" \
  --arg author "$AUTHOR_NAME" \
  '{
    name: $name,
    description: $description,
    version: $version,
    author: { name: $author }
  }' > "$OUTPUT_DIR/.claude-plugin/plugin.json"
echo "  Generated: .claude-plugin/plugin.json"

# --- Generate .mcp.json (spec 0180 R7/R8 back-fill) ---
# Translated through the shared org-channel translator (ext_mcp_native,
# scripts/lib/extension-manifest.sh) and rewritten to Claude's own
# ${CLAUDE_PLUGIN_ROOT} spelling — Claude Code resolves ${CLAUDE_PLUGIN_ROOT}
# itself at load time from the installed plugin directory (evidenced: the
# official marketplace plugin discord/.mcp.json on disk, and four
# CLAUDE_PLUGIN_ROOT substitution entries in the installed changelog), so no
# render-time absolute path is baked in any more. The prior substitution here
# — `gsub("\\$\\{extensionPath\\}"; $path)` with $path=$OUTPUT_DIR — baked
# the RENDERING machine's own directory into every delivered .mcp.json,
# which is wrong the moment a release artifact carries the tree elsewhere
# (spec 0173Δ R20/R22; spec 0180 R8).
# mcpDelivery gate (spec 0180 v2-F5): the SAME row scripts/build-extension.sh's
# render_plugin reads to decide whether an R15 gap is owed, so the emit
# decision and the gap decision read one shared fact and cannot disagree.
MCP_DELIVERABLE=$(ext_mcp_delivery claude)
if [ "$MCP_DELIVERABLE" = "true" ]; then
  MCP_SERVERS_NATIVE=$(ext_mcp_native claude "$MANIFEST")
  if [ "$MCP_SERVERS_NATIVE" != "{}" ]; then
    jq -n --argjson servers "$MCP_SERVERS_NATIVE" '{ mcpServers: $servers }' > "$OUTPUT_DIR/.mcp.json"
    echo "  Generated: .mcp.json"

    # The .mcp.json typically references ${CLAUDE_PLUGIN_ROOT}/dist/index.js —
    # copy the compiled MCP server so the resolved path inside the plugin is
    # valid (R16). package.json is also needed for ESM type resolution by node
    # at runtime.
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
  echo "Warning: extension declares mcpServers, which has no expressible delivery on target 'claude' — recorded as an observed gap by the parent render" >&2
fi

# --- Copy context file ---
CLAUDE_CONTEXT=$(jq -r '.claude.contextFileName // ""' "$MANIFEST" 2>/dev/null)
if [ -n "$CLAUDE_CONTEXT" ] && [ -f "$EXT_DIR/$CLAUDE_CONTEXT" ]; then
  cp "$EXT_DIR/$CLAUDE_CONTEXT" "$OUTPUT_DIR/$CLAUDE_CONTEXT"
  echo "  Copied: $CLAUDE_CONTEXT"
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

# --- Render pivot commands to Claude skills ---
# Spec 0042: the command source of truth is the pivot `commands/<name>.md`, NOT
# the Gemini `commands/<name>.toml` (which is a generated Gemini output). Reading
# the pivot `.md` directly also fixes a latent bug: the prior code ran
# `sed -n '/^prompt *= *"""/,/^"""/p'` over the `.toml`, which required a
# triple-quoted prompt and therefore extracted an EMPTY prompt from any
# single-quoted legacy `.toml`. The `convertToSkills` manifest flag is kept by
# name (a rename is sibling spec 0044 scope); post-flip it means "render pivot
# `.md` → Claude skill", not "convert `.toml` → skill".
COMMANDS_ENABLED=$(ext_subject_present "$MANIFEST" commands)
CONVERT_TO_SKILLS=$(ext_subject_option "$MANIFEST" commands convertToSkills false)
COMMANDS_LOCATION=$(ext_subject_location "$MANIFEST" commands "commands/")
if [ "$COMMANDS_ENABLED" = "true" ] && [ "$CONVERT_TO_SKILLS" = "true" ] && [ -d "$EXT_DIR/$COMMANDS_LOCATION" ]; then
  command -v yq >/dev/null 2>&1 || { echo "Error: yq is required to render pivot commands. Install with: brew install yq"; exit 1; }
  DEFAULT_TOOLS=$(jq -r '.claude.defaultAllowedTools // [] | join("\n")' "$MANIFEST" 2>/dev/null)
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
      if [ -n "$DEFAULT_TOOLS" ]; then
        echo "allowed-tools:"
        echo "$DEFAULT_TOOLS" | while IFS= read -r tool; do
          [ -n "$tool" ] && echo "  - $tool"
        done
      fi
      echo "---"
      echo ""
      echo "$cmd_prompt"
    } > "$OUTPUT_DIR/skills/$cmd_name/SKILL.md"
    echo "  Rendered command to skill: $cmd_name"
  done
fi

# --- Copy agents ---
# An agent dir is a pivot-authoring location: it may hold sibling files for
# other CLIs alongside the Claude pivot source AGENT.md (e.g. PROMPT.md is the
# Gemini pivot source — see extension-skeleton/agent/agents/sample-agent/PROMPT.md).
# `cp -r` of the whole directory would drag such siblings into the Claude
# plugin, where Claude Code registers them as bogus extra agents (issue #600).
# Copy only the files matched by the manifest's `claude.agents` glob array
# (default: agents/*/AGENT.md), file by file, preserving the relative path.
AGENTS_ENABLED=$(ext_subject_present "$MANIFEST" agents)
AGENTS_LOCATION=$(ext_subject_location "$MANIFEST" agents "agents/")
if [ "$AGENTS_ENABLED" = "true" ] && [ -d "$EXT_DIR/$AGENTS_LOCATION" ]; then
  AGENTS_GLOBS=$(jq -r '.claude.agents // [] | .[]' "$MANIFEST" 2>/dev/null)
  if [ -z "$AGENTS_GLOBS" ]; then
    AGENTS_GLOBS="${AGENTS_LOCATION}*/AGENT.md"
  fi
  while IFS= read -r glob_pattern; do
    [ -n "$glob_pattern" ] || continue
    for src_file in "$EXT_DIR/"$glob_pattern; do
      [ -f "$src_file" ] || continue
      rel_path="${src_file#"$EXT_DIR"/}"
      dest_file="$OUTPUT_DIR/$rel_path"
      mkdir -p "$(dirname "$dest_file")"
      cp "$src_file" "$dest_file"
      echo "  Copied agent file: $rel_path"
    done
  done < <(echo "$AGENTS_GLOBS")
fi

# --- Deliver hook handlers (spec 0179) ---
# The per-CLI `claude.hooks` key is retired (0179 R1/R16; this builder no
# longer reads it — build-extension.sh's render_plugin emits hooks/hooks.json
# from the generic declaration via scripts/lib/extension-hooks.sh, AFTER this
# builder runs). What this builder still owns is delivering the extension's
# own hook HANDLER scripts into the plugin output, because the emitted
# command's ${CLAUDE_PLUGIN_ROOT}/hooks/<handler> form resolves to a path
# nothing else copies here (unlike Gemini's render, which copies the whole
# source tree verbatim). Copied whenever the manifest declares any generic
# hooks at all, regardless of which map on Claude specifically — a
# conservative, deliberately coarse test that never under-delivers.
if jq -e '(.hooks // []) | length > 0' "$MANIFEST" >/dev/null 2>&1 && [ -d "$EXT_DIR/hooks" ]; then
  cp -r "$EXT_DIR/hooks" "$OUTPUT_DIR/hooks"
  echo "  Copied: hooks/"
fi

# --- Generate settings.json ---
CLAUDE_SETTINGS=$(jq '.claude.settings // {}' "$MANIFEST" 2>/dev/null)
if [ "$CLAUDE_SETTINGS" != "{}" ] && [ "$CLAUDE_SETTINGS" != "null" ]; then
  echo "$CLAUDE_SETTINGS" | jq '.' > "$OUTPUT_DIR/settings.json"
  echo "  Generated: settings.json"
fi

# --- Generate .lsp.json ---
CLAUDE_LSP=$(jq '.claude.lsp // {}' "$MANIFEST" 2>/dev/null)
if [ "$CLAUDE_LSP" != "{}" ] && [ "$CLAUDE_LSP" != "null" ]; then
  echo "$CLAUDE_LSP" | jq '.' > "$OUTPUT_DIR/.lsp.json"
  echo "  Generated: .lsp.json"
fi

# --- Copy bin/ ---
CLAUDE_BIN=$(jq -r '.claude.bin // ""' "$MANIFEST" 2>/dev/null)
if [ -n "$CLAUDE_BIN" ] && [ "$CLAUDE_BIN" != "null" ] && [ -d "$EXT_DIR/$CLAUDE_BIN" ]; then
  cp -r "$EXT_DIR/$CLAUDE_BIN" "$OUTPUT_DIR/bin"
  echo "  Copied: bin/"
fi

echo ""
echo "Plugin built: $OUTPUT_DIR"
echo "Test with: claude --plugin-dir $OUTPUT_DIR"
