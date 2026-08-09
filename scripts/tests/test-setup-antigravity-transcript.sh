#!/bin/bash
# test-setup-antigravity-transcript.sh — Regression tests for Antigravity CLI
# transcript-hook activation (spec 0116, issue #724).
#
# Unit under test: deploy_antigravity_transcript_hooks() in scripts/lib/common.sh,
# plus the shipped manifest hooks/antigravity-transcript-hooks.json.
#
# WHY A HELPER AND NOT THE SETUP SCRIPT. The three sibling setups inline their
# transcript blocks, but `test-setup-mcp-merge.sh` records the house rule that
# the interactive scripts cannot run end-to-end in CI (fzf prompts, the `agy`
# guard, the chroma daemon). Spec 0116 R17 demands hermetic coverage of the
# deployment, so the deployment lives in a helper the test can call and the two
# `fzf` prompts are asserted structurally instead (§4).
#
# Contract asserted (spec 0116):
#   R1/R2/R3 — the manifest is a map of NAMED hooks, registers only events the
#     CLI actually has, and registers neither of the per-tool events. The four
#     names spec 0056 shipped (BeforeAgent/AfterTool/AfterModel/SessionEnd) do
#     not exist in Antigravity and MUST be absent.
#   R4 — no command depends on the launch directory ($PWD is fatal here: a
#     handler's cwd is the directory holding hooks.json, not any project).
#   R5 — every command tells the hook which event fired, because the Antigravity
#     payload carries no event name.
#   R13/R14 — the hook script is installed under the assistant's own directory
#     and every command names it by absolute path, with the enabling env prefix.
#   R15 — an existing manifest is backed up before being touched, and a hook the
#     operator already declares survives the merge.
#   R16 — asserted structurally: both decline paths reach neither the helper nor
#     any write.
#
# HERMETIC: no HOME writes, no network, no interactive script runs. Every
# deployment targets throwaway paths under a temp root removed on exit.
#
# Usage:
#   bash scripts/tests/test-setup-antigravity-transcript.sh

# -e intentionally omitted: the pass/fail counters drive the harness, and some
# probes (jq -e presence checks) return non-zero on purpose.
set -uo pipefail

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
COMMON_LIB="$REPO_DIR/scripts/lib/common.sh"
MANIFEST="$REPO_DIR/hooks/antigravity-transcript-hooks.json"
HOOK_SCRIPT="$REPO_DIR/hooks/mempalace-transcript.sh"
SETUP="$REPO_DIR/scripts/setup-antigravity-interactive.sh"

for f in "$COMMON_LIB" "$MANIFEST" "$HOOK_SCRIPT" "$SETUP"; do
  [ -f "$f" ] || { echo "FATAL: missing $f" >&2; exit 2; }
done
command -v jq >/dev/null 2>&1 || { echo "FATAL: jq is required for this test" >&2; exit 2; }

# install_file() branches on INSTALL_MODE; pin it so the helper copies rather
# than symlinking into the temp root.
INSTALL_MODE="copy"
# shellcheck source=scripts/lib/common.sh
source "$COMMON_LIB"

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

pass=0
fail=0
ok()  { echo "  ok: $1"; pass=$((pass + 1)); }
bad() { echo "  FAIL: $1" >&2; fail=$((fail + 1)); }

ENVP='MEMPALACE_TRANSCRIPT_ENABLED=1 MEMPALACE_PYTHON=/usr/bin/python3'

# --- §1. The shipped manifest matches the CLI's real contract ---------------
echo "§1 manifest structure (R1/R2/R3/R4/R5)"

if jq -e . "$MANIFEST" >/dev/null 2>&1; then
  ok "manifest is valid JSON"
else
  bad "manifest is not valid JSON"
fi

# R1 — top level is a map of named hooks, not Gemini's {"hooks": {...}}.
if jq -e 'has("hooks") | not' "$MANIFEST" >/dev/null 2>&1; then
  ok "R1: no top-level 'hooks' key (that is the Gemini shape)"
else
  bad "R1: top-level 'hooks' key present — Antigravity reads a named-hook map"
fi
if jq -e 'to_entries | length >= 1 and all(.[]; .value | type == "object")' "$MANIFEST" >/dev/null 2>&1; then
  ok "R1: every top-level key maps to an object (a named hook)"
else
  bad "R1: a top-level value is not an object"
fi

