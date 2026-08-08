#!/usr/bin/env bash
# scripts/stop-chroma-server.sh — Stop the shared ChromaDB HTTP daemon.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
. "${SCRIPT_DIR}/lib/common.sh"

PID_FILE="${HOME}/.mempalace/chroma-server.pid"

if [ ! -f "${PID_FILE}" ]; then
  # A supervisor-managed daemon (launchd/systemd) writes no PID file, so the
  # absence of one does NOT mean nothing is running. Reporting "not running"
  # here was misleading: the daemon answers, and killing it would not end it
  # anyway — KeepAlive / Restart=always bring it straight back.
  #
  # Detection is the same discriminator status-chroma-server.sh:16-21 already
  # uses: no PID file, but the heartbeat answers. This script deliberately does
  # NOT act on that case — unloading the unit from a routine stop would cancel
  # the operator's autostart. Ending the daemon is a separate, named operation.
  _host="${MEMPALACE_CHROMA_HOST:-127.0.0.1}"
  _port="${MEMPALACE_CHROMA_PORT:-8001}"
  if curl -sf "http://${_host}:${_port}/api/v2/heartbeat" >/dev/null 2>&1; then
    echo "chroma server: RUNNING and supervisor-managed (${_host}:${_port}, no PID file)"
    echo "  Not stopped: a supervised daemon restarts immediately."
    echo "  To end it, remove its supervisor unit (launchctl unload -w /"
    echo "  systemctl --user disable --now mempalace-chroma-server)."
    exit 0
  fi
  echo "chroma server not running (no PID file, heartbeat failed at ${_host}:${_port})"
  exit 0
fi

pid="$(cat "${PID_FILE}" 2>/dev/null || true)"
if [ -z "${pid}" ] || ! kill -0 "${pid}" 2>/dev/null; then
  echo "chroma server not running (stale PID file removed)"
  rm -f "${PID_FILE}"
  exit 0
fi

kill -TERM "${pid}" 2>/dev/null || true

deadline=$((SECONDS + 5))
while [ "${SECONDS}" -lt "${deadline}" ]; do
  if ! kill -0 "${pid}" 2>/dev/null; then
    rm -f "${PID_FILE}"
    echo "chroma server stopped (was PID ${pid})"
    exit 0
  fi
  sleep 1
done

echo "WARN: chroma server (PID ${pid}) did not exit after SIGTERM — sending SIGKILL." >&2
kill -KILL "${pid}" 2>/dev/null || true
rm -f "${PID_FILE}"
echo "chroma server force-stopped (was PID ${pid})"
