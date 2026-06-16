#!/usr/bin/env bash
# build-extension-pivot.sh — Render extension command pivot sources to their
# committed Gemini consumed form (spec 0042).
#
# Gemini CLI loads an extension IN PLACE: install-extension.sh / link-extensions.sh
# copy or symlink the extension tree verbatim, with no install-time render hook
# (see docs/cli-matrix.md row 13). So the Gemini command form
# `commands/<name>.toml` must be a COMMITTED, generated sibling of its pivot
# source `commands/<name>.md` inside the extension tree — the extension analog of
# the artifacts/ build-output staging rule. This script produces (or, with
# --check, verifies) those committed `.toml` siblings.
#
# Claude does NOT consume the `.toml`: it builds a plugin at install time and
# renders the pivot `.md` directly (scripts/build-claude-plugin.sh). So this
# script is the Gemini-side symmetric counterpart to build-claude-plugin.sh.
#
# Usage:
#   bash scripts/build-extension-pivot.sh [<extension-dir-or-name> ...] [--check]
#
#   With no extension argument, every extension under extensions/{core,library,org}
#   that declares a commands/ directory is processed.
#   --check   Verify each committed .toml matches a fresh render of its pivot .md
#             (drift detection, no write). Exits non-zero on any drift. This is a
#             first-class acceptance criterion: it is the sole mechanism that
#             keeps the committed-generated .toml honest against its pivot .md.
#
# Prerequisites: yq.

set -euo pipefail

command -v yq >/dev/null 2>&1 || {
  echo "Error: yq is required. Install with: brew install yq" >&2
  exit 2
}

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# shellcheck source=lib/render-command.sh
. "$SCRIPT_DIR/lib/render-command.sh"

CHECK_MODE=false
EXT_ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --check) CHECK_MODE=true; shift ;;
    *)       EXT_ARGS+=("$1"); shift ;;
  esac
done

DRIFT_FOUND=false

# Resolve a bare extension name to its source dir extensions/<tier>/<name>/,
# searching every tier (first match; hard-error on a duplicate name). A path
# argument is accepted verbatim. Echoes the absolute extension dir.
resolve_extension_dir() {
  local arg="$1"
  if [ -d "$arg" ]; then
    (cd "$arg" && pwd)
    return 0
  fi
  local found=""
  local tier
  for tier in core library org; do
    if [ -d "$REPO_DIR/extensions/$tier/$arg" ]; then
      if [ -n "$found" ]; then
        echo "Error: extension '$arg' exists in multiple tiers; names must be unique." >&2
        exit 1
      fi
      found="$REPO_DIR/extensions/$tier/$arg"
    fi
  done
  if [ -z "$found" ]; then
    echo "Error: extension directory or name '$arg' not found." >&2
    exit 1
  fi
  (cd "$found" && pwd)
}

# Enumerate every extension dir under extensions/{core,library,org} that has a
# commands/ subdirectory. Echoes one absolute dir per line.
discover_extension_dirs() {
  local tier ext_dir
  for tier in core library org; do
    [ -d "$REPO_DIR/extensions/$tier" ] || continue
    for ext_dir in "$REPO_DIR/extensions/$tier"/*/; do
      [ -d "$ext_dir" ] || continue
      [ -d "${ext_dir}commands" ] || continue
      (cd "$ext_dir" && pwd)
    done
  done
}

# Render (or --check) the committed .toml for every command pivot .md in one
# extension's commands/ dir.
render_extension() {
  local ext_dir="$1"
  local commands_dir="$ext_dir/commands"
  [ -d "$commands_dir" ] || return 0

  local source
  for source in "$commands_dir"/*.md; do
    [ -f "$source" ] || continue
    local name
    name=$(yaml_field "$source" "name")
    if [ -z "$name" ] || [ "$name" = "null" ]; then
      echo "Warning: $source missing 'name' field, skipping" >&2
      continue
    fi

    local target="$commands_dir/$name.toml"
    local rendered
    rendered=$(render_command_gemini "$source")

    if [ "$CHECK_MODE" = true ]; then
      if [ ! -f "$target" ]; then
        echo "DRIFT: $target does not exist (expected from $source)"
        DRIFT_FOUND=true
        continue
      fi
      # `echo` adds the trailing newline the committed file carries.
      if ! echo "$rendered" | diff -q - "$target" >/dev/null 2>&1; then
        echo "DRIFT: $target differs from a fresh render of $source"
        DRIFT_FOUND=true
        continue
      fi
      echo "  OK   $target"
    else
      echo "$rendered" > "$target"
      echo "  Generated: $target"
    fi
  done
}

# Collect the target extension dirs.
ext_dirs=()
if [ "${#EXT_ARGS[@]}" -gt 0 ]; then
  for arg in "${EXT_ARGS[@]}"; do
    ext_dirs+=("$(resolve_extension_dir "$arg")")
  done
else
  while IFS= read -r d; do
    [ -z "$d" ] && continue
    ext_dirs+=("$d")
  done < <(discover_extension_dirs)
fi

if [ "$CHECK_MODE" = true ]; then
  echo "Extension pivot render — CHECK (drift detection)"
else
  echo "Extension pivot render — BUILD"
fi

for ext_dir in "${ext_dirs[@]}"; do
  render_extension "$ext_dir"
done

echo ""
if [ "$CHECK_MODE" = true ]; then
  if [ "$DRIFT_FOUND" = true ]; then
    echo "FAILED: extension command .toml drift detected. Run 'bash scripts/build-extension-pivot.sh' to regenerate."
    exit 1
  fi
  echo "OK: every committed extension command .toml matches its pivot .md."
else
  echo "Done."
fi
