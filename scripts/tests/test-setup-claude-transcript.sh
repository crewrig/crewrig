#!/bin/bash
# test-setup-claude-transcript.sh — Regression tests for Claude Code transcript
# and worktree git guard hook manifest wiring (spec 0169, issue #990).
#
# Unit under test:
#   - hooks/claude-transcript-hooks.json (the shipped manifest)
#   - the render step that scripts/setup-claude-interactive.sh applies to the
#     manifest at setup time.
#
# Contract asserted:
#   R1 — the shipped manifest is valid JSON containing PreToolUse (guard) and
#        lifecycle event hooks (transcripts).
#   R2 — the transcript commands are the direct `node` form on the in-repo
#        absolute path of hooks/mempalace-transcript.ts with the `claude-code`
#        argument, rendered by `hook-wiring.ts transcript render` (spec 0247 R20,
#        R21: no installed copy); the guard command is the direct `node` form on
#        the in-repo absolute path, rendered by `hook-wiring.ts guard render`
#        (spec 0248 R28, R29); both reached through render_session_recording_manifest.
#   R3 — zero $CLAUDE_PROJECT_DIR placeholder tokens survive in the patched output.
#   spec 0211 R2 — the session-recording manifest registers no usage-capture.sh
#        command: usage capture has its own opt-in, covered (with the
#        never-copied invariant for usage-capture.sh) by
#        scripts/tests/test-setup-usage-capture-optin.sh.
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
if [[ "$guard_raw" == *"\$CLAUDE_PROJECT_DIR/hooks/worktree-git-guard.ts"* ]]; then
  ok "PreToolUse declares worktree-git-guard.ts with project token"
else
  bad "PreToolUse missing expected guard command (got: $guard_raw)"
fi

# ---------------------------------------------------------------------------
# §2. Replay the setup patch transform (R2, R3).
# ---------------------------------------------------------------------------
echo "§2 setup patch transform (R2, R3)"
HOOK_TARGET="$(cd "$REPO_DIR/hooks" && pwd -P)/mempalace-transcript.ts"
GUARD_TARGET="$(cd "$REPO_DIR/hooks" && pwd -P)/worktree-git-guard.ts"
RENDERED="$TMP_ROOT/rendered.json"
PATCHED="$TMP_ROOT/patched.json"

# Both command lines are final once rendered (spec 0248 R28, R29; spec 0247
# R20, R21): setup substitutes nothing any more, so the replay calls the same
# render step setup does and reads its output as the patched manifest.
# shellcheck disable=SC2034  # read by install_file() in the lib sourced below
INSTALL_MODE="copy"
# shellcheck source=scripts/lib/common.sh
source "$REPO_DIR/scripts/lib/common.sh"
# shellcheck source=scripts/lib/usage-capture-optin.sh
source "$REPO_DIR/scripts/lib/usage-capture-optin.sh"
render_session_recording_manifest claude "$REPO_DIR" "$MANIFEST" "$RENDERED" >/dev/null 2>&1

cp "$RENDERED" "$PATCHED"

if jq -e . "$PATCHED" >/dev/null 2>&1; then
  ok "patched output is valid JSON"
else
  bad "patched output is not valid JSON"
fi

# PreToolUse must point to the guard script in-repo
guard_patched="$(jq -r '.hooks.PreToolUse[0].hooks[0].command // ""' "$PATCHED" 2>/dev/null)"
if [[ "$guard_patched" == "node \"$GUARD_TARGET\"" ]]; then
  ok "PreToolUse rewritten to the direct node form on the in-repo guard target"
else
  bad "PreToolUse not rewritten to in-repo guard target (got: $guard_patched)"
fi

# Lifecycle events must point to the in-repo transcript hook (spec 0247 R21)
for ev in UserPromptSubmit PostToolUse Stop SessionEnd; do
  ev_cmd="$(jq -r --arg ev "$ev" '.hooks[$ev][0].hooks[0].command // ""' "$PATCHED" 2>/dev/null)"
  if [[ "$ev_cmd" == "node \"$HOOK_TARGET\" claude-code" ]]; then
    ok "event '$ev' rewritten to the in-repo transcript hook"
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

# spec 0211 R2 — session recording no longer registers usage capture.
if jq -e '[.. | objects | select(.type? == "command") | .command | select(contains("usage-capture.sh"))] | length == 0' \
     "$PATCHED" >/dev/null 2>&1; then
  ok "no patched command names usage-capture.sh (spec 0211 R2)"
else
  bad "a patched session-recording command names usage-capture.sh (spec 0211 R2)"
fi

# ---------------------------------------------------------------------------
echo ""
echo "PASS: $pass  FAIL: $fail"
[ "$fail" -eq 0 ]
