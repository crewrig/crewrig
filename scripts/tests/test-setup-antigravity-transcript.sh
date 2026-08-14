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
# Contract asserted (spec 0116, incl. delta-03):
#   R1/R2 — the manifest is a map of NAMED hooks and registers only events the
#     CLI actually has. The four names spec 0056 shipped
#     (BeforeAgent/AfterTool/AfterModel/SessionEnd) do not exist and MUST be absent.
#   R3 (delta-01 as rescoped by delta-03) — `Stop` is the ONLY event registered
#     under the named hook `crewrig-mempalace-transcript`, because it is the only
#     one that fires once per turn. Measured, agy 1.0.16, one turn with three
#     shell commands: PreInvocation 4x, PostInvocation 4x, PreToolUse 3x, Stop 1x.
#     The manifest MAY carry OTHER named hooks with their own normative base —
#     namely `crewrig-worktree-git-guard`, whose `PreToolUse` registration is
#     covered by R27 below.
#   R27 (delta-03) — the manifest carries `crewrig-worktree-git-guard` registering
#     `PreToolUse` through a group whose `matcher` selects `run_command` and whose
#     handler command names `hooks/worktree-git-guard.sh`.
#   R28 (delta-03) — the deployment rewrites the guard command to the absolute
#     REPOSITORY path of `hooks/worktree-git-guard.sh` — never the installed
#     transcript hook, no env prefix, no lifecycle-event argument.
#   R22 (delta-01) — the consent text states the true per-turn write volume.
#   R24 (delta-01) — the setup script's call-site ARGUMENTS are asserted, not just
#     that the deployment is reached. An emptied env prefix silently disables
#     recording, and previously survived the whole suite.
#   R4 — no command depends on the launch directory ($PWD is fatal here: a
#     handler's cwd is the directory holding hooks.json, not any project).
#   R5 — every command registered under the transcript hook tells the hook which
#     event fired, because the Antigravity payload carries no event name. The
#     guard command is exempt (it reads the payload it receives on stdin).
#   R13/R14 — the hook script is installed under the assistant's own directory
#     and every transcript command names it by absolute path, with the enabling
#     env prefix.
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
GUARD_SCRIPT="$REPO_DIR/hooks/worktree-git-guard.sh"
SETUP="$REPO_DIR/scripts/setup-antigravity-interactive.sh"

for f in "$COMMON_LIB" "$MANIFEST" "$HOOK_SCRIPT" "$GUARD_SCRIPT" "$SETUP"; do
  [ -f "$f" ] || { echo "FATAL: missing $f" >&2; exit 2; }
done
command -v jq >/dev/null 2>&1 || { echo "FATAL: jq is required for this test" >&2; exit 2; }

# install_file() branches on INSTALL_MODE; pin it so the helper copies rather
# than symlinking into the temp root.
# shellcheck disable=SC2034  # read by install_file() in the lib sourced below
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

# R3 (as replaced by delta-01) — `Stop` is the ONLY registered event. Measured on
# agy 1.0.16, one turn issuing three shell commands: PreInvocation 4x,
# PostInvocation 4x, PreToolUse 3x, Stop 1x. The other four all have roughly
# per-tool-round cardinality, and the CLI runs hooks synchronously, blocking the
# agent loop.
if jq -e '."crewrig-mempalace-transcript" | [keys[]] == ["Stop"]' "$MANIFEST" >/dev/null 2>&1; then
  ok "R3: Stop is the only event registered under the transcript hook"
else
  bad "R3: transcript-hook events are $(jq -c '."crewrig-mempalace-transcript" | keys' "$MANIFEST"), expected [\"Stop\"]"
fi
for noisy in PreToolUse PostToolUse PreInvocation PostInvocation; do
  if jq -e --arg e "$noisy" '."crewrig-mempalace-transcript" | [keys[]] | index($e) == null' "$MANIFEST" >/dev/null 2>&1; then
    ok "R3: high-frequency event '$noisy' is not registered under the transcript hook"
  else
    bad "R3: high-frequency event '$noisy' is registered under the transcript hook"
  fi
