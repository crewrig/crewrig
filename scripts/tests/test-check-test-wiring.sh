#!/bin/bash
# test-check-test-wiring.sh — Regression tests for check-test-wiring.sh (spec 0076).
#
# check-test-wiring.sh is the CI guard that fails when a scripts/tests/test-*.sh
# script is neither executed by any CI workflow nor listed in the exemption
# allowlist with a reason. This is the parity sibling mandated by the repo
# convention "every check-*.sh has a test-*.sh" (spec 0076 R6).
#
# Cases:
#   a. Wired test (invoked in a workflow) → exit 0, OK line on stdout.
#   b. Exempted-with-reason test → exit 0 (not forced into a job, R8 / R3).
#   c. Unwired + unexempted test → exit 1, stderr names the script (R1/R2).
#   d. Exemption entry with no reason → exit 1 (R3).
#   e. Stale exemption (allowlisted file absent) → exit 1 (R5).
#   f. A '#'-commented invocation does NOT count as wired → the test is flagged
#      (the false-negative the guard must not miss — cold-review requirement).
#
# Usage:
#   bash scripts/tests/test-check-test-wiring.sh

# -e intentionally omitted: pass/fail counters drive the harness; adding -e
# would abort on the expected non-zero exits from the script under test.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT_UNDER_TEST="$SCRIPT_DIR/check-test-wiring.sh"

if [ ! -f "$SCRIPT_UNDER_TEST" ]; then
  echo "FATAL: cannot find $SCRIPT_UNDER_TEST" >&2
  exit 2
fi

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

pass=0
fail=0

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# mk_fixture <dir> — scaffold an empty fixture repo (tests + workflows + ci).
mk_fixture() {
  local dir="$1"
  mkdir -p "$dir/scripts/tests" "$dir/.github/workflows" "$dir/ci"
}

# add_test <dir> <name> — create an executable stub test under scripts/tests/.
add_test() {
  printf '#!/bin/bash\nexit 0\n' > "$1/scripts/tests/$2"
  chmod +x "$1/scripts/tests/$2"
}

# write_workflow <dir> <content> — write the fixture's build workflow verbatim.
write_workflow() {
  printf '%s' "$2" > "$1/.github/workflows/build.yml"
}

# write_exemptions <dir> <content> — write the fixture's exemption allowlist.
write_exemptions() {
  printf '%s' "$2" > "$1/ci/test-wiring-exemptions.txt"
}

# run_check <dir> — run the guard with CREWRIG_REPO_DIR set, capturing stdout,
# stderr, and exit code into CHECK_EXIT / CHECK_STDOUT / CHECK_STDERR.
run_check() {
  local repo="$1" out_file err_file
  out_file="$(mktemp "$TMP_ROOT/out.XXXXXX")"
  err_file="$(mktemp "$TMP_ROOT/err.XXXXXX")"
  CHECK_EXIT=0
  ( CREWRIG_REPO_DIR="$repo" bash "$SCRIPT_UNDER_TEST" >"$out_file" 2>"$err_file" ) || CHECK_EXIT=$?
  CHECK_STDOUT="$(cat "$out_file")"
  CHECK_STDERR="$(cat "$err_file")"
  rm -f "$out_file" "$err_file"
}

# A minimal workflow that wires a given test via a plain `run:` step.
wired_workflow() {
  printf 'jobs:\n  check-components:\n    steps:\n      - run: bash scripts/tests/%s\n' "$1"
}

