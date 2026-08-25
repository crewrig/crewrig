#!/bin/bash
# test-extension-render-conformance.sh — Permanent guard for spec 0173's
# requirement 15, as amended by
# specs/0173-extension-declaration-model.delta-01.md ("build against build":
# no committed command form serves as the baseline any more, since the
# companion delta on spec 0042 de-commits it), and for spec 0180's
# requirement 18 (extension-scoped MCP server declaration, issue #1006).
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
# SANDBOXED since spec 0180 (PLAN v5 step 12, v2-F3 corrected): hello-world
# now declares an MCP server whose command names a build-output artifact
# (dist/index.js), and the reference extension's REAL dist/ is a gitignored
# `tsc` output this test must never write to or delete — cleanup() here fires
# BEFORE every render, so touching the real dist/ would destroy a developer's
# actual local build on the very first run. A full copy of scripts/,
# extension-skeleton/ and extensions/{core,library,org}/ into a mktemp'd
# sandbox (the same idiom scripts/tests/test-build-extension.sh's
# make_sandbox() uses) means the render's own REPO_DIR resolution keys
# entirely on the sandbox, a throwaway dist/index.js stub can be dropped into
# the SANDBOX's copy of hello-world with no risk to the real tree, and no
# node/tsc runtime is ever needed (the extension-render CI capability
# declares tools: [jq, yq] only).
#
# Usage:
#   bash scripts/tests/test-extension-render-conformance.sh
#
# -e is intentionally omitted: outcomes are asserted via explicit pass/fail
# counters, matching the sibling suites' idiom.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RENDER_REL="scripts/build-extension.sh"
GENERATED_CLASS="$SCRIPT_DIR/lib/extension-generated-class.json"
EXT_NAME="hello-world"
REAL_EXT_DIR="$REPO_DIR/extensions/core/$EXT_NAME"

if [ ! -f "$SCRIPT_DIR/build-extension.sh" ]; then
  echo "FATAL: cannot find $SCRIPT_DIR/build-extension.sh" >&2
  exit 2
fi
if [ ! -d "$REAL_EXT_DIR" ]; then
  echo "FATAL: cannot find $REAL_EXT_DIR" >&2
  exit 2
fi

pass=0
fail=0
ok() { echo "PASS  $1"; pass=$((pass + 1)); }
ng() { echo "FAIL  $1"; fail=$((fail + 1)); }

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

# make_sandbox — a fresh mktemp'd copy of scripts/, extension-skeleton/ and
# extensions/{core,library,org}/ (the real committed trees, so hello-world's
# actual hooks/commands/skills fixtures come along unchanged), so RENDER's
# own REPO_DIR resolution keys entirely on the sandbox and the real repo tree
# is never touched. Echoes the sandbox path.
make_sandbox() {
  local sandbox
  sandbox="$(mktemp -d "$TMP_ROOT/sandbox.XXXXXX")"
  cp -r "$SCRIPT_DIR" "$sandbox/scripts"
  cp -r "$REPO_DIR/extension-skeleton" "$sandbox/extension-skeleton"
  mkdir -p "$sandbox/extensions/core" "$sandbox/extensions/library" "$sandbox/extensions/org"
  cp -r "$REPO_DIR/extensions/core" "$sandbox/extensions/"
  cp -r "$REPO_DIR/extensions/library" "$sandbox/extensions/" 2>/dev/null || true
  cp -r "$REPO_DIR/extensions/org" "$sandbox/extensions/" 2>/dev/null || true
  echo "$sandbox"
}

SANDBOX="$(make_sandbox)"
EXT_DIR="$SANDBOX/extensions/core/$EXT_NAME"

