#!/bin/bash
set -e

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SKELETON_DIR="$REPO_DIR/extension-skeleton"

# --- Extension name ---
if [ -z "$NAME" ]; then
  echo "Usage: NAME=my-extension task create-extension"
  exit 1
fi

# --- Tier selection ---
# Scaffolding is an adopter action, so new extensions default to the org tier.
# core/library are upstream-authored; override with TIER=core|library|org.
TIER="${TIER:-org}"
case "$TIER" in
  core|library|org) ;;
  *)
    echo "Error: TIER must be one of core, library, org (got '$TIER')."
    exit 1
    ;;
esac

TARGET="$REPO_DIR/extensions/$TIER/$NAME"
if [ -d "$TARGET" ]; then
  echo "Error: extensions/$TIER/$NAME already exists."
  exit 1
fi

# --- Prerequisites ---
command -v fzf >/dev/null 2>&1 || {
  echo "Error: fzf is required. Install with: brew install fzf (macOS) or apt install fzf (Linux)"
  exit 1
}

# --- Component selection ---
echo "Creating extension: $NAME"
echo ""
echo "Select components to include (TAB to toggle, ENTER to confirm):"

COMPONENTS=$(printf "mcp-server\ncommand\nskill\nagent\nhook\ntheme" \
  | fzf --multi --height 40% --header "Components for $NAME (TAB=toggle, ENTER=confirm)")

if [ -z "$COMPONENTS" ]; then
  echo "No components selected. Creating base-only extension."
fi

# --- Scaffold base ---
mkdir -p "$TARGET"
cp -r "$SKELETON_DIR/base/." "$TARGET/"

# --- Add selected components ---
# component_subject <comp> — the generic-manifest subject key a skeleton
# component directory corresponds to, for the enablement flip below. Empty
# for mcp-server/theme, which merge a whole-fragment (mcpServers / gemini.themes)
# rather than toggling a components.<subject>.enabled boolean.
component_subject() {
  # "hook" is deliberately absent (spec 0179 R2): the generic `hooks`
  # section merged from hooks.json.fragment below is ALREADY the subject's
  # enablement (presence follows enablement — the same rule every other
  # generic subject in this schema follows), so there is no
  # components.hooks.enabled toggle to flip. Flipping one here would
  # resurrect exactly the "toggle that appears to resolve the subject and
  # does not" shape R2 forbids surviving anywhere.
  case "$1" in
    command) echo "commands" ;;
    skill)   echo "skills" ;;
    agent)   echo "agents" ;;
    *)       echo "" ;;
  esac
}

while IFS= read -r comp; do
  [ -z "$comp" ] && continue
  COMP_DIR="$SKELETON_DIR/$comp"
  if [ -d "$COMP_DIR" ]; then
    cp -r "$COMP_DIR/." "$TARGET/"
    echo "  Added: $comp"
    # Flip the matching components.<subject>.enabled toggle in the scaffolded
    # extension.json — the base skeleton ships every subject disabled, and
    # copying the component's files alone never turned it on (a pre-existing
    # gap: it silently never mattered for Gemini before spec 0173, since the
    # retired build-extension-pivot.sh discovered by commands/ directory
    # presence rather than by the manifest, and the plugin builders already
    # required this same flag). Under the render model every target now
    # reads it uniformly (scripts/lib/extension-manifest.sh
    # ext_subject_present), so a selected component that stays disabled would
    # render on no target at all.
    subj="$(component_subject "$comp")"
    if [ -n "$subj" ] && command -v jq >/dev/null 2>&1; then
      jq --arg s "$subj" '.components[$s].enabled = true' "$TARGET/extension.json" > "$TARGET/extension.json.tmp" \
        && mv "$TARGET/extension.json.tmp" "$TARGET/extension.json"
    fi
  fi
done <<< "$COMPONENTS"

# --- Replace ${SKELETON_NAME} placeholder ---
find "$TARGET" -type f | while read -r file; do
  if file "$file" | grep -q text; then
    sed -i.bak "s/\${SKELETON_NAME}/$NAME/g" "$file"
    rm -f "$file.bak"
  fi
done

# --- Merge MCP server config into the manifest if selected ---
# extension.json is the single generic root manifest (spec 0173 R1);
# gemini-extension.json is a BUILD output under the render-at-publication
# model (spec 0173 delta-01) and no longer exists in the skeleton (step 8),
# so the fragment merges the ONE manifest that exists. This is a hard break,
# not a preference: with no second manifest present, the prior two-manifest
# loop's `jq -s` would run against a non-existent first input and error under
# `set -e` (:2) on every scaffold selecting mcp-server or theme.
if echo "$COMPONENTS" | grep -q "mcp-server"; then
  FRAGMENT="$TARGET/mcp-server.json.fragment"
  if [ -f "$FRAGMENT" ] && command -v jq >/dev/null 2>&1; then
    MANIFEST="$TARGET/extension.json"
    jq -s '.[0] * .[1]' "$MANIFEST" "$FRAGMENT" > "$MANIFEST.tmp"
    mv "$MANIFEST.tmp" "$MANIFEST"
    rm -f "$FRAGMENT"
    echo "  Merged: MCP server config into extension.json"
  fi
fi

# --- Merge theme config into the manifest if selected ---
if echo "$COMPONENTS" | grep -q "theme"; then
  FRAGMENT="$TARGET/theme.json.fragment"
  if [ -f "$FRAGMENT" ] && command -v jq >/dev/null 2>&1; then
    MANIFEST="$TARGET/extension.json"
    jq -s '.[0] * .[1]' "$MANIFEST" "$FRAGMENT" > "$MANIFEST.tmp"
    mv "$MANIFEST.tmp" "$MANIFEST"
    rm -f "$FRAGMENT"
    echo "  Merged: theme config into extension.json"
  fi
fi

# --- Merge hook config into the manifest if selected (spec 0179 R17) ---
# The fragment mechanism is the ONLY correct target for the neutral `hooks`
# section: base/extension.json is copied unconditionally before this loop,
# so putting the section there would make every scaffolded extension declare
# a hook, violating R1 ("An extension that provides no hook SHALL omit the
# section entirely") and naming a handler absent from a scaffold that never
# selected `hook`.
if echo "$COMPONENTS" | grep -q "hook"; then
  FRAGMENT="$TARGET/hooks.json.fragment"
  if [ -f "$FRAGMENT" ] && command -v jq >/dev/null 2>&1; then
    MANIFEST="$TARGET/extension.json"
    jq -s '.[0] * .[1]' "$MANIFEST" "$FRAGMENT" > "$MANIFEST.tmp"
    mv "$MANIFEST.tmp" "$MANIFEST"
    rm -f "$FRAGMENT"
    echo "  Merged: hook config into extension.json"
  fi
fi

echo ""
echo "Extension created: extensions/$TIER/$NAME"
echo ""
echo "Next steps:"
echo "  cd extensions/$TIER/$NAME"
echo "  npm install"
echo "  task install-gemini-extension EXT=$NAME"
echo "  (debugging: task link-gemini-extension-build EXT=$NAME)"
