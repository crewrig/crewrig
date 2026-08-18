#!/usr/bin/env bash
# test-repair-mempalace-http.sh — Regression tests for the MemPalace switch
# residue repair command (spec 0165).
#
# The command under test is scripts/repair-mempalace-http.sh. It is a pure
# file-level repair: it reads and rewrites assistant MCP configuration files
# under $HOME and never touches supervisor state, ports, or the daemon, so the
# isolation contract is the single $HOME axis (plus CLAUDE_CONFIG_DIR, which
# Claude Code resolves instead of $HOME). The "present" gate is `command -v`,
# so each CLI is stubbed on PATH exactly as test-mcp-daemon.sh section 11 does.
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

PASS=0
FAIL=0
ok()   { PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"; }
nope() { FAIL=$((FAIL + 1)); printf '  FAIL %s\n' "$1"; }

REAL_HOME="${HOME}"
TEST_HOME="$(mktemp -d)"
export HOME="${TEST_HOME}"
export CLAUDE_CONFIG_DIR="${TEST_HOME}/.claude-config"
mkdir -p "${CLAUDE_CONFIG_DIR}"

cleanup() { rm -rf "${TEST_HOME}"; }
trap cleanup EXIT

# shellcheck source=../lib/common.sh
. "${REPO_DIR}/scripts/lib/common.sh"
CREWRIG_REPO_DIR="${REPO_DIR}"

REPAIR="${REPO_DIR}/scripts/repair-mempalace-http.sh"

# The transaction's "present" gate is `command -v`, so stub each tool on PATH
# (test-mcp-daemon.sh section 11 pattern). The stubs must exist for the repair
# command to treat the four assistants as present without a real install.
mkdir -p "${TEST_HOME}/bin"
for c in claude gemini copilot agy; do
  printf '#!/usr/bin/env bash\nexit 0\n' > "${TEST_HOME}/bin/${c}"
  chmod +x "${TEST_HOME}/bin/${c}"
done
export ORIG_PATH="${PATH}"
export PATH="${TEST_HOME}/bin:${PATH}"

# mode_of <path> — the file's mode in octal, GNU first (test-mcp-daemon.sh
# token-file precedent: `stat -f` on GNU means "filesystem" and SUCCEEDS with
# unusable output, so probing BSD-style first silently yields garbage).
mode_of() {
  stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1" 2>/dev/null
}

# residue_config — a mempalace registration that matches neither the http nor
# the stdio shape: the residue the repair command exists to detect (R2).
residue_config() {
  printf '%s\n' '{"mcpServers":{"mempalace":{"nonsense":true}}}'
}

echo "test-repair-mempalace-http.sh — isolated in ${TEST_HOME}"
echo ""

# --- R4. Report-only run -----------------------------------------------------
echo "R4 — report-only run:"
mkdir -p "${TEST_HOME}/.gemini"
residue_config > "${TEST_HOME}/.gemini/settings.json"
out="$(bash "${REPAIR}" 2>&1)"; rc=$?
[ "${rc}" -ne 0 ] \
  && ok "a report-only run exits non-zero when residue exists" \
  || nope "report-only run exited ${rc} with residue present"
case "${out}" in
  *"gemini"*) ok "the affected assistant is named" ;;
  *) nope "the affected assistant is not named: ${out}" ;;
esac
case "${out}" in
  *"${TEST_HOME}/.gemini/settings.json"*) ok "the configuration path is named" ;;
  *) nope "the configuration path is not named: ${out}" ;;
esac
case "${out}" in
  *"--reset-none"*) ok "the available repair action is named" ;;
  *) nope "no repair action named: ${out}" ;;
esac

# A present assistant with no config file has no mempalace registration —
# recognisably `none`, not residue (spec 0165 R2, absent→none mapping).
rm -f "${TEST_HOME}/.gemini/settings.json"
bash "${REPAIR}" >/dev/null 2>&1; rc=$?
[ "${rc}" -eq 0 ] \
  && ok "a present assistant with no config file is none, not residue (exit 0)" \
  || nope "a config-less present assistant was treated as residue (exit ${rc})"

