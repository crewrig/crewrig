#!/usr/bin/env bash
# test-mcp-daemon.sh — Regression tests for the shared MemPalace MCP HTTP
# daemon (spec 0113, ADR 0016).
#
# ISOLATION CONTRACT — read this before adding a case.
#
# Every test that touches supervisor or daemon state isolates on ALL THREE
# axes, and refuses to run if any of them resolves to its production value:
#
#   1. label / unit name  — a shared label lets a test act on the operator's
#                           real supervisor unit; launchd labels are keyed by
#                           uid (gui/<uid>) and `systemctl --user` units too,
#                           so $HOME alone does not isolate them.
#   2. PORT               — the axis that matters most here and the one a
#                           label guard does not watch. This tier is reached
#                           over HTTP: a correctly test-labelled unit that
#                           fails to bind because production holds the socket
#                           leaves the clients connecting to PRODUCTION. The
#                           writes then land in the operator's real palace with
#                           every assertion passing — green and destructive at
#                           once.
#   3. $HOME              — keeps the palace, the lock filename and the token
#                           path off the real store.
#
# The same contract is documented at test-chroma-server.sh:19-21.
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

PASS=0
FAIL=0
ok()   { PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"; }
nope() { FAIL=$((FAIL + 1)); printf '  FAIL %s\n' "$1"; }

# --- Isolation guard (refuses rather than risks) -----------------------------
PROD_LABEL="com.mempalace.mcp-server"
PROD_UNIT="mempalace-mcp-server"
PROD_PORT="8021"

# Capture the real HOME BEFORE overriding it. Comparing $HOME to `cd ~` after
# the override compares the override to itself and is always equal — a guard
# that would refuse every run, i.e. protect by permanently skipping the tests
# it exists to protect.
REAL_HOME="${HOME}"
TEST_HOME="$(mktemp -d)"
export HOME="${TEST_HOME}"
export MEMPALACE_MCP_LABEL="com.mempalace.mcp-server-test-$$"
export MEMPALACE_MCP_UNIT="mempalace-mcp-server-test-$$"
export MEMPALACE_MCP_PORT="$((18000 + (RANDOM % 900)))"
export MEMPALACE_MCP_LAUNCHER_PATH="${TEST_HOME}/.crewrig/mcp-daemon-launcher.sh"
# The launcher only needs an interpreter PATH substituted in; the tests never
# execute the wrapper, so any resolvable python satisfies them. Without this a
# runner with no mempalace venv fails every launcher assertion for a reason
# that has nothing to do with what is under test.
export MEMPALACE_PYTHON="${MEMPALACE_PYTHON:-$(command -v python3 || echo /usr/bin/python3)}"
# Every launcher invocation below exercises a refusal and must die at the token
# check. Without this, a regression that lets one through would sit in the
# ChromaDB wait for a full minute per case and the suite would look hung.
export MEMPALACE_MCP_CHROMA_WAIT=2
# Point the launcher's ChromaDB dependency at a dead port. Every launcher case
# below asserts a REFUSAL, and a refusal test must not be able to succeed at
# starting something: if a regression removes the token guards, the launcher
# would otherwise reach its exec and spawn a REAL daemon from inside the test
# suite. Discovered by deliberately removing both guards — the suite hung with
# a live daemon rather than failing. The dead port makes the exec unreachable,
# so a broken guard shows up as a failed assertion instead of a background
# process nobody notices.
export MEMPALACE_CHROMA_PORT=1
# Claude Code resolves its user config through CLAUDE_CONFIG_DIR, so $HOME alone
# does NOT isolate the Claude arm. Nothing exercises it today, but the coverage
# this suite still owes (the switch transaction, the Claude reader) does — and
# whoever writes it would mutate the operator's real ~/.claude.json unless the
# variable is already redirected. Added before the coverage that needs it.
export CLAUDE_CONFIG_DIR="${TEST_HOME}/.claude-config"
mkdir -p "${CLAUDE_CONFIG_DIR}"

cleanup() { rm -rf "${TEST_HOME}"; }
trap cleanup EXIT

if [ "${MEMPALACE_MCP_LABEL}" = "${PROD_LABEL}" ] \
  || [ "${MEMPALACE_MCP_UNIT}" = "${PROD_UNIT}" ] \
  || [ "${MEMPALACE_MCP_PORT}" = "${PROD_PORT}" ] \
  || [ "${HOME}" = "${REAL_HOME}" ]; then
  echo "REFUSING TO RUN: an isolation axis resolved to its production value." >&2
  echo "  label=${MEMPALACE_MCP_LABEL} unit=${MEMPALACE_MCP_UNIT} port=${MEMPALACE_MCP_PORT}" >&2
  exit 2
fi

# shellcheck source=../lib/common.sh
. "${REPO_DIR}/scripts/lib/common.sh"
CREWRIG_REPO_DIR="${REPO_DIR}"

echo "test-mcp-daemon.sh — isolated in ${TEST_HOME}"
echo ""

# --- 1. Token provisioning ---------------------------------------------------
echo "Token provisioning (R8):"
tok="$(mcp_token_read_or_create)"
[ -n "${tok}" ] && ok "a token is created when absent" || nope "no token created"

tok2="$(mcp_token_read_or_create)"
[ "${tok}" = "${tok2}" ] && ok "re-reading returns the same token (idempotent)" \
  || nope "second call produced a different token"

tok_file="$(mcp_token_path)"
# GNU first: `stat -f` on GNU means "filesystem" and SUCCEEDS with unusable
# output, so probing BSD-style first silently yields garbage on Linux.
perms="$(stat -c '%a' "${tok_file}" 2>/dev/null || stat -f '%Lp' "${tok_file}" 2>/dev/null)"
[ "${perms}" = "600" ] && ok "token file is mode 0600" || nope "token file is mode ${perms}, expected 600"

# --- 2. The launcher refuses to serve without a token ------------------------
# This is the finding that would otherwise have shipped a daemon with
# authentication silently disabled: MemPalace requires a token only on a
# non-loopback bind, and its auth gate short-circuits on an empty one.
echo ""

# refuses_for_token <case-label> — run the launcher and assert it refused FOR
# THE TOKEN, not merely that it exited non-zero.
#
# Checking the exit code alone is not enough and this was proven, not assumed:
# with the token guards deliberately removed the suite still went green, because
# the launcher then died on the unreachable ChromaDB dependency instead. A
# refusal test that does not name the reason passes for whichever failure
# happens first, which is the "green for the wrong reason" trap this file
# exists to avoid. So: assert the diagnostic mentions the token.
# Bounded: the launcher's happy path is an exec into a server that never
# returns, so any regression letting a refusal case through turns this suite
# into a hang rather than a failure. No `timeout(1)` on stock macOS, hence the
# watchdog.
run_launcher_bounded() {
  local out_file rc
  out_file="$(mktemp)"
  bash "${launcher}" >"${out_file}" 2>&1 &
  local pid=$!
  ( sleep 20; kill -9 "${pid}" 2>/dev/null ) &
  local watchdog=$!
  wait "${pid}" 2>/dev/null; rc=$?
  kill "${watchdog}" 2>/dev/null
  cat "${out_file}"; rm -f "${out_file}"
  return "${rc}"
}

refuses_for_token() {
  local label="$1" out rc
  out="$(run_launcher_bounded)"; rc=$?
  if [ "${rc}" -eq 0 ]; then
    nope "${label} — launcher STARTED (auth would be disabled)"
    return
  fi
  case "${out}" in
    *"bearer token"*) ok "${label}" ;;
    *) nope "${label} — refused, but not for the token: ${out}" ;;
  esac
}

