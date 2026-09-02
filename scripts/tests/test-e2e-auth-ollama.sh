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
#   2. tests/e2e/local.toml.example must get the keypair to a writable
#      ~/.ollama in the copilot scenario container, by EITHER of two
#      admissible shapes: a direct `[cli.copilot].mounts` entry whose
#      container path is /home/agent/.ollama (the original shape), OR the
#      copy-into-writable pattern (issue #1107) — a mounts entry at a side
#      path plus an in-container `command` step that copies it into
#      ~/.ollama before launch (a direct :ro mount AT ~/.ollama breaks
#      recent ollama clients, which write temp state there and fail with
#      EROFS).
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
    # Shape (a) — the original direct mount: any [cli.copilot].mounts entry
    # whose container path is /home/agent/.ollama. Read-only (`:ro`) suffix
    # is allowed but not required.
    DIRECT_MOUNT="$(jq -e '
          .cli.copilot.mounts // []
          | map(select(test("/home/agent/\\.ollama(:|$)")))
          | length > 0
        ' <<< "$JSON" 2>/dev/null)" || DIRECT_MOUNT="false"

    # Shape (b) — copy-into-writable (issue #1107): a mounts entry at ANY
    # container path (the read-only staging side path) whose in-container
    # `command` copies into ~/.ollama before launch. Requires evidence of
    # BOTH a mount and a copy step — a command mentioning ~/.ollama with no
    # mount at all would not actually stage the keypair into the container.
    HAS_ANY_MOUNT="$(jq -e '(.cli.copilot.mounts // []) | length > 0' <<< "$JSON" 2>/dev/null)" || HAS_ANY_MOUNT="false"
    CMD_JSON="$(jq -c '.cli.copilot.command // []' <<< "$JSON")"
    COPY_INTO_WRITABLE="false"
    if [[ "$HAS_ANY_MOUNT" == "true" ]] \
       && grep -q '~/.ollama' <<< "$CMD_JSON" \
       && grep -Eq 'cp[[:space:]]' <<< "$CMD_JSON"; then
      COPY_INTO_WRITABLE="true"
    fi

    if [[ "$DIRECT_MOUNT" == "true" || "$COPY_INTO_WRITABLE" == "true" ]]; then
      note_pass "[cli.copilot] — keypair reaches a writable ~/.ollama in-container (direct mount or copy-into-writable, issue #114/#1107)"
    else
      got_mounts="$(jq -c '.cli.copilot.mounts // []' <<< "$JSON")"
      note_fail "[cli.copilot] — keypair reaches a writable ~/.ollama in-container" \
        "neither a direct /home/agent/.ollama mount nor a copy-into-writable command found (issue #114/#1107). mounts=$got_mounts command=$CMD_JSON"
    fi
  fi
fi

echo ""
echo "Results: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
