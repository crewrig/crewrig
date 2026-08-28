#!/bin/bash
# test-setup-gemini-md-cleanup.sh — Regression tests for cleanup of superseded
# ~/.gemini/GEMINI.md context file (spec 0061 delta-02, issue #1082).
#
# Hermetic unit tests asserting:
#   (1) Structural presence: setup-antigravity-interactive.sh and
#       setup-gemini-interactive.sh both check for <!-- crewrig-section: and remove GEMINI.md.
#   (2) Functional behavior:
#       - A crewrig-generated GEMINI.md containing `<!-- crewrig-section:` is removed.
#       - A custom user GEMINI.md lacking `<!-- crewrig-section:` is preserved.
#       - Absent GEMINI.md behaves idempotently.
#
# Usage:
#   bash scripts/tests/test-setup-gemini-md-cleanup.sh

set -uo pipefail

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
SETUP_ANTIGRAVITY="$REPO_DIR/scripts/setup-antigravity-interactive.sh"
SETUP_GEMINI="$REPO_DIR/scripts/setup-gemini-interactive.sh"

pass=0
fail=0
ok()  { echo "  ok: $1"; pass=$((pass + 1)); }
bad() { echo "  FAIL: $1" >&2; fail=$((fail + 1)); }

echo "1. Structural assertions in setup scripts"

for script in "$SETUP_ANTIGRAVITY" "$SETUP_GEMINI"; do
  sname="$(basename "$script")"
  if [ ! -f "$script" ]; then
    bad "$sname missing at $script"
    continue
  fi
  if grep -q "LEGACY_GEMINI_MD=" "$script" && grep -q "grep -q '<!-- crewrig-section:'" "$script"; then
    ok "$sname contains legacy GEMINI.md crewrig-section check and removal"
  else
    bad "$sname missing legacy GEMINI.md cleanup block"
  fi
done

echo ""
echo "2. Functional cleanup assertions"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

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
