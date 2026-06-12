#!/bin/bash
# build-docs-index.sh — Generate the public documentation index manifest.
#
# Per spec 0027 (docs/publication-contract.md), every documentation page
# under docs/ carries a metadata block — a single HTML comment of the form
#
#   <!-- crewrig-doc: section=<s> nav_order=<n> published=<bool> title="..." -->
#
# placed immediately after the page H1. This script scans docs/**/*.md,
# parses each block, and emits docs/index.json: the machine-readable manifest
# of the PUBLIC documentation set (published pages only), grouped by section
# in the fixed eight-section order and sorted by nav_order then path.
#
# The emitter is deterministic (stable key order, fixed section order, stable
# page sort, trailing newline) so that re-running on an unchanged tree yields
# a byte-identical file — which is what makes --check reliable.
#
# Usage:
#   bash scripts/build-docs-index.sh            Regenerate docs/index.json.
#   bash scripts/build-docs-index.sh --check    Regenerate to a temp file,
#                                               diff against the committed
#                                               docs/index.json, exit non-zero
#                                               on drift. Runs the lint pass.
#
# Exit codes:
#   0  success (write succeeded, or --check found no drift)
#   1  lint failure (malformed block, missing field, unknown section,
#      forbidden character, orphan entry) or --check drift
#   2  usage error / cannot locate repo root

set -uo pipefail

# ---------------------------------------------------------------------------
# Locate the repository root (so the script works from any cwd).
# ---------------------------------------------------------------------------
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DOCS_DIR="$REPO_ROOT/docs"
INDEX_FILE="$REPO_ROOT/docs/index.json"

if [ ! -d "$DOCS_DIR" ]; then
  echo "Error: docs directory not found at $DOCS_DIR" >&2
  exit 2
fi

# ---------------------------------------------------------------------------
# Arguments.
# ---------------------------------------------------------------------------
CHECK=0
case "${1:-}" in
  "")        CHECK=0 ;;
  --check)   CHECK=1 ;;
  *)
    echo "Usage: $0 [--check]" >&2
    exit 2
    ;;
esac

# ---------------------------------------------------------------------------
# The fixed eight-section taxonomy (order is significant).
# ---------------------------------------------------------------------------
SECTION_KEYS=(introduction concepts adoption authoring lifecycle harness-engineering reference architecture-adr)
section_title() {
  case "$1" in
    introduction)         echo "Introduction" ;;
    concepts)             echo "Concepts" ;;
    adoption)             echo "Adoption" ;;
    authoring)            echo "Authoring" ;;
    lifecycle)            echo "Lifecycle" ;;
    harness-engineering)  echo "Harness engineering" ;;
    reference)            echo "Reference" ;;
    architecture-adr)     echo "Architecture & ADRs" ;;
    *)                    return 1 ;;
  esac
}
is_known_section() { section_title "$1" >/dev/null 2>&1; }

# ---------------------------------------------------------------------------
# Collected, validated, published rows: "<section>\t<nav_order>\t<path>\t<title>".
# ---------------------------------------------------------------------------
ROWS=()
LINT_ERRORS=()

# Extract the metadata block from a file. Echoes the inner payload (between
# "crewrig-doc:" and "-->"). Per the contract the block is the first crewrig-doc
# comment AFTER the page H1; anchoring to the post-H1 position prevents an
# earlier illustrative crewrig-doc line (e.g. the contract page's own examples)
# from being mis-parsed as the page's real block.
extract_block() {
  awk '
    !seen_h1 && /^# / { seen_h1 = 1; next }
    seen_h1 && /crewrig-doc:/ { print; exit }
  ' "$1" 2>/dev/null \
    | sed -E 's/^.*crewrig-doc:[[:space:]]*//; s/[[:space:]]*-->.*$//'
}