echo "Launcher refuses an absent or empty token (R8, security):"
install_mcp_launcher >/dev/null 2>&1
launcher="$(mcp_launcher_installed_path)"
[ -f "${launcher}" ] && ok "launcher materialised to the installed path" \
  || nope "launcher not installed at ${launcher}"

rm -f "${tok_file}"
refuses_for_token "launcher refuses to start with no token file"

mkdir -p "$(dirname "${tok_file}")"; : > "${tok_file}"
refuses_for_token "launcher refuses to start with an empty token"

# Whitespace-only is the case that defeated the first version of this guard:
# the shell sees a non-empty string, upstream .strip()s it to empty, and an
# empty auth_token short-circuits the bearer check — the daemon then serves the
# whole palace unauthenticated while the launcher reports success.
printf '   \t  \n' > "${tok_file}"
refuses_for_token "launcher refuses to start with a whitespace-only token"

printf 'short\n' > "${tok_file}"
refuses_for_token "launcher refuses a token shorter than 32 characters"

printf 'has spaces and $(id) in it padded to length aaaaaaaaaaaa\n' > "${tok_file}"
refuses_for_token "launcher refuses a token with unexpected characters"

# mcp_token_read_or_create must refuse the same content rather than hand back
# an empty string that would register `Authorization: Bearer ` on four CLIs.
printf '   \n' > "${tok_file}"
if mcp_token_read_or_create >/dev/null 2>&1; then
  nope "token reader returned success on a whitespace-only file"
