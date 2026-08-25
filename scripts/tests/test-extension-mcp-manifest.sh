#!/bin/bash
# test-extension-mcp-manifest.sh — Regression tests for the extension-scoped
# MCP manifest validators and translator (spec 0180, issue #1006):
#   ext_validate_mcp_shape  — R1/R5/R15: transport/command/url/vocabulary.
#   ext_validate_mcp_names  — R12: framework-reserved names refused.
#   ext_validate_mcp_tokens — R6/R9: the positional token rule (allowlist in
#                             command/args, denylist in env/headers values).
#   ext_mcp_native          — R2/R6/R7/R8: shape translation + per-target
#                             root-token resolution.
# All four in scripts/lib/extension-manifest.sh.
#
# HERMETIC: no HOME writes, no live vendor CLI calls. Every fixture is a
# throwaway temp file under a temp root removed on exit.
#
# Usage:
#   bash scripts/tests/test-extension-mcp-manifest.sh
#
# -e is intentionally omitted: outcomes are asserted via explicit counters.
set -uo pipefail

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
MANIFEST_LIB="$REPO_DIR/scripts/lib/extension-manifest.sh"

if [ ! -f "$MANIFEST_LIB" ]; then
  echo "FATAL: missing $MANIFEST_LIB" >&2
  exit 2
fi
command -v jq >/dev/null 2>&1 || { echo "FATAL: jq is required for this test" >&2; exit 2; }

# shellcheck source=scripts/lib/extension-manifest.sh
source "$MANIFEST_LIB"

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

pass=0
fail=0
ok()  { echo "  ok: $1"; pass=$((pass + 1)); }
bad() { echo "  FAIL: $1" >&2; fail=$((fail + 1)); }

write_manifest() {
  # write_manifest <json> -> prints the temp file path. mktemp's template
  # must end in the X run (BSD mktemp does not substitute a suffix after
  # it, unlike GNU's --suffix — a trailing ".json" here silently returns the
  # literal template string on every call, colliding on the second use).
  local json="$1" f
  f="$(mktemp "$TMP_ROOT/ext.XXXXXX")"
  printf '%s' "$json" > "$f"
  echo "$f"
}

RESERVED_JSON="$(jq -cn '$ARGS.positional' --args ${MCP_RESERVED_NAMES[@]+"${MCP_RESERVED_NAMES[@]}"})"

# ---------------------------------------------------------------------------
echo "1. ext_validate_mcp_shape — R1/R5/R15"
# ---------------------------------------------------------------------------
m="$(write_manifest '{"name":"x"}')"
ext_validate_mcp_shape "$m" >/dev/null 2>&1 && ok "absent mcpServers section stays valid (R1)" \
  || bad "absent mcpServers section should be valid"

m="$(write_manifest '{"name":"x","mcpServers":{"a":{"command":"node"}}}')"
ext_validate_mcp_shape "$m" >/dev/null 2>&1 && ok "valid stdio (absent transport defaults to stdio)" \
  || bad "valid stdio should pass"

m="$(write_manifest '{"name":"x","mcpServers":{"a":{"transport":"http","url":"https://x"}}}')"
ext_validate_mcp_shape "$m" >/dev/null 2>&1 && ok "valid http" || bad "valid http should pass"

m="$(write_manifest '{"name":"x","mcpServers":{"a":{"transport":"sse","url":"https://x"}}}')"
ext_validate_mcp_shape "$m" >/dev/null 2>&1 && ok "valid sse" || bad "valid sse should pass"

m="$(write_manifest '{"name":"x","mcpServers":{"a":{"transport":"websocket","url":"https://x"}}}')"
out="$(ext_validate_mcp_shape "$m" 2>&1)"; rc=$?
[ "$rc" -ne 0 ] && [[ "$out" == *"outside the admissible set"* ]] \
  && ok "unknown transport is a validation error, not passed through" \
  || bad "unknown transport should fail: rc=$rc out=$out"

m="$(write_manifest '{"name":"x","mcpServers":{"a":{"transport":"http"}}}')"
out="$(ext_validate_mcp_shape "$m" 2>&1)"; rc=$?
[ "$rc" -ne 0 ] && [[ "$out" == *"missing a non-empty 'url'"* ]] \
  && ok "missing http endpoint is a validation error, never delivered as null" \
  || bad "missing url should fail: rc=$rc out=$out"

m="$(write_manifest '{"name":"x","mcpServers":{"a":{}}}')"
out="$(ext_validate_mcp_shape "$m" 2>&1)"; rc=$?
[ "$rc" -ne 0 ] && [[ "$out" == *"missing a non-empty 'command'"* ]] \
  && ok "missing stdio command is a validation error" \
  || bad "missing command should fail: rc=$rc out=$out"

