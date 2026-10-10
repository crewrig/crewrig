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
#     handler command names `hooks/worktree-git-guard.ts`.
#   R28 (delta-03) — the deployment rewrites the guard command to the absolute
#     REPOSITORY path of `hooks/worktree-git-guard.ts` — never the installed
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
GUARD_SCRIPT="$REPO_DIR/hooks/worktree-git-guard.ts"
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

# R22 — the consent text must state the true write volume (one entry per execution-loop end,
# no turn-start entry). Spec 0256 requirement 9 (PR D2): no longer read from the text of the setup
# script. scripts/tests/setup-retarget-antigravity-transcript.test.ts runs the TypeScript entry with the
# transcripts question answered yes and asserts the consent text it PRINTS. Pinned against the
# unchanged shell by the golden cell antigravity/transcript-optin-yes (its stdout holds the text).

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
# whose handler command names `hooks/worktree-git-guard.ts` (spec 0153 R1/R4).
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
if jq -e '."crewrig-worktree-git-guard".PreToolUse[0].hooks[0].command | contains("hooks/worktree-git-guard.ts")' \
     "$MANIFEST" >/dev/null 2>&1; then
  ok "R27: the guard handler command names hooks/worktree-git-guard.ts"
else
  bad "R27: the guard handler command does not name hooks/worktree-git-guard.ts"
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
# Spec 0247 R21 retires the installed copy: the hook runs from the checkout.
if [ ! -e "$HOOK_TARGET_A" ]; then
  ok "R13: no hook script copy is installed under the assistant's own directory (spec 0247 R21)"
else
  bad "R13: a hook script copy was installed at $HOOK_TARGET_A"
fi
if [ ! -e "$HOOK_TARGET_A" ]; then
  ok "R13: no installed hook script to make executable (spec 0247 R21)"
else
  bad "R13: an installed hook script exists at $HOOK_TARGET_A"
fi
if [ -f "$TARGET_A" ] && jq -e . "$TARGET_A" >/dev/null 2>&1; then
  ok "R14: manifest deployed to the customization root as valid JSON"
else
  bad "R14: manifest not deployed, or not valid JSON"
fi

# Every TRANSCRIPT command must name the in-repo hook by ABSOLUTE path, in the
# direct form (spec 0247 R20, R21): no installed copy, no environment prefix.
REPO_TS_A="$(cd "$REPO_DIR/hooks" && pwd -P)/mempalace-transcript.ts"
if jq -e --arg hp "node \"$REPO_TS_A\" antigravity-cli " \
     '."crewrig-mempalace-transcript" | [.. | .command? // empty] | length > 0 and all(startswith($hp))' \
     "$TARGET_A" >/dev/null 2>&1; then
  ok "R14: every transcript command names the in-repo hook by absolute path (spec 0247 R21)"
else
  bad "R14: a transcript command does not name the in-repo hook by absolute path"
fi
if jq -e '."crewrig-mempalace-transcript" | [.. | .command? // empty] | all(contains("MEMPALACE_TRANSCRIPT_ENABLED") | not)' \
     "$TARGET_A" >/dev/null 2>&1; then
  ok "R14: no transcript command carries an env prefix (spec 0247 R20)"
else
  bad "R14: a transcript command carries an env prefix"
fi
if grep -q '\$PWD' "$TARGET_A"; then
  bad "R4: deployed manifest reintroduced \$PWD"
else
  ok "R4: deployed manifest is free of \$PWD"
fi

# R28 (delta-03) — the deployed guard command names the REPOSITORY guard path,
# never the installed transcript hook, with no env prefix and no event argument.
# `contains`, NOT exact equality: the rewrite's `tojson` quotes the path, so the
# deployed command is `node "/abs/repo/hooks/worktree-git-guard.ts"` and an exact
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
# Spec 0247 R23(c): only `crewrig-mempalace-transcript` (and the guard's named
# hook) is the framework's; a named hook of any other name is written verbatim.
if jq -e '."grouped-and-disabled".PreToolUse[0].hooks[0].command == "ORIG"' \
     "$TARGET_D" >/dev/null 2>&1; then
  ok "a grouped event's INNER handler command of another named hook is left verbatim (spec 0247 R23(c))"