# R2 — only events the CLI has. The five real ones, per the vendor's own
# docs/hooks.md shipped inside the CLI.
REAL_EVENTS='["PreToolUse","PostToolUse","PreInvocation","PostInvocation","Stop"]'
if jq -e --argjson real "$REAL_EVENTS" \
     '[.[] | keys[]] | map(select(. != "enabled")) | all(. as $e | $real | index($e) != null)' \
     "$MANIFEST" >/dev/null 2>&1; then
  ok "R2: every registered event is one the CLI actually has"
else
  bad "R2: an unregistered-by-the-CLI event name is present"
fi

for retired in BeforeAgent AfterTool AfterModel SessionEnd; do
  if grep -q "$retired" "$MANIFEST"; then
    bad "R2: retired spec-0056 event '$retired' still present"
  else
    ok "R2: retired spec-0056 event '$retired' is gone"
  fi
done

# R3 — the per-tool events are deliberately not registered. mempalace-transcript.sh
# already refuses PostToolUse (issue #91: too many writes for parallel sessions),
# and PreToolUse sits on a path where a hook's output can deny the tool.
for noisy in PreToolUse PostToolUse PostInvocation; do
  if jq -e --arg e "$noisy" '[.[] | keys[]] | index($e) == null' "$MANIFEST" >/dev/null 2>&1; then
    ok "R3: high-frequency event '$noisy' is not registered"
  else
    bad "R3: high-frequency event '$noisy' is registered"
  fi
done

# R4 — a handler's cwd is the directory holding hooks.json, so $PWD resolves
# under the customization root rather than under any project.
if grep -q '\$PWD' "$MANIFEST"; then
  bad "R4: manifest still uses \$PWD"
else
  ok "R4: manifest does not use \$PWD"
fi

# R5 — the event name is on the command line, because the payload has none.
if jq -e 'to_entries | all(.[]; .value | to_entries | all(.[];
       (.value | type) != "array" or (.key as $ev | .value | all(.[]; .command | endswith($ev)))))' \
     "$MANIFEST" >/dev/null 2>&1; then
  ok "R5: every command ends with the event name it is registered under"
else
  bad "R5: a command does not carry its event name"
fi

# --- §2. Deployment: the accept path ----------------------------------------
echo "§2 deployment, accept path (R13/R14)"

HOME_A="$TMP_ROOT/a"
HOOKS_DIR_A="$HOME_A/.gemini/antigravity-cli/hooks"
TARGET_A="$HOME_A/.gemini/config/hooks.json"

if deploy_antigravity_transcript_hooks \
     "$MANIFEST" "$HOOK_SCRIPT" "$HOOKS_DIR_A" "$TARGET_A" "$ENVP" >/dev/null 2>&1; then
  ok "helper exits zero on a clean target"
else
  bad "helper failed on a clean target"
fi

HOOK_TARGET_A="$HOOKS_DIR_A/mempalace-transcript.sh"
if [ -f "$HOOK_TARGET_A" ]; then
  ok "R13: hook script installed under the assistant's own directory"
else
  bad "R13: hook script not installed"
fi
if [ -x "$HOOK_TARGET_A" ]; then
  ok "R13: installed hook script is executable"
else
  bad "R13: installed hook script is not executable"
fi
if [ -f "$TARGET_A" ] && jq -e . "$TARGET_A" >/dev/null 2>&1; then
  ok "R14: manifest deployed to the customization root as valid JSON"
else
  bad "R14: manifest not deployed, or not valid JSON"
fi

# Every command must name the installed hook by ABSOLUTE path — that is the whole
# point of installing it out of the repository.
if jq -e --arg hp "$HOOK_TARGET_A" \
     '[.. | .command? // empty] | length > 0 and all(contains($hp))' \
     "$TARGET_A" >/dev/null 2>&1; then
  ok "R14: every command names the installed hook by absolute path"
else
  bad "R14: a command does not name the installed hook by absolute path"
fi
if jq -e '[.. | .command? // empty] | all(startswith("MEMPALACE_TRANSCRIPT_ENABLED=1"))' \
     "$TARGET_A" >/dev/null 2>&1; then
  ok "R14: every command carries the enabling env prefix"
else
  bad "R14: a command is missing the enabling env prefix"
fi
if grep -q '\$PWD' "$TARGET_A"; then
  bad "R4: deployed manifest reintroduced \$PWD"
else
  ok "R4: deployed manifest is free of \$PWD"
