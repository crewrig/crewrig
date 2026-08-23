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
# Leaving the registrations pointed at a now-free port is the dangerous part of
# an uninstall: the next process to bind that port receives the real bearer
# token in the first request header, and can then answer four agents with
# fabricated memory. Report exactly which assistants are in that state.
still_http=""
for _cli in claude gemini copilot antigravity; do
  if [ "$(mcp_assistant_arrangement "${_cli}")" = "http" ]; then
    still_http="${still_http} ${_cli}"
  fi
done
if [ -n "${still_http}" ]; then
  echo "WARNING: these assistants still point at the daemon you just removed:"
  for _cli in ${still_http}; do
    echo "    - ${_cli}  ($(mcp_assistant_config_path "${_cli}"))"
  done
  echo ""
  echo "  The port is now free. Any local process that binds it receives your"
  echo "  bearer token in the first request and can answer your agents with"
  echo "  fabricated memory. Re-point them before that matters:"
  echo "    re-run the setup script for each, or 'task mempalace:switch-http'"
  echo "    to bring the daemon back."
  echo ""
fi

echo "The bearer token is left in place: it is per-palace and a later install"
echo "reuses it."
echo ""
echo "To ROTATE it (do this if you have any reason to think it leaked):"
echo "  task mempalace:rotate-token"
echo "  # or: bash scripts/switch-mempalace-http.sh --rotate"
echo ""
echo "  This removes the old token, mints a new one, replaces the daemon process"
echo "  (spec 0139), purges stale .bak backups, and re-registers every assistant."
echo "  Then restart every running session to pick up the new value."
echo ""
echo "To DECOMMISSION this palace entirely, remove the token by hand:"
echo "  rm -rf $(dirname "$(mcp_token_path)")"