done

# R22 — the consent text must state the true write volume. It claimed "one entry
# per turn (turn start and turn end)" while registering an event that fires once
# per model call; a three-tool turn produced five entries, not two. Pin the two
# together so the text cannot drift from the manifest again.
if grep -q "Record ONE entry each time the agent's execution loop ends" "$SETUP"; then
  ok "R22: the consent text states one entry per execution-loop end"
else
  bad "R22: the consent text does not state the true per-turn write volume"
fi
if grep -qE 'turn start and turn end' "$SETUP"; then
  bad "R22: the consent text still promises a turn-start entry"
else
  ok "R22: the consent text no longer promises a turn-start entry"
fi

# R4 — a handler's cwd is the directory holding hooks.json, so $PWD resolves
# under the customization root rather than under any project.
if grep -q '\$PWD' "$MANIFEST"; then
  bad "R4: manifest still uses \$PWD"
else
  ok "R4: manifest does not use \$PWD"
fi

# R5 — the event name is on the command line, because the payload has none.
# Scoped to the transcript hook: the guard command is exempt (R5 as replaced by
# delta-03) because it inspects the payload it reads from stdin.
if jq -e '."crewrig-mempalace-transcript" | to_entries | all(.[];
       (.value | type) != "array" or (.key as $ev | .value | all(.[]; .command | endswith($ev))))' \
     "$MANIFEST" >/dev/null 2>&1; then
  ok "R5: every transcript command ends with the event name it is registered under"
else
  bad "R5: a transcript command does not carry its event name"
fi

# R27 (delta-03) — the manifest MAY carry the named hook `crewrig-worktree-git-guard`
# registering `PreToolUse` through a group whose matcher selects `run_command` and
# whose handler command names `hooks/worktree-git-guard.sh` (spec 0153 R1/R4).
if jq -e 'has("crewrig-worktree-git-guard")' "$MANIFEST" >/dev/null 2>&1; then
  ok "R27: the manifest carries the named hook 'crewrig-worktree-git-guard'"
else
  bad "R27: the named hook 'crewrig-worktree-git-guard' is absent"
fi
if jq -e '."crewrig-worktree-git-guard".PreToolUse[0].matcher == "run_command"' "$MANIFEST" >/dev/null 2>&1; then
  ok "R27: the guard registers PreToolUse with matcher 'run_command'"
else
  bad "R27: guard PreToolUse[0].matcher is not 'run_command'"
fi
if jq -e '."crewrig-worktree-git-guard".PreToolUse[0] | has("hooks") and (.hooks | type) == "array"' "$MANIFEST" >/dev/null 2>&1; then
  ok "R27: the guard group carries a 'hooks' array"
else
  bad "R27: the guard group has no 'hooks' array (grouped shape violated)"
fi
if jq -e '."crewrig-worktree-git-guard".PreToolUse[0].hooks[0].command | contains("hooks/worktree-git-guard.sh")' \
     "$MANIFEST" >/dev/null 2>&1; then
  ok "R27: the guard handler command names hooks/worktree-git-guard.sh"
else
  bad "R27: the guard handler command does not name hooks/worktree-git-guard.sh"
fi

# --- §2. Deployment: the accept path ----------------------------------------
echo "§2 deployment, accept path (R13/R14)"

HOME_A="$TMP_ROOT/a"
HOOKS_DIR_A="$HOME_A/.gemini/antigravity-cli/hooks"
TARGET_A="$HOME_A/.gemini/config/hooks.json"

if deploy_antigravity_transcript_hooks \
     "$MANIFEST" "$HOOK_SCRIPT" "$HOOKS_DIR_A" "$TARGET_A" "$ENVP" "$GUARD_SCRIPT" >/dev/null 2>&1; then
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

