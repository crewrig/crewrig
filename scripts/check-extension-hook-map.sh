#!/bin/bash
# check-extension-hook-map.sh — the R6 agreement check (spec 0179, issue
# #1005): asserts that docs/extension-hook-events.md and
# scripts/lib/extension-hooks.sh's ACTUAL translation agree, from TWO
# independent representations:
#
#   (a) the published table, parsed as data;
#   (b) the translator's own emitted output, derived by EXECUTING it — a
#       synthetic probe manifest declaring one hook per event in the
#       translator's closed set (ext_hooks_known_events, enumerated AT
#       CHECK TIME — not a hand-written fixture, which is what makes the
#       growth mutation in the opposite direction constructible), rendered
#       per target directly via ext_hooks_render, never through the whole
#       build-extension.sh pipeline.
#
# This is deliberately NOT a single shared source: if the table and the
# translator both read the same data, changing either one alone could never
# make the two disagree, and the check would be vacuous by construction
# (spec 0179 -> Alternatives considered and rejected). The DOMAIN comes from
# the translator (ext_hooks_known_events); the CODOMAIN comes from
# execution (the rendered file); the table is the independent third party
# both are checked against.
#
# ALSO reconciles the artifact's per-target header cells (hook file, time
# unit, root-token form) against scripts/lib/extension-targets.json's
# descriptor — two places holding one fact drift apart unless something
# compares them (spec 0179 R5 obliges the artifact to record them per
# column; the descriptor now holds the same facts for the render).
#
# The probe manifest is built in a mktemp -d OUTSIDE extensions/, so
# ext_discover_dirs never sees it and no accepted-gaps.json is needed for
# whatever gaps the probe's own maximal declaration produces (e.g.
# UserPromptSubmit has no Antigravity counterpart) — this check never
# touches build-extension.sh's gap machinery, only ext_hooks_render.
#
# R5 (this check MUST run against the committed table, the descriptor and
# the translator, and must NEVER invoke a CLI, or the extension-render job
# becomes unrunnable): true here — this script never shells out to claude,
# gemini, agy or copilot; it only calls this repository's own translator.
#
# Usage:
#   bash scripts/check-extension-hook-map.sh

set -uo pipefail

command -v jq >/dev/null 2>&1 || { echo "Error: jq is required." >&2; exit 2; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DOC="$REPO_DIR/docs/extension-hook-events.md"
TARGETS_JSON="$SCRIPT_DIR/lib/extension-targets.json"

# shellcheck source=lib/extension-hooks.sh
. "$SCRIPT_DIR/lib/extension-hooks.sh"

[ -f "$DOC" ] || { echo "Error: $DOC not found." >&2; exit 2; }

TARGET_LIST="claude gemini copilot antigravity"
failures=0

# --- Parse (a): the published correspondence table --------------------

# table_cell <neutral-event> <target> — echoes the table's own cell value
# for <target> (empty if the row names no counterpart), or nothing if the
# table carries no row for <neutral-event> at all.
table_row_line() {
  local event="$1"
  grep -F "| \`$event\` |" "$DOC" | head -1
}

table_cell() {
  local event="$1" target="$2" line col
  line="$(table_row_line "$event")"
  [ -n "$line" ] || return 0
  case "$target" in
    claude) col=2 ;;
    gemini) col=3 ;;
    copilot) col=4 ;;
    antigravity) col=5 ;;
  esac
  # Column N of a "| a | b | c | d | e |" row, backtick-stripped; a
  # no-counterpart cell (no backticks) yields the empty string.
  awk -F'|' -v c="$((col + 1))" '{gsub(/^ +| +$/, "", $c); print $c}' <<< "$line" \
    | sed 's/`//g'
}

# --- Build the probe manifest from the TRANSLATOR's own closed set -----

PROBE_ROOT="$(mktemp -d)"
trap 'rm -rf "$PROBE_ROOT"' EXIT
PROBE_MANIFEST="$PROBE_ROOT/extension.json"

hooks_json="$(
  ext_hooks_known_events | while IFS= read -r ev; do
    [ -z "$ev" ] && continue
    jq -c -n --arg id "${ev}-probe" --arg event "$ev" '{id: $id, event: $event, command: "echo hi"}'
  done | jq -s '.'
)"
jq -n --argjson hooks "$hooks_json" '{name: "hook-map-probe", version: "0.0.1", description: "R6 agreement probe", hooks: $hooks}' > "$PROBE_MANIFEST"

# --- Direction 1: every event in the translator's closed set has a table row, and the table agrees with what the render actually emits ---

