#!/bin/bash
# migrate-extension.sh — Convert an extension source tree from the retired
# declaration shape into the current generic-schema form (spec 0183 R15).
#
# Usage:
#   bash scripts/migrate-extension.sh <extension-dir-or-name>
#
# Accepts either a path or a bare extension name, resolved over the three
# tiers the same way scripts/build-extension.sh's resolve_extension_dir does
# (extensions/core → extensions/library → extensions/org, first match,
# hard error on a duplicate name).
#
# Reads the SAME enumeration ext_assert_current_shape reads
# (scripts/lib/extension-legacy-shape.json, spec 0183 R12) — neither this
# tool nor that reader carries its own list.
#
# Conversion:
#   - Each components.<subject> entry whose `enabled` is true becomes the
#     generic top-level <subject> section, carrying its surviving options
#     (every key but `enabled`). A disabled or absent entry is dropped with
#     nothing added. The `components` object is deleted entirely.
#   - The retired per-CLI keys are dropped, along with any per-CLI section
#     (gemini/claude/copilot/antigravity) they leave empty.
#   - Any committed member of the generated-output class
#     (scripts/lib/extension-generated-class.json) is de-committed: it is a
#     build output under the render-at-publication model and must not ship
#     in the source tree post-migration.
#
# The tool works on a TEMPORARY COPY and replaces the source tree only on
# full success: a tree it cannot fully convert is left byte-unchanged and
# the run fails, naming what it could not convert. A tree carrying none of
# the enumerated old-shape forms is reported as already migrated, and the
# tool writes nothing at all on that path.
#
# Prerequisites: jq

set -euo pipefail

command -v jq >/dev/null 2>&1 || { echo "Error: jq is required. Install with: brew install jq"; exit 1; }

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SHAPE_JSON="$REPO_DIR/scripts/lib/extension-legacy-shape.json"
GENERATED_CLASS_JSON="$REPO_DIR/scripts/lib/extension-generated-class.json"

if [ ! -f "$SHAPE_JSON" ]; then
  echo "Error: legacy-shape enumeration not found at $SHAPE_JSON (spec 0183 R12)." >&2
  exit 1
fi

EXT_ARG="${1:?Usage: migrate-extension.sh <extension-dir-or-name>}"

# --- Resolve the target tree (path, or bare name over the three tiers) -----
if [ -d "$EXT_ARG" ]; then
  EXT_DIR="$(cd "$EXT_ARG" && pwd)"
else
  EXT_DIR=""
  for tier in core library org; do
    if [ -d "$REPO_DIR/extensions/$tier/$EXT_ARG" ]; then
      if [ -n "$EXT_DIR" ]; then
        echo "Error: extension '$EXT_ARG' exists in multiple tiers; names must be unique." >&2
        exit 1
      fi
      EXT_DIR="$REPO_DIR/extensions/$tier/$EXT_ARG"
    fi
  done
  if [ -z "$EXT_DIR" ]; then
    echo "Error: extension directory or name '$EXT_ARG' not found." >&2
    exit 1
  fi
  EXT_DIR="$(cd "$EXT_DIR" && pwd)"
fi

MANIFEST="$EXT_DIR/extension.json"
if [ ! -f "$MANIFEST" ]; then
  echo "Error: No extension.json found in $EXT_DIR — nothing to migrate." >&2
  exit 1
fi

# --- Detect every enumerated old-shape form present in the manifest --------
COMPONENTS_KEY="$(jq -r '.componentsKey' "$SHAPE_JSON")"
has_components=false
if jq -e --arg k "$COMPONENTS_KEY" 'has($k) and (.[$k] != null)' "$MANIFEST" >/dev/null 2>&1; then
  has_components=true
fi

percli_hits=()
while IFS= read -r percli_key; do
  [ -z "$percli_key" ] && continue
  section="${percli_key%%.*}"
  key="${percli_key#*.}"
  if jq -e --arg s "$section" --arg k "$key" 'has($s) and (.[$s] // {} | has($k))' "$MANIFEST" >/dev/null 2>&1; then
    percli_hits+=("$percli_key")
  fi
done < <(jq -r '.perCliKeys[]' "$SHAPE_JSON")

