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
# Every offered component now merges a whole-fragment (spec 0183 R1, PLAN
# step 23) into the generic top-level manifest, the same mechanism
# mcp-server/theme/hook already used before this change — there is no
# components.<subject>.enabled toggle left to flip (the retired shape no
# longer exists in the base skeleton at all), so selecting a component adds
# its generic section by PRESENCE alone (spec 0173 R5). This also makes R4
# hold by construction: the tool writes no tool-designated file, because the
# skeleton no longer contains one.
while IFS= read -r comp; do
  [ -z "$comp" ] && continue
  COMP_DIR="$SKELETON_DIR/$comp"
  if [ -d "$COMP_DIR" ]; then
    cp -r "$COMP_DIR/." "$TARGET/"
    echo "  Added: $comp"
  fi
done <<< "$COMPONENTS"

# --- Replace ${SKELETON_NAME} placeholder (spec 0183 R3, absorbs #1010) ---
# is_text_carrying <path> — a NUL-byte predicate (`grep -I`, portable across
# GNU/BSD/ugrep): a file with no NUL byte is text-carrying and gets
# substituted, REGARDLESS of what a content-type heuristic like `file`
# reports. This replaces the prior `file "$path" | grep -q text` classifier,
# which macOS `file` 5.41 defeats on every committed JSON manifest — it
# reports "JSON data", containing no "text" substring, so the prior
# heuristic silently skipped every extension.json and package.json in the
# skeleton, leaving ${SKELETON_NAME} literals standing in every scaffolded
# manifest (issue #1010, absorbed here).
is_text_carrying() {
  grep -Iq '' "$1" 2>/dev/null
}

find "$TARGET" -type f | while IFS= read -r file; do
  if is_text_carrying "$file"; then
    sed -i.bak "s/\${SKELETON_NAME}/$NAME/g" "$file"
    rm -f "$file.bak"
  fi
done

# The placeholder SET for the final produced-tree assertion (below, after
# every fragment merge) is derived by scanning extension-skeleton/ itself
# for every ${SKELETON_*} token any skeleton file actually uses today — not
# hard-coded as the single literal ${SKELETON_NAME} — so a later addition to
# that family is covered with no code change here.
PLACEHOLDER_TOKENS="$(grep -rhoE '\$\{SKELETON_[A-Za-z0-9_]*\}' "$SKELETON_DIR" 2>/dev/null | sort -u)"

# --- Merge command config into the manifest if selected (spec 0183 R1) ---
# Fragment mechanism, not the retired components.commands.enabled toggle:
# base/extension.json declares no `commands` section at all, so a scaffold
# that never selected `command` stays subjectless on this axis (R1's "a
# scaffold that declares no subject at all SHALL remain a valid extension").
if echo "$COMPONENTS" | grep -q "command"; then
  FRAGMENT="$TARGET/command.json.fragment"
  if [ -f "$FRAGMENT" ] && command -v jq >/dev/null 2>&1; then
    MANIFEST="$TARGET/extension.json"
    jq -s '.[0] * .[1]' "$MANIFEST" "$FRAGMENT" > "$MANIFEST.tmp"
    mv "$MANIFEST.tmp" "$MANIFEST"
    rm -f "$FRAGMENT"
    echo "  Merged: command config into extension.json"
  fi
fi

# --- Merge skill config into the manifest if selected (spec 0183 R1) ---
if echo "$COMPONENTS" | grep -q "skill"; then
  FRAGMENT="$TARGET/skill.json.fragment"
  if [ -f "$FRAGMENT" ] && command -v jq >/dev/null 2>&1; then
    MANIFEST="$TARGET/extension.json"
    jq -s '.[0] * .[1]' "$MANIFEST" "$FRAGMENT" > "$MANIFEST.tmp"
    mv "$MANIFEST.tmp" "$MANIFEST"
    rm -f "$FRAGMENT"
    echo "  Merged: skill config into extension.json"
  fi
fi