fi
# The event argument must survive the rewrite, or the hook cannot classify —
# the payload carries no event name. Asserted per event: a single compound
# expression is a trap here, because after `[...] |` the `.` is the array, so a
# second `[.. | .command? // empty]` re-derives from strings and yields [].
for ev in PreInvocation Stop; do
  if jq -e --arg ev " $ev" '[.. | .command? // empty] | any(endswith($ev))' \
       "$TARGET_A" >/dev/null 2>&1; then
    ok "R5: the '$ev' argument survives the command rewrite"
  else
    bad "R5: the '$ev' argument was lost in the rewrite"
  fi
done

# --- §3. Deployment: an operator's existing manifest -------------------------
echo "§3 deployment over an existing manifest (R15)"

HOME_B="$TMP_ROOT/b"
HOOKS_DIR_B="$HOME_B/.gemini/antigravity-cli/hooks"
TARGET_B="$HOME_B/.gemini/config/hooks.json"
mkdir -p "$(dirname "$TARGET_B")"
cat > "$TARGET_B" <<'EOF'
{
  "operator-lint-gate": {
    "PostToolUse": [
      { "matcher": "run_command", "hooks": [ { "type": "command", "command": "./lint.sh" } ] }
    ]
  }
}
EOF

deploy_antigravity_transcript_hooks \
  "$MANIFEST" "$HOOK_SCRIPT" "$HOOKS_DIR_B" "$TARGET_B" "$ENVP" >/dev/null 2>&1

if compgen -G "${TARGET_B}.bak.*" >/dev/null; then
  ok "R15: the pre-existing manifest was backed up"
else
  bad "R15: no backup of the pre-existing manifest"
fi
if jq -e 'has("operator-lint-gate")' "$TARGET_B" >/dev/null 2>&1; then
  ok "R15: the operator's own named hook survived the merge"
else
  bad "R15: the operator's own named hook was clobbered"
fi
if jq -e '.["operator-lint-gate"].PostToolUse[0].hooks[0].command == "./lint.sh"' \
     "$TARGET_B" >/dev/null 2>&1; then
  ok "R15: the operator's hook survived VERBATIM (not rewritten)"
else
  bad "R15: the operator's hook was modified by the merge"
fi
if jq -e 'to_entries | map(select(.key != "operator-lint-gate")) | length >= 1' \
     "$TARGET_B" >/dev/null 2>&1; then
  ok "R15: the crewrig hook was merged in alongside it"
else
  bad "R15: the crewrig hook is absent after the merge"
fi

# Re-running setup must be idempotent, not additive.
BEFORE_KEYS="$(jq -S 'keys' "$TARGET_B")"
deploy_antigravity_transcript_hooks \
  "$MANIFEST" "$HOOK_SCRIPT" "$HOOKS_DIR_B" "$TARGET_B" "$ENVP" >/dev/null 2>&1
if [ "$BEFORE_KEYS" = "$(jq -S 'keys' "$TARGET_B")" ]; then
  ok "re-running the deployment is idempotent on the key set"
else
  bad "re-running the deployment changed the key set"
fi

# A hook we own must be REPLACED, not deep-merged. This is the difference
# between jq's `+` and `*`, and it is not cosmetic: a stale event under our own
# name — the `SessionEnd` spec 0056 shipped and this spec retires — would
# otherwise survive every re-run, still pointing at a dead command. The whole
# point of this ticket is that those four event names are gone.
HOME_C="$TMP_ROOT/c"
HOOKS_DIR_C="$HOME_C/.gemini/antigravity-cli/hooks"
TARGET_C="$HOME_C/.gemini/config/hooks.json"
OURS="$(jq -r 'keys[0]' "$MANIFEST")"
mkdir -p "$(dirname "$TARGET_C")"
jq -n --arg k "$OURS" '{
  ($k): { "SessionEnd": [ { "type": "command", "command": "bash $PWD/hooks/mempalace-transcript.sh" } ] },
  "operator-keep": { "Stop": [ { "command": "./keep.sh" } ] }
}' > "$TARGET_C"

deploy_antigravity_transcript_hooks \
  "$MANIFEST" "$HOOK_SCRIPT" "$HOOKS_DIR_C" "$TARGET_C" "$ENVP" >/dev/null 2>&1

if jq -e --arg k "$OURS" '.[$k] | has("SessionEnd") | not' "$TARGET_C" >/dev/null 2>&1; then
  ok "R2: a retired event under our own hook name does not survive a re-run"
