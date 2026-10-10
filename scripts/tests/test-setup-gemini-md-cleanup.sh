#!/bin/bash
# test-setup-gemini-md-cleanup.sh — Regression tests for cleanup of superseded
# ~/.gemini/GEMINI.md context file (spec 0061 delta-02, issue #1082).
#
# Hermetic unit tests asserting:
#   (1) Declaration: the antigravity and gemini setup declarations both name
#       ~/.gemini/GEMINI.md as the legacy file and <!-- crewrig-section: as its marker.
#   (2) Functional behavior:
#       - A crewrig-generated GEMINI.md containing `<!-- crewrig-section:` is removed.
#       - A custom user GEMINI.md lacking `<!-- crewrig-section:` is preserved.
#       - Absent GEMINI.md behaves idempotently.
#
# Usage:
#   bash scripts/tests/test-setup-gemini-md-cleanup.sh

set -uo pipefail

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

pass=0
fail=0
ok()  { echo "  ok: $1"; pass=$((pass + 1)); }
bad() { echo "  FAIL: $1" >&2; fail=$((fail + 1)); }

echo "1. Declaration assertions (spec 0256 requirement 9, PR D1)"

# Retargeted from a grep of the two setup scripts' text to a read of the TypeScript setup
# DECLARATION (scripts/tests/lib/print-setup-declarations.ts): the setup declares the legacy
# context file it removes (`legacy.gemini-md`) and the marker that identifies a CrewRig-generated
# one (`legacy.marker`). Pin against the unchanged shell while it exists: the setup-golden cells
# gemini/legacy-gemini-md-marker and gemini/legacy-gemini-md-no-marker (same for antigravity's
# cleanup behaviour: antigravity/legacy-gemini-md-with-marker and -without-marker, which drive the
# real script end to end). Vacuity guard: an empty or unreadable
# declaration, or an absent fact, fails the case.
PRINT_DECL="$REPO_DIR/scripts/tests/lib/print-setup-declarations.ts"

for cli in antigravity gemini; do
  decl="$(node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON "$PRINT_DECL" "$cli" 2>/dev/null)"
  if [ -z "$decl" ]; then
    bad "$cli: the setup declaration printed nothing (vacuity guard)"
    continue
  fi
  legacy_file="$(printf '%s\n' "$decl" | grep '^legacy\.gemini-md=' | cut -d= -f2-)"
  legacy_marker="$(printf '%s\n' "$decl" | grep '^legacy\.marker=' | cut -d= -f2-)"
  if [ "$legacy_file" = "<HOME>/.gemini/GEMINI.md" ] && [ "$legacy_marker" = "<!-- crewrig-section:" ]; then
    ok "$cli declares the legacy GEMINI.md crewrig-section check and removal"
  else
    bad "$cli declaration lacks the legacy GEMINI.md cleanup (file='$legacy_file' marker='$legacy_marker')"
  fi
done

echo ""
echo "2. Functional cleanup assertions"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# D2 (static reads of behaviour): this helper re-implements the scripts' cleanup snippet instead of
# running the step; D2 retargets it to execute the TypeScript step. Until then the real behaviour
# stays pinned by the goldens gemini/legacy-gemini-md-marker and -no-marker.
# Helper running the cleanup snippet matching the scripts' implementation
run_cleanup_snippet() {
  local target_home="$1"
  local legacy_file="${target_home}/.gemini/GEMINI.md"
  if [ -f "$legacy_file" ] && grep -q '<!-- crewrig-section:' "$legacy_file" 2>/dev/null; then
    rm -f "$legacy_file"
  fi
}

# Case A: CrewRig-generated GEMINI.md is deleted
HOME_A="$TMP_DIR/home_a"
mkdir -p "$HOME_A/.gemini"
cat > "$HOME_A/.gemini/GEMINI.md" <<'MARKER'
<!-- crewrig-section: 00_SOUL.md -->
# SOUL.md - Agent Identity Blueprint
MARKER

run_cleanup_snippet "$HOME_A"
[ ! -f "$HOME_A/.gemini/GEMINI.md" ] \
  && ok "Case A: CrewRig-generated GEMINI.md is deleted" \
  || bad "Case A: CrewRig-generated GEMINI.md was not deleted"

# Case B: Custom user GEMINI.md without marker is preserved
HOME_B="$TMP_DIR/home_b"
mkdir -p "$HOME_B/.gemini"
cat > "$HOME_B/.gemini/GEMINI.md" <<'CUSTOM'
# My Custom Gemini Rules
Always use strict types.
CUSTOM

run_cleanup_snippet "$HOME_B"
[ -f "$HOME_B/.gemini/GEMINI.md" ] \
  && ok "Case B: Custom user GEMINI.md is preserved" \
  || bad "Case B: Custom user GEMINI.md was deleted"

# Case C: Absent GEMINI.md executes cleanly
HOME_C="$TMP_DIR/home_c"
mkdir -p "$HOME_C/.gemini"

run_cleanup_snippet "$HOME_C"
[ ! -f "$HOME_C/.gemini/GEMINI.md" ] \
  && ok "Case C: Absent GEMINI.md completes cleanly" \
  || bad "Case C: Unexpected state for absent GEMINI.md"

echo ""
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