# --- R5. Restore from the most recent usable backup --------------------------
echo ""
echo "R5 — restore from the most recent usable backup:"
# Two backups: an older one that does not parse, a newer one that does. The
# restore must pick the newer usable one, not the older non-parseable one.
echo 'not json' > "${TEST_HOME}/.gemini/settings.json.bak.20260101-000000"
printf '%s\n' '{"mcpServers":{"mempalace":{"command":"bash","args":["good"]}}}' \
  > "${TEST_HOME}/.gemini/settings.json.bak.20260102-000000"
chmod 644 "${TEST_HOME}/.gemini/settings.json.bak.20260102-000000"
residue_config > "${TEST_HOME}/.gemini/settings.json"
out="$(bash "${REPAIR}" --restore-backup 2>&1)"; rc=$?
[ "$(jq -c '.mcpServers.mempalace' "${TEST_HOME}/.gemini/settings.json")" = '{"command":"bash","args":["good"]}' ] \
  && ok "the most recent usable backup is restored" \
  || nope "the wrong backup was restored"
[ "$(mode_of "${TEST_HOME}/.gemini/settings.json")" = "644" ] \
  && ok "the file's mode is preserved by the restore" \
  || nope "restore did not preserve the mode (got $(mode_of "${TEST_HOME}/.gemini/settings.json"))"
[ "${rc}" -eq 0 ] \
  && ok "a restore that leaves no residue exits 0" \
  || nope "restore exited ${rc}"

echo ""
echo "R5 — a restored config carrying a bearer token stays 0600:"
printf '%s\n' '{"mcpServers":{"mempalace":{"type":"http","url":"http://127.0.0.1:1/mcp","headers":{"Authorization":"Bearer x"}}}}' \
  > "${TEST_HOME}/.gemini/settings.json.bak.20260103-000000"
chmod 644 "${TEST_HOME}/.gemini/settings.json.bak.20260103-000000"
residue_config > "${TEST_HOME}/.gemini/settings.json"
bash "${REPAIR}" --restore-backup >/dev/null 2>&1
[ "$(mode_of "${TEST_HOME}/.gemini/settings.json")" = "600" ] \
  && ok "a restored config carrying a bearer token is forced to 0600" \
  || nope "token-bearing restored config is $(mode_of "${TEST_HOME}/.gemini/settings.json"), expected 600"

echo ""
echo "R5 — no usable backup is reported, not silently skipped:"
rm -f "${TEST_HOME}/.gemini/settings.json.bak."*
residue_config > "${TEST_HOME}/.gemini/settings.json"
out="$(bash "${REPAIR}" --restore-backup 2>&1)"; rc=$?
[ "${rc}" -ne 0 ] \
  && ok "restore with no usable backup exits non-zero" \
  || nope "restore with no usable backup exited ${rc}"
case "${out}" in
  *"gemini"*"NO USABLE BACKUP"*) ok "the assistant with no usable backup is reported" ;;
  *) nope "no usable-backup report: ${out}" ;;
esac

# --- R6. Reset to none -------------------------------------------------------
echo ""
echo "R6 — reset-none removes the mempalace registration:"
residue_config > "${TEST_HOME}/.gemini/settings.json"
out="$(bash "${REPAIR}" --reset-none 2>&1)"; rc=$?
[ "$(mcp_assistant_arrangement gemini)" = "none" ] \
  && ok "reset-none produces the none arrangement" \
  || nope "reset-none did not produce none"
jq -e '(.mcpServers | has("mempalace")) | not' "${TEST_HOME}/.gemini/settings.json" >/dev/null 2>&1 \
  && ok "no mempalace entry remains after reset-none" \
  || nope "a mempalace entry survived reset-none"
