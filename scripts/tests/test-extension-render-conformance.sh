#!/bin/bash
# test-extension-render-conformance.sh — Permanent guard for spec 0173's
# requirement 15, as amended by
# specs/0173-extension-declaration-model.delta-01.md ("build against build":
# no committed command form serves as the baseline any more, since the
# companion delta on spec 0042 de-commits it).
#
# Asserts the FILE SET each of the four builders produces for the reference
# extension (hello-world) against a human-readable list of expected relative
# paths — one path per line, held as a heredoc in THIS file (not a sha256
# digest fixture, and not a separate committed data file, PLAN v2-F6). The
# in-place (Gemini) block is re-aimed at the build tree's GENERATED members
# only (build/extensions/hello-world/'s manifest_class / generated_globs
# hits — gemini-extension.json, commands/hello.toml), never the verbatim
# copy of the source tree it also carries; the three plugin blocks are
# unchanged from the pre-delta model (dist-{claude,copilot,antigravity}-plugin
# stay their own gitignored roots, per the Approach of the issue #1004 PLAN).
#
# A legitimate future change that adds an output for hello-world edits one
# readable heredoc line, so the reviewer sees exactly what changed — no
# --update-golden escape hatch, and the test cannot degrade into a rubber
# stamp.
#
# Usage:
#   bash scripts/tests/test-extension-render-conformance.sh
#
# -e is intentionally omitted: outcomes are asserted via explicit pass/fail
# counters, matching the sibling suites' idiom.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RENDER="$SCRIPT_DIR/build-extension.sh"
GENERATED_CLASS="$SCRIPT_DIR/lib/extension-generated-class.json"
EXT_NAME="hello-world"
EXT_DIR="$REPO_DIR/extensions/core/$EXT_NAME"

if [ ! -f "$RENDER" ]; then
  echo "FATAL: cannot find $RENDER" >&2
  exit 2
fi

pass=0
fail=0
ok() { echo "PASS  $1"; pass=$((pass + 1)); }
ng() { echo "FAIL  $1"; fail=$((fail + 1)); }

# Clean start — every one of these roots is gitignored (.gitignore:16-18,52,55)
# and none is tracked, so removing them before the render is not a
# working-tree mutation.
CLAUDE_OUT="$EXT_DIR/dist-claude-plugin"
COPILOT_OUT="$REPO_DIR/dist-copilot-plugin"
ANTIGRAVITY_OUT="$REPO_DIR/dist-antigravity-plugin"
GEMINI_BUILD="$REPO_DIR/build"
cleanup() { rm -rf "$CLAUDE_OUT" "$COPILOT_OUT" "$ANTIGRAVITY_OUT" "$GEMINI_BUILD"; }
trap cleanup EXIT
cleanup

render_out="$( cd "$REPO_DIR" && bash "$RENDER" --target all "$EXT_NAME" 2>&1 )"
render_rc=$?
if [ "$render_rc" -eq 0 ]; then
  ok "render --target all exits 0 for $EXT_NAME"
else
  ng "render --target all failed (rc=$render_rc):"$'\n'"$render_out"
fi

# --- Expected file sets — one relative path per line ------------------------

read -r -d '' EXPECTED_GEMINI_GENERATED <<'EOF' || true
commands/hello.toml
gemini-extension.json
hooks/hooks.json
EOF

read -r -d '' EXPECTED_CLAUDE <<'EOF' || true
.claude-plugin/plugin.json
.mcp.json
CLAUDE.md
package.json
skills/greeter/SKILL.md
skills/hello/SKILL.md
hooks/hooks.json
hooks/prompt-logger.sh
hooks/shell-logger.sh
EOF

read -r -d '' EXPECTED_COPILOT <<'EOF' || true
plugin.json
skills/greeter/SKILL.md
skills/hello/SKILL.md
hooks.json
hooks/prompt-logger.sh
hooks/shell-logger.sh
EOF

read -r -d '' EXPECTED_ANTIGRAVITY <<'EOF' || true
package.json
plugin.json
skills/greeter/SKILL.md
skills/hello/SKILL.md
hooks.json
hooks/prompt-logger.sh
hooks/shell-logger.sh
EOF

