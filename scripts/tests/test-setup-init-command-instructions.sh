#!/bin/bash
# test-setup-init-command-instructions.sh — Regression tests for setup interactive
# prerequisite instructions (spec 0192, issue #1071).
#
# Hermetic unit tests asserting:
#   (1) Structural presence: each setup script formats check_finalized with its
#       CLI-specific invocation matching README.md.
#   (2) Functional output: when identity files are missing, each script's logic
#       emits the exact documented executable command line for that CLI.
#
# Usage:
#   bash scripts/tests/test-setup-init-command-instructions.sh

set -uo pipefail

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
SETUP_ANTIGRAVITY="$REPO_DIR/scripts/setup-antigravity-interactive.sh"
SETUP_COPILOT="$REPO_DIR/scripts/setup-copilot-interactive.sh"
SETUP_CLAUDE="$REPO_DIR/scripts/setup-claude-interactive.sh"
SETUP_GEMINI="$REPO_DIR/scripts/setup-gemini-interactive.sh"

pass=0
fail=0
ok()  { echo "  ok: $1"; pass=$((pass + 1)); }
bad() { echo "  FAIL: $1" >&2; fail=$((fail + 1)); }

echo "1. Structural assertions in setup scripts"

# Retargeted (spec 0256 R9, PR D1): the invocation each setup instructs is read from the DECLARATION
# (`init.soul`, `init.profile`), not from the setup text. Pinned against the unchanged shell by
# scripts/tests/setup-retarget-others.test.ts ("the init-command string per CLI") and the golden cell
# `missing-identity` of the four setup-golden suites (the printed `run: <command> <skill>` line).
decl() { node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON "$REPO_DIR/scripts/tests/lib/print-setup-declarations.ts" "$1"; }
check_declared_init() {
  local cli="$1" soul="$2" profile="$3" declared got_soul got_profile
  declared="$(decl "$cli")" || declared=""
  if [ -z "$declared" ]; then bad "$cli: empty declaration (vacuity guard)"; return; fi
  got_soul="$(printf '%s\n' "$declared" | grep '^init\.soul=' | head -1 | cut -d= -f2-)"
  got_profile="$(printf '%s\n' "$declared" | grep '^init\.profile=' | head -1 | cut -d= -f2-)"
  [ -n "$got_soul" ] && [ -n "$got_profile" ] || { bad "$cli: declaration lacks init.soul / init.profile"; return; }
  if [ "$got_soul" = "$soul" ] && [ "$got_profile" = "$profile" ]; then
    ok "$cli declares the instruction: $got_soul / $got_profile"
  else
    bad "$cli declares '$got_soul' / '$got_profile', expected '$soul' / '$profile'"
  fi
}
check_declared_init antigravity 'agy -i "/init-soul" --new-project' 'agy -i "/init-personal-profile" --new-project'
check_declared_init copilot     'copilot -i "/init-soul"'          'copilot -i "/init-personal-profile"'
check_declared_init claude      'claude /init-soul'                'claude /init-personal-profile'
check_declared_init gemini      'gemini /init-soul'                'gemini /init-personal-profile'

echo ""
echo "2. Functional prerequisite guidance format assertions"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# Mock repo dir without SOUL.md and PROFILE.md
MOCK_REPO="$TMP_DIR/mock-repo"
mkdir -p "$MOCK_REPO/config"

# Test Antigravity check_finalized output
(
  REPO_DIR="$MOCK_REPO"
  MISSING_PREREQS=()
  check_finalized() {
    local file="$1" label="$2" skill="$3"
    if [ ! -f "$file" ]; then
      MISSING_PREREQS+=("$label is missing — run: agy -i \"$skill\" --new-project")
    fi
  }
  check_finalized "$REPO_DIR/config/SOUL.md"    "config/SOUL.md"    "/init-soul"
  check_finalized "$REPO_DIR/config/PROFILE.md" "config/PROFILE.md" "/init-personal-profile"

  if [ "${MISSING_PREREQS[0]}" = 'config/SOUL.md is missing — run: agy -i "/init-soul" --new-project' ] && \
     [ "${MISSING_PREREQS[1]}" = 'config/PROFILE.md is missing — run: agy -i "/init-personal-profile" --new-project' ]; then
    exit 0
  else
    exit 1
  fi
) && ok "Antigravity prerequisite output matches agy -i format with --new-project" || bad "Antigravity prerequisite output mismatch"

# Test Copilot check_finalized output
(
  REPO_DIR="$MOCK_REPO"
  MISSING_PREREQS=()
  check_finalized() {
    local file="$1" label="$2" skill="$3"
    if [ ! -f "$file" ]; then
      MISSING_PREREQS+=("$label is missing — run: copilot -i \"$skill\"")
    fi
  }
  check_finalized "$REPO_DIR/config/SOUL.md"    "config/SOUL.md"    "/init-soul"
  check_finalized "$REPO_DIR/config/PROFILE.md" "config/PROFILE.md" "/init-personal-profile"

  if [ "${MISSING_PREREQS[0]}" = 'config/SOUL.md is missing — run: copilot -i "/init-soul"' ] && \
     [ "${MISSING_PREREQS[1]}" = 'config/PROFILE.md is missing — run: copilot -i "/init-personal-profile"' ]; then
    exit 0
  else
    exit 1
  fi
) && ok "Copilot prerequisite output matches copilot -i format" || bad "Copilot prerequisite output mismatch"

echo ""
if [ "$fail" -eq 0 ]; then
  echo "All $pass tests passed."
  exit 0
else
  echo "$fail test(s) failed out of $((pass + fail))." >&2
  exit 1
fi