else
  ok "token reader refuses a whitespace-only token file"
fi
rm -f "${tok_file}"

# Acceptance, not just refusal. Every case above asserts a REFUSAL; with only
# those, tightening the charset to [A-Za-z0-9] would keep the suite fully green
# while rejecting every token `mempalace serve` provisions (token_urlsafe uses
# - and _) and breaking the documented convergence. The dead ChromaDB port
# gives the success signal for free: dying at ChromaDB means the token gate was
# passed.
accepts_token() {
  local label="$1" out
  out="$(run_launcher_bounded)"
  case "${out}" in
    *"ChromaDB daemon unreachable"*) ok "${label}" ;;
    *"bearer token"*) nope "${label} — refused at the token gate: ${out}" ;;
    *) nope "${label} — unexpected outcome: ${out}" ;;
  esac
}

printf 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n' > "${tok_file}"
accepts_token "a 48-character alphanumeric token is accepted"

# upstream's secrets.token_urlsafe alphabet includes - and _
printf 'abcdefghij-klmnopqrst_uvwxyz0123456789ABCDEF\n' > "${tok_file}"
accepts_token "an upstream-style token with - and _ is accepted"

printf '  aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  \n' > "${tok_file}"
accepts_token "a valid token with surrounding whitespace is normalised, not rejected"

# --- 3. The launcher never puts the token in argv ----------------------------
echo ""
echo "Token stays out of the process table (R8):"
grep -q 'export MEMPALACE_MCP_HTTP_TOKEN' "${launcher}" \
  && ok "token is exported, not passed as an argument" \
  || nope "token is not exported"
# The exec spans a line continuation, so strip continuations before matching.
exec_stmt="$(sed -e ':a' -e 'N' -e '$!ba' -e 's/\\\n[[:space:]]*/ /g' "${launcher}" | grep -E '^exec ' || true)"
case "${exec_stmt}" in
  *'--transport http'*) ok "handoff execs the wrapper with --transport http" ;;
  *) nope "exec statement does not carry --transport http: ${exec_stmt}" ;;
esac
case "${exec_stmt}" in
  *TOKEN*) nope "the exec statement mentions the token — it would land in argv" ;;
  *) ok "the exec statement carries no token (credential stays in the environment)" ;;
esac
grep -q "${tok}" "${launcher}" 2>/dev/null \
  && nope "the token VALUE was substituted into the launcher" \
  || ok "no token value is baked into the launcher"