else
  bad "R2: a stale 'SessionEnd' survived under our own hook name (deep merge?)"
fi
if grep -q '\$PWD' "$TARGET_C"; then
  bad "R4: a stale \$PWD command survived the re-run"
else
  ok "R4: the stale \$PWD command was replaced, not merged around"
fi
if jq -e '.["operator-keep"].Stop[0].command == "./keep.sh"' "$TARGET_C" >/dev/null 2>&1; then
  ok "R15: replacing our own hook still leaves the operator's untouched"
else
  bad "R15: the operator's hook was lost while replacing ours"
fi

# --- §3b. The rewrite handles BOTH element shapes ---------------------------
# The CLI has two: PreToolUse/PostToolUse are GROUPED (`{matcher, hooks: [...]}`)
# while PreInvocation/PostInvocation/Stop are FLAT (the element IS the handler).
# The shipped manifest registers only flat events, so a rewrite that mishandled
# the grouped shape would stay invisible until the first tool event was ever
# registered — and would then produce a manifest the CLI loads and never runs.
# Covered here against a synthetic manifest rather than left to that day.
echo "§3b rewrite against a grouped event and a non-array member"

HOME_D="$TMP_ROOT/d"
SRC_D="$TMP_ROOT/grouped-src.json"
TARGET_D="$HOME_D/.gemini/config/hooks.json"
cat > "$SRC_D" <<'EOF'
{
  "grouped-and-disabled": {
    "enabled": false,
    "PreToolUse": [
      { "matcher": "run_command", "hooks": [ { "type": "command", "command": "ORIG" } ] }
    ],
    "Stop": [ { "type": "command", "command": "ORIG" } ]
  }
}
EOF
deploy_antigravity_transcript_hooks \
  "$SRC_D" "$HOOK_SCRIPT" "$HOME_D/hooks" "$TARGET_D" "$ENVP" >/dev/null 2>&1

if jq -e '."grouped-and-disabled".enabled == false' "$TARGET_D" >/dev/null 2>&1; then
  ok "a non-array member ('enabled') passes through untouched"
else
  bad "the non-array member 'enabled' was mangled by the rewrite"
fi
if jq -e '."grouped-and-disabled".PreToolUse[0].matcher == "run_command"' "$TARGET_D" >/dev/null 2>&1; then
  ok "a grouped event keeps its matcher"
else
  bad "a grouped event lost its matcher"
fi
if jq -e --arg hp "$HOME_D/hooks/mempalace-transcript.sh" \
     '."grouped-and-disabled".PreToolUse[0].hooks[0].command | contains($hp) and endswith(" PreToolUse")' \
     "$TARGET_D" >/dev/null 2>&1; then
  ok "a grouped event's INNER handler command is rewritten"
else
  bad "a grouped event's inner handler command was not rewritten"
fi
if jq -e '."grouped-and-disabled".PreToolUse[0] | has("command") | not' "$TARGET_D" >/dev/null 2>&1; then
  ok "no bogus 'command' is bolted onto the group object itself"
else
  bad "a 'command' key was injected at the group level, where the CLI never reads it"
fi
if jq -e --arg hp "$HOME_D/hooks/mempalace-transcript.sh" \
     '."grouped-and-disabled".Stop[0].command | contains($hp) and endswith(" Stop")' \
     "$TARGET_D" >/dev/null 2>&1; then
  ok "a flat event's handler command is still rewritten"
else
  bad "a flat event's handler command was not rewritten"
fi

# --- §4. The setup script's own wiring (structural) -------------------------
# The interactive script cannot run in CI, so assert its shape instead.
echo "§4 setup script wiring (R12/R16, structural)"

if grep -q 'Enable automatic session recording to MemPalace? (opt-in)' "$SETUP"; then
  ok "R12: the opt-in offer prompt is present"
else
  bad "R12: the opt-in offer prompt is missing"
fi
if grep -q 'fzf --height 10% --header "Apply?"' "$SETUP"; then
  ok "R12: the second confirmation prompt is present"
else
  bad "R12: the second confirmation prompt is missing"
fi
if grep -q 'deploy_antigravity_transcript_hooks' "$SETUP"; then
  ok "the setup script calls the deployment helper"
else
  bad "the setup script never calls the deployment helper"
fi
# R12 asks for the offer to default to declining: `no` must be the first line
# fed to fzf, as in all three siblings.
if grep -q 'echo -e "no\\nyes" | fzf --height 10% --header "Enable automatic session recording' "$SETUP"; then
  ok "R12: the offer defaults to 'no'"
