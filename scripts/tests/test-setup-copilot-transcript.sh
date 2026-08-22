#!/bin/bash
# test-setup-copilot-transcript.sh — Regression tests for the GitHub Copilot CLI
# transcript-hook manifest schema (issue #825).
#
# Unit under test:
#   - hooks/copilot-transcript-hooks.json              (the shipped manifest)
#   - config/copilot/settings.json.template            (the workspace template)
#   - .github/copilot/settings.json                    (the committed workspace)
#   - the two jq transforms that scripts/setup-copilot-interactive.sh applies
#     to the manifest at setup time (user-level patch + workspace merge).
#
# WHY NOT THE SETUP SCRIPT. The transcript deployment is inlined in
# `setup-copilot-interactive.sh` behind two `fzf` prompts (enable + confirm), so
# it cannot run end-to-end in CI (see `test-setup-mcp-merge.sh` for the house
# rule). The jq transforms are replayed here against throwaway copies and the
# shipped manifests are asserted structurally.
#
# Contract asserted (GitHub Copilot CLI hook schema — docs/github use-hooks):
#   R1 — the shipped manifest is a valid object keyed by camelCase event name,
#        each value an array of entries; `version` is the integer 1; every
#        entry carries `type` and a `command`/`bash` field.
#   R2 — the workspace settings (template + committed settings.json) carry
#        `"hooks": {}` and `version: 1`.
#   R3 — the user-level patch transform rewrites the command of EVERY entry in
#        EVERY event array to an absolute hook path prefixed by the env vars.
#
# HERMETIC: no HOME writes, no network, no interactive script runs. All
# transforms target throwaway paths under a temp root removed on exit.
#
# Usage:
#   bash scripts/tests/test-setup-copilot-transcript.sh

# -e intentionally omitted: the pass/fail counters drive the harness, and some
# probes (jq -e presence checks) return non-zero on purpose.
set -uo pipefail

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
MANIFEST="$REPO_DIR/hooks/copilot-transcript-hooks.json"
SETTINGS_TEMPLATE="$REPO_DIR/config/copilot/settings.json.template"
SETTINGS_COMMITTED="$REPO_DIR/.github/copilot/settings.json"
SETUP="$REPO_DIR/scripts/setup-copilot-interactive.sh"

for f in "$MANIFEST" "$SETTINGS_TEMPLATE" "$SETTINGS_COMMITTED" "$SETUP"; do
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
# §1. The shipped manifest uses the documented object schema (R1).
# ---------------------------------------------------------------------------
echo "§1 manifest schema (R1)"

if jq -e . "$MANIFEST" >/dev/null 2>&1; then
  ok "manifest is valid JSON"
else
  bad "manifest is not valid JSON"
fi

hooks_type="$(jq -r '.hooks | type' "$MANIFEST" 2>/dev/null)"
if [ "$hooks_type" = "object" ]; then
  ok "hooks is an object (got: $hooks_type)"
else
  bad "hooks is not an object (got: $hooks_type)"
fi

version="$(jq -r '.version' "$MANIFEST" 2>/dev/null)"
if [ "$version" = "1" ]; then
  ok "version is the integer 1"
else
  bad "version is not 1 (got: $version)"
fi

# Every config key is camelCase and every value is an array of well-formed entries.
camel_bad="$(jq -r '.hooks | keys[] | select(test("^[a-z][a-zA-Z0-9]*$") | not)' "$MANIFEST" 2>/dev/null)"
if [ -z "$camel_bad" ]; then
  ok "every event config key is camelCase"
else
  bad "non-camelCase event key(s): $camel_bad"
fi

entry_bad="$(jq -r '[.hooks[] | .[] | select((.type != "command") or ((has("command") | not) and (has("bash") | not)))] | length' "$MANIFEST" 2>/dev/null)"
if [ "$entry_bad" = "0" ]; then
  ok "every entry has type 'command' and a command/bash field"
else
  bad "$entry_bad entry/entries malformed"
fi

