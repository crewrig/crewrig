#!/usr/bin/env bash
# scripts/lib/extension-install.sh — Shared install-time helpers for the
# per-CLI install scripts.
#
# Do NOT execute directly; source it. Requires: jq.

# ext_antigravity_resolve_tokens <plugin-output-dir> — spec 0183 R19: the
# install path resolves the neutral ${extensionRoot} token AFTER the tool's
# own install has run (a live probe proved Antigravity's MCP server spawns
# with the CLI's own launch directory as CWD, not the plugin root —
# docs/runbooks/extension-mcp-token-probe.md Q2 — so
# build-antigravity-extension.sh's render ships mcp_config.json with the
# token unresolved), and LOCATES the installed directory through the
# identity the tool itself reports (the rendered plugin.json's own `.name`
# field) rather than through the source directory's basename. An absent or
# empty `.name` is a HARD FAILURE naming plugin.json — there is no fallback
# to the source basename; guessing an identity the tool did not report is
# exactly what R19 forbids. Returns 0 (silent) when the extension declares
# no mcpServers subject at all (no mcp_config.json to resolve).
ext_antigravity_resolve_tokens() {
  local output_dir="$1"
  [ -f "$output_dir/mcp_config.json" ] || return 0

  local plugin_name
  plugin_name="$(jq -r '.name // empty' "$output_dir/plugin.json" 2>/dev/null)"
  if [ -z "$plugin_name" ]; then
    echo "Error: $output_dir/plugin.json carries no (or an empty) .name — cannot locate the installed directory. The install-time resolution requires the identity the tool itself reports; there is no fallback to the source directory's basename (spec 0183 R19)." >&2
    return 1
  fi

  local installed_root installed_mcp
  installed_root="$HOME/.gemini/config/plugins/$plugin_name"
  installed_mcp="$installed_root/mcp_config.json"
  if [ ! -f "$installed_mcp" ]; then
    echo "Error: expected $installed_mcp after install (spec 0180 R16: a target that receives a declaration without the artifacts it names is a failure)." >&2
    return 1
  fi

  local tmp_mcp
  tmp_mcp="$(mktemp)"
  if jq --arg root "$installed_root" \
      'walk(if type == "string" then gsub("\\$\\{extensionRoot\\}"; $root) else . end)' \
      "$installed_mcp" > "$tmp_mcp"; then
    mv "$tmp_mcp" "$installed_mcp"
    echo "  Resolved \${extensionRoot} -> $installed_root in $installed_mcp"
  else
    rm -f "$tmp_mcp"
    echo "Error: failed to rewrite \${extensionRoot} in $installed_mcp" >&2
    return 1
  fi
}
