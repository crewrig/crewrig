#!/usr/bin/env bash
# test-e2e-auth-ollama.sh — Regression for GitHub issue #114.
#
# Ollama Cloud authentication writes an Ed25519 keypair into
# ~/.ollama/{id_ed25519,id_ed25519.pub} on first signin. For the e2e
# harness, that directory must be:
#
#   1. Bind-mounted into the interactive signin container so the keypair
#      is persisted on the host under ${CREWRIG_E2E_HOME}/ollama/.
#   2. Re-mounted (read-only) into the copilot scenario container so
#      `ollama launch copilot` can reuse the registered identity without
#      re-prompting.
#
# This test locks both ends of the contract:
#   1. scripts/e2e/auth-ollama.sh must contain a docker `-v` flag binding
#      a host path to /home/agent/.ollama (literal or `.${CLI}` form
#      with CLI=ollama) inside the container.
#   2. tests/e2e/local.toml.example must declare a `[cli.copilot].mounts`
#      entry whose container path is /home/agent/.ollama.
#
# Static-only: parses the script and the TOML; does not execute docker.

set -uo pipefail

PASS=0
FAIL=0

note_pass() { echo "PASS  $1"; PASS=$((PASS + 1)); }
note_fail() { echo "FAIL  $1 — $2"; FAIL=$((FAIL + 1)); }

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AUTH_SCRIPT="${REPO_DIR}/scripts/e2e/auth-ollama.sh"
LOCAL_EXAMPLE="${REPO_DIR}/tests/e2e/local.toml.example"

# ---------------------------------------------------------------------------
# Test 1 — auth-ollama.sh mounts .ollama into the container
# ---------------------------------------------------------------------------
if [[ ! -f "$AUTH_SCRIPT" ]]; then
  echo "SKIP  auth-ollama.sh not found at $AUTH_SCRIPT — cannot test"
  exit 1
fi

# The script must contain a -v flag whose container side resolves to
# /home/agent/.ollama. Two acceptable forms in the source:
#   - literal:  -v "<host>:/home/agent/.ollama"
#   - variable: -v "<host>:/home/agent/.${CLI}"  (with CLI=ollama set elsewhere)
# Strip comment lines first so a `#  -v ...` docstring example cannot
# satisfy the contract.
STRIPPED="$(grep -v '^[[:space:]]*#' "$AUTH_SCRIPT")"

if grep -Eq -- '-v[[:space:]]+"?[^"[:space:]]*:/home/agent/\.(ollama([[:space:]"]|$)|\$\{?CLI\}?)' <<< "$STRIPPED"; then
  # If the variable form is used, additionally require CLI=ollama assignment
  # so the mount actually resolves to /home/agent/.ollama at run time.
  if grep -Eq -- '-v[[:space:]]+"?[^"[:space:]]*:/home/agent/\.ollama([[:space:]"]|$)' <<< "$STRIPPED"; then
    note_pass "auth-ollama.sh — docker run binds host path into /home/agent/.ollama"
  elif grep -Eq '^[[:space:]]*CLI=("ollama"|ollama|'\''ollama'\'')[[:space:]]*$' <<< "$STRIPPED"; then
    note_pass "auth-ollama.sh — docker run binds host path into /home/agent/.\${CLI} with CLI=ollama"
  else
    note_fail "auth-ollama.sh — docker run binds host path into /home/agent/.ollama" \
      "found -v ...:/home/agent/.\${CLI} but no CLI=ollama assignment (issue #114)"
  fi
else
  note_fail "auth-ollama.sh — docker run binds host path into /home/agent/.ollama" \
    "no '-v <host>:/home/agent/.ollama' flag found in $AUTH_SCRIPT (issue #114)"
fi

# ---------------------------------------------------------------------------
# Test 2 — local.toml.example: [cli.copilot].mounts surfaces .ollama
# ---------------------------------------------------------------------------
if [[ ! -f "$LOCAL_EXAMPLE" ]]; then
  echo "SKIP  local.toml.example not found at $LOCAL_EXAMPLE — cannot test"
  exit 1
fi

if ! command -v yq >/dev/null 2>&1; then
  note_fail "yq dependency" "yq not on PATH — required to parse local.toml.example"
elif ! command -v jq >/dev/null 2>&1; then
  note_fail "jq dependency" "jq not on PATH — required to query the parsed JSON"
else
  JSON="$(yq -p=toml -o=json '.' "$LOCAL_EXAMPLE" 2>/dev/null)" || JSON=""
  if [[ -z "$JSON" ]]; then
    note_fail "local.toml.example parses as TOML" "yq parse error"
  else
    # Any entry in [cli.copilot].mounts whose container path is
    # /home/agent/.ollama satisfies the contract. Read-only (`:ro`)
    # suffix is allowed but not required.
    if jq -e '
          .cli.copilot.mounts // []
          | map(select(test("/home/agent/\\.ollama(:|$)")))
          | length > 0
        ' <<< "$JSON" >/dev/null; then
      note_pass "[cli.copilot].mounts — entry targeting /home/agent/.ollama present"
    else
      got="$(jq -c '.cli.copilot.mounts // []' <<< "$JSON")"
      note_fail "[cli.copilot].mounts — entry targeting /home/agent/.ollama present" \
        "no mount for .ollama found (issue #114). Current mounts=$got"
    fi
  fi
fi

echo ""
echo "Results: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