# assert_file_set <label> <root-dir> <expected-heredoc>
assert_file_set() {
  local label="$1" root="$2" expected="$3"
  if [ ! -d "$root" ]; then
    ng "$label — output root $root was not produced"
    return
  fi
  local actual expected_sorted
  actual="$(cd "$root" && find . -type f | sed 's#^\./##' | sort)"
  expected_sorted="$(printf '%s\n' "$expected" | sort)"
  if [ "$actual" = "$expected_sorted" ]; then
    ok "$label — produced file set matches the expected list exactly"
  else
    ng "$label — produced file set diverges from the expected list."$'\n'"  expected:"$'\n'"$expected_sorted"$'\n'"  actual:"$'\n'"$actual"
  fi
}

assert_file_set "Claude plugin (dist-claude-plugin/$EXT_NAME)" "$CLAUDE_OUT/$EXT_NAME" "$EXPECTED_CLAUDE"
assert_file_set "Copilot plugin (dist-copilot-plugin/$EXT_NAME)" "$COPILOT_OUT/$EXT_NAME" "$EXPECTED_COPILOT"
assert_file_set "Antigravity plugin (dist-antigravity-plugin/$EXT_NAME)" "$ANTIGRAVITY_OUT/$EXT_NAME" "$EXPECTED_ANTIGRAVITY"

# In-place (Gemini) block — the GENERATED members of the build tree only,
# via the same class predicate scripts/build-extension.sh --check uses (arm
# c), never the verbatim source copy the build tree also carries.
gemini_build_dir="$GEMINI_BUILD/extensions/$EXT_NAME"
if [ -d "$gemini_build_dir" ]; then
  globs="$(jq -r '.generated_globs[]' "$GENERATED_CLASS")"
  gemini_generated=""
  while IFS= read -r rel; do
    [ -z "$rel" ] && continue
    if jq -e --arg r "$rel" '.manifest_class | index($r) != null' "$GENERATED_CLASS" >/dev/null 2>&1; then
      gemini_generated="$gemini_generated$rel"$'\n'
      continue
    fi
    while IFS= read -r glob; do
      [ -z "$glob" ] && continue
      # shellcheck disable=SC2254  # deliberate: $glob is a glob pattern
      case "$rel" in
        $glob) gemini_generated="$gemini_generated$rel"$'\n' ;;
      esac
    done <<< "$globs"
  done < <(cd "$gemini_build_dir" && find . -type f | sed 's#^\./##' | sort)
  actual_sorted="$(printf '%s' "$gemini_generated" | sed '/^$/d' | sort)"
  expected_sorted="$(printf '%s\n' "$EXPECTED_GEMINI_GENERATED" | sort)"
  if [ "$actual_sorted" = "$expected_sorted" ]; then
    ok "Gemini in-place (build/extensions/$EXT_NAME) — generated-member set matches the expected list exactly"
  else
    ng "Gemini in-place — generated-member set diverges from the expected list."$'\n'"  expected:"$'\n'"$expected_sorted"$'\n'"  actual:"$'\n'"$actual_sorted"
  fi
else
  ng "Gemini in-place — build/extensions/$EXT_NAME was not produced"
fi

