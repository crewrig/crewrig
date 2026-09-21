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
# §4 (spec 0206, PLAN v3 step 18, O2) — usage-capture.sh wiring. Copilot is
# the one installer whose ${COPILOT_PROJECT_DIR guard stays vacuous (nothing
# is ever substituted in that branch — the source command already names
# usage-capture.sh literally), so §4's (a)/(b) are the ONLY detector here and
# MUST fail loudly on a missing key, never skip (a skip in this position is
# indistinguishable from a pass):
#   (a) agentStop/sessionEnd each carry TWO DISTINCT commands, one naming
#       usage-capture.sh.
#   (b) the capture command is the in-repo absolute path with the correct
#       `copilot-cli <event>` argv, no unresolved token, no env prefix.
#   (c) usage-capture.sh is never install_file'd, and none appears under this
#       test's sandboxed installed-hooks directory.
# §4 also replays the OLD blanket per-array assignment as a counterfactual —
# the shape this test itself used before this diff, mirroring the Copilot
# gap the DEV logbook note flagged as unclosed — and asserts it FAILS (a),
# proving the new assertion is not passing for the wrong reason.
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
#
# This is the REAL per-entry dispatch scripts/setup-copilot-interactive.sh
# l. 422-434 applies (spec 0206) — NOT the blanket per-array assignment this
# test replayed before. The blanket form rewrites EVERY entry of
# agentStop/sessionEnd to the transcript-hook command, silently destroying
# the usage-capture.sh entry's distinctness — exactly the defect the plan
# v3 review's observation flagged ("the Copilot branch rebuilds rather than
# substitutes... those two assertions carry the whole weight there — they
# should fail loudly on a missing key rather than skip", PLAN v3-F1
# observation). §4 below proves the blanket form fails (a); this section
# only replays the correct one.
# ---------------------------------------------------------------------------
echo "§3 user-level patch transform (R3)"
ENVP="MEMPALACE_TRANSCRIPT_ENABLED=1 MEMPALACE_PYTHON=/usr/bin/python3"
HOOK_TARGET="$TMP_ROOT/copilot/hooks/mempalace-transcript.sh"
GUARD_TARGET="$REPO_DIR/hooks/worktree-git-guard.sh"
CAPTURE_TARGET="$REPO_DIR/hooks/usage-capture.sh"
PATCHED="$TMP_ROOT/patched.json"

copilot_dispatch_transform() {
  # copilot_dispatch_transform <manifest> <out> — the real per-entry
  # dispatch, parameterized so §4's counterfactual can replay the OLD
  # blanket form against the same inputs for comparison.
  jq --arg envp "$ENVP" --arg hook_path "$HOOK_TARGET" --arg guard_path "$GUARD_TARGET" --arg capture_path "$CAPTURE_TARGET" '
    (.hooks // {}) |= with_entries(
      .key as $event |
      if .key == "preToolUse"
      then .value |= map(.command = ("bash " + ($guard_path | tojson)))
      else .value |= map(
        if (.command | contains("usage-capture.sh"))
        then .command = ("bash " + ($capture_path | tojson) + " copilot-cli " + $event)
        else .command = ($envp + " bash " + ($hook_path | tojson))
        end
      )
      end
    )' \
    "$1" > "$2" 2>/dev/null
}

copilot_dispatch_transform "$MANIFEST" "$PATCHED"
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

# Lifecycle events' FIRST (transcript) entry must still point to the
# transcript hook with env prefix — unaffected by the capture dispatch.
for ev in sessionStart userPromptSubmitted postToolUse agentStop sessionEnd; do
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
# §4. usage-capture.sh wiring (spec 0206, PLAN v3 step 18, O2).
# ---------------------------------------------------------------------------
echo "§4 usage-capture.sh wiring"