else
  bad "a grouped event's inner handler command was not rewritten"
fi
if jq -e '."grouped-and-disabled".PreToolUse[0] | has("command") | not' "$TARGET_D" >/dev/null 2>&1; then
  ok "no bogus 'command' is bolted onto the group object itself"
else
  bad "a 'command' key was injected at the group level, where the CLI never reads it"
fi
if jq -e '."grouped-and-disabled".Stop[0].command == "ORIG"' \
     "$TARGET_D" >/dev/null 2>&1; then
  ok "a flat event's handler command of another named hook is left verbatim (spec 0247 R23(c))"
else
  bad "a flat event's handler command was not rewritten"
fi

# --- §4. The setup script's own wiring (structural) -------------------------
# The interactive script cannot run in CI, so assert its shape instead.
echo "§4 setup script wiring (R12/R16, structural)"

# The DECLARATION of the Antigravity setup (spec 0256 requirement 9, PR D1), read through the
# printer: these structural assertions no longer read the text of the setup script, which becomes
# a forwarding shim at the switch PR. Vacuity guard: an empty declaration (the printer exits 1
# with nothing on stdout) or a missing fact fails the suite instead of passing it.
DECL_PRINTER="$REPO_DIR/scripts/tests/lib/print-setup-declarations.ts"
DECL="$(node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON "$DECL_PRINTER" antigravity 2>/dev/null)"
DECL_RC=$?
if [ "$DECL_RC" -eq 0 ] && [ -n "$DECL" ]; then
  ok "the Antigravity setup declaration is readable and non-empty"
else
  bad "the Antigravity setup declaration is empty or unreadable (printer exit $DECL_RC) — the declaration assertions below would be vacuous"
fi
# decl_fact <key>: the value of one `<key>=<value>` fact; empty when the fact is absent.
# A here-string, not a pipe: under `pipefail` a `grep -m1` upstream SIGPIPE would misreport.
decl_fact() { grep -m1 "^$1=" <<<"$DECL" | cut -d= -f2-; }
# decl_has_step <id>: the declaration lists `step <N>: <id>`.
decl_has_step() { grep -qx "step [0-9]*: $1" <<<"$DECL"; }

# Pinned against the unchanged shell by the golden cells transcript-optin-yes and
# transcript-optin-yes-declined (scripts/tests/fixtures/setup-golden/antigravity/), whose stdout
# holds both prompts and whose tree holds the deployed manifest.
OFFER_HEADER="$(decl_fact prompt.transcripts.header)"
if [ -n "$OFFER_HEADER" ] && [ "$OFFER_HEADER" = 'Enable automatic session recording to MemPalace? (opt-in)' ]; then
  ok "R12: the opt-in offer prompt is declared"
else
  bad "R12: the opt-in offer prompt is not declared (got '$OFFER_HEADER')"
fi
CONFIRM_HEADER="$(decl_fact prompt.transcripts-confirm.header)"
if [ -n "$CONFIRM_HEADER" ] && [ "$CONFIRM_HEADER" = 'Apply?' ]; then
  ok "R12: the second confirmation prompt is declared"
else
  bad "R12: the second confirmation prompt is not declared (got '$CONFIRM_HEADER')"
fi
if decl_has_step session-recording && [ "$(decl_fact hooks.channel)" = "agy-json" ]; then
  ok "the setup declares the session-recording step that deploys the manifest (the deployment helper's call site)"
else
  bad "the setup does not declare the session-recording step with the agy-json channel"
fi
# R12 asks for the offer to default to declining: `no` must be the first option offered to
# fzf, as in all three siblings.
OFFER_OPTIONS="$(decl_fact prompt.transcripts.options)"
case "$OFFER_OPTIONS" in
  no,*) ok "R12: the offer defaults to 'no'" ;;
  *)    bad "R12: the offer does not default to 'no' (options '$OFFER_OPTIONS')" ;;
