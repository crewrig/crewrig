#!/usr/bin/env bash
# test-e2e-auth-ready.sh — Regression for e2e_auth_ready() in
# scripts/e2e/lib/auth-common.sh (the helper added by issue #78 for the
# runner's SKIP decision).
#
# Locks:
#   - sourceable; function declared
#   - clean env + clean $CREWRIG_E2E_HOME → returns 78 per CLI
#   - per-CLI env vars flip the result to 0
#   - copilot precedence: COPILOT_GITHUB_TOKEN wins over GH_TOKEN
#   - on-disk marker test (claude .credentials.json)
#   - unknown CLI → non-zero
#
# No docker.

set -uo pipefail

PASS=0
FAIL=0
SKIP=0

note_pass() { echo "# PASS $1"; PASS=$((PASS + 1)); }
note_fail() { echo "# FAIL $1 — $2"; FAIL=$((FAIL + 1)); }

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LIB="${REPO_DIR}/scripts/e2e/lib/auth-common.sh"

TMP_HOME="$(mktemp -d -t crewrig-auth-ready.XXXXXX)"
trap 'rm -rf "$TMP_HOME"' EXIT

# Run the helper in a clean subshell with the env vars we choose.
# Stdout: empty. Stderr: the helper's info line. Exit code: the contract.
run_auth_ready() {
  # $1 = cli name, $@[2:] = env assignments like NAME=VAL
  local cli="$1"; shift
  env -i \
    HOME="$TMP_HOME" \
    CREWRIG_E2E_HOME="$TMP_HOME" \
    PATH="$PATH" \
    "$@" \
    bash -c "set -uo pipefail; source '$LIB'; e2e_auth_ready '$cli'" 2>/dev/null
}

# Variant that captures stderr for assertions about the info line.
run_auth_ready_stderr() {
  local cli="$1"; shift
  env -i \
    HOME="$TMP_HOME" \
    CREWRIG_E2E_HOME="$TMP_HOME" \
    PATH="$PATH" \
    "$@" \
    bash -c "set -uo pipefail; source '$LIB'; e2e_auth_ready '$cli'" 2>&1 >/dev/null
}

# --- Case 1: sourceable + function exists ---------------------------------
if bash -c "set -uo pipefail; source '$LIB'; declare -F e2e_auth_ready >/dev/null"; then
  note_pass "auth-common.sh sourceable; e2e_auth_ready declared"
else
  note_fail "sourceable + declared" "source or declare -F failed"
fi

# --- Case 2: clean env → 78 for each CLI ----------------------------------
for cli in claude gemini copilot; do
  run_auth_ready "$cli"
  rc=$?
  if [[ $rc -eq 78 ]]; then
    note_pass "clean env / clean HOME → $cli returns 78"
  else
    note_fail "clean env → $cli=78" "got rc=$rc"
  fi
  err="$(run_auth_ready_stderr "$cli")"
  if [[ -n "$err" ]]; then
    note_pass "$cli stderr explains the gap (non-empty info line)"
  else
    note_fail "$cli stderr explanation" "stderr was empty"
  fi
done

# --- Case 3: ANTHROPIC_API_KEY=test → claude returns 0 -------------------
run_auth_ready claude ANTHROPIC_API_KEY=test
rc=$?
[[ $rc -eq 0 ]] && note_pass "ANTHROPIC_API_KEY set → claude returns 0" \
                || note_fail "ANTHROPIC_API_KEY → claude=0" "got rc=$rc"

# --- Case 4: GEMINI_API_KEY=test → gemini returns 0 ----------------------
run_auth_ready gemini GEMINI_API_KEY=test
rc=$?
[[ $rc -eq 0 ]] && note_pass "GEMINI_API_KEY set → gemini returns 0" \
                || note_fail "GEMINI_API_KEY → gemini=0" "got rc=$rc"

# --- Case 5: COPILOT_GITHUB_TOKEN wins over GH_TOKEN ---------------------
run_auth_ready copilot COPILOT_GITHUB_TOKEN=primary GH_TOKEN=fallback
rc=$?
[[ $rc -eq 0 ]] && note_pass "COPILOT_GITHUB_TOKEN → copilot returns 0" \
                || note_fail "COPILOT_GITHUB_TOKEN → copilot=0" "got rc=$rc"

# Precedence: stderr message should mention COPILOT_GITHUB_TOKEN, not GH_TOKEN.
err5="$(run_auth_ready_stderr copilot COPILOT_GITHUB_TOKEN=primary GH_TOKEN=fallback)"
if grep -q "COPILOT_GITHUB_TOKEN" <<< "$err5" && ! grep -q "GH_TOKEN" <<< "$err5"; then
  note_pass "precedence — message names COPILOT_GITHUB_TOKEN only"
else
  note_fail "precedence message" "stderr: $err5"
fi

# --- Case 6: GH_TOKEN alone → copilot returns 0 --------------------------
run_auth_ready copilot GH_TOKEN=fallback
rc=$?
[[ $rc -eq 0 ]] && note_pass "GH_TOKEN alone → copilot returns 0 (fallback)" \
                || note_fail "GH_TOKEN fallback → copilot=0" "got rc=$rc"

# --- Case 7: on-disk marker — claude .credentials.json -------------------
mkdir -p "$TMP_HOME/.crewrig-e2e/claude"
echo '{"placeholder":"x"}' > "$TMP_HOME/.crewrig-e2e/claude/.credentials.json"
run_auth_ready claude
rc=$?
if [[ $rc -eq 0 ]]; then
  note_pass "on-disk .credentials.json → claude returns 0"
else
  note_fail "on-disk marker → claude=0" "got rc=$rc"
fi
rm -rf "$TMP_HOME/.crewrig-e2e/claude"

# --- Case 8: unknown CLI → non-zero with clear error ---------------------
# e2e_auth_ready calls e2e_die for unknown CLI → exit 1.
err8="$(run_auth_ready_stderr nonesuch)"
rc=$?
if [[ $rc -ne 0 ]]; then
  if grep -qiE "unknown|claude\|gemini\|copilot" <<< "$err8"; then
    note_pass "unknown CLI → non-zero with clear error"
  else
    note_fail "unknown CLI message" "stderr: $err8"
  fi
else
  note_fail "unknown CLI non-zero" "got rc=0"
fi

echo "# $PASS passed / $FAIL failed / $SKIP skipped"
if [[ $FAIL -gt 0 ]]; then exit 1; fi
exit 0