# ---------------------------------------------------------------------------
# Case a — Wired test passes.
# ---------------------------------------------------------------------------
{
  repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  mk_fixture "$repo"
  add_test "$repo" "test-alpha.sh"
  write_workflow "$repo" "$(wired_workflow test-alpha.sh)"

  run_check "$repo"

  if [ "$CHECK_EXIT" -eq 0 ]; then
    echo "PASS  case-a: a wired test passes the check (exit 0)"
    pass=$((pass + 1))
  else
    echo "FAIL  case-a: expected exit 0, got $CHECK_EXIT"
    echo "      stderr: $CHECK_STDERR"
    fail=$((fail + 1))
  fi

  if echo "$CHECK_STDOUT" | grep -qF "the exemption allowlist is honest"; then
    echo "PASS  case-a: OK line emitted on stdout"
    pass=$((pass + 1))
  else
    echo "FAIL  case-a: missing OK line (stdout: $CHECK_STDOUT)"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case b — Exempted-with-reason test passes (R3 satisfied, R8 honored).
# ---------------------------------------------------------------------------
{
  repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  mk_fixture "$repo"
  add_test "$repo" "test-beta.sh"          # unwired, but exempted
  write_workflow "$repo" "jobs: {}"$'\n'
  write_exemptions "$repo" $'test-beta.sh\tneeds a live server the hermetic job lacks\n'

  run_check "$repo"

  if [ "$CHECK_EXIT" -eq 0 ]; then
    echo "PASS  case-b: an exempted-with-reason test passes the check (exit 0)"
    pass=$((pass + 1))
  else
    echo "FAIL  case-b: expected exit 0, got $CHECK_EXIT"
    echo "      stderr: $CHECK_STDERR"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case c — Unwired + unexempted test fails and is named (R1/R2).
# ---------------------------------------------------------------------------
{
  repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  mk_fixture "$repo"
  add_test "$repo" "test-gamma.sh"         # unwired, unexempted
  write_workflow "$repo" "jobs: {}"$'\n'

  run_check "$repo"

  if [ "$CHECK_EXIT" -eq 1 ]; then
    echo "PASS  case-c: an unwired, unexempted test fails the check (exit 1)"
    pass=$((pass + 1))
  else
    echo "FAIL  case-c: expected exit 1, got $CHECK_EXIT"
    fail=$((fail + 1))
  fi

  if echo "$CHECK_STDERR" | grep -qF "scripts/tests/test-gamma.sh"; then
    echo "PASS  case-c: stderr names the offending test (R2)"
    pass=$((pass + 1))
  else
    echo "FAIL  case-c: stderr did not name test-gamma.sh (stderr: $CHECK_STDERR)"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case d — Exemption entry with no reason fails (R3).
# ---------------------------------------------------------------------------
{
  repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  mk_fixture "$repo"
  add_test "$repo" "test-delta.sh"         # present (not stale), reasonless-exempt
  write_workflow "$repo" "jobs: {}"$'\n'
  write_exemptions "$repo" $'test-delta.sh\n'   # name only — no reason

  run_check "$repo"

  if [ "$CHECK_EXIT" -eq 1 ]; then
    echo "PASS  case-d: a reasonless exemption fails the check (exit 1)"
    pass=$((pass + 1))
  else
    echo "FAIL  case-d: expected exit 1, got $CHECK_EXIT"
    fail=$((fail + 1))
  fi

  if echo "$CHECK_STDERR" | grep -qiF "no reason"; then
    echo "PASS  case-d: stderr explains the reasonless exemption (R3)"
    pass=$((pass + 1))
  else
    echo "FAIL  case-d: stderr did not flag the missing reason (stderr: $CHECK_STDERR)"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case e — Stale exemption (allowlisted file absent) fails (R5).
# ---------------------------------------------------------------------------
{
  repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  mk_fixture "$repo"
  add_test "$repo" "test-real.sh"          # wired, so no orphan noise
  write_workflow "$repo" "$(wired_workflow test-real.sh)"
  # Exemption names a file that does not exist under scripts/tests/.
  write_exemptions "$repo" $'test-gone.sh\tformerly needed docker\n'

  run_check "$repo"

  if [ "$CHECK_EXIT" -eq 1 ]; then
    echo "PASS  case-e: a stale exemption fails the check (exit 1)"
    pass=$((pass + 1))
  else
    echo "FAIL  case-e: expected exit 1, got $CHECK_EXIT"
    fail=$((fail + 1))
  fi

  if echo "$CHECK_STDERR" | grep -qF "test-gone.sh"; then
    echo "PASS  case-e: stderr names the stale exemption (R5)"
    pass=$((pass + 1))
  else
    echo "FAIL  case-e: stderr did not name test-gone.sh (stderr: $CHECK_STDERR)"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case f — A '#'-commented invocation does NOT count as wired.
#          The token appears only inside a comment line of a multi-line
#          `run: |` block, so the test must still be flagged as unwired.
# ---------------------------------------------------------------------------
{
  repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  mk_fixture "$repo"
  add_test "$repo" "test-commented.sh"     # only mentioned in a comment
  write_workflow "$repo" $'jobs:\n  check-components:\n    steps:\n      - run: |\n          echo hi\n          # bash scripts/tests/test-commented.sh\n'

  run_check "$repo"

  if [ "$CHECK_EXIT" -eq 1 ]; then
    echo "PASS  case-f: a commented-out invocation does not count as wired (exit 1)"
    pass=$((pass + 1))
  else
    echo "FAIL  case-f: expected exit 1, got $CHECK_EXIT"
    echo "      stderr: $CHECK_STDERR"
    fail=$((fail + 1))
  fi

  if echo "$CHECK_STDERR" | grep -qF "scripts/tests/test-commented.sh"; then
    echo "PASS  case-f: stderr names the (only-commented) test as unwired"
    pass=$((pass + 1))
  else
    echo "FAIL  case-f: stderr did not name test-commented.sh (stderr: $CHECK_STDERR)"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
total=$((pass + fail))
echo ""
echo "Results: $pass/$total passed"
[ "$fail" -eq 0 ] && exit 0 || exit 1