esac
# R16 (the gate) and R24 (the call site's argument list) — spec 0256 requirement 9 (PR D2): they were
# asserted by extracting the transcript block from the text of the setup script and running it with
# `fzf` and the deployment stubbed. They are now asserted by RUNNING the TypeScript entry in the
# golden sandbox (scripts/tests/setup-retarget-antigravity-transcript.test.ts):
#   - declining the offer, the offer decline holding against a later `Apply?` yes, declining `Apply?`
#     deploy nothing; accepting both prompts lands hooks.json (the canary that the run did something);
#   - each of the six arguments of the deployment (manifest source, hook copy retired, hook directory,
#     manifest target, EMPTY env prefix, guard source) is observed on the manifest that LANDS: both named
#     hooks come from the shipped manifest, every transcript command is the direct in-repo form with no
#     MEMPALACE_TRANSCRIPT_ENABLED prefix, the guard command names the repository guard, no hook copy is
#     installed, and the target is ~/.gemini/config/hooks.json at 0600.
# Pinned against the unchanged shell by the golden cells antigravity/transcript-optin-no,
# transcript-optin-yes and transcript-optin-yes-declined. The R24 text mutations of the call site have no
# TypeScript counterpart (there is no argument list to empty: the call is typed), so each is retired
# with the landed-manifest assertion above that observes the same property.
# The deployment target must be the customization root that is proven to fire,
# not the application-data directory.
# Pinned against the unchanged shell by the golden cell transcript-optin-yes (its tree holds
# .gemini/config/hooks.json) and by the R24 arg-4 case above.
HOOKS_FILE="$(decl_fact hooks.file)"
if [ -n "$HOOKS_FILE" ] && [ "$HOOKS_FILE" = '<HOME>/.gemini/config/hooks.json' ]; then
  ok "R14: the deployment target is the global customization root"
else
  bad "R14: the declared deployment target is '$HOOKS_FILE', not <HOME>/.gemini/config/hooks.json"
fi

# --- §5. The hook's own Antigravity handling ---------------------------------
# Hermetic through a loopback stub daemon and a mock token file (spec 0247 R32,
# delta-02): the hook posts its JSON-RPC request to the stub that
# MEMPALACE_MCP_HOST/PORT name and, on success, logs
# `persisted <ENTRY_TYPE> to transcripts/<ROOM>`. The stub
# (scripts/tests/fixtures/mempalace-transcript/stub-daemon.ts) answers every
# call with success and records the request, so the classification, the payload
# content and the room id are observed at the daemon boundary, without a live
# network — for the shell hook and its TypeScript successor alike.
echo "§5 hook payload handling (R7/R8/R9/R10/R11)"

CONTENT_OUT="$TMP_ROOT/content-out"
STUB_DAEMON="$REPO_DIR/scripts/tests/fixtures/mempalace-transcript/stub-daemon.ts"
STUB_LOG="$TMP_ROOT/stub-requests.jsonl"
STUB_PORT_FILE="$TMP_ROOT/stub-port"
: > "$STUB_LOG"
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON "$STUB_DAEMON" \
  --port-file "$STUB_PORT_FILE" --log "$STUB_LOG" --mode ok \
  >"$TMP_ROOT/stub-stdout" 2>"$TMP_ROOT/stub-stderr" &
STUB_PID=$!
stub_tries=0
while [ ! -s "$STUB_PORT_FILE" ]; do
  stub_tries=$((stub_tries + 1))
  if [ "$stub_tries" -gt 50 ]; then
    kill "$STUB_PID" 2>/dev/null || true
    echo "FATAL: stub daemon did not report a port within 5 s: $(cat "$TMP_ROOT/stub-stderr" 2>/dev/null)" >&2
    exit 2
  fi
  sleep 0.1
done
STUB_PORT="$(tr -d '[:space:]' < "$STUB_PORT_FILE")"

MOCK_TOKEN="$TMP_ROOT/mock-token"
echo "test-token" > "$MOCK_TOKEN"

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
  printf '%s' "$payload" | MEMPALACE_MCP_HOST=127.0.0.1 MEMPALACE_MCP_PORT="$STUB_PORT" NO_PROXY=127.0.0.1 no_proxy=127.0.0.1 \
    MEMPALACE_TRANSCRIPT_ENABLED=1 MEMPALACE_DAEMON_TOKEN_FILE="$MOCK_TOKEN" MEMPALACE_PYTHON="$PYSTUB" \
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