total_entries="$(jq '[.hooks[] | length] | add' "$MANIFEST" 2>/dev/null)"
echo "  info: $total_entries total hook entries across $(jq '.hooks | length' "$MANIFEST" 2>/dev/null) events"

# ---------------------------------------------------------------------------
# §2. Workspace settings carry the empty object and integer version (R2).
# ---------------------------------------------------------------------------
echo "§2 workspace settings shape (R2)"
for sf in "$SETTINGS_TEMPLATE" "$SETTINGS_COMMITTED"; do
  name="$(basename "$(dirname "$sf")")/$(basename "$sf")"
  st="$(jq -r '.hooks | type' "$sf" 2>/dev/null)"
  sv="$(jq -r '.version' "$sf" 2>/dev/null)"
  if [ "$st" = "object" ] && [ "$sv" = "1" ]; then
    ok "$name has hooks={} and version=1"
  else
    bad "$name has hooks type '$st' (want object) and version '$sv' (want 1)"
  fi
done

# ---------------------------------------------------------------------------
# §3. Replay the user-level patch transform (R3).
# ---------------------------------------------------------------------------
echo "§3 user-level patch transform (R3)"
ENVP="MEMPALACE_TRANSCRIPT_ENABLED=1 MEMPALACE_PYTHON=/usr/bin/python3"
HOOK_TARGET="$TMP_ROOT/copilot/hooks/mempalace-transcript.sh"
GUARD_TARGET="$REPO_DIR/hooks/worktree-git-guard.sh"
PATCHED="$TMP_ROOT/patched.json"
jq --arg envp "$ENVP" --arg hook_path "$HOOK_TARGET" --arg guard_path "$GUARD_TARGET" '
  (.hooks // {}) |= with_entries(
    if .key == "preToolUse"
    then .value |= map(.command = ("bash " + ($guard_path | tojson)))
    else .value |= map(.command = ($envp + " bash " + ($hook_path | tojson)))
    end
  )' \
  "$MANIFEST" > "$PATCHED" 2>/dev/null
if jq -e . "$PATCHED" >/dev/null 2>&1 && [ "$(jq -r '.hooks | type' "$PATCHED")" = "object" ]; then
  ok "patch output is valid JSON with object hooks"
else
  bad "patch output is not valid JSON / object hooks"
fi

# preToolUse must point to the guard script and not carry the transcript env prefix
guard_cmd="$(jq -r '.hooks.preToolUse[0].command // ""' "$PATCHED" 2>/dev/null)"
if [[ "$guard_cmd" == *"$GUARD_TARGET"* ]] && [[ "$guard_cmd" != *"MEMPALACE_TRANSCRIPT_ENABLED"* ]]; then
  ok "preToolUse command rewritten to in-repo guard target without transcript env"
else
  bad "preToolUse command not correctly rewritten to guard (got: $guard_cmd)"
fi

# Lifecycle events must point to the transcript hook with env prefix
transcript_events=("sessionStart" "userPromptSubmitted" "postToolUse" "agentStop" "sessionEnd")
for ev in "${transcript_events[@]}"; do
  ev_cmd="$(jq -r --arg ev "$ev" '.hooks[$ev][0].command // ""' "$PATCHED" 2>/dev/null)"
  if [[ "$ev_cmd" == *"$HOOK_TARGET"* ]] && [[ "$ev_cmd" == *"MEMPALACE_TRANSCRIPT_ENABLED=1"* ]]; then
    ok "event '$ev' rewritten to transcript hook with env prefix"
  else
    bad "event '$ev' not correctly rewritten (got: $ev_cmd)"
  fi
done

# Zero project-directory tokens must survive
if grep -q '\${COPILOT_PROJECT_DIR' "$PATCHED"; then
  bad "surviving \${COPILOT_PROJECT_DIR} token found in patched output"
else
  ok "zero project-directory placeholder tokens survive in patched output"
fi


# ---------------------------------------------------------------------------
echo ""
echo "PASS: $pass  FAIL: $fail"
[ "$fail" -eq 0 ]