# The dist/index.js stub (spec 0180 R16's artifact-travels-with-declaration
# assertion needs a real file to find; compiling the real TypeScript source
# is explicitly out of scope for this render — spec 0180 "Out of scope").
# Lives ONLY in the sandbox, dies with $TMP_ROOT.
mkdir -p "$EXT_DIR/dist"
cat > "$EXT_DIR/dist/index.js" <<'EOF'
// Fixture stub for scripts/tests/test-extension-render-conformance.sh
// (spec 0180 R16). Not a real MCP server — proves the artifact-copy path
// carries what the declaration names, never executed.
EOF

CLAUDE_OUT="$EXT_DIR/dist-claude-plugin"
COPILOT_OUT="$SANDBOX/dist-copilot-plugin"
ANTIGRAVITY_OUT="$SANDBOX/dist-antigravity-plugin"
GEMINI_BUILD="$SANDBOX/build"

render_out="$( cd "$SANDBOX" && bash "$RENDER_REL" --target all "$EXT_NAME" 2>&1 )"
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
dist/index.js
EOF

read -r -d '' EXPECTED_COPILOT <<'EOF' || true
plugin.json
.mcp.json
package.json
skills/greeter/SKILL.md
skills/hello/SKILL.md
hooks.json
hooks/prompt-logger.sh
hooks/shell-logger.sh
dist/index.js
EOF

read -r -d '' EXPECTED_ANTIGRAVITY <<'EOF' || true
package.json
plugin.json
mcp_config.json
skills/greeter/SKILL.md
skills/hello/SKILL.md
hooks.json
hooks/prompt-logger.sh
hooks/shell-logger.sh
dist/index.js
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

# --- spec 0180 R18(i), second half — content: the declared server NAME must
# actually be present, not merely an empty {} the file-set check would not
# catch. hello-world declares exactly one server, "default". ---
declared_mcp_names="$(jq -r '.mcpServers // {} | keys[]' "$EXT_DIR/extension.json" 2>/dev/null)"
assert_mcp_server_names() {
  # assert_mcp_server_names <label> <file> — data-driven from the SANDBOX's
  # own extension.json (never hardcoded), so a manifest that later declares
  # a second server is covered automatically and a target's emitter that
  # drops just ONE of several declared servers is caught, not only a target
  # that drops all of them.
  local label="$1" file="$2" name missing=""
  if [ ! -f "$file" ]; then
    ng "$label — $file was not produced, cannot check declared server name(s)"
    return
  fi
  while IFS= read -r name; do
    [ -z "$name" ] && continue
    jq -e --arg n "$name" '(.mcpServers // {}) | has($n)' "$file" >/dev/null 2>&1 \
      || missing="$missing $name"
  done <<< "$declared_mcp_names"
  if [ -z "$missing" ]; then
    ok "$label — rendered output carries every declared server name ($declared_mcp_names)"
  else
    ng "$label — rendered output at $file is missing declared server name(s):$missing"
  fi
}
assert_mcp_server_names "Claude MCP content" "$CLAUDE_OUT/$EXT_NAME/.mcp.json"
assert_mcp_server_names "Copilot MCP content" "$COPILOT_OUT/$EXT_NAME/.mcp.json"
assert_mcp_server_names "Antigravity MCP content" "$ANTIGRAVITY_OUT/$EXT_NAME/mcp_config.json"
assert_mcp_server_names "Gemini MCP content" "$gemini_build_dir/gemini-extension.json"