# The source-text check "exactly one EXIT trap in the hook" was removed with the
# migration (parent spec 0215 R13, second exception; spec 0247 delta-02): it
# read a property only a shell file has. Its behaviour — the acknowledgement on
# every path, exactly once — is asserted black-box by
# scripts/tests/mempalace-transcript-args.test.ts,
# "the acknowledgement on every Antigravity path (R5)".

# THE ENTRY'S CONTENT. Everything above pins the entry TYPE and the room; nothing
# pinned the text. Deleting the Antigravity `Stop)` case arm left both suites
# green, because the generic Claude `Stop` branch below it sets the same
# ENTRY_TYPE — only the `(terminationReason)` suffix silently vanished. That
# Pin the text by capturing the payload content passed to the mock curl.
rm -f "$CONTENT_OUT"
: > "$STUB_LOG"
printf '%s' "$AGY_STOP" | MEMPALACE_MCP_HOST=127.0.0.1 MEMPALACE_MCP_PORT="$STUB_PORT" NO_PROXY=127.0.0.1 no_proxy=127.0.0.1 \
  MEMPALACE_TRANSCRIPT_ENABLED=1 MEMPALACE_DAEMON_TOKEN_FILE="$MOCK_TOKEN" \
  bash "$HOOK_SCRIPT" Stop >/dev/null 2>&1
# The content the stub received, as the mock curl wrote it (no trailing newline).
if [ -s "$STUB_LOG" ]; then
  jq -s -j 'last | .body.params.arguments.content // empty' "$STUB_LOG" > "$CONTENT_OUT" 2>/dev/null
fi
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

kill "$STUB_PID" 2>/dev/null || true
wait "$STUB_PID" 2>/dev/null || true

echo ""
echo "§6 usage-capture statusline wiring (spec 0206, PLAN v3 step 18)"

# The matching pair step 18 names for the Antigravity statusline channel:
# statusLine.command is `node "<in-repo absolute path>"` (spec 0243 R16), and no
# antigravity-statusline-shim file is installed under ~/.gemini/antigravity-cli/
# (the same "wired by in-repo absolute path, never copied" class as
# usage-capture itself — §4 above already covers the deployment-gate
# style rigor for the transcript hooks). The install and rewrite are the real
# scripts/hook-wiring.ts calls scripts/setup-antigravity-interactive.sh makes
# (spec 0243 R19, R23), not a replay of a jq transform.
STATUSLINE_SRC="$REPO_DIR/hooks/antigravity-statusline-shim.ts"
STATUSLINE_SH="$REPO_DIR/hooks/antigravity-statusline-shim.sh"
[ -f "$STATUSLINE_SRC" ] || { echo "FATAL: missing $STATUSLINE_SRC" >&2; exit 2; }
[ -f "$STATUSLINE_SH" ] || { echo "FATAL: missing $STATUSLINE_SH" >&2; exit 2; }
STATUSLINE_ABS="$(cd "$(dirname "$STATUSLINE_SRC")" && pwd -P)/$(basename "$STATUSLINE_SRC")"
STATUSLINE_SH_ABS="$(cd "$(dirname "$STATUSLINE_SH")" && pwd -P)/$(basename "$STATUSLINE_SH")"
STATUSLINE_DIRECT="node \"$STATUSLINE_ABS\""
agy_wiring() {
  node --disable-warning=ExperimentalWarning --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
    "$REPO_DIR/scripts/hook-wiring.ts" "$@" --repo "$REPO_DIR"
}
file_mode_6() { stat -c %a "$1" 2>/dev/null || stat -f %Lp "$1" 2>/dev/null; }

# The "enable" branch: the value was previously empty (R20's precondition).
AGY_SETTINGS="$TMP_ROOT/antigravity-cli-settings.json"
AGY_MARKER="$TMP_ROOT/antigravity-statusline-marker.json"
echo '{"theme":"dark"}' > "$AGY_SETTINGS"
agy_wiring statusline install --settings "$AGY_SETTINGS" --marker "$AGY_MARKER" >/dev/null 2>&1
rc=$?