# Every TRANSCRIPT command must name the installed hook by ABSOLUTE path — that
# is the whole point of installing it out of the repository. Scoped to the
# transcript hook: the guard command deliberately names the repository path
# instead (R28).
if jq -e --arg hp "$HOOK_TARGET_A" \
     '."crewrig-mempalace-transcript" | [.. | .command? // empty] | length > 0 and all(contains($hp))' \
     "$TARGET_A" >/dev/null 2>&1; then
  ok "R14: every transcript command names the installed hook by absolute path"
else
  bad "R14: a transcript command does not name the installed hook by absolute path"
fi
if jq -e '."crewrig-mempalace-transcript" | [.. | .command? // empty] | all(startswith("MEMPALACE_TRANSCRIPT_ENABLED=1"))' \
     "$TARGET_A" >/dev/null 2>&1; then
  ok "R14: every transcript command carries the enabling env prefix"
else
  bad "R14: a transcript command is missing the enabling env prefix"
fi
if grep -q '\$PWD' "$TARGET_A"; then
  bad "R4: deployed manifest reintroduced \$PWD"
else
  ok "R4: deployed manifest is free of \$PWD"
fi

# R28 (delta-03) — the deployed guard command names the REPOSITORY guard path,
# never the installed transcript hook, with no env prefix and no event argument.
# `contains`, NOT exact equality: the rewrite's `tojson` quotes the path, so the
# deployed command is `bash "/abs/repo/hooks/worktree-git-guard.sh"` and an exact
# match against the unquoted path would fail.
if jq -e --arg gp "$GUARD_SCRIPT" \
     '."crewrig-worktree-git-guard".PreToolUse[0].hooks[0].command | contains($gp)' \
     "$TARGET_A" >/dev/null 2>&1; then
  ok "R28: the deployed guard command contains the repository guard path"
else
  bad "R28: the deployed guard command lacks $GUARD_SCRIPT"
fi
if jq -e --arg hp "$HOOK_TARGET_A" \
     '."crewrig-worktree-git-guard".PreToolUse[0].hooks[0].command | contains($hp) | not' \
     "$TARGET_A" >/dev/null 2>&1; then
  ok "R28: the deployed guard command does NOT name the installed transcript hook"
else
  bad "R28: the deployed guard command still names the installed transcript hook"
fi
if jq -e '."crewrig-worktree-git-guard".PreToolUse[0].hooks[0].command | startswith("MEMPALACE_TRANSCRIPT_ENABLED=1") | not' \
     "$TARGET_A" >/dev/null 2>&1; then
  ok "R28: the deployed guard command carries no transcript env prefix"
else
  bad "R28: the deployed guard command carries the transcript enabling env prefix"
fi
if jq -e '."crewrig-worktree-git-guard".PreToolUse[0].hooks[0].command as $c |
       ["PreToolUse","PostToolUse","PreInvocation","PostInvocation","Stop"]
         | any(. as $e | $c | endswith(" " + $e)) | not' \
     "$TARGET_A" >/dev/null 2>&1; then
  ok "R28: the deployed guard command carries no lifecycle-event argument"
else
  bad "R28: the deployed guard command ends with a lifecycle-event name"
fi

# The event argument must survive the rewrite, or the hook cannot classify —
# the payload carries no event name. Read the registered events from the
# TRANSCRIPT hook (the only one R5 applies to) rather than hardcoding them, so
# this keeps covering whatever R3 mandates without needing an edit here; today
# that is `Stop` alone.
while IFS= read -r ev; do
  [ -n "$ev" ] || continue
  if jq -e --arg ev " $ev" '[.. | .command? // empty] | any(endswith($ev))' \
       "$TARGET_A" >/dev/null 2>&1; then
    ok "R5: the '$ev' argument survives the command rewrite"
  else
    bad "R5: the '$ev' argument was lost in the rewrite"
  fi