for ev in agentStop sessionEnd; do
  count="$(jq -r --arg ev "$ev" '.hooks[$ev] | length' "$PATCHED" 2>/dev/null)"
  cmd0="$(jq -r --arg ev "$ev" '.hooks[$ev][0].command // ""' "$PATCHED" 2>/dev/null)"
  cmd1="$(jq -r --arg ev "$ev" '.hooks[$ev][1].command // ""' "$PATCHED" 2>/dev/null)"

  # (a) O2: this assertion is the ONLY detector on Copilot — the
  # ${COPILOT_PROJECT_DIR guard stays vacuous here (nothing is ever
  # substituted in that branch), so it must fail LOUDLY on a missing key,
  # never skip. A skip-on-missing check in this position would be
  # indistinguishable from a pass.
  if [ "$count" != "2" ]; then
    bad "(a) event '$ev' does not carry exactly two hook entries (found $count) — cannot assert distinctness"
  elif [ -n "$cmd0" ] && [ -n "$cmd1" ] && [ "$cmd0" != "$cmd1" ] \
       && { [[ "$cmd0" == *usage-capture.sh* ]] || [[ "$cmd1" == *usage-capture.sh* ]]; }; then
    ok "(a) event '$ev' carries two distinct commands, one naming usage-capture.sh"
  else
    bad "(a) event '$ev' does not carry two distinct commands with one naming usage-capture.sh (cmd0: $cmd0 | cmd1: $cmd1)"
  fi

  capture_cmd="$cmd0"
  [[ "$capture_cmd" == *usage-capture.sh* ]] || capture_cmd="$cmd1"

  # (b) O2: same "fail loudly, never skip" discipline. In-repo absolute
  # path, correct copilot-cli/<event> argv, no unresolved token, no env
  # prefix.
  if [ -z "$capture_cmd" ]; then
    bad "(b) event '$ev' has no capture command to check — cannot assert its shape"
  elif [[ "$capture_cmd" == "bash \"$CAPTURE_TARGET\" copilot-cli $ev" ]] \
     && [[ "$capture_cmd" != *'${COPILOT_PROJECT_DIR'* ]] && [[ "$capture_cmd" != *MEMPALACE_TRANSCRIPT_ENABLED* ]]; then
    ok "(b) event '$ev' capture command is the in-repo absolute path with correct argv, no token, no env prefix"
  else
    bad "(b) event '$ev' capture command malformed (got: $capture_cmd)"
  fi
done

# (c) usage-capture.sh is never install_file'd, and none appears under this
# test's sandboxed installed-hooks directory.
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

# Counterfactual — proves (a) is not passing for the wrong reason. Replays
# the OLD blanket per-array assignment (this test's own shape before this
# diff, mirroring plan v2's step-14-era Copilot defect the DEV logbook
# flagged as an unclosed gap) against the SAME shipped manifest, and asserts
# it FAILS (a): the blanket form rewrites both agentStop/sessionEnd entries
# to the identical transcript-hook command, so no entry names
# usage-capture.sh any more and the two commands are no longer distinct.
BLANKET_PATCHED="$TMP_ROOT/patched-blanket.json"
jq --arg envp "$ENVP" --arg hook_path "$HOOK_TARGET" --arg guard_path "$GUARD_TARGET" '
  (.hooks // {}) |= with_entries(
    if .key == "preToolUse"
    then .value |= map(.command = ("bash " + ($guard_path | tojson)))
    else .value |= map(.command = ($envp + " bash " + ($hook_path | tojson)))
    end
  )' \
  "$MANIFEST" > "$BLANKET_PATCHED" 2>/dev/null
blanket_cmd0="$(jq -r '.hooks.agentStop[0].command // ""' "$BLANKET_PATCHED" 2>/dev/null)"
blanket_cmd1="$(jq -r '.hooks.agentStop[1].command // ""' "$BLANKET_PATCHED" 2>/dev/null)"
if [ -n "$blanket_cmd0" ] && [ -n "$blanket_cmd1" ] && [ "$blanket_cmd0" != "$blanket_cmd1" ] \
   && { [[ "$blanket_cmd0" == *usage-capture.sh* ]] || [[ "$blanket_cmd1" == *usage-capture.sh* ]]; }; then
  bad "counterfactual: the OLD blanket assignment unexpectedly PASSES assertion (a) — it is no longer a valid regression probe"
else
  ok "counterfactual: the OLD blanket assignment correctly FAILS assertion (a) (both entries collapse to '$blanket_cmd0') — proves (a) bites"
fi

# ---------------------------------------------------------------------------
echo ""
echo "PASS: $pass  FAIL: $fail"
[ "$fail" -eq 0 ]
