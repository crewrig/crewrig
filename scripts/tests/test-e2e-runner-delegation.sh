#!/usr/bin/env bash
# test-e2e-runner-delegation.sh — Regression for the runner→scenario
# delegation contract introduced in ADR 0005 Decision 3.
#
# Verifies that tests/e2e/run.sh:
#   - injects E2E_LIB_DIR and E2E_REPORT_DIR into the scenario script env
#   - resolves the scenario script as tests/e2e/scenarios/<name>/run.sh
#     and gates delegation on `[[ -x ... ]]`
#   - exits 0 in --dry-run with no Docker calls and no auth required
#   - exits 0 in --dry-run --scenario <known-scenario>
#   - exits 0 on --help
#
# Host-side, no Docker, no auth. Safe to run in CI.

set -uo pipefail

PASS=0
FAIL=0
SKIP=0

note_pass() { echo "# PASS $1"; PASS=$((PASS + 1)); }
note_fail() { echo "# FAIL $1 — $2"; FAIL=$((FAIL + 1)); }
note_skip() { echo "# SKIP $1: $2"; SKIP=$((SKIP + 1)); }

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUN_SH="${REPO_DIR}/tests/e2e/run.sh"
REPORTS="${REPO_DIR}/tests/e2e/reports"

# Track every dir created by this test so we leave no debris behind.
mapfile -t pre_dirs < <(find "$REPORTS" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort)
CREATED=()
cleanup() {
  for d in "${CREATED[@]}"; do
    [[ -n "$d" && -d "$d" ]] && rm -rf -- "$d"
  done
}
trap cleanup EXIT

collect_new_dirs() {
  mapfile -t now_dirs < <(find "$REPORTS" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort)
  for d in "${now_dirs[@]}"; do
    known=0
    for p in "${pre_dirs[@]}"  "${CREATED[@]}"; do
      [[ "$d" == "$p" ]] && { known=1; break; }
    done
    [[ $known -eq 0 ]] && CREATED+=("$d")
  done
}

# --- 0. Runner present -------------------------------------------------------
if [[ ! -f "$RUN_SH" ]]; then
  note_fail "run.sh exists" "missing at $RUN_SH"
  echo "# $PASS passed / $FAIL failed / $SKIP skipped"
  exit 1
fi
note_pass "run.sh exists"

# --- 1. Runner sets E2E_LIB_DIR and E2E_REPORT_DIR in scenario env ----------
# The runner currently injects these via `env VAR=... scenario_script`
# rather than `export`. Either form satisfies the contract — we grep for
# `E2E_LIB_DIR=` / `E2E_REPORT_DIR=` to cover both styles.
if grep -Eq '(^|[[:space:]])E2E_LIB_DIR=' "$RUN_SH"; then
  note_pass "run.sh — sets E2E_LIB_DIR for scenario script"
else
  note_fail "run.sh — sets E2E_LIB_DIR" "no 'E2E_LIB_DIR=' assignment found"
fi
if grep -Eq '(^|[[:space:]])E2E_REPORT_DIR=' "$RUN_SH"; then
  note_pass "run.sh — sets E2E_REPORT_DIR for scenario script"
else
  note_fail "run.sh — sets E2E_REPORT_DIR" "no 'E2E_REPORT_DIR=' assignment found"
fi

# --- 2. Runner delegates to scenarios/<name>/run.sh -------------------------
# The delegation guard reads: `scenario_script="${SCRIPT_DIR}/scenarios/${scenario}/run.sh"` ... `if [[ -x "$scenario_script" ]]`.
if grep -Eq 'scenarios/\$\{?scenario\}?/run\.sh' "$RUN_SH" \
   && grep -Eq '\[\[[[:space:]]+-x[[:space:]]+"\$scenario_script"' "$RUN_SH"; then
  note_pass "run.sh — delegates to scenarios/<name>/run.sh guarded by [[ -x ]]"
else
  note_fail "run.sh — delegation pattern" \
            "expected 'scenarios/\${scenario}/run.sh' + '[[ -x \"\$scenario_script\" ]]'"
fi

# --- 3. --dry-run exits 0 with no auth and no Docker -----------------------
# Force a tmp dir for any auth-home lookup so the runner cannot accidentally
# leak into the real ~/.crewrig-e2e. Unset auth env vars to make sure no
# CLI is treated as "ready" (would still be harmless — dry-run short-
# circuits the docker spawn — but this keeps the assertion sharp).
out3="$(env -u ANTHROPIC_API_KEY -u GEMINI_API_KEY -u COPILOT_GITHUB_TOKEN \
         CREWRIG_E2E_HOME=/tmp/crewrig-test-noop \
         bash "$RUN_SH" --dry-run 2>&1)"
rc3=$?
collect_new_dirs
if [[ $rc3 -eq 0 ]]; then
  note_pass "--dry-run exits 0 with no auth / no docker"
else
  note_fail "--dry-run exits 0" "rc=$rc3 out=$(echo "$out3" | tr '\n' '|' | head -c 240)"
fi

# Sanity: in dry-run mode, the runner must NOT have invoked docker.
# (We can't directly assert "no docker call"; we approximate by checking
# the output never reports a docker exec line.)
if grep -qE '^\+? *docker run ' <<< "$out3"; then
  note_fail "--dry-run does not spawn docker" "found 'docker run' in output"
else
  note_pass "--dry-run does not spawn docker (no 'docker run' in output)"
fi

# --- 4. --help exits 0 ------------------------------------------------------
if bash "$RUN_SH" --help >/dev/null 2>&1; then
  note_pass "--help exits 0"
else
  note_fail "--help exits 0" "non-zero exit"
fi

# --- 5. --dry-run --scenario <known> exits 0 -------------------------------
out5="$(env -u ANTHROPIC_API_KEY -u GEMINI_API_KEY -u COPILOT_GITHUB_TOKEN \
         CREWRIG_E2E_HOME=/tmp/crewrig-test-noop \
         bash "$RUN_SH" --dry-run --scenario 01-layered-context 2>&1)"
rc5=$?
collect_new_dirs
if [[ $rc5 -eq 0 ]]; then
  note_pass "--dry-run --scenario 01-layered-context exits 0"
else
  note_fail "--dry-run --scenario 01-layered-context exits 0" \
            "rc=$rc5 out=$(echo "$out5" | tr '\n' '|' | head -c 240)"
fi

echo ""
echo "# $PASS passed / $FAIL failed / $SKIP skipped"
[[ "$FAIL" -eq 0 ]]
