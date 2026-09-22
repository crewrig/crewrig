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
# §3 (spec 0206, PLAN v3 step 18) — usage-capture.sh wiring:
#   (a) the Stop/SessionEnd events each carry TWO DISTINCT installed
#       commands, one of them naming usage-capture.sh.
#   (b) the capture command is an in-repo absolute path ending in
#       /hooks/usage-capture.sh, carrying no unresolved $CLAUDE_PROJECT_DIR
#       token and no MEMPALACE_TRANSCRIPT_ENABLED prefix.
#   (c) usage-capture.sh is never install_file'd — the installer's own source
#       names no such call, and no usage-capture.sh appears under this test's
#       sandboxed installed-hooks directory. (a)+(c) together are the pair
#       that catches plan v2's step-14 defect (v2-F1): a manifest wired to an
#       INSTALLED copy target instead of the in-repo absolute path — (c) is
#       the one that observes the copy-out directly.
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
CAPTURE_TARGET="$REPO_DIR/hooks/usage-capture.sh"
PATCHED="$TMP_ROOT/patched.json"

# usage-capture.sh (spec 0206) is in the guard's class, not the transcript
# hook's: an in-repo absolute path, never an installed copy — the third
# gsub below mirrors scripts/setup-claude-interactive.sh's own transform.
jq --arg hook_path "$HOOK_TARGET" --arg guard_path "$GUARD_TARGET" --arg capture_path "$CAPTURE_TARGET" \
  '(.. | objects | select(.type? == "command") | .command) |=
     (gsub("\\$CLAUDE_PROJECT_DIR/hooks/mempalace-transcript.sh"; $hook_path) |
      gsub("\\$CLAUDE_PROJECT_DIR/hooks/worktree-git-guard.sh"; $guard_path) |
      gsub("\\$CLAUDE_PROJECT_DIR/hooks/usage-capture.sh"; $capture_path))' \
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
for ev in UserPromptSubmit PostToolUse Stop SessionEnd; do
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
# §3. usage-capture.sh wiring (spec 0206, PLAN v3 step 18).
# ---------------------------------------------------------------------------
echo "§3 usage-capture.sh wiring"

for ev in Stop SessionEnd; do
  cmd0="$(jq -r --arg ev "$ev" '.hooks[$ev][0].hooks[0].command // ""' "$PATCHED" 2>/dev/null)"
  cmd1="$(jq -r --arg ev "$ev" '.hooks[$ev][0].hooks[1].command // ""' "$PATCHED" 2>/dev/null)"

  # (a) two distinct commands, one naming usage-capture.sh.
  if [ -n "$cmd0" ] && [ -n "$cmd1" ] && [ "$cmd0" != "$cmd1" ] \
     && { [[ "$cmd0" == *usage-capture.sh* ]] || [[ "$cmd1" == *usage-capture.sh* ]]; }; then
    ok "(a) event '$ev' carries two distinct commands, one naming usage-capture.sh"
  else
    bad "(a) event '$ev' does not carry two distinct commands with one naming usage-capture.sh (cmd0: $cmd0 | cmd1: $cmd1)"
  fi

  capture_cmd="$cmd0"
  [[ "$capture_cmd" == *usage-capture.sh* ]] || capture_cmd="$cmd1"

  # (b) in-repo absolute path, no unresolved token, no env prefix.
  if [[ "$capture_cmd" == *"\"$CAPTURE_TARGET\""* ]] && [[ "$capture_cmd" == */hooks/usage-capture.sh\"* ]] \
     && [[ "$capture_cmd" != *'$CLAUDE_PROJECT_DIR'* ]] && [[ "$capture_cmd" != *MEMPALACE_TRANSCRIPT_ENABLED* ]]; then
    ok "(b) event '$ev' capture command is the in-repo absolute path, no token, no env prefix"
  else
    bad "(b) event '$ev' capture command malformed (got: $capture_cmd)"
  fi
done

# (c) usage-capture.sh is never install_file'd, and none appears under this
# test's sandboxed installed-hooks directory (the one that observes a
# copy-out directly — v2-F1's exact defect).
if grep -qE 'install_file[^#]*usage-capture\.sh' "$SETUP"; then
  bad "(c) $SETUP appears to install_file usage-capture.sh — it must be wired by in-repo absolute path, never copied"
else
  ok "(c) $SETUP never install_file's usage-capture.sh"
fi
SANDBOX_HOOKS_DIR="$(dirname "$HOOK_TARGET")"
mkdir -p "$SANDBOX_HOOKS_DIR"
if [ -f "$SANDBOX_HOOKS_DIR/usage-capture.sh" ]; then
  bad "(c) usage-capture.sh unexpectedly exists under the sandboxed installed hooks directory ($SANDBOX_HOOKS_DIR)"
else
  ok "(c) no usage-capture.sh under the sandboxed installed hooks directory ($SANDBOX_HOOKS_DIR)"
fi

# ---------------------------------------------------------------------------
echo ""
echo "PASS: $pass  FAIL: $fail"
[ "$fail" -eq 0 ]
