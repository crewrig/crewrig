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

# Strip ALL whitespace before judging, and validate the SHAPE rather than mere
# emptiness. This is not fussiness: upstream strips the token before storing it
# (`token.strip()`), so a file containing only spaces or tabs is non-empty to
# the shell and EMPTY to the server — and an empty auth_token short-circuits
# the bearer check, serving the whole palace unauthenticated while this guard
# reports success. Demonstrated against the real handler: a "   " token yields
# 200 on an unauthenticated tools/list. A trailing newline is safe (command
# substitution and .strip() agree), but only shape validation closes the class.
MEMPALACE_MCP_HTTP_TOKEN="$(tr -d '[:space:]' < "${TOKEN_FILE}" 2>/dev/null || true)"
if [ -z "${MEMPALACE_MCP_HTTP_TOKEN}" ]; then
  die "bearer token file is empty or whitespace-only: ${TOKEN_FILE}
       Refusing to start: upstream strips the token, so whitespace-only content
       becomes an empty token and short-circuits the bearer check — every
       request would be served unauthenticated. Re-run the setup script."
fi
case "${MEMPALACE_MCP_HTTP_TOKEN}" in
  *[!A-Za-z0-9_-]*)
    die "bearer token contains unexpected characters: ${TOKEN_FILE}
       Refusing to start rather than guess how the server will interpret it."
    ;;
esac
if [ "${#MEMPALACE_MCP_HTTP_TOKEN}" -lt 32 ]; then
  die "bearer token is shorter than 32 characters: ${TOKEN_FILE}
       Refusing to start: a short token is not a credential. Re-provision it."
fi
export MEMPALACE_MCP_HTTP_TOKEN

# The idle watchdog exists to reap stale per-session stdio servers. A supervised
# shared daemon is neither stale nor per-session; letting it self-terminate
# would cycle the writer lease for no reason.
export MEMPALACE_MCP_IDLE_HOURS="${MEMPALACE_MCP_IDLE_HOURS:-0}"

# --- 1b. Refuse fast when the port is already taken --------------------------
# A taken port is NOT transient: retrying every ThrottleInterval for hours
# cannot resolve it, and that is exactly what the supervisor will do. Say it
# once, name what the operator can actually check — `lsof` returns nothing when
# the holder is a system service under launchd — and exit before doing any more
# work. Observed as 172 identical restarts on the first production run (#748).
if command -v python3 >/dev/null 2>&1; then
  if ! python3 - "${MCP_HOST}" "${MCP_PORT}" <<'PROBE'
import socket, sys
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
try:
    s.bind((sys.argv[1], int(sys.argv[2])))
except OSError:
    sys.exit(1)
finally:
    s.close()
PROBE
  then
    die "port ${MCP_PORT} on ${MCP_HOST} is already in use.
       Retrying will not help — the supervisor would respawn this forever.
       Find the holder:   netstat -anv | grep ${MCP_PORT}
       (lsof may show nothing: a system service under launchd is invisible
        without elevation.)
       Choose another:    MEMPALACE_MCP_PORT=<port> task mempalace:switch-http"
  fi
fi

# --- 2. Wait for the ChromaDB daemon (tier 1) --------------------------------
# ADR 0006 owns the tier below this one. The wrapper we exec fails loud when
# that daemon is unreachable, which is correct but would make the supervisor
# restart us in a loop at boot. Waiting converts a boot-order race into one
# long attempt.
# Configurable so a hermetic test does not pay 60s per invocation. Every test
# that exercises a REFUSAL must die at the token check and never reach here; if
# a regression lets one through, a short deadline turns a 60s hang into a fast,
# legible failure rather than a suite that looks stuck.
CHROMA_WAIT_SECONDS="${MEMPALACE_MCP_CHROMA_WAIT:-60}"
DEADLINE=$((SECONDS + CHROMA_WAIT_SECONDS))
until curl -sf --max-time 2 "http://${CHROMA_HOST}:${CHROMA_PORT}/api/v2/heartbeat" >/dev/null 2>&1; do
  if [ "${SECONDS}" -ge "${DEADLINE}" ]; then
    die "ChromaDB daemon unreachable at ${CHROMA_HOST}:${CHROMA_PORT} after ${CHROMA_WAIT_SECONDS}s.
       The MCP daemon serves through it (ADR 0006) and will not start without it.
       Check: bash ${CREWRIG_REPO_DIR}/scripts/status-chroma-server.sh"
  fi
  sleep 1
done
log "ChromaDB daemon reachable at ${CHROMA_HOST}:${CHROMA_PORT}"

# Propagate the endpoint we just proved reachable. The wrapper reads
# MEMPALACE_CHROMA_HOST/PORT from the environment and defaults to
# 127.0.0.1:8001, and no supervisor inherits a login shell — so on a
# non-default chroma port the launcher would wait on the RIGHT port, succeed,
# and hand off to a wrapper that probes 8001, fails loud, and gets respawned
# forever by KeepAlive / Restart=always. That is precisely the boot loop the
# wait above exists to prevent, reintroduced one line later.
export MEMPALACE_CHROMA_HOST="${CHROMA_HOST}"
export MEMPALACE_CHROMA_PORT="${CHROMA_PORT}"

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