[ "${rc}" -eq 0 ] \
  && ok "a reset that leaves no residue exits 0" \
  || nope "reset exited ${rc}"

echo ""
echo "R6 — reset-none refuses a non-parseable config:"
echo 'not json' > "${TEST_HOME}/.gemini/settings.json"
out="$(bash "${REPAIR}" --reset-none 2>&1)"; rc=$?
[ "${rc}" -ne 0 ] \
  && ok "reset-none on a non-parseable config exits non-zero" \
  || nope "reset-none on a non-parseable config exited ${rc}"
[ "$(cat "${TEST_HOME}/.gemini/settings.json")" = "not json" ] \
  && ok "a non-parseable config is not modified" \
  || nope "the non-parseable config was modified"
case "${out}" in
  *"--restore-backup"*) ok "the non-parseable assistant is told to use --restore-backup first" ;;
  *) nope "no --restore-backup guidance: ${out}" ;;
esac

# --- R8. A recognisable arrangement is never modified ------------------------
echo ""
echo "R8 — a recognisable arrangement is never modified:"
for shape in \
  '{"mcpServers":{"mempalace":{"type":"http","url":"http://127.0.0.1:1/mcp"}}}' \
  '{"mcpServers":{"mempalace":{"command":"bash","args":["x"]}}}' \
  '{"mcpServers":{}}'; do
  printf '%s\n' "${shape}" > "${TEST_HOME}/.gemini/settings.json"
  before="$(cat "${TEST_HOME}/.gemini/settings.json")"
  bash "${REPAIR}" --restore-backup >/dev/null 2>&1
  bash "${REPAIR}" --reset-none >/dev/null 2>&1
  [ "$(cat "${TEST_HOME}/.gemini/settings.json")" = "${before}" ] \
    && ok "a recognisable config is never modified (${shape})" \
    || nope "a recognisable config was modified (${shape})"
done

# --- R7. Post-repair verification --------------------------------------------
echo ""
echo "R7 — post-repair verification:"
residue_config > "${TEST_HOME}/.gemini/settings.json"
out="$(bash "${REPAIR}" --reset-none 2>&1)"; rc=$?
case "${out}" in
  *"Post-repair verification"*) ok "the post-repair verification runs" ;;
  *) nope "no post-repair verification: ${out}" ;;
esac
case "${out}" in
  *"gemini: none"*) ok "the verification reports the resulting arrangement" ;;
  *) nope "the verification does not report gemini's arrangement: ${out}" ;;
esac
[ "${rc}" -eq 0 ] \
  && ok "a repair that leaves no residue exits 0" \
  || nope "repair exited ${rc}"

# --- R9. Repeatability --------------------------------------------------------
echo ""
echo "R9 — a second run after a successful repair finds no residue:"
bash "${REPAIR}" >/dev/null 2>&1; rc=$?
[ "${rc}" -eq 0 ] \
  && ok "a second run after a successful repair finds no residue and exits 0" \
  || nope "a second run found residue or exited ${rc}"

# --- Flag parsing ------------------------------------------------------------
echo ""
echo "Flag parsing:"
out="$(bash "${REPAIR}" --restore-backup --reset-none 2>&1)"; rc=$?
[ "${rc}" -eq 2 ] \
  && ok "mutually exclusive flags exit 2" \
  || nope "mutually exclusive flags exited ${rc}"
case "${out}" in
  *"mutually exclusive"*) ok "the mutual-exclusion error is named" ;;
  *) nope "no mutual-exclusion error: ${out}" ;;
esac
out="$(bash "${REPAIR}" --bogus 2>&1)"; rc=$?
[ "${rc}" -eq 2 ] \
  && ok "an unknown flag exits 2" \
  || nope "an unknown flag exited ${rc}"

export PATH="${ORIG_PATH}"

echo ""
echo "----------------------------------------"
echo "  passed: ${PASS}   failed: ${FAIL}"
[ "${FAIL}" -eq 0 ] || exit 1
