#!/usr/bin/env bash
# scripts/stop-chroma-server.sh — Stop the shared ChromaDB HTTP daemon.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
. "${SCRIPT_DIR}/lib/common.sh"

PID_FILE="${HOME}/.mempalace/chroma-server.pid"

if [ ! -f "${PID_FILE}" ]; then
  echo "chroma server not running (no PID file)"
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
