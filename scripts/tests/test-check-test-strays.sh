#!/bin/bash
# test-check-test-strays.sh — Regression tests for scripts/check-test-strays.sh
# (issue #738)

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

  # A second commit touching only an unrelated path → empty test/lib diff.
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
# Case d — Cache hit skips re-execution; lib change invalidates all verdicts.
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
  cache_dir="$TMP_ROOT/cache-d.XXXXXX"
  cache_dir="$(mktemp -d "$cache_dir")"

  # First run: cold cache, both suites execute and write verdict markers.
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

  # Change the shared helper → every suite's verdict is invalidated (R4).
  cat > "$repo/scripts/lib/helper.sh" << 'EOF'
#!/bin/bash
helper() { echo "changed"; }
EOF
  run_check "$repo" --cache-dir "$cache_dir"
  if echo "$CHECK_STDERR" | grep -q "cache hit, skipping test-clean.sh"; then
    echo "FAIL  case-d: lib change should invalidate the suite verdict"
    fail=$((fail + 1))
  else
    echo "PASS  case-d: lib change invalidates the suite verdict (R4)"
    pass=$((pass + 1))
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

  # No git repo at all → merge-base fails → fallback to full non-cached scan.
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
# Case g — A change to a root-level scripts/*.sh invalidates a cached verdict
# (cache-key half of the arch-gap closure).
# ---------------------------------------------------------------------------
{
  repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  mk_fixture "$repo"
  cat > "$repo/scripts/tests/test-clean.sh" << 'EOF'
#!/bin/bash
echo "Everything is fine"
EOF
  chmod +x "$repo/scripts/tests/test-clean.sh"
  cat > "$repo/scripts/foo.sh" << 'EOF'
#!/bin/bash
foo() { :; }
EOF
  cache_dir="$(mktemp -d "$TMP_ROOT/cache-g.XXXXXX")"

  # First run: cold cache, suite executes and writes a verdict marker.
  run_check "$repo" --cache-dir "$cache_dir"
  if [ "$CHECK_EXIT" -eq 0 ]; then
    echo "PASS  case-g: cold run exits 0"
    pass=$((pass + 1))
  else
    echo "FAIL  case-g: cold run expected exit 0, got $CHECK_EXIT"
    fail=$((fail + 1))
  fi

  # Second run: warm cache, suite unchanged → cache hit.
  run_check "$repo" --cache-dir "$cache_dir"
  if echo "$CHECK_STDERR" | grep -q "cache hit, skipping test-clean.sh"; then
    echo "PASS  case-g: warm run reports cache hit"
    pass=$((pass + 1))
  else
    echo "FAIL  case-g: expected cache-hit notice (stderr: $CHECK_STDERR)"
    fail=$((fail + 1))
  fi

  # Change a root-level script (outside scripts/tests and scripts/lib) → the
  # suite verdict must be invalidated (arch-gap closure).
  cat > "$repo/scripts/foo.sh" << 'EOF'
#!/bin/bash
foo() { echo "changed"; }
EOF
  run_check "$repo" --cache-dir "$cache_dir"
  if echo "$CHECK_STDERR" | grep -q "cache hit, skipping test-clean.sh"; then
    echo "FAIL  case-g: root-level script change should invalidate the suite verdict"
    fail=$((fail + 1))
  else
    echo "PASS  case-g: root-level script change invalidates the suite verdict"
    pass=$((pass + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case h — The broadened short-circuit does not fire on a committed non-test
# script change (short-circuit half of the arch-gap closure).
# ---------------------------------------------------------------------------
{
  repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  mk_fixture "$repo"
  cat > "$repo/scripts/tests/test-stray.sh" << 'EOF'
#!/bin/bash
some-bogus-command
EOF
  chmod +x "$repo/scripts/tests/test-stray.sh"
  cat > "$repo/scripts/foo.sh" << 'EOF'
#!/bin/bash
foo() { :; }
EOF
  git -C "$repo" init -q
  git -C "$repo" config user.email test@example.com
  git -C "$repo" config user.name test
  git -C "$repo" config commit.gpgsign false
  git -C "$repo" add -A
  git -C "$repo" commit -qm init
  git -C "$repo" branch -M main
  init_sha="$(git -C "$repo" rev-parse HEAD)"

  # Commit a change to a root-level script only (no test/lib change). The
  # broadened short-circuit diffs the whole scripts/ tree, so it must NOT fire;
  # the scan runs and detects the stray (exit 1). If the short-circuit were
  # still scoped to scripts/tests + scripts/lib, it would fire and exit 0.
  cat > "$repo/scripts/foo.sh" << 'EOF'
#!/bin/bash
foo() { echo "changed"; }
EOF
  git -C "$repo" add scripts/foo.sh
  git -C "$repo" commit -qm change-root-script

  run_check "$repo" --base-ref "$init_sha"

  if [ "$CHECK_EXIT" -eq 1 ]; then
    echo "PASS  case-h: short-circuit does not fire on a root-level script change (scan ran, exit 1)"
    pass=$((pass + 1))
  else
    echo "FAIL  case-h: expected exit 1 (scan ran and found the stray), got $CHECK_EXIT"
    fail=$((fail + 1))
  fi
  if echo "$CHECK_STDERR" | grep -q "test-stray.sh has 1 stray.*errors"; then
    echo "PASS  case-h: stderr names the stray suite and count"
    pass=$((pass + 1))
  else
    echo "FAIL  case-h: stderr did not name test-stray.sh (stderr: $CHECK_STDERR)"
    fail=$((fail + 1))
  fi
}

# Summary
# ---------------------------------------------------------------------------
total=$((pass + fail))
echo ""
echo "Results: $pass/$total passed"
[ "$fail" -eq 0 ] && exit 0 || exit 1

# ---------------------------------------------------------------------------
