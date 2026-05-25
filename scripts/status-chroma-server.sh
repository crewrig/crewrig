#!/usr/bin/env bash
# scripts/status-chroma-server.sh — Report whether the shared ChromaDB HTTP
# daemon is running and healthy.
#
# Exit 0 → running + heartbeat OK. Exit 1 → not running or unreachable.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
. "${SCRIPT_DIR}/lib/common.sh"

PID_FILE="${HOME}/.mempalace/chroma-server.pid"
HOST="${MEMPALACE_CHROMA_HOST:-127.0.0.1}"
PORT="${MEMPALACE_CHROMA_PORT:-8001}"

if [ ! -f "${PID_FILE}" ]; then
  echo "chroma server: NOT RUNNING (no PID file)"
  exit 1
fi

pid="$(cat "${PID_FILE}" 2>/dev/null || true)"
if [ -z "${pid}" ] || ! kill -0 "${pid}" 2>/dev/null; then
  echo "chroma server: NOT RUNNING (stale PID file: ${PID_FILE})"
  exit 1
fi

if ! curl -sf "http://${HOST}:${PORT}/api/v2/heartbeat" >/dev/null 2>&1; then
  echo "chroma server: PROCESS ALIVE (PID ${pid}) but heartbeat FAILED at ${HOST}:${PORT}"
  exit 1
fi

echo "chroma server: HEALTHY (PID ${pid}, ${HOST}:${PORT})"
exit 0
