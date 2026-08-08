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
# Telling an operator to rotate while giving them no way to do it is worse than
# saying nothing: they will either skip it or invent a procedure. The framework
# ships no --rotate yet, so the manual steps are spelled out here, in order,
# because getting them out of order leaves a daemon serving the old value.
echo "To ROTATE it (do this if you have any reason to think it leaked):"
echo "  1. rm -f $(mcp_token_path)"
echo "  2. bash scripts/switch-mempalace-http.sh     # mints a new one, restarts,"
echo "                                               # and re-registers every CLI"
echo "  3. Delete the timestamped .bak files beside each assistant's config —"
echo "     they still contain the OLD token:"
for _cli in claude gemini copilot antigravity; do
  _cfg="$(mcp_assistant_config_path "${_cli}")"
  [ -n "${_cfg}" ] && echo "       ${_cfg}.bak.*"
done
echo "  4. Restart every running session so it picks up the new value."
echo ""
echo "To DECOMMISSION this palace entirely, remove the token by hand:"
echo "  rm -rf $(dirname "$(mcp_token_path)")"