installed_cmd="$(jq -r '.statusLine.command // ""' "$AGY_SETTINGS" 2>/dev/null)"
if [ "$rc" -eq 0 ] && [ "$installed_cmd" = "$STATUSLINE_DIRECT" ] \
   && [ "$(jq -r '.installedStatusLineCommand' "$AGY_MARKER")" = "$STATUSLINE_DIRECT" ] \
   && [ "$(jq -r '.priorStatusLineCommand' "$AGY_MARKER")" = "" ] \
   && [ "$(jq -r '.theme' "$AGY_SETTINGS")" = "dark" ]; then
  ok "statusLine.command is wired to the direct node form of antigravity-statusline-shim.ts, marker and other keys recorded"
else
  bad "statusLine.command wiring malformed (rc=$rc, got: $installed_cmd, want: $STATUSLINE_DIRECT)"
fi
if [ "$(file_mode_6 "$AGY_SETTINGS")" = "600" ] && [ "$(file_mode_6 "$AGY_MARKER")" = "600" ]; then
  ok "the install leaves settings.json and the marker at 0600"
else
  bad "the install left modes $(file_mode_6 "$AGY_SETTINGS")/$(file_mode_6 "$AGY_MARKER"), want 600/600"
fi
echo '{"statusLine":{"command":"echo prior"}}' > "$TMP_ROOT/agy-foreign.json"
agy_wiring statusline install --settings "$TMP_ROOT/agy-foreign.json" --marker "$TMP_ROOT/agy-foreign-marker.json" >/dev/null 2>&1
if [ $? -ne 0 ] && [ "$(jq -r '.statusLine.command' "$TMP_ROOT/agy-foreign.json")" = "echo prior" ] && [ ! -e "$TMP_ROOT/agy-foreign-marker.json" ]; then
  ok "install refuses a statusLine.command this framework did not install and writes nothing (R20)"
else
  bad "install touched a foreign statusLine.command"
fi

# Rewrite of an installation made by the previous release (bare .sh path), and
# the crash states of the D5 write order (v1-F6): (a) marker, (b) settings,
# (c) marker again.
rewrite_case() {
  local label="$1" settings_cmd="$2" marker_json="$3" want_marker_prev="$4"
  echo "{\"statusLine\":{\"command\":$(jq -n --arg c "$settings_cmd" '$c')},\"keep\":1}" > "$AGY_SETTINGS"
  printf '%s\n' "$marker_json" > "$AGY_MARKER"
  agy_wiring statusline rewrite --settings "$AGY_SETTINGS" --marker "$AGY_MARKER" >/dev/null 2>&1
  local rc=$?
  if [ "$rc" -eq 0 ] && [ "$(jq -r '.statusLine.command' "$AGY_SETTINGS")" = "$STATUSLINE_DIRECT" ] \
     && [ "$(jq -r '.installedStatusLineCommand' "$AGY_MARKER")" = "$STATUSLINE_DIRECT" ] \
     && [ "$(jq -r 'has("previousInstalledStatusLineCommand")' "$AGY_MARKER")" = "$want_marker_prev" ] \
     && [ "$(jq -r '.keep' "$AGY_SETTINGS")" = "1" ]; then
    ok "$label"
  else
    bad "$label (rc=$rc, settings=$(jq -c . "$AGY_SETTINGS"), marker=$(jq -c . "$AGY_MARKER"))"
  fi
}
LEGACY_MARKER="$(jq -nc --arg c "$STATUSLINE_SH_ABS" '{priorStatusLineCommand:"echo prior", installedStatusLineCommand:$c, installedBy:"t"}')"
rewrite_case "rewrite: a bare .sh statusLine.command becomes the direct form; the marker follows without a transitional key" \
  "$STATUSLINE_SH_ABS" "$LEGACY_MARKER" false
if [ "$(jq -r '.priorStatusLineCommand' "$AGY_MARKER")" = "echo prior" ]; then
  ok "rewrite keeps the recorded prior status-line command"
else
  bad "rewrite lost priorStatusLineCommand"
