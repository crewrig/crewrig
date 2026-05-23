#!/usr/bin/env bash
# test-e2e-scenarios-structure.sh — Structural test for the four pillar
# scenarios scaffolded by issue #80.
#
# Verifies that each scenario directory under tests/e2e/scenarios/ ships
# the contract surface required by the runner (ADR 0005 Decision 3):
#
#   - run.sh exists and is executable
#   - run.sh parses under `bash -n` (no shell-syntax rot)
#   - run.sh sources at least one helper from $E2E_LIB_DIR (proof that
#     it honours the runner-injected library directory)
#   - tests/e2e/scenarios/README.md exists and is non-empty
#   - tests/e2e/defaults.toml declares a [scenarios.<name>] table for
#     every directory present on disk
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
SCEN_DIR="${REPO_DIR}/tests/e2e/scenarios"
DEFAULTS_TOML="${REPO_DIR}/tests/e2e/defaults.toml"
README="${SCEN_DIR}/README.md"

SCENARIOS=(01-layered-context 02-cross-tool-memory 03-skill-build 04-harness-loop)

# --- 1. Each scenario dir + run.sh present and executable --------------------
for s in "${SCENARIOS[@]}"; do
  d="${SCEN_DIR}/${s}"
  r="${d}/run.sh"
  if [[ ! -d "$d" ]]; then
    note_fail "scenario '$s' — directory exists" "missing at $d"
    continue
  fi
  if [[ -x "$r" ]]; then
    note_pass "scenario '$s' — run.sh exists and is executable"
  else
    note_fail "scenario '$s' — run.sh executable" "not -x: $r"
  fi
done

# --- 2. Each run.sh passes `bash -n` syntax check ----------------------------
for s in "${SCENARIOS[@]}"; do
  r="${SCEN_DIR}/${s}/run.sh"
  [[ -f "$r" ]] || continue
  err="$(bash -n "$r" 2>&1)"
  if [[ -z "$err" ]]; then
    note_pass "scenario '$s' — bash -n syntax check"
  else
    note_fail "scenario '$s' — bash -n syntax check" "$(echo "$err" | tr '\n' '|')"
  fi
done

# --- 3. Each run.sh sources a helper from $E2E_LIB_DIR -----------------------
# Accept any of: assert.sh, structural.sh, llm_judge.sh (the v1 lib set).
for s in "${SCENARIOS[@]}"; do
  r="${SCEN_DIR}/${s}/run.sh"
  [[ -f "$r" ]] || continue
  if grep -Eq 'source[[:space:]]+"\$\{?E2E_LIB_DIR\}?/' "$r" \
     || grep -Eq '\.[[:space:]]+"\$\{?E2E_LIB_DIR\}?/' "$r"; then
    note_pass "scenario '$s' — sources \$E2E_LIB_DIR helper"
  else
    note_fail "scenario '$s' — sources \$E2E_LIB_DIR helper" \
              "no 'source \"\${E2E_LIB_DIR}/...\"' line found"
  fi
done

# --- 4. scenarios/README.md exists and is non-empty --------------------------
if [[ -s "$README" ]]; then
  note_pass "scenarios/README.md — present and non-empty"
else
  note_fail "scenarios/README.md — present and non-empty" "missing or empty: $README"
fi

# --- 5. defaults.toml declares [scenarios.<name>] for each scenario ---------
if [[ ! -f "$DEFAULTS_TOML" ]]; then
  note_fail "defaults.toml — present" "missing at $DEFAULTS_TOML"
else
  for s in "${SCENARIOS[@]}"; do
    if grep -Eq "^\[scenarios\.${s}\]" "$DEFAULTS_TOML"; then
      note_pass "defaults.toml — [scenarios.${s}] table present"
    else
      note_fail "defaults.toml — [scenarios.${s}] table present" \
                "no '[scenarios.${s}]' header found"
    fi
  done
fi

echo ""
echo "# $PASS passed / $FAIL failed / $SKIP skipped"
[[ "$FAIL" -eq 0 ]]
