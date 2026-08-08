#!/usr/bin/env bash
# scripts/status-mcp-server.sh — Report the state of the shared MemPalace MCP
# HTTP daemon (spec 0113 R10, R16; ADR 0016).
#
# Exit 0 → serving and healthy. Exit 1 → not serving, or serving unsafely.
#
# This script is the operator's ONLY window onto three things that have no
# other surface once sessions stop launching their own memory server:
#
#   1. The spec-0108 runtime version guard. Its refusal relies on "the
#      launching CLI reports a failed memory server" — after the switch there
#      is no launching CLI, so a non-healthy verdict tails the daemon log here.
#   2. Whether authentication is actually ON. A daemon started without a token
#      serves every request unauthenticated while looking perfectly healthy;
#      an unauthenticated probe of /mcp must be REFUSED. /healthz cannot answer
#      this — it is served with require_auth=False and returns 200 in every
#      state, including the broken one.
#   3. Launcher drift. The installed launcher lives outside the repository and
#      a `git pull` does not update it, so it records the hash of the source it
#      was built from and we compare that against the source now.
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=lib/common.sh
. "${SCRIPT_DIR}/lib/common.sh"
# shellcheck disable=SC2034  # read by mcp_launcher_source_sha in common.sh
CREWRIG_REPO_DIR="${REPO_DIR}"

HOST="${MEMPALACE_MCP_HOST:-${MCP_DAEMON_HOST_DEFAULT}}"
PORT="${MEMPALACE_MCP_PORT:-${MCP_DAEMON_PORT_DEFAULT}}"
LOG="${HOME}/.mempalace/mcp-server.log"
rc=0

echo "MemPalace MCP HTTP daemon"
echo "  endpoint: http://${HOST}:${PORT}/mcp"

# --- 1. Liveness -------------------------------------------------------------
if curl -sf --max-time 3 "http://${HOST}:${PORT}/healthz" >/dev/null 2>&1; then
  echo "  state:    HEALTHY"
else
  echo "  state:    NOT SERVING"
  rc=1
  if [ -f "${LOG}" ]; then
    echo ""
    echo "  --- last 20 lines of ${LOG} ---"
    tail -n 20 "${LOG}" | sed 's/^/  /'
    echo "  --- end of log ---"
  else
    echo "  (no log at ${LOG})"
  fi
fi

# --- 2. Authentication actually enforced -------------------------------------
# Only meaningful while serving; a dead daemon refuses everything for the wrong
# reason.
if [ "${rc}" -eq 0 ]; then
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 \
    -X POST "http://${HOST}:${PORT}/mcp" \
    -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' 2>/dev/null || echo "000")"
  if [ "${code}" = "401" ]; then
    echo "  auth:     ENFORCED (unauthenticated /mcp refused)"
  else
    echo "  auth:     *** NOT ENFORCED *** (unauthenticated /mcp returned ${code}, expected 401)"
    echo "            The daemon is serving without a bearer token. Every client"
    echo "            reaches it unauthenticated. Re-run setup to provision one."
    rc=1
  fi
fi

# --- 3. Launcher drift -------------------------------------------------------
launcher="$(mcp_launcher_installed_path)"
if [ -f "${launcher}" ]; then
  recorded="$(grep -m1 '^LAUNCHER_SOURCE_SHA=' "${launcher}" 2>/dev/null | cut -d'"' -f2)"
  current="$(mcp_launcher_source_sha 2>/dev/null || true)"
  if [ -z "${recorded}" ] || [ -z "${current}" ]; then
    echo "  launcher: ${launcher} (drift UNKNOWN — no recorded source hash)"
  elif [ "${recorded}" = "${current}" ]; then
    echo "  launcher: ${launcher} (in sync with the repository)"
  else
    echo "  launcher: ${launcher} *** DRIFTED ***"
    echo "            built from ${recorded}, repository now ${current}"
    echo "            Re-run setup to refresh it."
    rc=1
  fi
else
  echo "  launcher: NOT INSTALLED at ${launcher}"
  rc=1
fi

# --- 4. Per-assistant arrangement (R16) --------------------------------------
echo ""
echo "Assistant registrations:"
mcp_report_assistant_arrangements || true

exit "${rc}"