else
  bad "R12: the offer does not default to 'no'"
fi
# R16 — the helper call must sit INSIDE the confirmation branch, so that
# declining either prompt reaches no write at all.
if awk '/^ *CONFIRM=\$\(echo -e "yes\\nno"/{c=1} c && /deploy_antigravity_transcript_hooks/{found=1} END{exit !found}' "$SETUP"; then
  ok "R16: the deployment is gated behind the confirmation prompt"
else
  bad "R16: the deployment is not gated behind the confirmation prompt"
fi
# The deployment target must be the customization root that is proven to fire,
# not the application-data directory.
if grep -q 'AGY_HOOKS_JSON="${HOME}/.gemini/config/hooks.json"' "$SETUP"; then
  ok "R14: the deployment target is the global customization root"
else
  bad "R14: the deployment target is not \${HOME}/.gemini/config/hooks.json"
fi

# --- §5. The hook's own Antigravity handling ---------------------------------
# Hermetic by stubbing $MEMPALACE_PYTHON: the hook pipes its heredoc into that
# binary and, on a zero exit, logs `persisted <ENTRY_TYPE> to transcripts/<ROOM>`.
# A stub that swallows stdin and exits zero therefore exposes both the
# classification and the room id without MemPalace, chromadb, or a network.
echo "§5 hook payload handling (R7/R8/R9/R10/R11)"

PYSTUB="$TMP_ROOT/pystub"
printf '#!/bin/bash\ncat >/dev/null\necho OK\n' > "$PYSTUB"
chmod +x "$PYSTUB"

CONV="d8b1fa4a-16a1-4cc0-8bda-ea52da904ba3"
AGY_STOP="{\"conversationId\":\"$CONV\",\"error\":\"\",\"executionNum\":0,\"fullyIdle\":true,\"modelName\":\"claude-sonnet-4-6\",\"terminationReason\":\"NO_TOOL_CALL\",\"workspacePaths\":[\"$TMP_ROOT/myproject\"]}"
AGY_PRE="{\"conversationId\":\"$CONV\",\"initialNumSteps\":1,\"invocationNum\":0,\"modelName\":\"claude-sonnet-4-6\",\"workspacePaths\":[]}"
CLAUDE_STOP='{"hook_event_name":"Stop","stop_hook_active":false}'
CLAUDE_PROMPT='{"hook_event_name":"UserPromptSubmit","prompt":"hello"}'

run_hook() { # <payload> [event]
  local payload="$1"; shift
  printf '%s' "$payload" | MEMPALACE_TRANSCRIPT_ENABLED=1 MEMPALACE_PYTHON="$PYSTUB" \
    bash "$HOOK_SCRIPT" "$@" 2>"$TMP_ROOT/stderr"
}

# R10 — a JSON object on stdout for Antigravity, and only for Antigravity.
OUT="$(run_hook "$AGY_STOP" Stop)"
if [ "$OUT" = "{}" ]; then
  ok "R10: Antigravity Stop answers with an empty JSON object"
else
  bad "R10: Antigravity Stop answered '$OUT', expected '{}'"
fi
# An empty object must NOT steer the agent: no decision key at all.
if printf '%s' "$OUT" | jq -e 'has("decision") | not' >/dev/null 2>&1; then
  ok "R10: the answer carries no 'decision' key, so it cannot block the stop"
else
  bad "R10: the answer carries a 'decision' key"
fi

# R7/R8/R9 — classification, session id, project dir.
if grep -q 'persisted agent-response' "$TMP_ROOT/stderr"; then
  ok "R7: Antigravity Stop classifies as agent-response"
else
  bad "R7: Antigravity Stop misclassified: $(cat "$TMP_ROOT/stderr")"
fi
if grep -q "transcripts/myproject-.*-${CONV:0:8}" "$TMP_ROOT/stderr"; then
  ok "R8/R9: room derives from conversationId and workspacePaths[0]"
else
  bad "R8/R9: room wrong: $(cat "$TMP_ROOT/stderr")"
fi

OUT="$(run_hook "$AGY_PRE" PreInvocation)"
if [ "$OUT" = "{}" ] && grep -q 'persisted session-lifecycle' "$TMP_ROOT/stderr"; then
  ok "R7: Antigravity PreInvocation classifies as session-lifecycle"
else
  bad "R7: Antigravity PreInvocation misclassified: $(cat "$TMP_ROOT/stderr")"