# Tokenize a metadata payload into KEY=VALUE pairs, honoring double-quoted
# values that may contain spaces. Populates the associative-style globals via
# the BLOCK_* convention. Returns 1 on a malformed token.
#
# bash 3.2 (macOS default) has no associative arrays, so we stash parsed
# fields in plain scalars.
parse_block() {
  local payload="$1" file="$2"
  BLOCK_section="" ; BLOCK_nav_order="" ; BLOCK_published="" ; BLOCK_title=""
  BLOCK_HAS_section=0 ; BLOCK_HAS_nav_order=0 ; BLOCK_HAS_published=0 ; BLOCK_HAS_title=0

  local rest="$payload"
  while [ -n "${rest// /}" ]; do
    # Strip leading whitespace.
    rest="${rest#"${rest%%[![:space:]]*}"}"
    [ -z "$rest" ] && break

    # Split off the key up to '='.
    case "$rest" in
      *=*) : ;;
      *)
        LINT_ERRORS+=("$file: malformed metadata token (no '='): '$rest'")
        return 1
        ;;
    esac
    local key="${rest%%=*}"
    rest="${rest#*=}"

    local value
    if [ "${rest:0:1}" = '"' ]; then
      # Quoted value: take up to the next unescaped double quote.
      rest="${rest:1}"
      case "$rest" in
        *'"'*) : ;;
        *)
          LINT_ERRORS+=("$file: unterminated quoted value for key '$key'")
          return 1
          ;;
      esac
      value="${rest%%\"*}"
      rest="${rest#*\"}"
    else
      # Bare token: up to the next space.
      value="${rest%%[[:space:]]*}"
      rest="${rest:${#value}}"
    fi

    # Forbidden characters inside any value.
    case "$value" in
      *'"'*|*'>'*)
        LINT_ERRORS+=("$file: value for key '$key' contains a forbidden '\"' or '>' character")
        return 1
        ;;
    esac

    case "$key" in
      section)   BLOCK_section="$value"   ; BLOCK_HAS_section=1 ;;
      nav_order) BLOCK_nav_order="$value" ; BLOCK_HAS_nav_order=1 ;;
      published) BLOCK_published="$value" ; BLOCK_HAS_published=1 ;;
      title)     BLOCK_title="$value"     ; BLOCK_HAS_title=1 ;;
      *)
        LINT_ERRORS+=("$file: unknown metadata key '$key'")
        return 1
        ;;
    esac
  done
  return 0
}

# JSON-escape a string (the grammar forbids " and >, so only \ and control
# chars remain a concern; back-slashes are not expected in titles/paths but
# we escape them defensively).
json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  printf '%s' "$s"
}

# ---------------------------------------------------------------------------
# Scan every docs/**/*.md, parse, validate, and collect published rows.
# ---------------------------------------------------------------------------
while IFS= read -r file; do
  rel="${file#"$REPO_ROOT"/}"

  payload="$(extract_block "$file")"
  if [ -z "$payload" ]; then
    # No metadata block at all. Per R12 the default is unpublished, but a
    # missing block means the page declared nothing — treat as unpublished
    # only if it is not expected to be published. We cannot know intent, so
    # a total absence is a lint error to force an explicit decision.
    LINT_ERRORS+=("$rel: no crewrig-doc metadata block found")
    continue
  fi

  if ! parse_block "$payload" "$rel"; then
    continue
  fi

  # published must be present and well-formed.
  if [ "$BLOCK_HAS_published" -ne 1 ]; then
    LINT_ERRORS+=("$rel: metadata block missing required field 'published'")
    continue
  fi
  case "$BLOCK_published" in
    true|false) : ;;
    *)
      LINT_ERRORS+=("$rel: 'published' must be 'true' or 'false', got '$BLOCK_published'")
      continue
      ;;
  esac

  if [ "$BLOCK_published" = "false" ]; then
    continue  # Unpublished: never enters the index. No further validation.
  fi

  # Published: all four fields required.
  miss=0
  [ "$BLOCK_HAS_title" -ne 1 ]     && { LINT_ERRORS+=("$rel: published page missing required field 'title'"); miss=1; }
  [ "$BLOCK_HAS_section" -ne 1 ]   && { LINT_ERRORS+=("$rel: published page missing required field 'section'"); miss=1; }
  [ "$BLOCK_HAS_nav_order" -ne 1 ] && { LINT_ERRORS+=("$rel: published page missing required field 'nav_order'"); miss=1; }
  [ "$miss" -ne 0 ] && continue

  if ! is_known_section "$BLOCK_section"; then
    LINT_ERRORS+=("$rel: unknown section '$BLOCK_section'")
    continue
  fi

  case "$BLOCK_nav_order" in
    ''|*[!0-9]*)
      LINT_ERRORS+=("$rel: nav_order must be a non-negative integer, got '$BLOCK_nav_order'")
      continue
      ;;
  esac

  ROWS+=("$BLOCK_section"$'\t'"$BLOCK_nav_order"$'\t'"$rel"$'\t'"$BLOCK_title")
done < <(find "$DOCS_DIR" -type f -name '*.md' | sort)