m="$(write_manifest '{"name":"x","mcpServers":{"a":{"command":"node","cwd":"/tmp"}}}')"
out="$(ext_validate_mcp_shape "$m" 2>&1)"; rc=$?
[ "$rc" -ne 0 ] && [[ "$out" == *"inadmissible key 'cwd'"* ]] \
  && ok "a non-vocabulary key (cwd) is a loud error, not a silent drop (R5)" \
  || bad "cwd should fail: rc=$rc out=$out"

m="$(write_manifest '{"name":"x","mcpServers":"not-an-object"}')"
ext_validate_mcp_shape "$m" >/dev/null 2>&1 \
  && bad "a non-object mcpServers should fail" \
  || ok "a non-object mcpServers section is rejected"

# ---------------------------------------------------------------------------
echo "2. ext_validate_mcp_names — R12"
# ---------------------------------------------------------------------------
m="$(write_manifest '{"name":"ext1","mcpServers":{"mempalace":{"command":"evil"}}}')"
out="$(ext_validate_mcp_names "$m" "$RESERVED_JSON" 2>&1)"; rc=$?
[ "$rc" -ne 0 ] && [[ "$out" == *"ext1"* ]] && [[ "$out" == *"mempalace"* ]] \
  && ok "a reserved name is refused, naming the extension and the name" \
  || bad "reserved name should fail: rc=$rc out=$out"

m="$(write_manifest '{"name":"ext1","mcpServers":{"sequentialthinking":{"command":"evil"}}}')"
ext_validate_mcp_names "$m" "$RESERVED_JSON" >/dev/null 2>&1 \
  && bad "the SECOND reserved name should also be refused" \
  || ok "the second reserved name (sequentialthinking) is also refused (full-array coverage)"

m="$(write_manifest '{"name":"ext1","mcpServers":{"acme":{"command":"ok"}}}')"
ext_validate_mcp_names "$m" "$RESERVED_JSON" >/dev/null 2>&1 \
  && ok "a non-reserved name passes" || bad "acme should pass"

m="$(write_manifest '{"name":"ext1","mcpServers":{"acme":{"command":"ok"}}}')"
ext_validate_mcp_names "$m" "[]" >/dev/null 2>&1 \
  && bad "fail-closed: an empty reserved set should refuse to validate" \
  || ok "fail-closed — an empty reserved-name array is itself a hard error"

ext_validate_mcp_names "$m" '"not-an-array"' >/dev/null 2>&1 \
  && bad "fail-closed: a malformed reserved set should refuse to validate" \
  || ok "fail-closed — a malformed reserved-name argument is itself a hard error"

# ---------------------------------------------------------------------------
echo "3. ext_validate_mcp_tokens — R6/R9 positional token rule"
# ---------------------------------------------------------------------------
m="$(write_manifest '{"name":"x","mcpServers":{"a":{"command":"node","args":["${extensionRoot}/dist/index.js"]}}}')"
ext_validate_mcp_tokens "$m" >/dev/null 2>&1 \
  && ok "\${extensionRoot} in args is admissible" || bad "extensionRoot in args should pass"

m="$(write_manifest '{"name":"x","mcpServers":{"a":{"command":"${extensionRoot}/run.sh"}}}')"
ext_validate_mcp_tokens "$m" >/dev/null 2>&1 \
  && ok "\${extensionRoot} in command is admissible" || bad "extensionRoot in command should pass"

# The step-13 exact-token mutation target: a target-specific token that is
# NOT ${extensionRoot} must be refused by the ALLOWLIST, even though it is
# never individually enumerated.
m="$(write_manifest '{"name":"x","mcpServers":{"a":{"command":"${extensionPath}/run.sh"}}}')"
out="$(ext_validate_mcp_tokens "$m" 2>&1)"; rc=$?
[ "$rc" -ne 0 ] && [[ "$out" == *'${extensionPath}'* ]] \
  && ok "a target-specific token (\${extensionPath}) in command is refused by the allowlist" \
  || bad "extensionPath in command should fail: rc=$rc out=$out"

# The case a five-entry denylist would have missed (v1-F9): gemini-cli's own
# ${/} variable, never individually listed — the allowlist catches it anyway.
m="$(write_manifest '{"name":"x","mcpServers":{"a":{"command":"${/}/run.sh"}}}')"
ext_validate_mcp_tokens "$m" >/dev/null 2>&1 \
  && bad "\${/} in command should be refused (unlisted target-specific token)" \
  || ok "\${/} in command is refused WITHOUT being individually enumerated (allowlist property)"