# --- 4. Unit files never carry the token -------------------------------------
echo ""
echo "Unit files carry no credential (R8):"
for unit in "${REPO_DIR}/config/launchd/com.mempalace.mcp-server.plist" \
            "${REPO_DIR}/config/systemd/mempalace-mcp-server.service"; do
  # Strip comments STRUCTURALLY, then look for an assignment anywhere in what
  # remains. Filtering by leading whitespace made this unfalsifiable for the
  # plist, whose every body line is indented — an injected
  # <string>token=SECRET</string> passed as "commentary".
  body="$(sed -e 's/<!--.*-->//g' -e '/<!--/,/-->/d' -e 's/^[[:space:]]*#.*$//' "${unit}")"
  if printf '%s' "${body}" | grep -qiE 'token[=[:space:]]*[A-Za-z0-9_-]{8,}|MEMPALACE_MCP_HTTP_TOKEN'; then
    nope "$(basename "${unit}") carries a token outside commentary"
  else
    ok "$(basename "${unit}") carries no credential"
  fi
done

# --- 5. Drift detection compares versions, not bytes -------------------------
echo ""
echo "Launcher drift check (step 5):"
recorded="$(grep -m1 '^LAUNCHER_SOURCE_SHA=' "${launcher}" | cut -d'"' -f2)"
current="$(mcp_launcher_source_sha)"
[ -n "${recorded}" ] && ok "installed launcher records its source hash" \
  || nope "no source hash recorded"
[ "${recorded}" = "${current}" ] \
  && ok "a fresh install reports IN SYNC (not spurious drift)" \
  || nope "fresh install reports drift — the check compares the wrong quantity"

# --- 5b. Config modes: a credential-bearing file must never widen ------------
echo ""
echo "Client configs never widen when the token lands in them (R8):"
mkdir -p "${TEST_HOME}/.gemini"
echo '{"mcpServers":{}}' > "${TEST_HOME}/.gemini/settings.json"
chmod 600 "${TEST_HOME}/.gemini/settings.json"
register_mempalace_mcp gemini "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" >/dev/null 2>&1
mode="$(stat -c '%a' "${TEST_HOME}/.gemini/settings.json" 2>/dev/null || stat -f '%Lp' "${TEST_HOME}/.gemini/settings.json" 2>/dev/null)"
[ "${mode}" = "600" ] \
  && ok "a 0600 config stays 0600 after the token is written into it" \
  || nope "config widened to ${mode} — mv inherits the temp file's mode"

echo '{"mcpServers":{}}' > "${TEST_HOME}/.gemini/settings.json"
chmod 644 "${TEST_HOME}/.gemini/settings.json"
register_mempalace_mcp gemini "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" >/dev/null 2>&1
mode="$(stat -c '%a' "${TEST_HOME}/.gemini/settings.json" 2>/dev/null || stat -f '%Lp' "${TEST_HOME}/.gemini/settings.json" 2>/dev/null)"
[ "${mode}" = "600" ] \
  && ok "an already-0644 config is narrowed to 0600 once it holds a token" \
  || nope "config left at ${mode} while holding a bearer token"

# --- 6. Arrangement reader ---------------------------------------------------
echo ""
echo "Per-assistant arrangement reader (R16, delta-01 R14):"
mkdir -p "${TEST_HOME}/.gemini"
echo '{"mcpServers":{"mempalace":{"command":"bash","args":["x"]}}}' > "${TEST_HOME}/.gemini/settings.json"
[ "$(mcp_assistant_arrangement gemini)" = "stdio" ] \
  && ok "a command-based entry reads as stdio" || nope "stdio entry misread"

echo '{"mcpServers":{"mempalace":{"type":"http","url":"http://127.0.0.1:1/mcp"}}}' > "${TEST_HOME}/.gemini/settings.json"
[ "$(mcp_assistant_arrangement gemini)" = "http" ] \
  && ok "a url-based entry reads as http" || nope "http entry misread"