# ---------------------------------------------------------------------------
# Orphan check (committed manifest → file). A docs/index.json entry whose
# path does not resolve to a file is an orphan. (File → manifest drift is
# caught by the --check byte-diff below; absent published pages would change
# the regenerated output and fail the diff.)
# ---------------------------------------------------------------------------
if [ -f "$INDEX_FILE" ]; then
  while IFS= read -r p; do
    [ -z "$p" ] && continue
    if [ ! -f "$REPO_ROOT/$p" ]; then
      LINT_ERRORS+=("docs/index.json: entry path '$p' does not resolve to a file (orphan)")
    fi
  done < <(grep -oE '"path":[[:space:]]*"[^"]*"' "$INDEX_FILE" | sed -E 's/.*"path":[[:space:]]*"([^"]*)".*/\1/')
fi

# ---------------------------------------------------------------------------
# Fail fast on any lint error.
# ---------------------------------------------------------------------------
if [ "${#LINT_ERRORS[@]}" -gt 0 ]; then
  echo "Documentation publication contract violations:" >&2
  for e in "${LINT_ERRORS[@]}"; do
    echo "  - $e" >&2
  done
  exit 1
fi

# ---------------------------------------------------------------------------
# Emit the manifest deterministically.
# Sort rows: by section (in fixed taxonomy order, handled by iterating
# SECTION_KEYS), then nav_order (numeric), then path (lexicographic).
# ---------------------------------------------------------------------------
emit_index() {
  printf '{\n'
  printf '  "version": 1,\n'
  printf '  "sections": [\n'

  local first_section=1
  local sec
  for sec in "${SECTION_KEYS[@]}"; do
    # Gather rows for this section, sort by nav_order then path.
    local sec_rows=()
    local row
    for row in "${ROWS[@]}"; do
      [ "${row%%$'\t'*}" = "$sec" ] && sec_rows+=("$row")
    done
    [ "${#sec_rows[@]}" -eq 0 ] && continue

    # Sort: field 2 numeric (nav_order), then field 3 (path).
    local sorted=()
    while IFS= read -r row; do
      sorted+=("$row")
    done < <(printf '%s\n' "${sec_rows[@]}" | sort -t$'\t' -k2,2n -k3,3)

    if [ "$first_section" -eq 1 ]; then
      first_section=0
    else
      printf ',\n'
    fi
    printf '    {\n'
    printf '      "section": "%s",\n' "$(json_escape "$sec")"
    printf '      "title": "%s",\n' "$(json_escape "$(section_title "$sec")")"
    printf '      "pages": [\n'

    local first_page=1
    for row in "${sorted[@]}"; do
      local r_nav r_path r_title rest2
      rest2="${row#*$'\t'}"            # drop section
      r_nav="${rest2%%$'\t'*}"
      rest2="${rest2#*$'\t'}"          # drop nav_order
      r_path="${rest2%%$'\t'*}"
      r_title="${rest2#*$'\t'}"        # remainder is title

      if [ "$first_page" -eq 1 ]; then
        first_page=0
      else
        printf ',\n'
      fi
      printf '        {\n'
      printf '          "title": "%s",\n' "$(json_escape "$r_title")"
      printf '          "path": "%s",\n' "$(json_escape "$r_path")"
      printf '          "nav_order": %s\n' "$r_nav"
      printf '        }'
    done

    printf '\n      ]\n'
    printf '    }'
  done

  printf '\n  ]\n'
  printf '}\n'
}

# Note: $(...) strips trailing newlines, so we re-append the contract-mandated
# trailing newline explicitly when emitting the captured content.
GENERATED="$(emit_index)"

if [ "$CHECK" -eq 1 ]; then
  if [ ! -f "$INDEX_FILE" ]; then
    echo "Drift: docs/index.json is missing. Run: bash scripts/build-docs-index.sh" >&2
    exit 1
  fi
  if ! diff -u "$INDEX_FILE" <(printf '%s\n' "$GENERATED") >/dev/null 2>&1; then
    echo "Drift: docs/index.json is stale. Re-run: bash scripts/build-docs-index.sh" >&2
    diff -u "$INDEX_FILE" <(printf '%s\n' "$GENERATED") >&2 || true
    exit 1
  fi
  echo "OK: docs/index.json is up to date (${#ROWS[@]} published pages)."
  exit 0
fi

printf '%s\n' "$GENERATED" > "$INDEX_FILE"
echo "Wrote docs/index.json (${#ROWS[@]} published pages)."
