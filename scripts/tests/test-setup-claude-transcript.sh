#!/bin/bash
# test-setup-claude-transcript.sh — Regression tests for Claude Code transcript
# and worktree git guard hook manifest wiring (spec 0169, issue #990).
#
# Unit under test:
#   - hooks/claude-transcript-hooks.json (the shipped manifest)
#   - the jq transform that scripts/setup-claude-interactive.sh applies to the
#     manifest at setup time.
#
# Contract asserted:
#   R1 — the shipped manifest is valid JSON containing PreToolUse (guard) and
#        lifecycle event hooks (transcripts).
#   R2 — the setup transform rewrites mempalace-transcript.sh to the installed
#        target path and worktree-git-guard.sh to the in-repo absolute path.
#   R3 — zero $CLAUDE_PROJECT_DIR placeholder tokens survive in the patched output.
#
# HERMETIC: no HOME writes, no network, no interactive script runs. All
# transforms target throwaway paths under a temp root removed on exit.
#
# Usage:
#   bash scripts/tests/test-setup-claude-transcript.sh

set -uo pipefail

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
MANIFEST="$REPO_DIR/hooks/claude-transcript-hooks.json"
SETUP="$REPO_DIR/scripts/setup-claude-interactive.sh"

for f in "$MANIFEST" "$SETUP"; do
  [ -f "$f" ] || { echo "FATAL: missing $f" >&2; exit 2; }
done
command -v jq >/dev/null 2>&1 || { echo "FATAL: jq is required for this test" >&2; exit 2; }

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

pass=0
fail=0
ok()  { echo "  ok: $1"; pass=$((pass + 1)); }
bad() { echo "  FAIL: $1" >&2; fail=$((fail + 1)); }

# ---------------------------------------------------------------------------
# §1. The shipped manifest is valid JSON with expected structure (R1).
# ---------------------------------------------------------------------------
echo "§1 manifest schema (R1)"

if jq -e . "$MANIFEST" >/dev/null 2>&1; then
  ok "manifest is valid JSON"
else
  bad "manifest is not valid JSON"
fi

if [ "$(jq -r '.hooks | type' "$MANIFEST" 2>/dev/null)" = "object" ]; then
  ok "hooks is an object"
else
  bad "hooks is not an object"
fi

guard_raw="$(jq -r '.hooks.PreToolUse[0].hooks[0].command // ""' "$MANIFEST" 2>/dev/null)"
if [[ "$guard_raw" == *"\$CLAUDE_PROJECT_DIR/hooks/worktree-git-guard.sh"* ]]; then
  ok "PreToolUse declares worktree-git-guard.sh with project token"
else
  bad "PreToolUse missing expected guard command (got: $guard_raw)"
fi

# ---------------------------------------------------------------------------
# §2. Replay the setup patch transform (R2, R3).
# ---------------------------------------------------------------------------
echo "§2 setup patch transform (R2, R3)"
HOOK_TARGET="$TMP_ROOT/claude/hooks/mempalace-transcript.sh"
GUARD_TARGET="$REPO_DIR/hooks/worktree-git-guard.sh"
PATCHED="$TMP_ROOT/patched.json"

jq --arg hook_path "$HOOK_TARGET" --arg guard_path "$GUARD_TARGET" \
  '(.. | objects | select(.type? == "command") | .command) |=
     (gsub("\\$CLAUDE_PROJECT_DIR/hooks/mempalace-transcript.sh"; $hook_path) |
      gsub("\\$CLAUDE_PROJECT_DIR/hooks/worktree-git-guard.sh"; $guard_path))' \
  "$MANIFEST" > "$PATCHED" 2>/dev/null

if jq -e . "$PATCHED" >/dev/null 2>&1; then
  ok "patched output is valid JSON"
else
  bad "patched output is not valid JSON"
fi

# PreToolUse must point to the guard script in-repo
guard_patched="$(jq -r '.hooks.PreToolUse[0].hooks[0].command // ""' "$PATCHED" 2>/dev/null)"
if [[ "$guard_patched" == *"\"$GUARD_TARGET\""* ]]; then
  ok "PreToolUse rewritten to in-repo guard target"
else
  bad "PreToolUse not rewritten to in-repo guard target (got: $guard_patched)"
fi

# Lifecycle events must point to installed transcript hook
lifecycle_events=("UserPromptSubmit" "PostToolUse" "Stop" "SessionEnd")
for ev in "${lifecycle_events[@]}"; do
  ev_cmd="$(jq -r --arg ev "$ev" '.hooks[$ev][0].hooks[0].command // ""' "$PATCHED" 2>/dev/null)"
  if [[ "$ev_cmd" == *"\"$HOOK_TARGET\""* ]]; then
    ok "event '$ev' rewritten to installed transcript hook"
  else
    bad "event '$ev' not correctly rewritten (got: $ev_cmd)"
  fi
done

# Zero project-directory tokens must survive (R3)
if grep -q '\$CLAUDE_PROJECT_DIR' "$PATCHED"; then
  bad "surviving \$CLAUDE_PROJECT_DIR token found in patched output"
else
  ok "zero \$CLAUDE_PROJECT_DIR placeholder tokens survive in patched output"
fi

# ---------------------------------------------------------------------------
echo ""
echo "PASS: $pass  FAIL: $fail"
[ "$fail" -eq 0 ]