fi
cp "$AGY_SETTINGS" "$AGY_SETTINGS.done"; cp "$AGY_MARKER" "$AGY_MARKER.done"
agy_wiring statusline rewrite --settings "$AGY_SETTINGS" --marker "$AGY_MARKER" >/dev/null 2>&1
if cmp -s "$AGY_SETTINGS" "$AGY_SETTINGS.done" && cmp -s "$AGY_MARKER" "$AGY_MARKER.done"; then
  ok "a second rewrite writes nothing"
else
  bad "a second rewrite changed a file"
fi
AFTER_A="$(jq -nc --arg n "$STATUSLINE_DIRECT" --arg o "$STATUSLINE_SH_ABS" \
  '{priorStatusLineCommand:"", installedStatusLineCommand:$n, previousInstalledStatusLineCommand:$o, installedBy:"t"}')"
rewrite_case "crash after write (a): settings still hold the old command, the marker names both; the next run completes the rewrite" \
  "$STATUSLINE_SH_ABS" "$AFTER_A" false
rewrite_case "crash after write (b): settings already hold the new command; the next run drops the transitional key" \
  "$STATUSLINE_DIRECT" "$AFTER_A" false
FOREIGN_MARKER="$(jq -nc --arg c "$STATUSLINE_SH_ABS" '{priorStatusLineCommand:"", installedStatusLineCommand:$c, installedBy:"t"}')"
echo '{"statusLine":{"command":"echo foreign"}}' > "$AGY_SETTINGS"
printf '%s\n' "$FOREIGN_MARKER" > "$AGY_MARKER"
cp "$AGY_SETTINGS" "$AGY_SETTINGS.orig"
agy_wiring statusline rewrite --settings "$AGY_SETTINGS" --marker "$AGY_MARKER" >/dev/null 2>&1
if cmp -s "$AGY_SETTINGS" "$AGY_SETTINGS.orig"; then
  ok "rewrite leaves a statusLine.command that is neither recorded value untouched"
else
  bad "rewrite changed a foreign statusLine.command"
fi
# The three structural greps on the setup text (the transitional previousInstalledStatusLineCommand
# is recognised as the framework's, the 0600 atomic writer with no `jq > .tmp && mv` left, the shim never
# install_file'd) are retargeted by spec 0256 requirement 9 (PR D2) to runs of the TypeScript entry:
# scripts/tests/setup-retarget-antigravity-transcript.test.ts asserts that `remove` from the transitional state restores the prior command,
# that the install lands settings.json and the marker at 0600 with no `.tmp` sibling, and that no copy of
# the shim appears under the home. Pinned against the unchanged shell by the golden cells
# antigravity/usage-capture-absent-yes and usage-capture-installed-remove.
SANDBOX_AGY_HOME="$TMP_ROOT/gemini-antigravity-cli"
mkdir -p "$SANDBOX_AGY_HOME"
if [ -f "$SANDBOX_AGY_HOME/antigravity-statusline-shim.sh" ]; then
  bad "antigravity-statusline-shim.sh unexpectedly exists under the sandboxed ~/.gemini/antigravity-cli/ ($SANDBOX_AGY_HOME)"
else
  ok "no antigravity-statusline-shim.sh under the sandboxed ~/.gemini/antigravity-cli/ ($SANDBOX_AGY_HOME)"
fi

echo ""
echo "§7 usage-capture statusline shim prior command (spec 0241)"

USAGE_ROOT_7="$TMP_ROOT/usage-state-7"
mkdir -p "$USAGE_ROOT_7/state"
STATE_MARKER_7="$USAGE_ROOT_7/state/antigravity-statusline.json"

# Test-only capture override (spec 0243 R9): with CREWRIG_USAGE_CAPTURE_TEST set,
# the shim runs this script as a separate node process with
# `--cli <cli> --event <event> --payload-file <file>`. The retired
# scripts/lib/usage-capture/cli.js used to be the default target of that contract;
# this stub stands in for it and records the staged payload.
CAPTURE_OVERRIDE_SCRIPT="$TMP_ROOT/capture-override.js"
cat > "$CAPTURE_OVERRIDE_SCRIPT" <<'EOF'
const fs = require('fs');
const file = process.argv[process.argv.indexOf('--payload-file') + 1];
fs.writeFileSync(process.env.MOCK_PAYLOAD_OUT, fs.readFileSync(file));
EOF
chmod +x "$CAPTURE_OVERRIDE_SCRIPT"

