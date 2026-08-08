#!/usr/bin/env bash
# mcp-daemon-launcher.sh — ExecStart for the shared MemPalace MCP HTTP daemon
# (spec 0113, ADR 0016).
#
# THIS FILE IS A TEMPLATE. The supervisor never runs this copy: the installer
# materialises it to ~/.crewrig/mcp-daemon-launcher.sh with the placeholders
# below substituted, and both unit files name THAT path. Installing it outside
# the repository is deliberate — a `git revert` of this ticket must not delete
# the program the supervisor's ExecStart points at.
#
# Three properties this program exists to guarantee, none of which the unit
# file can provide on its own:
#
#   1. FOREGROUND. The supervisor owns the process. Backgrounding (the way
#      start-chroma-server.sh does with nohup) makes the supervisor observe an
#      immediate exit and restart forever. We exec, we never fork.
#
#   2. THE TOKEN NEVER TOUCHES A WORLD-READABLE FILE. Unit files are
#      materialised with `sed > dst` at the default umask (0644). Reading the
#      0600 token here, and exporting it into our own environment, keeps the
#      credential out of the unit and out of the process table (an exported
#      variable is not argv).
#
#   3. FAIL CLOSED ON A MISSING TOKEN. Upstream does not: MemPalace requires a
#      token only for a NON-loopback bind, and its auth gate reads
#      `if require_auth and srv.auth_token:` — an empty token short-circuits
#      the entire bearer check. A daemon started without one serves happily,
#      every CLI works, and the Authorization header they send is ignored.
#      Authentication would be off with nothing reporting it. So: absent or
#      empty token => refuse to start, loudly, non-zero.
#
# Ordering is enforced here rather than asserted in the unit: launchd has no
# dependency ordering between user agents, so we WAIT for the ChromaDB daemon
# on a deadline. One supervisor start is one long attempt, never a retry storm
# that would exhaust a start-limit budget and leave the unit permanently failed.

set -u

CREWRIG_REPO_DIR="__CREWRIG_REPO_DIR__"
MCP_HOST="__MCP_HOST__"
MCP_PORT="__MCP_PORT__"
CHROMA_HOST="__CHROMA_HOST__"
CHROMA_PORT="__CHROMA_PORT__"
MEMPALACE_PYTHON="__MEMPALACE_PYTHON__"

# Recorded at install time: the sha256 of this file's REPOSITORY SOURCE, not of
# the materialised copy. status-mcp-server.sh compares it against the source's
# current hash to detect drift. Comparing the installed bytes directly would
# report divergence on a fresh, correct install — the substitutions above
# guarantee the two files differ — and a check that always fires is worth as
# little as one that never does.
LAUNCHER_SOURCE_SHA="__LAUNCHER_SOURCE_SHA__"
export LAUNCHER_SOURCE_SHA

log() { printf '%s %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$*"; }
die() { printf '%s ERROR: %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$*" >&2; exit 1; }

# --- 1. Token: read, or refuse to serve -------------------------------------
TOKEN_FILE="${MEMPALACE_MCP_TOKEN_FILE:-}"
if [ -z "${TOKEN_FILE}" ]; then
  palace="${MEMPALACE_PALACE_PATH:-${HOME}/.mempalace/palace}"
  resolved="$(cd "$(dirname "${palace}")" 2>/dev/null && pwd)/$(basename "${palace}")" || resolved="${palace}"
  if command -v shasum >/dev/null 2>&1; then
    key="$(printf '%s' "${resolved}" | shasum -a 256 | cut -c1-24)"
  else
    key="$(printf '%s' "${resolved}" | sha256sum | cut -c1-24)"
  fi
  TOKEN_FILE="${HOME}/.mempalace/server/${key}/token"
fi

if [ ! -f "${TOKEN_FILE}" ]; then
  die "bearer token file not found: ${TOKEN_FILE}
       Refusing to start: MemPalace requires a token only on a non-loopback
       bind, so serving without one would silently disable authentication for
       every client. Re-run the setup script to provision it."
fi

MEMPALACE_MCP_HTTP_TOKEN="$(cat "${TOKEN_FILE}" 2>/dev/null || true)"
if [ -z "${MEMPALACE_MCP_HTTP_TOKEN}" ]; then
  die "bearer token file is empty: ${TOKEN_FILE}
       Refusing to start: an empty token short-circuits the bearer check
       upstream, which would serve every request unauthenticated. Re-run the
       setup script to provision it."
fi
export MEMPALACE_MCP_HTTP_TOKEN

# The idle watchdog exists to reap stale per-session stdio servers. A supervised
# shared daemon is neither stale nor per-session; letting it self-terminate
# would cycle the writer lease for no reason.
export MEMPALACE_MCP_IDLE_HOURS="${MEMPALACE_MCP_IDLE_HOURS:-0}"

# --- 2. Wait for the ChromaDB daemon (tier 1) --------------------------------
# ADR 0006 owns the tier below this one. The wrapper we exec fails loud when
# that daemon is unreachable, which is correct but would make the supervisor
# restart us in a loop at boot. Waiting converts a boot-order race into one
# long attempt.
DEADLINE=$((SECONDS + 60))
until curl -sf --max-time 2 "http://${CHROMA_HOST}:${CHROMA_PORT}/api/v2/heartbeat" >/dev/null 2>&1; do
  if [ "${SECONDS}" -ge "${DEADLINE}" ]; then
    die "ChromaDB daemon unreachable at ${CHROMA_HOST}:${CHROMA_PORT} after 60s.
       The MCP daemon serves through it (ADR 0006) and will not start without it.
       Check: bash ${CREWRIG_REPO_DIR}/scripts/status-chroma-server.sh"
  fi
  sleep 1
done
log "ChromaDB daemon reachable at ${CHROMA_HOST}:${CHROMA_PORT}"

# --- 3. Hand off ------------------------------------------------------------
# exec, not a subshell: the supervisor must supervise the server itself, and
# the wrapper carries the spec-0108 version guard plus the ADR-0006
# PersistentClient patch. Going around it would re-create the second data owner
# ADR 0006 eliminated.
WRAPPER="${CREWRIG_REPO_DIR}/scripts/lib/mempalace-http-wrapper.py"
[ -f "${WRAPPER}" ] || die "wrapper not found: ${WRAPPER}
       The launcher lives outside the repository but the wrapper does not; a
       moved or removed checkout breaks this path. Re-run the setup script."

log "starting MemPalace MCP HTTP daemon on ${MCP_HOST}:${MCP_PORT}/mcp"
exec "${MEMPALACE_PYTHON}" "${WRAPPER}" \
  --transport http --host "${MCP_HOST}" --port "${MCP_PORT}"
