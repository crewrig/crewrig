#!/usr/bin/env bash
# tests/e2e/lib/test-token-refresh.sh — regression test for issue #142.
#
# Failure mode under test:
#
#   The Gemini CLI persists OAuth state in oauth_creds.json with the shape
#   {access_token, expiry_date, id_token, refresh_token, scope, token_type}.
#   It does NOT store client_id / client_secret — those are compiled into the
#   CLI itself.
#
#   The current implementation of e2e_gemini_refresh_access_token() insists on
#   reading client_id and client_secret from oauth_creds.json, so it dies
#   immediately with:
#     ERROR: [gemini] oauth_creds.json missing client_id, client_secret, or refresh_token
#   …even when a perfectly valid, non-expired access_token is sitting right
#   there in the file.
#
# Test A locks the desired post-fix behaviour: when access_token is present
# and expiry_date is at least 5 min in the future, the function must echo
# the access_token to stdout without touching the network and without dying.
#
# Run standalone: bash tests/e2e/lib/test-token-refresh.sh
# TAP output: ok N - ... / not ok N - ...

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
AUTH_LIB="${REPO_ROOT}/scripts/e2e/lib/auth-common.sh"

TAP_INDEX=0
TAP_NOK=0

emit() {
  TAP_INDEX=$((TAP_INDEX + 1))
  case "$1" in
    ok)     printf 'ok %d - %s\n'     "$TAP_INDEX" "$2" ;;
    not_ok) printf 'not ok %d - %s\n' "$TAP_INDEX" "$2"; TAP_NOK=$((TAP_NOK + 1)) ;;
  esac
}

# --------------------------------------------------------------------------
# Preconditions
# --------------------------------------------------------------------------

if ! command -v jq >/dev/null 2>&1; then
  printf '1..0 # SKIP jq not found on PATH\n'
  exit 78
fi

if [[ ! -f "$AUTH_LIB" ]]; then
  printf '1..0 # SKIP auth-common.sh not found at %s\n' "$AUTH_LIB"
  exit 78
fi

# Source the library under test. Subshells below isolate `e2e_die`'s exit.
# shellcheck disable=SC1090
source "$AUTH_LIB"

# --------------------------------------------------------------------------
# Test A — valid token returned directly (no refresh needed).
#
# Build an oauth_creds.json that mirrors what the Gemini CLI actually writes:
# access_token + expiry_date (ms epoch) + refresh_token, NO client_id /
# client_secret. With expiry_date set to NOW + 1 hour, the function must
# return the access_token verbatim without contacting the network.
# --------------------------------------------------------------------------

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

CREDS_FILE="${WORK_DIR}/oauth_creds.json"
FUTURE_MS=$(( ($(date +%s) + 3600) * 1000 ))

cat >"$CREDS_FILE" <<EOF
{
  "access_token": "test-token-abc",
  "expiry_date": ${FUTURE_MS},
  "id_token": "dummy-id-token",
  "refresh_token": "dummy-refresh-token",
  "scope": "https://www.googleapis.com/auth/cloud-platform",
  "token_type": "Bearer"
}
EOF

# Run in a subshell so e2e_die's `exit 1` does not kill this test runner.
set +e
ACTUAL_OUTPUT=$(
  e2e_gemini_refresh_access_token "$CREDS_FILE" 2>"${WORK_DIR}/stderr.txt"
)
ACTUAL_EXIT=$?
set -e

if (( ACTUAL_EXIT == 0 )) && [[ "$ACTUAL_OUTPUT" == "test-token-abc" ]]; then
  emit ok "valid token (>=5 min remaining) is returned directly without refresh"
else
  emit not_ok "expected stdout='test-token-abc' exit=0, got stdout='${ACTUAL_OUTPUT}' exit=${ACTUAL_EXIT}; stderr: $(tr '\n' ' ' <"${WORK_DIR}/stderr.txt")"
fi

printf '1..%d\n' "$TAP_INDEX"

if (( TAP_NOK > 0 )); then
  exit 1
fi
exit 0
