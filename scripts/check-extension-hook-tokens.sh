#!/bin/bash
# check-extension-hook-tokens.sh — the R12 token check (spec 0179, issue
# #1005): asserts that ZERO neutral extension-root tokens survive in any
# emitted hook file, for every discovered extension, across every target's
# build output. Fails while naming each offending FILE and each SURVIVING
# OCCURRENCE within it — a file where the token appears twice must be named
# twice, not once, so a translator that substitutes only the first
# occurrence (v1-F10) cannot pass by accident.
#
# Scans the RENDERED outputs, never the sources — R12 is a property of what
# the render produces, not of what an author wrote.
#
# Renders a fresh --target all for every discovered extension itself, rather
# than assuming a prior step already left build outputs in place: the
# `--check` path's own cleanup (scripts/build-extension.sh's
# cleanup_stray_plugin_dist, EXIT-trapped on --check only) removes the
# plugin dist directories this check needs to read, so this check cannot
# assume anything survives a preceding `--check` step in the same job.
#
# Usage:
#   bash scripts/check-extension-hook-tokens.sh
#
# Exits 0 when no emitted hook file carries the neutral token; non-zero,
# naming every offending file and occurrence, otherwise.

set -uo pipefail

command -v jq >/dev/null 2>&1 || { echo "Error: jq is required." >&2; exit 2; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# shellcheck source=lib/extension-manifest.sh
. "$SCRIPT_DIR/lib/extension-manifest.sh"
# shellcheck source=lib/extension-hooks.sh
. "$SCRIPT_DIR/lib/extension-hooks.sh"

NEUTRAL_TOKEN='${extensionRoot}'
failures=0

check_file() {
  # check_file <path> — counts and names EVERY surviving occurrence, not
  # merely reporting that the file is offending.
  local path="$1" occurrences
  [ -f "$path" ] || return 0
  occurrences="$(grep -o -F "$NEUTRAL_TOKEN" "$path" 2>/dev/null | wc -l | tr -d ' ')"
  if [ "${occurrences:-0}" -gt 0 ]; then
    local i=1
    while [ "$i" -le "$occurrences" ]; do
      echo "  FAIL $path — surviving neutral token occurrence $i/$occurrences ('$NEUTRAL_TOKEN')"
      i=$((i + 1))
    done
    failures=$((failures + 1))
  fi
}

while IFS= read -r ext_dir; do
  [ -z "$ext_dir" ] && continue
  name="$(jq -r '.name' "$ext_dir/extension.json" 2>/dev/null)"
  [ -n "$name" ] && [ "$name" != "null" ] || continue

  bash "$SCRIPT_DIR/build-extension.sh" --target all "$ext_dir" >/dev/null 2>&1

  check_file "$REPO_DIR/build/extensions/$name/hooks/hooks.json"
  check_file "$ext_dir/dist-claude-plugin/$name/hooks/hooks.json"
  check_file "$REPO_DIR/dist-copilot-plugin/$name/hooks.json"
  check_file "$REPO_DIR/dist-antigravity-plugin/$name/hooks.json"
done < <(ext_discover_dirs "$REPO_DIR")

# --check-style cleanup: this script renders plugin dist trees purely to
# scan them, and must not leave that staging behind for other, unrelated
# scripts to trip over in a shared workspace (spec 0147 R5's fail-safe
# changeset-coverage job — the same class of hazard build-extension.sh's own
# cleanup_stray_plugin_dist exists for).
find "$REPO_DIR/extensions" -mindepth 3 -maxdepth 3 -type d -name 'dist-*-plugin' -exec rm -rf {} + 2>/dev/null || true

if [ "$failures" -gt 0 ]; then
  echo ""
  echo "FAILED: $failures emitted hook file(s) still carry the neutral extension-root token."
  exit 1
fi

echo "OK: no emitted hook file carries an unresolved neutral extension-root token."
