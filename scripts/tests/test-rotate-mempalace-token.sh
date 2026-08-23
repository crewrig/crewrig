#!/usr/bin/env bash
# test-rotate-mempalace-token.sh — Regression tests for MemPalace daemon token rotation (spec 0176).
#
# Asserts the --rotate / -r behavior of scripts/switch-mempalace-http.sh:
#   - --help prints usage and names --rotate
#   - Unknown argument fails visibly
#   - When --rotate is invoked, old token is removed, fresh token is minted
#   - Assistant configs are updated to carry the new token
#   - Pre-existing and transition backup files (.bak.*) are purged
#   - Without --rotate, existing token is preserved
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

PASS=0
FAIL=0
SKIP=0
ok()   { PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"; }
nope() { FAIL=$((FAIL + 1)); printf '  FAIL %s\n' "$1"; }
skipped() { SKIP=$((SKIP + 1)); printf '  skip %s\n' "$1"; }

REAL_HOME="${HOME}"
TEST_HOME="$(mktemp -d)"

if [ -z "${TEST_HOME}" ] || [ ! -d "${TEST_HOME}" ] || [ "${TEST_HOME}" = "${REAL_HOME}" ]; then
  echo "REFUSING TO RUN: the isolated HOME did not materialise (got '${TEST_HOME}')." >&2
  exit 1
fi
export HOME="${TEST_HOME}"

cleanup() {
  rm -rf "${TEST_HOME}"
}
trap cleanup EXIT

# shellcheck source=../lib/common.sh
. "${REPO_DIR}/scripts/lib/common.sh"
CREWRIG_REPO_DIR="${REPO_DIR}"

SWITCH_SCRIPT="${REPO_DIR}/scripts/switch-mempalace-http.sh"

# Setup fake PATH with assistant CLI binaries and stub tools
STUB_BIN="${TEST_HOME}/bin"
mkdir -p "${STUB_BIN}"
export PATH="${STUB_BIN}:${PATH}"

for cli in claude gemini copilot antigravity agy; do
  cat <<STUB > "${STUB_BIN}/${cli}"
#!/bin/sh
exit 0
STUB
  chmod +x "${STUB_BIN}/${cli}"
done

echo "test-rotate-mempalace-token.sh — MemPalace token rotation (spec 0176)"

# --- Case 1: --help and unknown flag handling ---
echo "Case 1: CLI argument parsing"
help_out="$("${SWITCH_SCRIPT}" --help 2>&1)" || true
case "${help_out}" in
  *"--rotate"*) ok "--help documents --rotate flag" ;;
  *) nope "--help output does not mention --rotate: ${help_out}" ;;
esac

err_out="$("${SWITCH_SCRIPT}" --invalid-flag 2>&1)" && rc_err=0 || rc_err=$?
[ "${rc_err}" -ne 0 ] \
  && ok "unknown argument exits non-zero" \
  || nope "unknown argument unexpectedly succeeded"

# --- Setup assistant config fixtures ---
setup_fixtures() {
  local token="$1"
  mkdir -p "${HOME}/.gemini/config" "${HOME}/.copilot"
  
  # Claude config (~/.claude.json)
  cat <<JSON > "${HOME}/.claude.json"
{
  "mcpServers": {
    "mempalace": {
      "url": "http://127.0.0.1:8765/mcp",
      "headers": { "Authorization": "Bearer ${token}" }
    }
  }
}
JSON

  # Gemini config (~/.gemini/settings.json)
  cat <<JSON > "${HOME}/.gemini/settings.json"
{
  "mcpServers": {
    "mempalace": {
      "url": "http://127.0.0.1:8765/mcp",
      "headers": { "Authorization": "Bearer ${token}" }
    }
  }
}
JSON

  # Copilot config (~/.copilot/mcp-config.json)
  cat <<JSON > "${HOME}/.copilot/mcp-config.json"
{
  "mcpServers": {
    "mempalace": {
      "url": "http://127.0.0.1:8765/mcp",
      "headers": { "Authorization": "Bearer ${token}" }
    }
  }
}
JSON

  # Antigravity config (~/.gemini/config/mcp_config.json)
  cat <<JSON > "${HOME}/.gemini/config/mcp_config.json"
{
  "mcpServers": {
    "mempalace": {
      "serverUrl": "http://127.0.0.1:8765/mcp",
      "headers": { "Authorization": "Bearer ${token}" }
    }
  }
}
JSON
}

# --- Case 2: Token rotation workflow ---
echo "Case 2: Full token rotation workflow"

