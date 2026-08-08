#!/usr/bin/env bash
# scripts/switch-mempalace-http.sh — Switch every supported assistant on this
# machine to the shared MemPalace MCP HTTP daemon (spec 0113 R3/R4, R11-R16).
#
# All-or-nothing across the machine: the four setup scripts are four
# independent entry points, so the machine-wide obligation needs one command
# that bounds them. A scoped run of a single setup script remains legitimate
# and sits OUTSIDE R4 — this is the entry point that does not.
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=lib/common.sh
. "${SCRIPT_DIR}/lib/common.sh"
# shellcheck disable=SC2034  # read by helpers in common.sh
CREWRIG_REPO_DIR="${REPO_DIR}"

echo "Switching assistants to the shared MemPalace MCP HTTP daemon"
echo ""

if ! install_mcp_daemon "${REPO_DIR}"; then
  echo ""
  echo "ERROR: the daemon is not serving — no assistant has been switched."
  echo "       Switching them to a daemon that is not there would break every"
  echo "       session (R5: fail visibly, never fall back silently)."
  exit 1
fi

TOKEN="$(mcp_token_read_or_create)" || {
  echo "ERROR: could not read the bearer token." >&2
  exit 1
}

echo ""
echo "Registering assistants..."
if ! switch_assistants_to_http "${TOKEN}"; then
  exit 1
fi

echo ""
echo "Done. Every supported assistant on this machine now reaches shared memory"
echo "through the daemon."
echo ""
echo "IMPORTANT: already-running sessions keep their previous memory server"
echo "           until they restart. Restart them to pick up the change —"
echo "           without that, you will see no difference."
echo ""
bash "${SCRIPT_DIR}/status-mcp-server.sh" || true