# --- spec 0179 v2-F1 — RESOLVABILITY: each emitted hook command's resolved
# path must exist in that target's own rendered tree. An exact file-set
# match (above) proves the handler files are PRESENT; it does not prove the
# COMMAND STRING a target actually reads points at them — a translator that
# emits the wrong root-token substitution (or the wrong relative path for
# Antigravity's working-directory rule) can pass every file-set assertion
# above while still shipping a hook nothing can execute. This is the one
# hole the seat flagged that no other check closes, and it lands WITH this
# file's file-set work, not after it. ---
assert_command_resolves() {
  # assert_command_resolves <label> <hook-file> <root-dir> <root-token-or-empty>
  local label="$1" hook_file="$2" root_dir="$3" root_token="$4"
  if [ ! -f "$hook_file" ]; then
    ng "$label — $hook_file was not produced, cannot check command resolvability"
    return
  fi
  local commands checked=0
  commands="$(jq -r '.. | objects | .command? // empty' "$hook_file" 2>/dev/null)"
  while IFS= read -r cmd; do
    [ -z "$cmd" ] && continue
    checked=$((checked + 1))
    local resolved rel
    if [ -n "$root_token" ]; then
      resolved="${cmd//$root_token/$root_dir}"
    else
      resolved="$cmd"
    fi
    # Extract the path-looking token (starts with the root dir, or is a
    # bare relative path for Antigravity's working-directory rule) that
    # follows the invoking shell word (e.g. "bash <path>").
    rel="$(awk '{for(i=1;i<=NF;i++) if ($i ~ /\.(sh)$/) print $i}' <<< "$resolved" | head -1)"
    [ -n "$rel" ] || continue
    case "$rel" in
      /*) ;;
      *) rel="$root_dir/$rel" ;;
    esac
    if [ -f "$rel" ]; then
      ok "$label — emitted command's resolved path exists: $rel"
    else
      ng "$label — emitted command '$cmd' resolves to '$rel', which does NOT exist"
    fi
  done <<< "$commands"
  [ "$checked" -gt 0 ] || ng "$label — no command found in $hook_file to check"
}

assert_command_resolves "Claude resolvability" "$CLAUDE_OUT/$EXT_NAME/hooks/hooks.json" "$CLAUDE_OUT/$EXT_NAME" '${CLAUDE_PLUGIN_ROOT}'
assert_command_resolves "Copilot resolvability" "$COPILOT_OUT/$EXT_NAME/hooks.json" "$COPILOT_OUT/$EXT_NAME" '${COPILOT_PLUGIN_ROOT}'
assert_command_resolves "Antigravity resolvability" "$ANTIGRAVITY_OUT/$EXT_NAME/hooks.json" "$ANTIGRAVITY_OUT/$EXT_NAME" ""
assert_command_resolves "Gemini resolvability" "$gemini_build_dir/hooks/hooks.json" "$gemini_build_dir" '${extensionPath}'

# --- spec 0179 R8 — an omitted matcher renders as each target's own
# match-all form. hello-world's own hooks always declare an explicit
# matcher, so this needs a dedicated fixture — a sandboxed synthetic
# extension outside extensions/, rendered directly, cleaned up on exit. ---
MATCHALL_SANDBOX="$(mktemp -d)"
trap 'rm -rf "$MATCHALL_SANDBOX"; cleanup' EXIT
MATCHALL_EXT="$MATCHALL_SANDBOX/extensions/core/matchall"
mkdir -p "$MATCHALL_EXT"
cat > "$MATCHALL_EXT/extension.json" <<'EOF'
{"name":"matchall","version":"0.0.1","description":"fixture",
 "hooks":[{"id":"everything","event":"PreToolUse","command":"echo hi"}]}
EOF
cp -r "$REPO_DIR/scripts" "$MATCHALL_SANDBOX/scripts"
mkdir -p "$MATCHALL_SANDBOX/extensions/library" "$MATCHALL_SANDBOX/extensions/org"
( cd "$MATCHALL_SANDBOX" && bash scripts/build-extension.sh --target all matchall ) >/dev/null 2>&1

claude_matcher="$(jq -r '.hooks.PreToolUse[0].matcher' "$MATCHALL_EXT/dist-claude-plugin/matchall/hooks/hooks.json" 2>/dev/null)"
gemini_matcher="$(jq -r '.hooks.BeforeTool[0].matcher' "$MATCHALL_SANDBOX/build/extensions/matchall/hooks/hooks.json" 2>/dev/null)"
copilot_matcher="$(jq -r '.hooks.preToolUse[0].matcher' "$MATCHALL_SANDBOX/dist-copilot-plugin/matchall/hooks.json" 2>/dev/null)"
antigravity_matcher="$(jq -r '.["matchall-hooks"].PreToolUse[0].matcher' "$MATCHALL_SANDBOX/dist-antigravity-plugin/matchall/hooks.json" 2>/dev/null)"

if [ "$claude_matcher" = "" ]; then
  ok "Match-all default — Claude renders the omitted matcher as its own empty-string match-all form"
else
  ng "Match-all default — Claude matcher was '$claude_matcher', expected the empty string"
fi
if [ "$gemini_matcher" = ".*" ]; then
  ok "Match-all default — Gemini renders the omitted matcher as '.*'"
else
  ng "Match-all default — Gemini matcher was '$gemini_matcher', expected '.*'"
fi
if [ "$copilot_matcher" = ".*" ]; then
  ok "Match-all default — Copilot renders the omitted matcher as '.*'"
else
  ng "Match-all default — Copilot matcher was '$copilot_matcher', expected '.*'"
fi
if [ "$antigravity_matcher" = ".*" ]; then
  ok "Match-all default — Antigravity renders the omitted matcher as '.*'"
else
  ng "Match-all default — Antigravity matcher was '$antigravity_matcher', expected '.*'"
fi

echo ""
echo "Results: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
