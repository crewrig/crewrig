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

# Variant that captures the E2E_AUTH_READY_CREDENTIAL_PATH side effect
# (issue #1107 fix 2, spec 0194 R9 record accuracy) — the function call and
# the printf run in the SAME shell instance (not a subshell), so the
# global survives between them.
run_auth_ready_credpath() {
  local cli="$1"; shift
  env -i \
    HOME="$TMP_HOME" \
    CREWRIG_E2E_HOME="$TMP_HOME" \
    PATH="$PATH" \
    "$@" \
    bash -c "set -uo pipefail; source '$LIB'; e2e_auth_ready '$cli' >/dev/null 2>&1; printf '%s' \"\${E2E_AUTH_READY_CREDENTIAL_PATH:-}\""
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

# --- Case 9: workstation credential — copilot config.json alone (spec 0194 R1-R2) ---
mkdir -p "$TMP_HOME/.crewrig-e2e/copilot"
echo '{"placeholder":"x"}' > "$TMP_HOME/.crewrig-e2e/copilot/config.json"
run_auth_ready copilot
rc=$?
if [[ $rc -eq 0 ]]; then
  note_pass "workstation credential (config.json) alone → copilot returns 0"
else
  note_fail "workstation credential → copilot=0" "got rc=$rc"
fi

# --- Case 10: config.json + COPILOT_GITHUB_TOKEN — token wins precedence (D2) ---
err10="$(run_auth_ready_stderr copilot COPILOT_GITHUB_TOKEN=primary)"
rc=$?
if [[ $rc -eq 0 ]] && grep -q "COPILOT_GITHUB_TOKEN" <<< "$err10" && ! grep -q "config.json" <<< "$err10"; then
  note_pass "config.json + COPILOT_GITHUB_TOKEN → ready, message names the env var not the marker"
else
  note_fail "config.json + COPILOT_GITHUB_TOKEN precedence" "rc=$rc stderr: $err10"
fi

# --- Case 11: an EMPTY config.json is NOT a credential (-s, not -f) -------
: > "$TMP_HOME/.crewrig-e2e/copilot/config.json"
run_auth_ready copilot
rc=$?
if [[ $rc -eq 78 ]]; then
  note_pass "empty config.json → copilot returns 78 (not ready)"
else
  note_fail "empty config.json → copilot=78" "got rc=$rc"
fi
rm -rf "$TMP_HOME/.crewrig-e2e/copilot"

# --- Case 12: not-ready diagnostic names a command, not only a variable ---
err12="$(run_auth_ready_stderr copilot)"
if grep -qiE "copilot|task e2e:auth:copilot" <<< "$err12"; then
  note_pass "copilot not-ready diagnostic names a command"
else
  note_fail "copilot not-ready diagnostic names a command" "stderr: $err12"
fi

# --- Case 13: E2E_AUTH_READY_CREDENTIAL_PATH names the path actually
# selected (issue #1107 fix 2, spec 0194 R9 record accuracy) — the runner
# reads this side effect and exports it as E2E_CREDENTIAL_PATH so probe A's
# verdict stops hardcoding "COPILOT_GITHUB_TOKEN" regardless of which path
# actually authenticated the run.
got="$(run_auth_ready_credpath copilot COPILOT_GITHUB_TOKEN=x)"
[[ "$got" == "COPILOT_GITHUB_TOKEN" ]] \
  && note_pass "credential path — copilot/COPILOT_GITHUB_TOKEN labeled COPILOT_GITHUB_TOKEN" \
  || note_fail "credential path — copilot/COPILOT_GITHUB_TOKEN" "got: '$got'"

got="$(run_auth_ready_credpath copilot GH_TOKEN=x)"
[[ "$got" == "GH_TOKEN" ]] \
  && note_pass "credential path — copilot/GH_TOKEN labeled GH_TOKEN" \
  || note_fail "credential path — copilot/GH_TOKEN" "got: '$got'"

mkdir -p "$TMP_HOME/.crewrig-e2e/copilot"
echo '{"placeholder":"x"}' > "$TMP_HOME/.crewrig-e2e/copilot/config.json"
got="$(run_auth_ready_credpath copilot)"
[[ "$got" == "workstation-credential" ]] \
  && note_pass "credential path — copilot/config.json labeled workstation-credential" \
  || note_fail "credential path — copilot/config.json" "got: '$got'"
rm -rf "$TMP_HOME/.crewrig-e2e/copilot"

mkdir -p "$TMP_HOME/.crewrig-e2e/ollama"
echo 'fake-key' > "$TMP_HOME/.crewrig-e2e/ollama/id_ed25519"
got="$(run_auth_ready_credpath copilot)"
[[ "$got" == "ollama-cloud-keypair" ]] \
  && note_pass "credential path — copilot/ollama keypair labeled ollama-cloud-keypair" \
  || note_fail "credential path — copilot/ollama keypair" "got: '$got'"
rm -rf "$TMP_HOME/.crewrig-e2e/ollama"

got="$(run_auth_ready_credpath claude ANTHROPIC_API_KEY=x)"
[[ "$got" == "ANTHROPIC_API_KEY" ]] \
  && note_pass "credential path — claude/ANTHROPIC_API_KEY labeled ANTHROPIC_API_KEY" \
  || note_fail "credential path — claude/ANTHROPIC_API_KEY" "got: '$got'"

got="$(run_auth_ready_credpath gemini GEMINI_API_KEY=x)"
[[ "$got" == "GEMINI_API_KEY" ]] \
  && note_pass "credential path — gemini/GEMINI_API_KEY labeled GEMINI_API_KEY" \
  || note_fail "credential path — gemini/GEMINI_API_KEY" "got: '$got'"

# Not-ready path leaves the label empty (checked without polluting stderr
# expectations elsewhere).
got="$(run_auth_ready_credpath copilot)"
[[ "$got" == "" ]] \
  && note_pass "credential path — not-ready copilot leaves the label empty" \
  || note_fail "credential path — not-ready leaves it empty" "got: '$got'"

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
