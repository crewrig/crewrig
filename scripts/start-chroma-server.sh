#!/usr/bin/env bash
# scripts/start-chroma-server.sh — Start the shared ChromaDB HTTP daemon
# used by all MemPalace MCP server instances.
#
# Idempotent: if the daemon is already running, exits 0 without action.
# Health-checks the HTTP heartbeat endpoint before declaring success.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
. "${SCRIPT_DIR}/lib/common.sh"

MEMPALACE_DIR="${HOME}/.mempalace"
PID_FILE="${MEMPALACE_DIR}/chroma-server.pid"
LOG_FILE="${MEMPALACE_DIR}/chroma-server.log"
PALACE_DIR="${MEMPALACE_DIR}/palace"
HOST="${MEMPALACE_CHROMA_HOST:-127.0.0.1}"
PORT="${MEMPALACE_CHROMA_PORT:-8001}"

PYTHON_BIN="${MEMPALACE_PYTHON:-$(detect_mempalace_python || true)}"
if [ -z "${PYTHON_BIN}" ]; then
  echo "ERROR: cannot locate the mempalace Python interpreter." >&2
  echo "  Install via: pipx install 'mempalace>=3.3.3,<3.4'" >&2
  exit 1
fi
CHROMA_BIN="$(dirname "${PYTHON_BIN}")/chroma"

mkdir -p "${MEMPALACE_DIR}" "${PALACE_DIR}"

# ── Idempotency: already running? ───────────────────────────────────────────
if [ -f "${PID_FILE}" ]; then
  existing_pid="$(cat "${PID_FILE}" 2>/dev/null || true)"
  if [ -n "${existing_pid}" ] && kill -0 "${existing_pid}" 2>/dev/null; then
    echo "chroma server already running (PID ${existing_pid})"
    exit 0
  else
    echo "  Stale PID file detected — cleaning up."
    rm -f "${PID_FILE}"
  fi
fi

# ── Sanity checks ───────────────────────────────────────────────────────────
if [ ! -x "${PYTHON_BIN}" ]; then
  echo "ERROR: Python interpreter not found at ${PYTHON_BIN}" >&2
  echo "  Install MemPalace via pipx first." >&2
  exit 1
fi
if [ ! -x "${CHROMA_BIN}" ]; then
  echo "ERROR: chroma binary not found at ${CHROMA_BIN}" >&2
  echo "  Install via: pipx inject mempalace 'chromadb>=1.5.9'" >&2
  exit 1
fi

# ── Launch daemon ───────────────────────────────────────────────────────────
nohup "${PYTHON_BIN}" "${CHROMA_BIN}" run \
  --path "${PALACE_DIR}" \
  --host "${HOST}" \
  --port "${PORT}" \
  >> "${LOG_FILE}" 2>&1 &

new_pid=$!
echo "${new_pid}" > "${PID_FILE}"

# ── Health-check loop (15s max) ─────────────────────────────────────────────
deadline=$((SECONDS + 15))
while [ "${SECONDS}" -lt "${deadline}" ]; do
  if curl -sf "http://${HOST}:${PORT}/api/v2/heartbeat" >/dev/null 2>&1; then
    echo "chroma server started (PID ${new_pid}, ${HOST}:${PORT})"
    exit 0
  fi
  if ! kill -0 "${new_pid}" 2>/dev/null; then
    echo "ERROR: chroma server process died during startup." >&2
    echo "  Check the log: ${LOG_FILE}" >&2
    rm -f "${PID_FILE}"
    exit 1
  fi
  sleep 1
done

echo "ERROR: chroma server heartbeat timed out after 15s at ${HOST}:${PORT}" >&2
echo "  Check the log: ${LOG_FILE}" >&2
kill "${new_pid}" 2>/dev/null || true
rm -f "${PID_FILE}"
exit 1