while IFS= read -r event; do
  [ -z "$event" ] && continue
  row="$(table_row_line "$event")"
  if [ -z "$row" ]; then
    echo "  FAIL $DOC — no row for neutral event '$event', which is in the translator's closed set (scripts/lib/extension-hooks.sh)"
    failures=$((failures + 1))
    continue
  fi

  for target in $TARGET_LIST; do
    out_dir="$PROBE_ROOT/out-$target"
    mkdir -p "$out_dir"
    ext_hooks_render "$target" "$PROBE_MANIFEST" "$PROBE_ROOT" "$out_dir"

    hook_file_rel="$(_ext_hooks_target_const "$target" hookFile)"
    hook_file="$out_dir/$hook_file_rel"
    produced_events=""
    if [ -f "$hook_file" ]; then
      case "$target" in
        antigravity)
          produced_events="$(jq -r '.[keys[0]] // {} | keys[]' "$hook_file" 2>/dev/null)"
          ;;
        *)
          produced_events="$(jq -r '.hooks // {} | keys[]' "$hook_file" 2>/dev/null)"
          ;;
      esac
    fi

    cell="$(table_cell "$event" "$target")"
    target_event_actual="$(_ext_hooks_target_event "$event" "$target")"

    if [ -z "$cell" ] || [ "$cell" = "**no counterpart**" ] || [ "$cell" = "no counterpart" ]; then
      # Table says no counterpart: the render must NOT have produced this
      # event's key for this target either.
      if [ -n "$target_event_actual" ]; then
        echo "  FAIL $DOC — table cell (event '$event', target '$target') says no counterpart, but the translator DOES produce '$target_event_actual'"
        failures=$((failures + 1))
      fi
      continue
    fi

    if [ "$cell" != "$target_event_actual" ]; then
      echo "  FAIL disagreement (event '$event', target '$target') — table says '$cell', translator's mapping function says '$target_event_actual'"
      failures=$((failures + 1))
      continue
    fi

    if ! grep -qxF "$cell" <<< "$produced_events"; then
      echo "  FAIL disagreement (event '$event', target '$target') — table and translator mapping both say '$cell', but the RENDERED output does not carry that event key (produced: ${produced_events:-<none>})"
      failures=$((failures + 1))
    fi
  done
done < <(ext_hooks_known_events)

# --- Direction 2: every table row names an event the translator recognizes (mutation 24c) ---
#
# Scoped to the "## Correspondence table" section ONLY — the doc's separate
# "Neutral tool-class matcher" table also has rows shaped "| `x` | ... |",
# and is out of scope for R6's event mapping (matcher classes are their own,
# smaller, concern).

correspondence_section="$(awk '
  $0 == "## Correspondence table" { found=1; next }
  found && /^## / { exit }
  found { print }
' "$DOC")"

while IFS= read -r line; do
  [ -z "$line" ] && continue
  row_event="$(sed -n 's/^| `\([^`]*\)` |.*/\1/p' <<< "$line")"
  [ -n "$row_event" ] || continue
  if ! ext_hooks_known_events | grep -qxF "$row_event"; then
    echo "  FAIL $DOC — row names event '$row_event', which the translator does not recognize (scripts/lib/extension-hooks.sh)"
    failures=$((failures + 1))
  fi
done < <(grep -E '^\| `' <<< "$correspondence_section")

# --- Reconciliation: per-target header cells vs the descriptor (v3-F1) ---

for target in $TARGET_LIST; do
  section_header="$(
    case "$target" in
      claude) echo "### Claude Code" ;;
      gemini) echo "### Gemini CLI" ;;
      copilot) echo "### GitHub Copilot CLI" ;;
      antigravity) echo "### Antigravity CLI" ;;
    esac
  )"
  section="$(awk -v h="$section_header" '
    $0 == h { found=1; next }
    found && /^### / { exit }
    found { print }
  ' "$DOC")"

  doc_hook_file="$(grep -m1 '\*\*Hook file:\*\*' <<< "$section" | sed -n 's/[^`]*`\([^`]*\)`.*/\1/p')"
  desc_hook_file="$(_ext_hooks_target_const "$target" hookFile)"
  if [ "$doc_hook_file" != "$desc_hook_file" ]; then
    echo "  FAIL reconciliation ($target) — docs/extension-hook-events.md hook file is '$doc_hook_file', scripts/lib/extension-targets.json hookFile is '$desc_hook_file'"
    failures=$((failures + 1))
  fi

  doc_time_unit="$(grep -m1 '\*\*Time unit:\*\*' <<< "$section" | sed -n 's/.*\*\*Time unit:\*\* \([a-z]*\).*/\1/p')"
  desc_time_unit="$(_ext_hooks_target_const "$target" timeUnit)"
  if [ "$doc_time_unit" != "$desc_time_unit" ]; then
    echo "  FAIL reconciliation ($target) — docs/extension-hook-events.md time unit is '$doc_time_unit', scripts/lib/extension-targets.json timeUnit is '$desc_time_unit'"
    failures=$((failures + 1))
  fi

  doc_root_token="$(grep -m1 '\*\*Extension-root form:\*\*' <<< "$section" | sed -n 's/[^`]*`\([^`]*\)`.*/\1/p')"
  desc_root_token="$(_ext_hooks_target_const "$target" rootToken)"
  if [ "$doc_root_token" != "$desc_root_token" ]; then
    echo "  FAIL reconciliation ($target) — docs/extension-hook-events.md extension-root form is '$doc_root_token', scripts/lib/extension-targets.json rootToken is '$desc_root_token'"
    failures=$((failures + 1))
  fi
done

if [ "$failures" -gt 0 ]; then
  echo ""
  echo "FAILED: $failures disagreement(s) between docs/extension-hook-events.md and scripts/lib/extension-hooks.sh / scripts/lib/extension-targets.json."
  exit 1
fi

echo "OK: docs/extension-hook-events.md agrees with the translator's actual output and with scripts/lib/extension-targets.json."
