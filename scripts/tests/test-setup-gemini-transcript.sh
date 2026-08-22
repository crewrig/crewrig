#!/bin/bash
# test-setup-gemini-transcript.sh — Regression tests for Gemini CLI transcript
# and worktree git guard hook manifest wiring (spec 0169, issue #990).
#
# Unit under test:
#   - hooks/gemini-transcript-hooks.json (the shipped manifest)
#   - the jq transform that scripts/setup-gemini-interactive.sh applies to the
#     manifest at setup time.
#
# Contract asserted:
#   R1 — the shipped manifest is valid JSON containing BeforeTool (guard) and
#        lifecycle event hooks (transcripts).
#   R2 — the setup transform rewrites mempalace-transcript.sh to the installed
#        target path (prefixed by env vars) and worktree-git-guard.sh to the
#        in-repo absolute path (without env prefix).
#   R3 — zero ${GEMINI_PROJECT_DIR} placeholder tokens survive in the patched output.
#
# HERMETIC: no HOME writes, no network, no interactive script runs. All
# transforms target throwaway paths under a temp root removed on exit.
#
# Usage:
#   bash scripts/tests/test-setup-gemini-transcript.sh

set -uo pipefail

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
MANIFEST="$REPO_DIR/hooks/gemini-transcript-hooks.json"
SETUP="$REPO_DIR/scripts/setup-gemini-interactive.sh"

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

guard_raw="$(jq -r '.hooks.BeforeTool[0].hooks[0].command // ""' "$MANIFEST" 2>/dev/null)"
if [[ "$guard_raw" == *"\${GEMINI_PROJECT_DIR}/hooks/worktree-git-guard.sh"* ]]; then
  ok "BeforeTool declares transcript-git-guard with project token"
else
  bad "BeforeTool missing expected guard command (got: $guard_raw)"
fi

# ---------------------------------------------------------------------------
# §2. Replay the setup patch transform (R2, R3).
# ---------------------------------------------------------------------------
echo "§2 setup patch transform (R2, R3)"
ENVP="MEMPALACE_TRANSCRIPT_ENABLED=1 MEMPALACE_PYTHON=/usr/bin/python3"
HOOK_TARGET="$TMP_ROOT/gemini/hooks/mempalace-transcript.sh"
GUARD_TARGET="$REPO_DIR/hooks/worktree-git-guard.sh"
PATCHED="$TMP_ROOT/patched.json"

jq --arg envp "$ENVP" --arg hook_path "$HOOK_TARGET" --arg guard_path "$GUARD_TARGET" '
  (.. | objects | select(.type? == "command")) |=
    (if (.name? == "transcript-git-guard" or (.command | contains("worktree-git-guard.sh")))
     then .command = ("bash " + $guard_path)
     else .command = ($envp + " " + (.command | gsub("\\$\\{GEMINI_PROJECT_DIR\\}/hooks/mempalace-transcript.sh"; $hook_path)))
     end)' \
  "$MANIFEST" > "$PATCHED" 2>/dev/null

if jq -e . "$PATCHED" >/dev/null 2>&1; then
  ok "patched output is valid JSON"
else
  bad "patched output is not valid JSON"
fi

# BeforeTool guard must point to in-repo guard and NOT carry the transcript env prefix
guard_patched="$(jq -r '.hooks.BeforeTool[0].hooks[0].command // ""' "$PATCHED" 2>/dev/null)"
if [[ "$guard_patched" == *"bash $GUARD_TARGET"* ]] && [[ "$guard_patched" != *"MEMPALACE_TRANSCRIPT_ENABLED"* ]]; then
  ok "BeforeTool guard rewritten to in-repo target without transcript env"
else
  bad "BeforeTool guard not correctly rewritten (got: $guard_patched)"
fi

# Lifecycle events must point to installed transcript hook with env prefix
lifecycle_events=("BeforeAgent" "AfterTool" "AfterModel" "SessionEnd")
for ev in "${lifecycle_events[@]}"; do
  ev_cmd="$(jq -r --arg ev "$ev" '.hooks[$ev][0].hooks[0].command // ""' "$PATCHED" 2>/dev/null)"
  if [[ "$ev_cmd" == *"$HOOK_TARGET"* ]] && [[ "$ev_cmd" == *"MEMPALACE_TRANSCRIPT_ENABLED=1"* ]]; then
    ok "event '$ev' rewritten to installed transcript hook with env prefix"
  else
    bad "event '$ev' not correctly rewritten (got: $ev_cmd)"
  fi
done

# Zero project-directory tokens must survive (R3)
if grep -q '\${GEMINI_PROJECT_DIR}' "$PATCHED"; then
  bad "surviving \${GEMINI_PROJECT_DIR} token found in patched output"
else
  ok "zero \${GEMINI_PROJECT_DIR} placeholder tokens survive in patched output"
fi

# ---------------------------------------------------------------------------
echo ""
echo "PASS: $pass  FAIL: $fail"
[ "$fail" -eq 0 ]