generated_hits=()
if [ -f "$GENERATED_CLASS_JSON" ]; then
  while IFS= read -r rel; do
    [ -z "$rel" ] && continue
    [ -f "$EXT_DIR/$rel" ] && generated_hits+=("$rel")
  done < <(jq -r '.manifest_class[]' "$GENERATED_CLASS_JSON")
  while IFS= read -r glob; do
    [ -z "$glob" ] && continue
    for f in "$EXT_DIR"/$glob; do
      [ -f "$f" ] || continue
      generated_hits+=("${f#"$EXT_DIR"/}")
    done
  done < <(jq -r '.generated_globs[]' "$GENERATED_CLASS_JSON")
fi

if [ "$has_components" = "false" ] && [ "${#percli_hits[@]}" -eq 0 ] && [ "${#generated_hits[@]}" -eq 0 ]; then
  echo "Already migrated: $EXT_DIR carries none of the retired declaration forms."
  exit 0
fi

# --- Convert on a TEMPORARY COPY; the source tree is untouched until the
# --- conversion fully succeeds (R15).
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT
cp -a "$EXT_DIR/." "$WORK_DIR/"
WORK_MANIFEST="$WORK_DIR/extension.json"

unconverted=()

if [ "$has_components" = "true" ]; then
  while IFS= read -r subject; do
    [ -z "$subject" ] && continue
    enabled="$(jq -r --arg s "$subject" '.components[$s].enabled // false' "$WORK_MANIFEST")"
    if [ "$enabled" != "true" ]; then
      continue
    fi
    if jq -e --arg s "$subject" 'has($s) and (.[$s] != null)' "$WORK_MANIFEST" >/dev/null 2>&1; then
      unconverted+=("components.$subject (enabled) conflicts with an existing top-level '$subject' section")
      continue
    fi
    jq --arg s "$subject" '.[$s] = (.components[$s] | del(.enabled))' "$WORK_MANIFEST" > "$WORK_MANIFEST.tmp"
    mv "$WORK_MANIFEST.tmp" "$WORK_MANIFEST"
  done < <(jq -r '.componentsSubjects[]' "$SHAPE_JSON")

  if [ "${#unconverted[@]}" -eq 0 ]; then
    jq 'del(.components)' "$WORK_MANIFEST" > "$WORK_MANIFEST.tmp"
    mv "$WORK_MANIFEST.tmp" "$WORK_MANIFEST"
  fi
fi

if [ "${#unconverted[@]}" -eq 0 ] && [ "${#percli_hits[@]}" -gt 0 ]; then
  for percli_key in ${percli_hits[@]+"${percli_hits[@]}"}; do
    section="${percli_key%%.*}"
    key="${percli_key#*.}"
    jq --arg s "$section" --arg k "$key" \
      'if has($s) then .[$s] |= del(.[$k]) else . end' \
      "$WORK_MANIFEST" > "$WORK_MANIFEST.tmp"
    mv "$WORK_MANIFEST.tmp" "$WORK_MANIFEST"
  done
  # Drop any per-CLI section the deletions above left empty.
  for section in gemini claude copilot antigravity; do
    jq --arg s "$section" \
      'if (has($s) and (.[$s] | type == "object") and (.[$s] | length == 0)) then del(.[$s]) else . end' \
      "$WORK_MANIFEST" > "$WORK_MANIFEST.tmp"
    mv "$WORK_MANIFEST.tmp" "$WORK_MANIFEST"
  done
fi

if [ "${#unconverted[@]}" -eq 0 ]; then
  for rel in ${generated_hits[@]+"${generated_hits[@]}"}; do
    rm -f "$WORK_DIR/$rel"
  done
fi

if [ "${#unconverted[@]}" -gt 0 ]; then
  echo "Error: $EXT_DIR could not be fully converted; the source tree was left unchanged." >&2
  for item in ${unconverted[@]+"${unconverted[@]}"}; do
    echo "  - $item" >&2
  done
  exit 1
fi

# --- Replace the source tree with the converted copy on full success only --
find "$EXT_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
cp -a "$WORK_DIR/." "$EXT_DIR/"

echo "Migrated: $EXT_DIR"
if [ "$has_components" = "true" ]; then
  echo "  - converted the retired 'components' object to generic top-level sections"
fi
if [ "${#percli_hits[@]}" -gt 0 ]; then
  echo "  - dropped retired per-CLI keys: ${percli_hits[*]:-}"
fi
if [ "${#generated_hits[@]}" -gt 0 ]; then
  echo "  - de-committed generated-output-class file(s): ${generated_hits[*]:-}"
fi
exit 0