done <<EOF
$(jq -r '."crewrig-mempalace-transcript" | keys[] | select(. != "enabled")' "$MANIFEST")
EOF

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
  "$MANIFEST" "$HOOK_SCRIPT" "$HOOKS_DIR_B" "$TARGET_B" "$ENVP" "$GUARD_SCRIPT" >/dev/null 2>&1

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
  "$MANIFEST" "$HOOK_SCRIPT" "$HOOKS_DIR_B" "$TARGET_B" "$ENVP" "$GUARD_SCRIPT" >/dev/null 2>&1
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
#
# `OURS` is pinned to the literal transcript-hook name, not `jq -r 'keys[0]'`:
# jq `keys` sorts alphabetically, so `keys[0]` already yields the transcript
# hook today ('m' < 'w'), but the pin is defensive — it guards against a future
# hook whose name sorts before it. This block replaces OUR OWN hook wholesale
# while preserving the operator's; it is not about which hook runs first.
HOME_C="$TMP_ROOT/c"
HOOKS_DIR_C="$HOME_C/.gemini/antigravity-cli/hooks"
TARGET_C="$HOME_C/.gemini/config/hooks.json"
OURS="crewrig-mempalace-transcript"
mkdir -p "$(dirname "$TARGET_C")"
jq -n --arg k "$OURS" '{
  ($k): { "SessionEnd": [ { "type": "command", "command": "bash $PWD/hooks/mempalace-transcript.sh" } ] },
  "operator-keep": { "Stop": [ { "command": "./keep.sh" } ] }
}' > "$TARGET_C"

deploy_antigravity_transcript_hooks \
  "$MANIFEST" "$HOOK_SCRIPT" "$HOOKS_DIR_C" "$TARGET_C" "$ENVP" "$GUARD_SCRIPT" >/dev/null 2>&1

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

# A refused merge must FAIL, not report success. `cmd > out && mv` would swallow
# it: POSIX exempts every command in an `&&` list except the last from `set -e`,
# so a jq that refuses the input skips the `mv`, falls through to the success
# message, and returns 0 — announcing a deployment that never happened.
HOME_E="$TMP_ROOT/e"
TARGET_E="$HOME_E/.gemini/config/hooks.json"
mkdir -p "$(dirname "$TARGET_E")"
printf 'this is not json at all' > "$TARGET_E"
BEFORE_E="$(cat "$TARGET_E")"

if deploy_antigravity_transcript_hooks \
     "$MANIFEST" "$HOOK_SCRIPT" "$HOME_E/hooks" "$TARGET_E" "$ENVP" "$GUARD_SCRIPT" >"$TMP_ROOT/out_e" 2>/dev/null; then
  bad "a non-object existing manifest returned SUCCESS"
else
  ok "a non-object existing manifest makes the helper fail"
fi
if grep -q 'Transcript hooks deployed' "$TMP_ROOT/out_e"; then
  bad "the helper announced a deployment that did not happen"
else
  ok "the helper does not announce a deployment it did not perform"
fi
if [ "$(cat "$TARGET_E")" = "$BEFORE_E" ]; then
  ok "the operator's unreadable file is left untouched"
else
  bad "the operator's file was modified on the failure path"
fi
if [ -f "${TARGET_E}.tmp" ]; then
  bad "a stray .tmp file was left behind on the failure path"
else
  ok "no stray .tmp file is left behind on the failure path"
fi

# The rewrite's own failure guard. Found uncovered by the third cold pass: removing
# `|| { rm -f "$patched"; return 1; }` from the jq rewrite left the suite green.
# The guard is reachable — an unreadable source manifest exercises it — so it gets
# an assertion rather than a comment.
HOME_F="$TMP_ROOT/f"
TARGET_F="$HOME_F/.gemini/config/hooks.json"
if deploy_antigravity_transcript_hooks \
     "$TMP_ROOT/no-such-manifest.json" "$HOOK_SCRIPT" "$HOME_F/hooks" "$TARGET_F" "$ENVP" "$GUARD_SCRIPT" \
     >"$TMP_ROOT/out_f" 2>/dev/null; then
  bad "an unreadable source manifest returned SUCCESS"
else
  ok "an unreadable source manifest makes the helper fail"
fi
if [ -f "$TARGET_F" ]; then
  bad "a manifest was written from an unreadable source"
