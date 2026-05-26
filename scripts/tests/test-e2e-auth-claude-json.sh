#!/usr/bin/env bash
# test-e2e-auth-claude-json.sh — Regression for GitHub issue #112.
#
# Claude Code persists session state in TWO files:
#   - ~/.claude/.credentials.json   (inside the .claude directory)
#   - ~/.claude.json                (one level ABOVE, in $HOME)
#
# scripts/e2e/auth-claude.sh mounts only `${DIR}:/home/agent/.claude`, so any
# writes Claude makes to `/home/agent/.claude.json` land on the container's
# overlay FS and disappear when the container exits. Subsequent scenario runs
# then have no `.claude.json` to mount and Claude re-prompts for login.
#
# This test locks BOTH ends of the contract:
#   1. scripts/e2e/auth-claude.sh must include a docker `-v` flag binding
#      `<host>/.claude.json` to `/home/agent/.claude.json`.
#   2. tests/e2e/defaults.toml must include a `mounts` entry mapping the
#      same `.claude.json` for the `[cli.claude]` runtime, so non-interactive
#      scenario runs surface the persisted file inside the container.
#
# Static-only: parses the script and the TOML; does not execute docker.

set -uo pipefail

PASS=0
FAIL=0

note_pass() { echo "PASS  $1"; PASS=$((PASS + 1)); }
note_fail() { echo "FAIL  $1 — $2"; FAIL=$((FAIL + 1)); }

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AUTH_SCRIPT="${REPO_DIR}/scripts/e2e/auth-claude.sh"
DEFAULTS="${REPO_DIR}/tests/e2e/defaults.toml"

# ---------------------------------------------------------------------------
# Test 1 — auth-claude.sh mounts .claude.json into the container
# ---------------------------------------------------------------------------
if [[ ! -f "$AUTH_SCRIPT" ]]; then
  echo "SKIP  auth-claude.sh not found at $AUTH_SCRIPT — cannot test"
  exit 1
fi

# The script must contain a -v flag that binds a host path ending in
# `.claude.json` to `/home/agent/.claude.json`. We grep with a tolerant
# regex so either an inline literal or a `${VAR}/.claude.json` form passes.
# Strip comment lines first so a `#  -v ...` example in a docstring cannot
# satisfy the contract.
if grep -v '^[[:space:]]*#' "$AUTH_SCRIPT" \
   | grep -Eq -- '-v[[:space:]]+"?[^"[:space:]]*\.claude\.json:/home/agent/\.claude\.json'; then
  note_pass "auth-claude.sh — docker run binds .claude.json into /home/agent/.claude.json"
else
  note_fail "auth-claude.sh — docker run binds .claude.json into /home/agent/.claude.json" \
    "no '-v <host>/.claude.json:/home/agent/.claude.json' flag found in $AUTH_SCRIPT (issue #112)"
fi

# ---------------------------------------------------------------------------
# Test 2 — defaults.toml: [cli.claude].mounts surfaces .claude.json
# ---------------------------------------------------------------------------
if [[ ! -f "$DEFAULTS" ]]; then
  echo "SKIP  defaults.toml not found at $DEFAULTS — cannot test"
  exit 1
fi

if ! command -v yq >/dev/null 2>&1; then
  note_fail "yq dependency" "yq not on PATH — required to parse defaults.toml"
elif ! command -v jq >/dev/null 2>&1; then
  note_fail "jq dependency" "jq not on PATH — required to query the parsed JSON"
else
  JSON="$(yq -p=toml -o=json '.' "$DEFAULTS" 2>/dev/null)" || JSON=""
  if [[ -z "$JSON" ]]; then
    note_fail "defaults.toml parses as TOML" "yq parse error"
  else
    # Any entry in [cli.claude].mounts whose container path is
    # `/home/agent/.claude.json` satisfies the contract. Read-only (`:ro`)
    # suffix is allowed but not required — the runtime composes that.
    if jq -e '
          .cli.claude.mounts // []
          | map(select(test("/home/agent/\\.claude\\.json(:|$)")))
          | length > 0
        ' <<< "$JSON" >/dev/null; then
      note_pass "[cli.claude].mounts — entry targeting /home/agent/.claude.json present"
    else
      got="$(jq -c '.cli.claude.mounts // []' <<< "$JSON")"
      note_fail "[cli.claude].mounts — entry targeting /home/agent/.claude.json present" \
        "no mount for .claude.json found (issue #112). Current mounts=$got"
    fi
  fi
fi

echo ""
echo "Results: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