echo '{"mcpServers":{"mempalace":{"nonsense":true}}}' > "${TEST_HOME}/.gemini/settings.json"
[ "$(mcp_assistant_arrangement gemini)" = "unknown" ] \
  && ok "an entry in neither arrangement reads as unknown (reported, not converged)" \
  || nope "unrecognised entry not flagged"

echo '{"mcpServers":{}}' > "${TEST_HOME}/.gemini/settings.json"
[ "$(mcp_assistant_arrangement gemini)" = "none" ] \
  && ok "no entry reads as none" || nope "missing entry misread"

# --- 7. Capture and restore round-trip (R13) ---------------------------------
echo ""
echo "Capture and restore (R13):"
echo '{"mcpServers":{"mempalace":{"command":"bash","args":["original"]}}}' > "${TEST_HOME}/.gemini/settings.json"
cap="$(capture_mempalace_registration gemini)"
register_mempalace_mcp gemini "test-token" >/dev/null 2>&1
[ "$(mcp_assistant_arrangement gemini)" = "http" ] \
  && ok "registration switches the entry to http" || nope "registration did not switch"
# R11 is REPLACE, not add-alongside — and asserting the http shape is present
# does not prove it. An entry carrying BOTH shapes reads as http (the reader
# tests `has("url")` first) while still holding a `command` the CLI would spawn:
# a session with its own writer, which is precisely the R1 defect this ticket
# exists to remove. Assert the absence.
jq -e '.mcpServers.mempalace | has("command") | not' "${TEST_HOME}/.gemini/settings.json" >/dev/null 2>&1 \
  && ok "no spawn-capable key survives the switch (R11 replace, not add)" \
  || nope "the switched entry still carries a command — the session would spawn its own writer"
restore_mempalace_registration gemini "${cap}"
[ "$(mcp_assistant_arrangement gemini)" = "stdio" ] \
  && ok "restore returns the entry to its prior arrangement" || nope "restore did not return the prior arrangement"
restored="$(jq -c '.mcpServers.mempalace' "${TEST_HOME}/.gemini/settings.json")"
[ "${restored}" = "${cap}" ] \
  && ok "restored entry is byte-identical to the captured one" \
  || nope "restored entry differs from the capture"

# --- 8. Rollback restores what it is given ----------------------------------
echo ""
echo "Rollback primitives (R13, R14):"
echo '{"mcpServers":{"mempalace":{"command":"bash","args":["orig"]}}}' > "${TEST_HOME}/.gemini/settings.json"
cap_g="$(capture_mempalace_registration gemini)"
register_mempalace_mcp gemini "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" >/dev/null 2>&1
_switch_rollback "gemini" "null" "${cap_g}" "null" "null" >/dev/null 2>&1
[ "$(mcp_assistant_arrangement gemini)" = "stdio" ] \
  && ok "_switch_rollback restores an assistant named in its list" \
  || nope "_switch_rollback did not restore the assistant it was given"

# The defect this guards is that the CALLER must name the assistant whose own
# switch failed. register_mempalace_mcp is not atomic for Claude — `mcp remove`
# lands, the write may not — so an assistant tracked only on SUCCESS is left
# with no registration at all and, because the failed list stays empty, R14
# never reports it. Assert the caller's contract structurally: the assistant is
# added to the rollback list BEFORE the attempt, not after.
if awk '/^  for cli in \$present; do$/,/^  done$/' "${REPO_DIR}/scripts/lib/common.sh" \
   | grep -B2 'if register_mempalace_mcp' | grep -q 'applied="\$applied \$cli"'; then
  ok "the rollback list is built before the attempt, not after it succeeds"
else
  nope "an assistant is only tracked after a SUCCESSFUL switch — a failed one is abandoned"
fi