else
  ok "no manifest is written when the source cannot be read"
fi
if grep -q 'Transcript hooks deployed' "$TMP_ROOT/out_f"; then
  bad "the helper announced a deployment from an unreadable source"
else
  ok "the helper announces nothing when the source cannot be read"
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
  "$SRC_D" "$HOOK_SCRIPT" "$HOME_D/hooks" "$TARGET_D" "$ENVP" "$GUARD_SCRIPT" >/dev/null 2>&1

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
# R16 — BEHAVIOURAL, not a grep. An earlier version of this assertion only
# checked that the helper's NAME appeared somewhere after the `CONFIRM=` line,
# which no arrangement of the code could falsify: it passed even with the gate
# fully INVERTED, so that declining deployed and accepting did not. A test that
# cannot fail is worse than no test, because it is counted as coverage.
#
# Instead: extract the real block from the script, run it with `fzf` and the
# deployment stubbed, and drive the two prompts. That exercises the gate itself
# without needing a terminal, a real `fzf`, or a single write.
GATE_BLOCK="$TMP_ROOT/gate-block.sh"
awk '/^# --- Transcript hooks \(opt-in\) --- \(spec 0116\)/{p=1}
     p && /^# --- Generate/{p=0}
     p{print}' "$SETUP" > "$GATE_BLOCK"
if [ -s "$GATE_BLOCK" ]; then
  ok "R16: the transcript block was located in the setup script"
else
  bad "R16: could not locate the transcript block — the marker comment moved?"
fi

# TRIPWIRE. The extraction is bounded by a comment, and a comment can be
# reworded. If the END marker ever stops matching, `awk` runs away and captures
# the rest of the script — including the block that writes
# `${HOME}/.gemini/config/AGENTS.md`. Sourcing that would make this suite write
# to the operator's real home, breaking the hermeticity it claims in its own
# header. Fail loudly on a runaway instead of silently doing more work.
# (`run_gate` also sandboxes HOME, so this is the second of two guards.)
if grep -q 'GEMINI_MD_TARGET' "$GATE_BLOCK"; then
  bad "R16: the extraction ran away past the transcript block — end marker moved?"
else
  ok "R16: the extraction is bounded to the transcript block"
fi

# <answer1> <answer2> -> echoes "DEPLOYED" iff the helper was reached
run_gate() {
  local a1="$1" a2="$2"
  ( # subshell: the stubs must not leak into the rest of the suite
    # `fzf` is invoked as `echo ... | fzf --header ...`, so the stub swallows
    # stdin and answers positionally: first call = the offer, second = the
    # confirmation. A command-substitution subshell would lose an exported
    # counter, so the state rides on a file.
    _ASKED="$TMP_ROOT/asked.$$"; rm -f "$_ASKED"
    fzf() {
      cat >/dev/null
      if [ ! -f "$_ASKED" ]; then : > "$_ASKED"; printf '%s\n' "$a1"; else printf '%s\n' "$a2"; fi
    }
    # Echo the ARGUMENTS, not just a marker. Without this the call site is
    # covered by nothing: §2/§3 exercise the helper with hand-written correct
    # arguments, and a stub that ignores its own would let a swapped or emptied
    # argument at the call site pass the whole suite (spec 0116 delta-01 R24).
    deploy_antigravity_transcript_hooks() { echo "DEPLOYED|$1|$2|$3|$4|$5|$6"; }
    detect_mempalace_python() { echo "/usr/bin/python3"; }
    # A directive covers only the next command, and `a=1; b=2` is two — hence
    # one line each. Both are read by the block sourced below.
    # shellcheck disable=SC2034
    REPO_DIR="$TMP_ROOT/repo"
    # shellcheck disable=SC2034
    AGY_HOME="$TMP_ROOT/gatehome"
    # Sandbox HOME. The block resolves its deployment target from ${HOME}, and
    # this suite promises in its own header to write nothing outside a temp
    # directory. Redirecting HOME makes that true by construction rather than by
    # trusting that every line of the extracted block is inert.
    HOME="$TMP_ROOT/gatehome"
    # shellcheck source=/dev/null
    . "$GATE_BLOCK"
  ) 2>/dev/null
}

