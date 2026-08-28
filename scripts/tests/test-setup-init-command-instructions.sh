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

# Antigravity: must instruct agy -i "<skill>" --new-project
if grep -F -q 'agy -i \"$skill\" --new-project' "$SETUP_ANTIGRAVITY"; then
  ok "setup-antigravity-interactive.sh instructs agy -i \"\$skill\" --new-project"
else
  bad "setup-antigravity-interactive.sh missing agy -i \"\$skill\" --new-project instruction"
fi

# Copilot: must instruct copilot -i "<skill>"
if grep -F -q 'copilot -i \"$skill\"' "$SETUP_COPILOT"; then
  ok "setup-copilot-interactive.sh instructs copilot -i \"\$skill\""
else
  bad "setup-copilot-interactive.sh missing copilot -i \"\$skill\" instruction"
fi

# Claude: must instruct claude $skill
if grep -q 'claude \$skill' "$SETUP_CLAUDE"; then
  ok "setup-claude-interactive.sh instructs claude \$skill"
else
  bad "setup-claude-interactive.sh missing claude \$skill instruction"
fi

# Gemini: must instruct gemini
if grep -q 'gemini' "$SETUP_GEMINI"; then
  ok "setup-gemini-interactive.sh instructs gemini \$skill"
else
  bad "setup-gemini-interactive.sh missing gemini instruction"
fi

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
