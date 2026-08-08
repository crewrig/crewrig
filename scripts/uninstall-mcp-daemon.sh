#!/usr/bin/env bash
# scripts/uninstall-mcp-daemon.sh — End the shared MemPalace MCP HTTP daemon
# and remove its supervisor unit (spec 0113 step 2b).
#
# The symmetric inverse of the installer: `unload -w` undoes `load -w`,
# `disable --now` undoes `enable --now`. This is what a rollback runs, BEFORE
# reverting — the launcher lives outside the repository so a revert leaves a
# unit that would otherwise keep autostarting a daemon forever (the idle
# watchdog is disabled by design, so it never exits on its own).
#
# It is deliberately NOT what stop-mcp-server.sh does. Stopping is a restart
# request; this ends it.
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
. "${SCRIPT_DIR}/lib/common.sh"

echo "Uninstalling the shared MemPalace MCP HTTP daemon..."
uninstall_daemon_supervisor \
  "${MEMPALACE_MCP_LABEL:-${MCP_DAEMON_LABEL_DEFAULT}}" \
  "${MEMPALACE_MCP_UNIT:-${MCP_DAEMON_UNIT_DEFAULT}}"

launcher="$(mcp_launcher_installed_path)"
if [ -f "${launcher}" ]; then
  rm -f "${launcher}"
  echo "  Removed launcher: ${launcher}"
fi

echo ""
echo "The bearer token is left in place: it is per-palace and a later install"
echo "reuses it. Remove it by hand if you are decommissioning this palace."