# Capture, then match. Piping into `grep -q` would be wrong under the `pipefail`
# this suite runs with: grep exits on its first match, the producer takes SIGPIPE,
# and the pipeline reports 141 — so a successful match reads as a failure.
GATE_OUT="$(run_gate no no)"
case "$GATE_OUT" in
  *DEPLOYED*) bad "R16: declining the OFFER still reached the deployment" ;;
  *)          ok  "R16: declining the offer reaches no deployment" ;;
esac
# `no no` alone cannot say WHICH gate blocked — the second `no` would carry the
# case on its own. This is the independent probe: decline the offer, then answer
# yes to anything that follows. It must still deploy nothing. Without it, a
# refactor that renames the variable on one side of the offer's `if` — leaving
# the gate always-true — passes the whole suite while an operator who declined
# the offer is still shown "Apply?" and can deploy from it.
GATE_OUT="$(run_gate no yes)"
case "$GATE_OUT" in
  *DEPLOYED*) bad "R16: the offer decline was overridden by the confirmation" ;;
  *)          ok  "R16: the offer decline holds on its own" ;;
esac
GATE_OUT="$(run_gate yes no)"
case "$GATE_OUT" in
  *DEPLOYED*) bad "R16: declining the CONFIRMATION still reached the deployment" ;;
  *)          ok  "R16: declining the confirmation reaches no deployment" ;;
esac
# THE CANARY. Every case above passes by NOT seeing "DEPLOYED", so a `run_gate`
# that is broken outright — a bad extraction, an unset-variable abort, a sourcing
# failure — would satisfy all of them and read as full coverage. This case is the
# only one that requires the harness to actually work, which is what stops the
# other three from being vacuous. Verified: pointing the sourced path at a
# nonexistent file turns the suite red here (67 passed, 1 failed) rather than
# green everywhere.
GATE_OUT="$(run_gate yes yes)"
case "$GATE_OUT" in
  *DEPLOYED*) ok  "R12/R16: accepting both prompts reaches the deployment" ;;
  *)          bad "R12/R16: accepting both prompts did NOT reach the deployment — gate inverted, or the harness is broken" ;;
esac

# R24 — the call site's ARGUMENT LIST. Everything above proves the deployment is
# reached; none of it proves it is reached with the right arguments. Five
# mutations at the call site previously survived the whole suite, the worst being
# an emptied environment prefix: the deployed commands then lack
# MEMPALACE_TRANSCRIPT_ENABLED=1, so the hook opts itself out and records nothing,
# silently, exit 0. That is this feature's own failure mode, reachable by a
# one-token edit.
# No `tr ' ' '\n'` here: the env prefix (arg 5) contains a space, and a word-split
# `tr` would push the 6th field onto a line `grep '^DEPLOYED|'` rejects, leaving
# A_GUARD silently empty — the exact R24 defect class this ticket fixes.
GATE_ARGS="$(printf '%s' "$GATE_OUT" | grep '^DEPLOYED|' || true)"
IFS='|' read -r _ A_SRC A_HOOK A_DIR A_JSON A_ENV A_GUARD <<EOF
$GATE_ARGS
EOF
case "$A_SRC" in
  */hooks/antigravity-transcript-hooks.json) ok "R24: arg 1 is the manifest source" ;;
  *) bad "R24: arg 1 is '$A_SRC', expected the manifest source" ;;
esac
case "$A_HOOK" in
  */hooks/mempalace-transcript.sh) ok "R24: arg 2 is the hook script source" ;;
  *) bad "R24: arg 2 is '$A_HOOK', expected the hook script source" ;;
esac
case "$A_DIR" in
  */hooks) ok "R24: arg 3 is the hook install DIRECTORY" ;;
  *) bad "R24: arg 3 is '$A_DIR', expected a hooks directory" ;;
