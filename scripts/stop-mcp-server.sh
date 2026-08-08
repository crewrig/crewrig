#!/usr/bin/env bash
# scripts/stop-mcp-server.sh — Stop the shared MemPalace MCP HTTP daemon.
#
# TRANSIENT BY DESIGN. Under a supervisor with KeepAlive / Restart=always, a
# stop is a RESTART REQUEST: the daemon comes straight back. That is the useful
# meaning for day-to-day work (pick up a new config, clear a wedged process),
# and it is why this script never issues `unload -w` or `disable --now` — those
# would silently cancel the operator's autostart from a command that reads like
# a routine stop.
#
# To actually end the daemon, run scripts/uninstall-mcp-daemon.sh.
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
. "${SCRIPT_DIR}/lib/common.sh"

LABEL="${MEMPALACE_MCP_LABEL:-${MCP_DAEMON_LABEL_DEFAULT}}"
UNIT="${MEMPALACE_MCP_UNIT:-${MCP_DAEMON_UNIT_DEFAULT}}"

case "$(uname -s)" in
  Darwin)
    if launchctl list 2>/dev/null | grep -q "${LABEL}"; then
      launchctl stop "${LABEL}" 2>/dev/null || true
      echo "MCP daemon: restart requested (${LABEL})"
      echo "  Under KeepAlive the supervisor brings it straight back."
      echo "  To end it: bash scripts/uninstall-mcp-daemon.sh"
    else
      echo "MCP daemon: no supervisor unit loaded (${LABEL})"
    fi
    ;;
  Linux)
    if systemctl --user is-active --quiet "${UNIT}" 2>/dev/null; then
      systemctl --user restart "${UNIT}" 2>/dev/null || true
      echo "MCP daemon: restart requested (${UNIT})"
      echo "  Under Restart=always the supervisor brings it straight back."
      echo "  To end it: bash scripts/uninstall-mcp-daemon.sh"
    else
      echo "MCP daemon: no supervisor unit active (${UNIT})"
    fi
    ;;
  *)
    echo "MCP daemon: unsupported OS — manage the supervisor unit manually." >&2
    exit 1
    ;;
esac
