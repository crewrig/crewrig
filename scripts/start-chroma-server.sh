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

# Custom root-CA / native-TLS delegation (spec 0084): inherit user-consented
# trust so the daemon's embedding-model fetch works behind a custom CA.
if [ -f "${HOME}/.crewrig/tls-env.sh" ]; then
  # shellcheck source=/dev/null
  . "${HOME}/.crewrig/tls-env.sh"
fi

MEMPALACE_DIR="${HOME}/.mempalace"
PID_FILE="${MEMPALACE_DIR}/chroma-server.pid"
LOG_FILE="${MEMPALACE_DIR}/chroma-server.log"
PALACE_DIR="${MEMPALACE_PALACE_PATH:-${MEMPALACE_DIR}/palace}"
HOST="${MEMPALACE_CHROMA_HOST:-127.0.0.1}"
PORT="${MEMPALACE_CHROMA_PORT:-8001}"

PYTHON_BIN="${MEMPALACE_PYTHON:-$(detect_mempalace_python || true)}"
if [ -z "${PYTHON_BIN}" ]; then
  echo "ERROR: cannot locate the mempalace Python interpreter." >&2
  echo "  Install via: pipx install 'mempalace>=${MEMPALACE_MIN_VERSION},<${MEMPALACE_MAX_VERSION_EXCLUSIVE}'" >&2
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

# ── Raise open-file limit (spec 0087) ───────────────────────────────────────
# Scoped to this script's process: `ulimit -n` here only affects the shell
# running this script, and the daemon inherits it as a child of that shell
# (via `nohup ... &` below, no intervening subshell) — the invoking caller's
# shell and any other process are left untouched. Guarded because `set -e`
# (line 7) would otherwise abort the whole script on a fixed-below-floor
# hard ceiling (e.g. an unprivileged container default).
if ! ulimit -n "${MEMPALACE_CHROMA_ULIMIT_FLOOR:-10240}" 2>/dev/null; then
  echo "WARNING: could not raise open-file limit to ${MEMPALACE_CHROMA_ULIMIT_FLOOR:-10240}; current hard ceiling is $(ulimit -Hn)." >&2
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