MOCK_PAYLOAD_OUT="$TMP_ROOT/payload-7.out"

run_shim_7() {
  rm -f "$MOCK_PAYLOAD_OUT"
  CREWRIG_USAGE_ROOT="$USAGE_ROOT_7" \
  CREWRIG_USAGE_CAPTURE_TEST=1 \
  CREWRIG_USAGE_CAPTURE_CLI="$CAPTURE_OVERRIDE_SCRIPT" \
  MOCK_PAYLOAD_OUT="$MOCK_PAYLOAD_OUT" \
    bash "$STATUSLINE_SH"
}

# Case A: Missing state marker file -> stdout empty, exit 0, capture override script ran
rm -f "$STATE_MARKER_7"
SHIM_OUT="$(printf '{"turn":1}' | run_shim_7)"
SHIM_STATUS=$?
if [ $SHIM_STATUS -eq 0 ] && [ -z "$SHIM_OUT" ] && [ "$(cat "$MOCK_PAYLOAD_OUT" 2>/dev/null)" = '{"turn":1}' ]; then
  ok "Case A: missing marker file emits nothing on stdout, exits 0, runs the capture override script"
else
  bad "Case A failed: exit=$SHIM_STATUS out='$SHIM_OUT' payload='$(cat "$MOCK_PAYLOAD_OUT" 2>/dev/null)'"
fi

# Case B: Configured priorStatusLineCommand -> stdin piped to prior cmd, stdout reproduced, exits 0, capture override script ran
echo '{"priorStatusLineCommand":"cat | sed s/turn/epoch/"}' > "$STATE_MARKER_7"
SHIM_OUT="$(printf '{"turn":1}' | run_shim_7)"
SHIM_STATUS=$?
if [ $SHIM_STATUS -eq 0 ] && [ "$SHIM_OUT" = '{"epoch":1}' ] && [ "$(cat "$MOCK_PAYLOAD_OUT" 2>/dev/null)" = '{"turn":1}' ]; then
  ok "Case B: configured command receives payload and emits output, exits 0, runs the capture override script"
else
  bad "Case B failed: exit=$SHIM_STATUS out='$SHIM_OUT' payload='$(cat "$MOCK_PAYLOAD_OUT" 2>/dev/null)'"
fi

# Case C: Failing priorStatusLineCommand -> shim exits 0, capture override script ran
echo '{"priorStatusLineCommand":"cat >/dev/null; exit 7"}' > "$STATE_MARKER_7"
SHIM_OUT="$(printf '{"turn":1}' | run_shim_7)"
SHIM_STATUS=$?
if [ $SHIM_STATUS -eq 0 ] && [ "$(cat "$MOCK_PAYLOAD_OUT" 2>/dev/null)" = '{"turn":1}' ]; then
  ok "Case C: failing prior command does not fail shim (exits 0), runs the capture override script"
else
  bad "Case C failed: exit=$SHIM_STATUS payload='$(cat "$MOCK_PAYLOAD_OUT" 2>/dev/null)'"
fi

# Case D: Empty string priorStatusLineCommand -> stdout empty, exit 0, capture override script ran
echo '{"priorStatusLineCommand":""}' > "$STATE_MARKER_7"
SHIM_OUT="$(printf '{"turn":1}' | run_shim_7)"
SHIM_STATUS=$?
if [ $SHIM_STATUS -eq 0 ] && [ -z "$SHIM_OUT" ] && [ "$(cat "$MOCK_PAYLOAD_OUT" 2>/dev/null)" = '{"turn":1}' ]; then
  ok "Case D: empty string prior command emits nothing on stdout, exits 0, runs the capture override script"
else
  bad "Case D failed: exit=$SHIM_STATUS out='$SHIM_OUT' payload='$(cat "$MOCK_PAYLOAD_OUT" 2>/dev/null)'"
fi

echo ""
echo "Summary: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
