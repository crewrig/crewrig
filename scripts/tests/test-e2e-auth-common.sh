#!/bin/bash
# test-e2e-auth-common.sh — Regression test for scripts/e2e/lib/auth-common.sh.
#
# Locks the helper-library contract declared in docs/adr/0002-e2e-auth-flow.md
# and consumed by scripts/e2e/auth-{claude,gemini,copilot}.sh:
#
#   - file is sourceable in isolation under `set -euo pipefail`
#   - all advertised helpers are exported as bash functions
#   - e2e_skip exits with status 78 (skip convention)
#   - e2e_e2e_home honors $CREWRIG_E2E_HOME
#   - e2e_cli_dir composes <e2e_home>/<cli>
#
# No Docker required.

set -uo pipefail

PASS=0
FAIL=0
SKIP=0

note_pass() { echo "PASS  $1"; PASS=$((PASS + 1)); }
note_fail() { echo "FAIL  $1 — $2"; FAIL=$((FAIL + 1)); }
note_skip() { echo "SKIP  $1 — $2"; SKIP=$((SKIP + 1)); }

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LIB="${REPO_DIR}/scripts/e2e/lib/auth-common.sh"

# --- 1. File exists -----------------------------------------------------------
if [[ -f "$LIB" ]]; then
  note_pass "auth-common.sh — file exists"
else
  note_fail "auth-common.sh — file exists" "missing at $LIB"
  echo ""
  echo "Results: $PASS passed, $FAIL failed, $SKIP skipped"
  exit 1
fi

# --- 2. Sourceable in isolation ----------------------------------------------
if bash -c "set -euo pipefail; source '$LIB'" 2>/tmp/auth-common-source.err; then
  note_pass "auth-common.sh — sourceable under set -euo pipefail"
else
  note_fail "auth-common.sh — sourceable" "$(tr '\n' ' ' </tmp/auth-common-source.err)"
fi
rm -f /tmp/auth-common-source.err

# --- 3. Declared helpers exist as functions ----------------------------------
HELPERS=(e2e_die e2e_skip e2e_info e2e_require_docker e2e_require_image \
         e2e_e2e_home e2e_cli_dir e2e_chown_bootstrap)
for fn in "${HELPERS[@]}"; do
  if bash -c "set -euo pipefail; source '$LIB'; declare -F '$fn' >/dev/null"; then
    note_pass "helper '$fn' — declared as function"
  else
    note_fail "helper '$fn' — declared as function" "declare -F returned non-zero"
  fi
done

# --- 4. e2e_skip exits with status 78 ----------------------------------------
set +e
bash -c "set -uo pipefail; source '$LIB'; e2e_skip 'unit test'" >/dev/null 2>&1
rc=$?
set -e
if [[ "$rc" -eq 78 ]]; then
  note_pass "e2e_skip — exits with status 78"
else
  note_fail "e2e_skip — exits with status 78" "got exit code $rc"
fi

# --- 5. e2e_e2e_home honors $CREWRIG_E2E_HOME --------------------------------
override="$(mktemp -d)"
expected="${override}/.crewrig-e2e"
got="$(CREWRIG_E2E_HOME="$override" bash -c "source '$LIB'; e2e_e2e_home")"
if [[ "$got" == "$expected" ]]; then
  note_pass "e2e_e2e_home — honors \$CREWRIG_E2E_HOME (expected $expected)"
else
  note_fail "e2e_e2e_home — honors \$CREWRIG_E2E_HOME" "expected '$expected', got '$got'"
fi
# Also confirm default falls back to $HOME when override is unset.
got_default="$(env -u CREWRIG_E2E_HOME HOME=/tmp/fake-home bash -c "source '$LIB'; e2e_e2e_home")"
if [[ "$got_default" == "/tmp/fake-home/.crewrig-e2e" ]]; then
  note_pass "e2e_e2e_home — defaults to \$HOME/.crewrig-e2e"
else
  note_fail "e2e_e2e_home — defaults" "got '$got_default'"
fi
rmdir "$override" 2>/dev/null || true

# --- 6. e2e_cli_dir composes <e2e_home>/<cli> --------------------------------
for cli in claude gemini copilot; do
  got="$(CREWRIG_E2E_HOME=/tmp/cr-test bash -c "source '$LIB'; e2e_cli_dir '$cli'")"
  expected="/tmp/cr-test/.crewrig-e2e/$cli"
  if [[ "$got" == "$expected" ]]; then
    note_pass "e2e_cli_dir('$cli') — composes correctly"
  else
    note_fail "e2e_cli_dir('$cli')" "expected '$expected', got '$got'"
  fi
done

echo ""
echo "Results: $PASS passed, $FAIL failed, $SKIP skipped"
[[ "$FAIL" -eq 0 ]]