fi
# R9 — an empty workspace list must still yield an entry, via the fallback chain.
if grep -q 'persisted session-lifecycle to transcripts/' "$TMP_ROOT/stderr"; then
  ok "R9: an empty workspacePaths still resolves a project and persists"
else
  bad "R9: an empty workspacePaths lost the entry"
fi

# R10 — the acknowledgement is emitted even when persistence is opted out, since
# the CLI expects an answer regardless of what the hook decides to do.
OUT="$(printf '%s' "$AGY_STOP" | MEMPALACE_TRANSCRIPT_ENABLED=0 bash "$HOOK_SCRIPT" Stop 2>/dev/null)"
if [ "$OUT" = "{}" ]; then
  ok "R10: the acknowledgement is emitted on the opted-out path too"
else
  bad "R10: opted-out path answered '$OUT', expected '{}'"
fi

# R10 is NOT conditional on the payload parsing. `set -euo pipefail` makes a
# malformed payload abort at the first `jq` read, so the acknowledgement has to
# survive an abort — which is why it lives in an EXIT trap rather than at each
# exit site. A regression here is invisible on the happy path.
for broken in 'NOT JSON' ''; do
  OUT="$(printf '%s' "$broken" | MEMPALACE_TRANSCRIPT_ENABLED=1 MEMPALACE_PYTHON="$PYSTUB" \
    bash "$HOOK_SCRIPT" Stop 2>/dev/null)"
  if [ "$OUT" = "{}" ]; then
    ok "R10: acknowledged even on an unparseable payload ('${broken:-<empty>}')"
  else
    bad "R10: unparseable payload ('${broken:-<empty>}') answered '$OUT', expected '{}'"
  fi
done

# Exactly once — a trap that also fired at an explicit call site would emit two
# objects and make the CLI's parse ambiguous.
LINES="$(printf '%s' "$AGY_STOP" | MEMPALACE_TRANSCRIPT_ENABLED=1 MEMPALACE_PYTHON="$PYSTUB" \
  bash "$HOOK_SCRIPT" Stop 2>/dev/null | wc -l | tr -d ' ')"
if [ "$LINES" = "1" ]; then
  ok "R10: the acknowledgement is emitted exactly once"
else
  bad "R10: emitted $LINES lines on stdout, expected exactly 1"
fi

# Only one EXIT trap may exist: a second one REPLACES the first, silently
# disarming both the acknowledgement and the temp-file cleanup.
if [ "$(grep -c '^[[:space:]]*trap .* EXIT' "$HOOK_SCRIPT")" = "1" ]; then
  ok "R10: exactly one EXIT trap is installed in the hook"
else
  bad "R10: $(grep -c '^[[:space:]]*trap .* EXIT' "$HOOK_SCRIPT") EXIT traps — a later one disarms the earlier"
fi

# R11 — THE NO-REGRESSION GUARANTEE. The other three CLIs pass no argument, so
# every Antigravity path above must stay dormant: nothing on stdout, and the
# same classification as before.
OUT="$(run_hook "$CLAUDE_STOP")"
if [ -z "$OUT" ]; then
  ok "R11: a Claude payload (no argument) writes nothing to stdout"
else
  bad "R11: a Claude payload wrote '$OUT' to stdout"
fi
if grep -q 'persisted agent-response' "$TMP_ROOT/stderr"; then
  ok "R11: Claude Stop still classifies as agent-response"
else
  bad "R11: Claude Stop classification changed: $(cat "$TMP_ROOT/stderr")"
fi

OUT="$(run_hook "$CLAUDE_PROMPT")"
if [ -z "$OUT" ] && grep -q 'persisted user-prompt' "$TMP_ROOT/stderr"; then
  ok "R11: Claude UserPromptSubmit still classifies as user-prompt, silent stdout"
else
  bad "R11: Claude UserPromptSubmit regressed: $(cat "$TMP_ROOT/stderr")"
fi

# Issue #91 must survive: PostToolUse still short-circuits without persisting.
OUT="$(run_hook '{"hook_event_name":"PostToolUse","tool_name":"Bash"}')"
if [ -z "$OUT" ] && ! grep -q 'persisted' "$TMP_ROOT/stderr"; then
  ok "R11: issue #91 holds — PostToolUse still persists nothing"
else
  bad "R11: PostToolUse no longer short-circuits"
fi

echo ""
echo "Summary: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
