#!/bin/bash
# test-check-test-strays.sh — Regression tests for scripts/check-test-strays.sh
# (issue #738, spec 0170)

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT_UNDER_TEST="$SCRIPT_DIR/check-test-strays.sh"

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

mk_fixture() {
  local dir="$1"
  mkdir -p "$dir/scripts/tests"
}

run_check() {
  local repo="$1" out_file err_file
  shift
  out_file="$(mktemp "$TMP_ROOT/out.XXXXXX")"
  err_file="$(mktemp "$TMP_ROOT/err.XXXXXX")"
  CHECK_EXIT=0
  ( CREWRIG_REPO_DIR="$repo" bash "$SCRIPT_UNDER_TEST" "$@" >"$out_file" 2>"$err_file" ) || CHECK_EXIT=$?
  CHECK_STDOUT="$(cat "$out_file")"
  CHECK_STDERR="$(cat "$err_file")"
  rm -f "$out_file" "$err_file"
}

# ---------------------------------------------------------------------------
# Case a — Clean suite passes.
# ---------------------------------------------------------------------------
{
  repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  mk_fixture "$repo"
  cat > "$repo/scripts/tests/test-clean.sh" << 'EOF'
#!/bin/bash
echo "Everything is fine"
EOF
  chmod +x "$repo/scripts/tests/test-clean.sh"

  run_check "$repo"

  if [ "$CHECK_EXIT" -eq 0 ]; then
    echo "PASS  case-a: a clean suite passes the check (exit 0)"
    pass=$((pass + 1))
  else
    echo "FAIL  case-a: expected exit 0, got $CHECK_EXIT"
    echo "      stderr: $CHECK_STDERR"
    fail=$((fail + 1))
  fi

  if echo "$CHECK_STDOUT" | grep -qF "zero runtime strays across all test suites"; then
    echo "PASS  case-a: OK line emitted on stdout"
    pass=$((pass + 1))
  else
    echo "FAIL  case-a: missing OK line (stdout: $CHECK_STDOUT)"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case b — Stray command fails.
# ---------------------------------------------------------------------------
{
  repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  mk_fixture "$repo"
  cat > "$repo/scripts/tests/test-stray.sh" << 'EOF'
#!/bin/bash
some-bogus-command
EOF
  chmod +x "$repo/scripts/tests/test-stray.sh"

  run_check "$repo"

  if [ "$CHECK_EXIT" -eq 1 ]; then
    echo "PASS  case-b: a stray command fails the check (exit 1)"
    pass=$((pass + 1))
  else
    echo "FAIL  case-b: expected exit 1, got $CHECK_EXIT"
    fail=$((fail + 1))
  fi

  if echo "$CHECK_STDERR" | grep -q "test-stray.sh has 1 stray.*errors"; then
    echo "PASS  case-b: stderr names the suite and count"
    pass=$((pass + 1))
  else
    echo "FAIL  case-b: stderr did not name test-stray.sh and count correctly (stderr: $CHECK_STDERR)"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case c — No-change short-circuit: empty merge-base diff skips the scan.
# ---------------------------------------------------------------------------
{
  repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  mk_fixture "$repo"
  cat > "$repo/scripts/tests/test-clean.sh" << 'EOF'
#!/bin/bash
echo "Everything is fine"
EOF
  chmod +x "$repo/scripts/tests/test-clean.sh"
  git -C "$repo" init -q
  git -C "$repo" config user.email test@example.com
  git -C "$repo" config user.name test
  git -C "$repo" config commit.gpgsign false
  git -C "$repo" add -A
  git -C "$repo" commit -qm init
  git -C "$repo" branch -M main

  # A second commit touching only an unrelated path → empty test diff.
  echo "unrelated" > "$repo/README.md"
  git -C "$repo" add README.md
  git -C "$repo" commit -qm unrelated

  run_check "$repo" --base-ref main

  if [ "$CHECK_EXIT" -eq 0 ]; then
    echo "PASS  case-c: no-change short-circuit exits 0"
    pass=$((pass + 1))
  else
    echo "FAIL  case-c: expected exit 0, got $CHECK_EXIT"
    fail=$((fail + 1))
  fi
  if echo "$CHECK_STDOUT" | grep -qF "zero runtime strays across all test suites"; then
    echo "PASS  case-c: OK line emitted on short-circuit"
    pass=$((pass + 1))
  else
    echo "FAIL  case-c: missing OK line (stdout: $CHECK_STDOUT)"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case d — Cache hit skips re-execution on warm cache.
# ---------------------------------------------------------------------------
{
  repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  mk_fixture "$repo"
  cat > "$repo/scripts/tests/test-clean.sh" << 'EOF'
#!/bin/bash
echo "Everything is fine"
EOF
  chmod +x "$repo/scripts/tests/test-clean.sh"
  cache_dir="$(mktemp -d "$TMP_ROOT/cache-d.XXXXXX")"

  # First run: cold cache, suite executes and writes verdict marker.
  run_check "$repo" --cache-dir "$cache_dir"
  if [ "$CHECK_EXIT" -eq 0 ]; then
    echo "PASS  case-d: cold run exits 0"
    pass=$((pass + 1))
  else
    echo "FAIL  case-d: cold run expected exit 0, got $CHECK_EXIT"
    fail=$((fail + 1))
  fi
  n_markers=$(find "$cache_dir" -name '*.marker' | wc -l | tr -d ' ')
  if [ "$n_markers" -ge 1 ]; then
    echo "PASS  case-d: cold run wrote verdict markers ($n_markers)"
    pass=$((pass + 1))
  else
    echo "FAIL  case-d: expected at least one marker, found $n_markers"
    fail=$((fail + 1))
  fi

  # Second run: warm cache, suite unchanged → cache hit, no re-execution.
  run_check "$repo" --cache-dir "$cache_dir"
  if echo "$CHECK_STDERR" | grep -q "cache hit, skipping test-clean.sh"; then
    echo "PASS  case-d: warm run reports cache hit"
    pass=$((pass + 1))
  else
    echo "FAIL  case-d: expected cache-hit notice (stderr: $CHECK_STDERR)"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case e — Fallback when the base ref is unresolvable: all non-cached suites run.
# ---------------------------------------------------------------------------
{
  repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  mk_fixture "$repo"
  cat > "$repo/scripts/tests/test-clean.sh" << 'EOF'
#!/bin/bash
echo "Everything is fine"
EOF
  chmod +x "$repo/scripts/tests/test-clean.sh"

  # No git repo at all → merge-base fails → fallback to non-cached scan.
  run_check "$repo" --base-ref main

  if [ "$CHECK_EXIT" -eq 0 ]; then
    echo "PASS  case-e: unresolvable base falls back and exits 0"
    pass=$((pass + 1))
  else
    echo "FAIL  case-e: expected exit 0, got $CHECK_EXIT"
    fail=$((fail + 1))
  fi
  if echo "$CHECK_STDOUT" | grep -qF "zero runtime strays across all test suites"; then
    echo "PASS  case-e: OK line emitted on fallback"
    pass=$((pass + 1))
  else
    echo "FAIL  case-e: missing OK line (stdout: $CHECK_STDOUT)"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case f — Parallel execution still detects a stray in a changed suite.
# ---------------------------------------------------------------------------
{
  repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  mk_fixture "$repo"
  cat > "$repo/scripts/tests/test-clean.sh" << 'EOF'
#!/bin/bash
echo "Everything is fine"
EOF
  cat > "$repo/scripts/tests/test-stray.sh" << 'EOF'
#!/bin/bash
some-bogus-command
EOF
  chmod +x "$repo/scripts/tests/test-clean.sh" "$repo/scripts/tests/test-stray.sh"

  run_check "$repo" --jobs 2

  if [ "$CHECK_EXIT" -eq 1 ]; then
    echo "PASS  case-f: parallel run fails on a stray (exit 1)"
    pass=$((pass + 1))
  else
    echo "FAIL  case-f: expected exit 1, got $CHECK_EXIT"
    fail=$((fail + 1))
  fi
  if echo "$CHECK_STDERR" | grep -q "test-stray.sh has 1 stray.*errors"; then
    echo "PASS  case-f: stderr names the stray suite and count"
    pass=$((pass + 1))
  else
    echo "FAIL  case-f: stderr did not name test-stray.sh (stderr: $CHECK_STDERR)"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case g — Static syntax error fails immediately (spec 0170 R1).
# ---------------------------------------------------------------------------
{
  repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  mk_fixture "$repo"
  cat > "$repo/scripts/tests/test-syntax-err.sh" << 'EOF'
#!/bin/bash
if [ -f "foo" ; then
  echo "broken"
EOF
  chmod +x "$repo/scripts/tests/test-syntax-err.sh"

  run_check "$repo"

  if [ "$CHECK_EXIT" -eq 1 ]; then
    echo "PASS  case-g: syntax error fails the check (exit 1)"
    pass=$((pass + 1))
  else
    echo "FAIL  case-g: expected exit 1 on syntax error, got $CHECK_EXIT"
    fail=$((fail + 1))
  fi
  if echo "$CHECK_STDERR" | grep -q "test-syntax-err.sh has syntax errors"; then
    echo "PASS  case-g: stderr reports syntax error"
    pass=$((pass + 1))
  else
    echo "FAIL  case-g: stderr did not report syntax error (stderr: $CHECK_STDERR)"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case h — Non-test script/helper changes do NOT re-execute unchanged test suites (spec 0170 R4, R5).
# ---------------------------------------------------------------------------
{
  repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  mk_fixture "$repo"
  mkdir -p "$repo/scripts/lib"
  cat > "$repo/scripts/tests/test-clean.sh" << 'EOF'
#!/bin/bash
echo "Everything is fine"
EOF
  chmod +x "$repo/scripts/tests/test-clean.sh"
  cat > "$repo/scripts/lib/helper.sh" << 'EOF'
#!/bin/bash
helper() { :; }
EOF
  git -C "$repo" init -q
  git -C "$repo" config user.email test@example.com
  git -C "$repo" config user.name test
  git -C "$repo" config commit.gpgsign false
  git -C "$repo" add -A
  git -C "$repo" commit -qm init
  git -C "$repo" branch -M main
  init_sha="$(git -C "$repo" rev-parse HEAD)"

  # Modify helper script only (no changes under scripts/tests/).
  cat > "$repo/scripts/lib/helper.sh" << 'EOF'
#!/bin/bash
helper() { echo "updated"; }
EOF
  git -C "$repo" add scripts/lib/helper.sh
  git -C "$repo" commit -qm change-helper

  run_check "$repo" --base-ref "$init_sha"

  if [ "$CHECK_EXIT" -eq 0 ]; then
    echo "PASS  case-h: non-test helper change does not execute test suites (exit 0)"
    pass=$((pass + 1))
  else
    echo "FAIL  case-h: expected exit 0, got $CHECK_EXIT"
    fail=$((fail + 1))
  fi
  if echo "$CHECK_STDOUT" | grep -qF "zero runtime strays across all test suites"; then
    echo "PASS  case-h: OK line emitted"
    pass=$((pass + 1))
  else
    echo "FAIL  case-h: missing OK line (stdout: $CHECK_STDOUT)"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case i — Changeset-scoped execution runs only the modified test suite.
# ---------------------------------------------------------------------------
{
  repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  mk_fixture "$repo"
  cat > "$repo/scripts/tests/test-clean.sh" << 'EOF'
#!/bin/bash
echo "Clean suite"
EOF
  cat > "$repo/scripts/tests/test-stray.sh" << 'EOF'
#!/bin/bash
echo "Old clean suite"
EOF
  chmod +x "$repo/scripts/tests/test-clean.sh" "$repo/scripts/tests/test-stray.sh"
  git -C "$repo" init -q
  git -C "$repo" config user.email test@example.com
  git -C "$repo" config user.name test
  git -C "$repo" config commit.gpgsign false
  git -C "$repo" add -A
  git -C "$repo" commit -qm init
  git -C "$repo" branch -M main
  init_sha="$(git -C "$repo" rev-parse HEAD)"

  # Introduce a stray into test-stray.sh ONLY
  cat > "$repo/scripts/tests/test-stray.sh" << 'EOF'
#!/bin/bash
some-bogus-command
EOF
  git -C "$repo" add scripts/tests/test-stray.sh
  git -C "$repo" commit -qm add-stray

  run_check "$repo" --base-ref "$init_sha"

  if [ "$CHECK_EXIT" -eq 1 ]; then
    echo "PASS  case-i: modified suite with stray fails the check (exit 1)"
    pass=$((pass + 1))
  else
    echo "FAIL  case-i: expected exit 1, got $CHECK_EXIT"
    fail=$((fail + 1))
  fi
  if echo "$CHECK_STDERR" | grep -q "test-stray.sh has 1 stray.*errors"; then
    echo "PASS  case-i: stderr names the modified stray suite"
    pass=$((pass + 1))
  else
    echo "FAIL  case-i: stderr did not name test-stray.sh (stderr: $CHECK_STDERR)"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case j — Automatic HEAD~1 resolution on push/local commit without --base-ref (spec 0171 R1, R2, R3).
# ---------------------------------------------------------------------------
{
  repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  mk_fixture "$repo"
  cat > "$repo/scripts/tests/test-clean.sh" << 'EOF'
#!/bin/bash
echo "Clean suite"
EOF
  chmod +x "$repo/scripts/tests/test-clean.sh"
  git -C "$repo" init -q
  git -C "$repo" config user.email test@example.com
  git -C "$repo" config user.name test
  git -C "$repo" config commit.gpgsign false
  git -C "$repo" add -A
  git -C "$repo" commit -qm init
  git -C "$repo" branch -M main

  # Modify an unrelated non-test file (simulate push to main).
  echo "update docs" > "$repo/README.md"
  git -C "$repo" add README.md
  git -C "$repo" commit -qm update-docs

  # Run check WITHOUT --base-ref and WITHOUT GITHUB_BASE_REF.
  run_check "$repo"

  if [ "$CHECK_EXIT" -eq 0 ]; then
    echo "PASS  case-j: automatic HEAD~1 resolution on push/commit exits 0"
    pass=$((pass + 1))
  else
    echo "FAIL  case-j: expected exit 0, got $CHECK_EXIT"
    fail=$((fail + 1))
  fi
  if echo "$CHECK_STDOUT" | grep -qF "zero runtime strays across all test suites"; then
    echo "PASS  case-j: OK line emitted on automatic HEAD~1 resolution"
    pass=$((pass + 1))
  else
    echo "FAIL  case-j: missing OK line (stdout: $CHECK_STDOUT)"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case k — Automatic HEAD~1 resolution catches stray in modified test suite without --base-ref (spec 0171).
# ---------------------------------------------------------------------------
{
  repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  mk_fixture "$repo"
  cat > "$repo/scripts/tests/test-clean.sh" << 'EOF'
#!/bin/bash
echo "Clean suite"
EOF
  chmod +x "$repo/scripts/tests/test-clean.sh"
  git -C "$repo" init -q
  git -C "$repo" config user.email test@example.com
  git -C "$repo" config user.name test
  git -C "$repo" config commit.gpgsign false
  git -C "$repo" add -A
  git -C "$repo" commit -qm init
  git -C "$repo" branch -M main

  # Modify test-clean.sh with a stray command.
  cat > "$repo/scripts/tests/test-clean.sh" << 'EOF'
#!/bin/bash
some-bogus-command
EOF
  git -C "$repo" add scripts/tests/test-clean.sh
  git -C "$repo" commit -qm add-stray-to-clean

  # Run check WITHOUT --base-ref.
  run_check "$repo"

  if [ "$CHECK_EXIT" -eq 1 ]; then
    echo "PASS  case-k: automatic HEAD~1 catches stray in modified suite (exit 1)"
    pass=$((pass + 1))
  else
    echo "FAIL  case-k: expected exit 1, got $CHECK_EXIT"
    fail=$((fail + 1))
  fi
  if echo "$CHECK_STDERR" | grep -q "test-clean.sh has 1 stray.*errors"; then
    echo "PASS  case-k: stderr names the modified suite"
    pass=$((pass + 1))
  else
    echo "FAIL  case-k: stderr did not name test-clean.sh (stderr: $CHECK_STDERR)"
    fail=$((fail + 1))
  fi
}

# Summary
# ---------------------------------------------------------------------------
total=$((pass + fail))
echo ""
echo "Results: $pass/$total passed"
[ "$fail" -eq 0 ] && exit 0 || exit 1