# Provision initial token A
TOKEN_A="token_initial_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
TOK_PATH="$(mcp_token_path)"
mkdir -p "$(dirname "${TOK_PATH}")"
printf '%s\n' "${TOKEN_A}" > "${TOK_PATH}"
chmod 600 "${TOK_PATH}"

setup_fixtures "${TOKEN_A}"

# Create stale .bak files beside assistant configs
echo "old-backup-claude" > "${HOME}/.claude.json.bak.20260101-000000"
echo "old-backup-gemini" > "${HOME}/.gemini/settings.json.bak.20260101-000000"
echo "old-backup-copilot" > "${HOME}/.copilot/mcp-config.json.bak.20260101-000000"
echo "old-backup-antigravity" > "${HOME}/.gemini/config/mcp_config.json.bak.20260101-000000"

# Mock install_mcp_daemon, mcp_daemon_replace_process, status-mcp-server.sh
# to avoid needing a live Python daemon during unit tests
cat <<'STUB' > "${STUB_BIN}/status-mcp-server.sh"
#!/bin/sh
exit 0
STUB
chmod +x "${STUB_BIN}/status-mcp-server.sh"

# Run switch-mempalace-http.sh with --rotate
CREWRIG_TEST_MOCK_DAEMON=true "${SWITCH_SCRIPT}" --rotate >/dev/null 2>&1

TOKEN_B="$(tr -d '[:space:]' < "${TOK_PATH}" 2>/dev/null || true)"

if [ -n "${TOKEN_B}" ] && [ "${TOKEN_B}" != "${TOKEN_A}" ]; then
  ok "--rotate minted a new bearer token distinct from token A"
else
  nope "--rotate did not mint a new token (got '${TOKEN_B}', was '${TOKEN_A}')"
fi

if [ "${#TOKEN_B}" -ge 32 ]; then
  ok "minted token has sufficient cryptographic entropy (${#TOKEN_B} chars)"
else
  nope "minted token too short (${#TOKEN_B} chars)"
fi

# Verify assistant configs updated to TOKEN_B
claude_tok="$(jq -r '.mcpServers.mempalace.headers.Authorization // ""' "${HOME}/.claude.json" 2>/dev/null | sed 's/Bearer //')"
gemini_tok="$(jq -r '.mcpServers.mempalace.headers.Authorization // ""' "${HOME}/.gemini/settings.json" 2>/dev/null | sed 's/Bearer //')"
copilot_tok="$(jq -r '.mcpServers.mempalace.headers.Authorization // ""' "${HOME}/.copilot/mcp-config.json" 2>/dev/null | sed 's/Bearer //')"
antigravity_tok="$(jq -r '.mcpServers.mempalace.headers.Authorization // ""' "${HOME}/.gemini/config/mcp_config.json" 2>/dev/null | sed 's/Bearer //')"

[ "${claude_tok}" = "${TOKEN_B}" ] \
  && ok "Claude config carries new token B" \
  || nope "Claude config token mismatch: ${claude_tok}"

[ "${gemini_tok}" = "${TOKEN_B}" ] \
  && ok "Gemini config carries new token B" \
  || nope "Gemini config token mismatch: ${gemini_tok}"

[ "${copilot_tok}" = "${TOKEN_B}" ] \
  && ok "Copilot config carries new token B" \
  || nope "Copilot config token mismatch: ${copilot_tok}"

[ "${antigravity_tok}" = "${TOKEN_B}" ] \
  && ok "Antigravity config carries new token B" \
  || nope "Antigravity config token mismatch: ${antigravity_tok}"

# Verify all .bak files purged
bak_count=$(find "${HOME}" -name "*.bak.*" 2>/dev/null | wc -l | tr -d '[:space:]')
if [ "${bak_count}" -eq 0 ]; then
  ok "all stale .bak.* backup files were purged (${bak_count} remaining)"
else
  nope "stale .bak.* backup files still exist (${bak_count} found)"
fi

# --- Case 3: Switch without --rotate preserves existing token ---
echo "Case 3: Non-rotate switch preserves token"
TOKEN_BEFORE="$(tr -d '[:space:]' < "${TOK_PATH}")"
CREWRIG_TEST_MOCK_DAEMON=true "${SWITCH_SCRIPT}" >/dev/null 2>&1

TOKEN_AFTER="$(tr -d '[:space:]' < "${TOK_PATH}")"
[ "${TOKEN_BEFORE}" = "${TOKEN_AFTER}" ] \
  && ok "switch without --rotate preserves existing token" \
  || nope "switch without --rotate modified token: before=${TOKEN_BEFORE} after=${TOKEN_AFTER}"

echo ""
echo "Results: ${PASS} passed, ${FAIL} failed, ${SKIP} skipped"
[ "${FAIL}" -eq 0 ]