esac
case "$A_JSON" in
  */.gemini/config/hooks.json) ok "R24: arg 4 is the manifest TARGET at the customization root" ;;
  *) bad "R24: arg 4 is '$A_JSON', expected \${HOME}/.gemini/config/hooks.json" ;;
esac
case "$A_ENV" in
  MEMPALACE_TRANSCRIPT_ENABLED=1*) ok "R24: arg 5 enables persistence" ;;
  *) bad "R24: arg 5 is '$A_ENV' — the deployed hook would opt itself out and record nothing" ;;
esac
case "$A_GUARD" in
  */hooks/worktree-git-guard.sh) ok "R24: arg 6 is the guard script source" ;;
  *) bad "R24: arg 6 is '$A_GUARD', expected the guard script source" ;;
esac
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

# THE ENTRY'S CONTENT. Everything above pins the entry TYPE and the room; nothing
# pinned the text. Deleting the Antigravity `Stop)` case arm left both suites
# green, because the generic Claude `Stop` branch below it sets the same
# ENTRY_TYPE — only the `(terminationReason)` suffix silently vanished. That
# suffix is the whole informational payload: docs/cli-matrix.md row 8 records
# [GAP-content], so an Antigravity entry is a turn marker and the reason is all
# the marker carries. Pin the text by stubbing $MEMPALACE_PYTHON to dump the
# content the hook hands it.
CONTENT_STUB="$TMP_ROOT/content-stub"
CONTENT_OUT="$TMP_ROOT/content-out"
printf '#!/bin/bash\ncat >/dev/null\nprintf "%%s" "$TRANSCRIPT_CONTENT" > "%s"\necho OK\n' \
  "$CONTENT_OUT" > "$CONTENT_STUB"
chmod +x "$CONTENT_STUB"
rm -f "$CONTENT_OUT"
printf '%s' "$AGY_STOP" | MEMPALACE_TRANSCRIPT_ENABLED=1 MEMPALACE_PYTHON="$CONTENT_STUB" \
  bash "$HOOK_SCRIPT" Stop >/dev/null 2>&1
if [ "$(cat "$CONTENT_OUT" 2>/dev/null)" = "[AGENT] Session turn completed (NO_TOOL_CALL)" ]; then
  ok "R7: the entry carries the terminationReason, not just the turn marker"
else
  bad "R7: entry content is '$(cat "$CONTENT_OUT" 2>/dev/null)', expected the reason suffix"
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

# R11 names THREE assistants, so all three are replayed. Gemini and Copilot are
# the ones whose classification branches sit closest to the new code — Gemini's
# `user_input`/`model_response` reads and Copilot's stdin-derived session id and
# workspace path — so covering only Claude would leave the adjacent branches
# untested.
OUT="$(run_hook '{"user_input":"gemini prompt"}')"
if [ -z "$OUT" ] && grep -q 'persisted user-prompt' "$TMP_ROOT/stderr"; then
  ok "R11: Gemini BeforeAgent-shaped payload still classifies as user-prompt"
else
  bad "R11: Gemini user_input regressed: $(cat "$TMP_ROOT/stderr")"
fi
OUT="$(run_hook '{"model_response":"gemini answer"}')"
if [ -z "$OUT" ] && grep -q 'persisted agent-response' "$TMP_ROOT/stderr"; then
  ok "R11: Gemini AfterModel-shaped payload still classifies as agent-response"
else
  bad "R11: Gemini model_response regressed: $(cat "$TMP_ROOT/stderr")"
fi
OUT="$(run_hook '{"session_id":"abc12345","workspace_dir":"'"$TMP_ROOT"'/wsproj","prompt":"p"}')"
if [ -z "$OUT" ] && grep -q 'persisted user-prompt to transcripts/wsproj-.*-abc12345' "$TMP_ROOT/stderr"; then
  ok "R11: Copilot payload still derives session id and workspace from stdin"
else
  bad "R11: Copilot stdin derivation regressed: $(cat "$TMP_ROOT/stderr")"
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