# --- spec 0180 R18(ii) — no render-time absolute path. Assert ABSENCE of the
# repo root (here, the sandbox root — the render-time equivalent of a real
# checkout), the builder's own OUTPUT_DIR, build/extensions/, dist-*-plugin
# and $HOME in every rendered MCP output. Absence, not "token presence": a
# declaration carrying BOTH a resolved absolute path and the neutral token
# would pass a presence-only check. ---
assert_no_render_time_absolute_path() {
  # assert_no_render_time_absolute_path <label> <file>
  local label="$1" file="$2" content needle
  if [ ! -f "$file" ]; then
    ng "$label — $file was not produced, cannot check for a render-time absolute path"
    return
  fi
  content="$(cat "$file")"
  for needle in "$SANDBOX" "$HOME" "build/extensions/" "dist-claude-plugin" "dist-copilot-plugin" "dist-antigravity"; do
    if [[ "$content" == *"$needle"* ]]; then
      ng "$label — $file carries the render-time path fragment '$needle'"
      return
    fi
  done
  ok "$label — no render-time absolute path in $file"
}
assert_no_render_time_absolute_path "Claude no-absolute-path" "$CLAUDE_OUT/$EXT_NAME/.mcp.json"
assert_no_render_time_absolute_path "Copilot no-absolute-path" "$COPILOT_OUT/$EXT_NAME/.mcp.json"
assert_no_render_time_absolute_path "Antigravity no-absolute-path" "$ANTIGRAVITY_OUT/$EXT_NAME/mcp_config.json"
assert_no_render_time_absolute_path "Gemini no-absolute-path" "$gemini_build_dir/gemini-extension.json"

# --- spec 0180 R18(iii) — a framework-reserved name is refused. A SEPARATE
# sandbox (mutating hello-world's own manifest would corrupt the fixture the
# assertions above depend on). ---
RESERVED_SANDBOX="$(make_sandbox)"
RESERVED_EXT_DIR="$RESERVED_SANDBOX/extensions/core/$EXT_NAME"
mkdir -p "$RESERVED_EXT_DIR/dist"
echo "// stub" > "$RESERVED_EXT_DIR/dist/index.js"
jq '.mcpServers.mempalace = {"command": "evil"}' "$RESERVED_EXT_DIR/extension.json" > "$RESERVED_EXT_DIR/extension.json.tmp" \
  && mv "$RESERVED_EXT_DIR/extension.json.tmp" "$RESERVED_EXT_DIR/extension.json"
reserved_out="$( cd "$RESERVED_SANDBOX" && bash "$RENDER_REL" --target all "$EXT_NAME" 2>&1 )"
reserved_rc=$?
if [ "$reserved_rc" -ne 0 ] && [[ "$reserved_out" == *"$EXT_NAME"* ]] && [[ "$reserved_out" == *"mempalace"* ]]; then
  ok "Reserved-name rejection — a declared 'mempalace' server makes the render exit non-zero, naming the extension and the reserved name"
else
  ng "Reserved-name rejection — expected a non-zero exit naming '$EXT_NAME' and 'mempalace'; got rc=$reserved_rc, output:"$'\n'"$reserved_out"
fi
no_target_carries=1
for f in "$RESERVED_EXT_DIR/dist-claude-plugin/$EXT_NAME/.mcp.json" \
         "$RESERVED_SANDBOX/dist-copilot-plugin/$EXT_NAME/.mcp.json" \
         "$RESERVED_SANDBOX/dist-antigravity-plugin/$EXT_NAME/mcp_config.json" \
         "$RESERVED_SANDBOX/build/extensions/$EXT_NAME/gemini-extension.json"; do
  if [ -f "$f" ] && jq -e '.mcpServers.mempalace // (.mcpServers // {} | has("mempalace"))' "$f" >/dev/null 2>&1; then
    no_target_carries=0
  fi
done
if [ "$no_target_carries" -eq 1 ]; then
  ok "Reserved-name rejection — no target's output carries a server under the reserved name"
else
  ng "Reserved-name rejection — a target's output carries the reserved-name server despite the validation failure"
fi

# --- spec 0180 R16/R18(iv) — no declaration without its artifacts. The
# exact file-set assertions above already require dist/index.js to be
# PRESENT in every target that receives a declaration naming it — this is
# that property's positive proof. Its own mutation (delete the stub from one
# target's tree; declare a second server naming a second build output and
# copy only the first) lives in the mutation-testing pass, not here. ---

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
MATCHALL_SANDBOX="$(mktemp -d "$TMP_ROOT/matchall.XXXXXX")"
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
