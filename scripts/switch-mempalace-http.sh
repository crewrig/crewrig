#!/usr/bin/env bash
# scripts/switch-mempalace-http.sh — Switch every supported assistant on this
# machine to the shared MemPalace MCP HTTP daemon (spec 0113 R3/R4, R11-R16).
#
# All-or-nothing across the machine: the four setup scripts are four
# independent entry points, so the machine-wide obligation needs one command
# that bounds them. A scoped run of a single setup script remains legitimate
# and sits OUTSIDE R4 — this is the entry point that does not.
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=lib/common.sh
. "${SCRIPT_DIR}/lib/common.sh"
# shellcheck disable=SC2034  # read by helpers in common.sh
CREWRIG_REPO_DIR="${REPO_DIR}"

ROTATE=false

while [ "$#" -gt 0 ]; do
  case "$1" in
    --rotate|-r)
      ROTATE=true
      shift
      ;;
    -h|--help)
      echo "Usage: switch-mempalace-http.sh [--rotate|-r]"
      echo ""
      echo "Switch assistants to the shared MemPalace MCP HTTP daemon."
      echo "  --rotate, -r  Rotate the bearer token, replace the daemon process,"
      echo "                purge stale backup files holding the old token, and"
      echo "                re-register every assistant with the new token (spec 0176)."
      exit 0
      ;;
    *)
      echo "ERROR: unknown argument '$1'" >&2
      exit 1
      ;;
  esac
done

if [ "$ROTATE" = "true" ]; then
  echo "Rotating the shared MemPalace daemon bearer token (spec 0176)"
  echo ""
  TOKEN_FILE="$(mcp_token_path)"
  if [ -f "$TOKEN_FILE" ]; then
    rm -f "$TOKEN_FILE"
    echo "  Removed superseded token file: $TOKEN_FILE"
  fi
  # Purge preexisting .bak files before switch
  for _cli in claude gemini copilot antigravity; do
    _cfg="$(mcp_assistant_config_path "${_cli}")"
    if [ -n "${_cfg}" ]; then
      _cfg_dir="$(dirname "${_cfg}")"
      _cfg_base="$(basename "${_cfg}")"
      if [ -d "${_cfg_dir}" ]; then
        for _bak in "${_cfg_dir}/${_cfg_base}".bak.*; do
          if [ -f "${_bak}" ]; then
            rm -f "${_bak}"
            echo "  Purged stale backup file: ${_bak}"
          fi
        done
      fi
    fi
  done
else
  echo "Switching assistants to the shared MemPalace MCP HTTP daemon"
fi
echo ""

if [ "${CREWRIG_TEST_MOCK_DAEMON:-false}" != "true" ]; then
  if ! install_mcp_daemon "${REPO_DIR}"; then
    echo ""
    echo "ERROR: the daemon is not serving — no assistant has been switched."
    echo "       Switching them to a daemon that is not there would break every"
    echo "       session (R5: fail visibly, never fall back silently)."
    exit 1
  fi
fi

TOKEN="$(mcp_token_read_or_create)" || {
  echo "ERROR: could not read the bearer token." >&2
  exit 1
}

if [ "${CREWRIG_TEST_MOCK_DAEMON:-false}" != "true" ]; then
  echo ""
  echo "Ensuring the daemon process honours the current token (spec 0139 R2)..."
  if ! mcp_daemon_replace_process; then
    echo ""
    echo "ERROR: the daemon process could not be replaced — it may still be"
    echo "       honouring a superseded token. No assistant has been switched over"
    echo "       a stale credential."
    exit 1
  fi
fi

echo ""
echo "Registering assistants..."
if ! switch_assistants_to_http "${TOKEN}"; then
  exit 1
fi

if [ "$ROTATE" = "true" ]; then
  # Purge transition backup files generated during switch_assistants_to_http since they hold the old token
  for _cli in claude gemini copilot antigravity; do
    _cfg="$(mcp_assistant_config_path "${_cli}")"
    if [ -n "${_cfg}" ]; then
      _cfg_dir="$(dirname "${_cfg}")"
      _cfg_base="$(basename "${_cfg}")"
      if [ -d "${_cfg_dir}" ]; then
        for _bak in "${_cfg_dir}/${_cfg_base}".bak.*; do
          if [ -f "${_bak}" ]; then
            rm -f "${_bak}"
          fi
        done
      fi
    fi
  done
  echo "  Purged transition backup files holding the superseded token."
fi

echo ""
echo "Done. Every supported assistant on this machine now reaches shared memory"
echo "through the daemon."
echo ""
echo "IMPORTANT: already-running sessions keep their previous memory server"
echo "           until they restart. Restart them to pick up the change —"
echo "           without that, you will see no difference."
echo ""
# The status probe's exit code decides the run. Discarding it would print
# "*** NOT ENFORCED ***" and still exit 0 with the token already written into
# every config — the one check able to detect an unauthenticated daemon must be
# able to fail the transaction it guards.
if [ "${CREWRIG_TEST_MOCK_DAEMON:-false}" != "true" ]; then
  if ! bash "${SCRIPT_DIR}/status-mcp-server.sh"; then
    echo ""
    echo "ERROR: the daemon is serving, the assistants are registered, but the"
    echo "       checks above did not all pass. Read them before using this."
    echo "       If authentication is NOT ENFORCED, treat the token as burned:"
    echo "       remove it, run 'task mempalace:uninstall-daemon', and re-run."
    exit 1
  fi
fi