# --- 9. Every setup script wires the switch (R3, F5) -------------------------
echo ""
echo "Setup scripts switch their assistant (R3):"
missing=""
for cli in claude gemini copilot antigravity; do
  grep -q "offer_mcp_http_switch" "${REPO_DIR}/scripts/setup-${cli}-interactive.sh" || missing="${missing} ${cli}"
done
[ -z "${missing}" ] \
  && ok "all four setup scripts offer the switch" \
  || nope "setup scripts still stdio-only:${missing} — a later run would silently revert the switch"

# The revert is not hypothetical: `mempalace` is reserved, so the preservation
# helper deliberately drops an operator entry under that name and the framework
# rewrites it stdio-shaped. Assert the reservation still holds, since that is
# what makes wiring every setup mandatory rather than merely tidy.
grep -q 'MCP_RESERVED_NAMES=(mempalace' "${REPO_DIR}/scripts/lib/common.sh" \
  && ok "mempalace is still a reserved name (so setups must switch it themselves)" \
  || nope "mempalace is no longer reserved — re-check whether the setups still need to switch"

# --- 10. The daemon must OUTLIVE the reaper (#749) ---------------------------
# The defect this guards shipped once and was invisible to every static check:
# the wrapper starts an orphan-reaper thread that calls os._exit(0) when its
# parent is PID 1, which is the NORMAL state of a supervised daemon. It killed
# the daemon every ~60s with exit code 0 and no log line. Only watching the
# process live past the reaper's poll interval reveals it.
echo ""
echo "Daemon lifetime (R2, #749):"

# Hermetic half: the reaper must not be armed under the HTTP transport.
if grep -q 'if not _transport_is_http():' "${REPO_DIR}/scripts/lib/mempalace-http-wrapper.py"; then
  ok "the orphan reaper is not armed under --transport http"
else
  nope "the orphan reaper runs unconditionally — a supervised daemon will kill itself"
fi

# Behavioural half: probed skip, because CI has no mempalace venv. Quoting the
# reason rather than silently passing, per the tester skill.
if "${MEMPALACE_PYTHON}" -c 'import mempalace' >/dev/null 2>&1; then
  export MEMPALACE_CHROMA_PORT=8001   # the real one; we need a working handoff
  install_mcp_launcher >/dev/null 2>&1
  # ORPHAN IT. A daemon whose parent is this test shell is never orphaned, so
  # the reaper never fires and the assertion passes with the defect present —
  # verified. The double-fork makes the intermediate shell exit immediately,
  # reparenting the daemon to PID 1, which is exactly what a supervisor does.
  ( bash "$(mcp_launcher_installed_path)" >/dev/null 2>&1 & ) &
  sleep 1
  waited=0
  until curl -sf --max-time 2 "http://127.0.0.1:${MEMPALACE_MCP_PORT}/healthz" >/dev/null 2>&1 \
        || [ "${waited}" -ge 40 ]; do sleep 2; waited=$((waited + 2)); done
  if curl -sf --max-time 2 "http://127.0.0.1:${MEMPALACE_MCP_PORT}/healthz" >/dev/null 2>&1; then
    # The reaper polls every 5s; 20s is four intervals of margin.
    sleep 20
    if curl -sf --max-time 3 "http://127.0.0.1:${MEMPALACE_MCP_PORT}/healthz" >/dev/null 2>&1; then
      ok "an ORPHANED daemon still serves 20s later (four reaper intervals)"
    else
      nope "the orphaned daemon died within 20s — the reaper is killing it"
    fi
  else
    nope "the daemon never became healthy"
  fi
  pkill -f "transport http --host 127.0.0.1 --port ${MEMPALACE_MCP_PORT}" 2>/dev/null
else
  echo "  skip mempalace is not importable from ${MEMPALACE_PYTHON} — cannot"
  echo "       start a real daemon, so the behavioural lifetime check is skipped."
fi

echo ""
echo "----------------------------------------"
echo "  passed: ${PASS}   failed: ${FAIL}"
[ "${FAIL}" -eq 0 ] || exit 1
