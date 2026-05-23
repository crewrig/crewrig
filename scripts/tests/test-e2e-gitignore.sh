#!/usr/bin/env bash
# test-e2e-gitignore.sh — Verifies that the .gitignore entries added by
# issue #78 actually exclude local.toml and reports/* while preserving
# .gitkeep, and that local.toml.example is committed.

set -uo pipefail

PASS=0
FAIL=0
SKIP=0

note_pass() { echo "# PASS $1"; PASS=$((PASS + 1)); }
note_fail() { echo "# FAIL $1 — $2"; FAIL=$((FAIL + 1)); }

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_DIR" || { note_fail "cd REPO_DIR" "$REPO_DIR"; echo "# 0 passed / 1 failed / 0 skipped"; exit 1; }

# --- Case 1: local.toml is ignored ---------------------------------------
if git check-ignore -q tests/e2e/local.toml; then
  note_pass "tests/e2e/local.toml is gitignored"
else
  note_fail "local.toml ignored" "check-ignore returned non-zero"
fi

# --- Case 2: a path under reports/ is ignored ----------------------------
if git check-ignore -q tests/e2e/reports/some-run-dir; then
  note_pass "tests/e2e/reports/<dir> is gitignored"
else
  note_fail "reports/<dir> ignored" "check-ignore returned non-zero"
fi

# --- Case 3: .gitkeep is NOT ignored (negation works) --------------------
if git check-ignore -q tests/e2e/reports/.gitkeep; then
  note_fail "reports/.gitkeep negation" ".gitkeep is incorrectly ignored"
else
  note_pass "tests/e2e/reports/.gitkeep is NOT ignored (negation works)"
fi

# --- Case 4: .gitkeep is tracked ----------------------------------------
if git ls-files --error-unmatch tests/e2e/reports/.gitkeep >/dev/null 2>&1; then
  note_pass "tests/e2e/reports/.gitkeep is tracked"
else
  note_fail "reports/.gitkeep tracked" "ls-files --error-unmatch failed"
fi

# --- Case 5: local.toml.example is tracked (not ignored) -----------------
if git ls-files --error-unmatch tests/e2e/local.toml.example >/dev/null 2>&1; then
  note_pass "tests/e2e/local.toml.example is tracked"
else
  note_fail "local.toml.example tracked" "ls-files --error-unmatch failed"
fi
if git check-ignore -q tests/e2e/local.toml.example; then
  note_fail "local.toml.example NOT ignored" "check-ignore matched (it should not)"
else
  note_pass "tests/e2e/local.toml.example is NOT ignored"
fi

echo "# $PASS passed / $FAIL failed / $SKIP skipped"
if [[ $FAIL -gt 0 ]]; then exit 1; fi
exit 0
