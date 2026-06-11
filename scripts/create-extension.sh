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
while IFS= read -r comp; do
  [ -z "$comp" ] && continue
  COMP_DIR="$SKELETON_DIR/$comp"
  if [ -d "$COMP_DIR" ]; then
    cp -r "$COMP_DIR/." "$TARGET/"
    echo "  Added: $comp"
  fi
done <<< "$COMPONENTS"

# --- Replace ${SKELETON_NAME} placeholder ---
find "$TARGET" -type f | while read -r file; do
  if file "$file" | grep -q text; then
    sed -i.bak "s/\${SKELETON_NAME}/$NAME/g" "$file"
    rm -f "$file.bak"
  fi
done

# --- Merge MCP server config into manifest if selected ---
if echo "$COMPONENTS" | grep -q "mcp-server"; then
  FRAGMENT="$TARGET/mcp-server.json.fragment"
  if [ -f "$FRAGMENT" ] && command -v jq >/dev/null 2>&1; then
    jq -s '.[0] * .[1]' "$TARGET/gemini-extension.json" "$FRAGMENT" > "$TARGET/gemini-extension.json.tmp"
    mv "$TARGET/gemini-extension.json.tmp" "$TARGET/gemini-extension.json"
    rm -f "$FRAGMENT"
    echo "  Merged: MCP server config into manifest"
  fi
fi

# --- Merge theme config into manifest if selected ---
if echo "$COMPONENTS" | grep -q "theme"; then
  FRAGMENT="$TARGET/theme.json.fragment"
  if [ -f "$FRAGMENT" ] && command -v jq >/dev/null 2>&1; then
    jq -s '.[0] * .[1]' "$TARGET/gemini-extension.json" "$FRAGMENT" > "$TARGET/gemini-extension.json.tmp"
    mv "$TARGET/gemini-extension.json.tmp" "$TARGET/gemini-extension.json"
    rm -f "$FRAGMENT"
    echo "  Merged: theme config into manifest"
  fi
fi

echo ""
echo "Extension created: extensions/$TIER/$NAME"
echo ""
echo "Next steps:"
echo "  cd extensions/$TIER/$NAME"
echo "  npm install"
echo "  task link-extensions"