m="$(write_manifest '{"name":"x","mcpServers":{"a":{"command":"node","env":{"FOO":"${CLAUDE_PLUGIN_ROOT}"}}}}')"
ext_validate_mcp_tokens "$m" >/dev/null 2>&1 \
  && bad "a known path token inside an env value should be refused" \
  || ok "a known path token inside an env value is refused (denylist)"

m="$(write_manifest '{"name":"x","mcpServers":{"a":{"command":"node","headers":{"Authorization":"Bearer ${extensionRoot}"}}}}')"
ext_validate_mcp_tokens "$m" >/dev/null 2>&1 \
  && bad "a known path token inside a headers value should be refused" \
  || ok "a known path token inside a headers value is refused (denylist)"

m="$(write_manifest '{"name":"x","mcpServers":{"a":{"command":"node","env":{"FOO":"${API_KEY:-}"}}}}')"
ext_validate_mcp_tokens "$m" >/dev/null 2>&1 \
  && ok "arbitrary non-path interpolation in an env value is admissible" \
  || bad "\${API_KEY:-} in env should pass"

m="$(write_manifest '{"name":"x","mcpServers":{"a":{"command":"node","headers":{"X":"${SOME_VAR}"}}}}')"
ext_validate_mcp_tokens "$m" >/dev/null 2>&1 \
  && ok "arbitrary non-path interpolation in a headers value is admissible" \
  || bad "\${SOME_VAR} in headers should pass"

# ---------------------------------------------------------------------------
echo "4. ext_mcp_native — R2/R6/R7/R8 per-target translation"
# ---------------------------------------------------------------------------
m="$(write_manifest '{"name":"x","mcpServers":{"default":{"command":"node","args":["${extensionRoot}/dist/index.js"]}}}')"

gem="$(ext_mcp_native gemini "$m")"
jq -e '.default.args[0] == "${extensionPath}/dist/index.js"' <<< "$gem" >/dev/null 2>&1 \
  && ok "gemini — neutral token rewritten to \${extensionPath} (Gemini's own load-time resolver)" \
  || bad "gemini rewrite wrong: $gem"

cla="$(ext_mcp_native claude "$m")"
jq -e '.default.args[0] == "${CLAUDE_PLUGIN_ROOT}/dist/index.js"' <<< "$cla" >/dev/null 2>&1 \
  && ok "claude — neutral token rewritten to \${CLAUDE_PLUGIN_ROOT} (Claude's own load-time resolver)" \
  || bad "claude rewrite wrong: $cla"

cop="$(ext_mcp_native copilot "$m")"
jq -e '.default.args[0] == "${COPILOT_PLUGIN_ROOT}/dist/index.js" and .default.type == "stdio"' <<< "$cop" >/dev/null 2>&1 \
  && ok "copilot — neutral token rewritten to \${COPILOT_PLUGIN_ROOT} (confirmed live-spawn, docs/runbooks/extension-mcp-token-probe.md)" \
  || bad "copilot rewrite wrong: $cop"

agy="$(ext_mcp_native antigravity "$m")"
jq -e '.default.args[0] == "${extensionRoot}/dist/index.js"' <<< "$agy" >/dev/null 2>&1 \
  && ok "antigravity — neutral token LEFT UNRESOLVED (Option A: scripts/install-antigravity-extension.sh resolves it post-install)" \
  || bad "antigravity should leave the token unresolved: $agy"

m_empty="$(write_manifest '{"name":"x"}')"
[ "$(ext_mcp_native claude "$m_empty")" = "{}" ] && [ "$(ext_mcp_native antigravity "$m_empty")" = "{}" ] \
  && ok "an extension declaring no mcpServers translates to {} on every target" \
  || bad "empty mcpServers should translate to {}"


# ---------------------------------------------------------------------------
echo "5. R3 — no per-CLI top-level section may carry an MCP server key"
# ---------------------------------------------------------------------------
# Verified no-op (spec 0180 PLAN v5 step 14): scripts/lib/extension-percli-keys.json
# carries no '*.mcpServers' row, so the EXISTING per-CLI-key allowlist check in
# ext_validate_manifest already rejects one — no new code, this is the named
# negative test that discharges R3, with its own decisive mutation below.
PERCLI_KEYS="$REPO_DIR/scripts/lib/extension-percli-keys.json"
m="$(write_manifest '{"name":"x","claude":{"mcpServers":{"a":{"command":"node"}}}}')"
out="$(ext_validate_manifest "$m" "$PERCLI_KEYS" 2>&1)"; rc=$?
[ "$rc" -ne 0 ] && [[ "$out" == *"claude.mcpServers"* ]] \
  && ok "R3 — an MCP server key inside a per-CLI section (claude.mcpServers) is rejected" \
  || bad "R3 — claude.mcpServers should be rejected: rc=$rc out=$out"

echo ""
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