# --- Merge agent config into the manifest if selected (spec 0183 R1/R6) ---
if echo "$COMPONENTS" | grep -q "agent"; then
  FRAGMENT="$TARGET/agent.json.fragment"
  if [ -f "$FRAGMENT" ] && command -v jq >/dev/null 2>&1; then
    MANIFEST="$TARGET/extension.json"
    jq -s '.[0] * .[1]' "$MANIFEST" "$FRAGMENT" > "$MANIFEST.tmp"
    mv "$MANIFEST.tmp" "$MANIFEST"
    rm -f "$FRAGMENT"
    echo "  Merged: agent config into extension.json"
  fi
fi

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

# --- Assert unconditionally that no placeholder literal survives (R3) -----
# Runs against the FULLY merged, produced tree — after every fragment merge
# above — not only the raw substitution pass, so a placeholder a future
# fragment happens to carry is caught here too. On any failure the partly
# written target directory is removed (R3's own failure contract).
PLACEHOLDER_SURVIVORS=0
while IFS= read -r token; do
  [ -z "$token" ] && continue
  while IFS= read -r file; do
    [ -z "$file" ] && continue
    is_text_carrying "$file" || continue
    if grep -qF "$token" "$file" 2>/dev/null; then
      echo "Error: placeholder $token survives in $file" >&2
      PLACEHOLDER_SURVIVORS=$((PLACEHOLDER_SURVIVORS + 1))
    fi
  done < <(find "$TARGET" -type f)
done <<< "$PLACEHOLDER_TOKENS"

if [ "$PLACEHOLDER_SURVIVORS" -gt 0 ]; then
  echo "Error: $PLACEHOLDER_SURVIVORS placeholder occurrence(s) survived substitution; removing the partly-written $TARGET." >&2
  rm -rf "$TARGET"
  exit 1
fi
echo "  No placeholder literal survives in $TARGET."

# --- Derive the scaffold's gap declaration from a real render (spec 0183 R2) ---
# Run once, --target all, from the repository root, so ext_discover_dirs and
# ext_gap_dir resolve exactly as they do for every other invocation. A
# scaffold whose declarations all map on every target observes no gap and
# gets no accepted-gaps.json at all — a DERIVED file can never disagree with
# the render it is compared against, unlike a static, hand-authored one.
echo ""
echo "Rendering the scaffold once to derive its gap declaration..."
(cd "$REPO_DIR" && bash scripts/build-extension.sh --target all "$NAME" >/dev/null 2>&1)
GAP_DIR="$REPO_DIR/build/gaps/$NAME"
OBSERVED_GAPS="$GAP_DIR/observed-gaps.json"
if [ -f "$OBSERVED_GAPS" ] && command -v jq >/dev/null 2>&1 && [ "$(jq 'length' "$OBSERVED_GAPS" 2>/dev/null)" != "0" ]; then
  cp "$OBSERVED_GAPS" "$TARGET/accepted-gaps.json"
  echo ""
  echo "=============================================================="
  echo " REVIEW: this scaffold declares a gap the render could not map."
  echo " extensions/$TIER/$NAME/accepted-gaps.json was DERIVED from the"
  echo " render's own observed gap set below. Review each entry before"
  echo " committing it — it is a starting point, not a rubber stamp."
  echo "=============================================================="
  jq -r '.[] | "  - " + .subject + " on " + .target + (if .hook then " (hook: " + .hook + ")" else "" end) + ": " + .reason' "$TARGET/accepted-gaps.json"
fi
# Stray plugin staging directories (spec 0173Δ, mirrors --check's own
# cleanup_stray_plugin_dist): a --target all render for gap derivation
# stages the three plugin builders' output inside the scaffold's own
# directory (extensions/$TIER/$NAME/dist-*-plugin/); this scaffolding run
# has no downstream consumer for them, so they are swept immediately rather
# than left as day-one clutter in a freshly created extension.
rm -rf "$TARGET/dist-claude-plugin" "$TARGET/dist-copilot-plugin" "$TARGET/dist-antigravity-plugin"

echo ""
echo "Extension created: extensions/$TIER/$NAME"
echo ""
echo "Next steps:"
echo "  cd extensions/$TIER/$NAME"
echo "  npm install"
echo "  task install-gemini-extension EXT=$NAME"
echo "  (debugging: task link-gemini-extension-build EXT=$NAME)"
