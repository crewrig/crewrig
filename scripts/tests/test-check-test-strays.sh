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

# RUN_ENV holds optional VAR=value assignments applied to the next run_check
# call (the caller resets it). run_check always starts from a clean slate for
# every variable the script under test reads, so the suite behaves the same
# locally and inside PR CI (where GITHUB_BASE_REF and GITHUB_ACTIONS are
# exported).
RUN_ENV=()

run_check() {
  local repo="$1" out_file err_file
  shift
  out_file="$(mktemp "$TMP_ROOT/out.XXXXXX")"
  err_file="$(mktemp "$TMP_ROOT/err.XXXXXX")"
  CHECK_EXIT=0
  ( unset GITHUB_BASE_REF CI_MERGE_REQUEST_TARGET_BRANCH_NAME CI_COMMIT_BEFORE_SHA GITHUB_ACTIONS; env ${RUN_ENV[@]+"${RUN_ENV[@]}"} CREWRIG_REPO_DIR="$repo" bash "$SCRIPT_UNDER_TEST" "$@" >"$out_file" 2>"$err_file" ) || CHECK_EXIT=$?
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

# ---------------------------------------------------------------------------
# Case l — GITHUB_BASE_REF environment variable is honored when set.
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
  git -C "$repo" branch -M base-branch
  base_sha="$(git -C "$repo" rev-parse HEAD)"

  git -C "$repo" checkout -qb feature-branch
  echo "unrelated" > "$repo/README.md"
  git -C "$repo" add README.md
  git -C "$repo" commit -qm update-readme

  out_file="$(mktemp "$TMP_ROOT/out.XXXXXX")"
  err_file="$(mktemp "$TMP_ROOT/err.XXXXXX")"
  CHECK_EXIT=0
  ( unset CI_MERGE_REQUEST_TARGET_BRANCH_NAME CI_COMMIT_BEFORE_SHA GITHUB_ACTIONS; CREWRIG_REPO_DIR="$repo" GITHUB_BASE_REF="$base_sha" bash "$SCRIPT_UNDER_TEST" --cache-dir "$TMP_ROOT/cache-l" >"$out_file" 2>"$err_file" ) || CHECK_EXIT=$?
  CHECK_STDOUT="$(cat "$out_file")"
  CHECK_STDERR="$(cat "$err_file")"
  rm -f "$out_file" "$err_file"

  if [ "$CHECK_EXIT" -eq 0 ]; then
    echo "PASS  case-l: GITHUB_BASE_REF is honored (exit 0)"
    pass=$((pass + 1))
  else
    echo "FAIL  case-l: expected exit 0, got $CHECK_EXIT"
    fail=$((fail + 1))
  fi
  if echo "$CHECK_STDOUT" | grep -qF "zero runtime strays across all test suites"; then
    echo "PASS  case-l: OK line emitted on GITHUB_BASE_REF resolution"
    pass=$((pass + 1))
  else
    echo "FAIL  case-l: missing OK line (stdout: $CHECK_STDOUT)"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case m — CI_COMMIT_BEFORE_SHA environment variable is honored when set.
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
  before_sha="$(git -C "$repo" rev-parse HEAD)"

  echo "unrelated" > "$repo/README.md"
  git -C "$repo" add README.md
  git -C "$repo" commit -qm update-readme

  out_file="$(mktemp "$TMP_ROOT/out.XXXXXX")"
  err_file="$(mktemp "$TMP_ROOT/err.XXXXXX")"
  CHECK_EXIT=0
  ( unset GITHUB_BASE_REF CI_MERGE_REQUEST_TARGET_BRANCH_NAME GITHUB_ACTIONS; CREWRIG_REPO_DIR="$repo" CI_COMMIT_BEFORE_SHA="$before_sha" bash "$SCRIPT_UNDER_TEST" --cache-dir "$TMP_ROOT/cache-m" >"$out_file" 2>"$err_file" ) || CHECK_EXIT=$?
  CHECK_STDOUT="$(cat "$out_file")"
  CHECK_STDERR="$(cat "$err_file")"
  rm -f "$out_file" "$err_file"

  if [ "$CHECK_EXIT" -eq 0 ]; then
    echo "PASS  case-m: CI_COMMIT_BEFORE_SHA is honored (exit 0)"
    pass=$((pass + 1))
  else
    echo "FAIL  case-m: expected exit 0, got $CHECK_EXIT"
    fail=$((fail + 1))
  fi
  if echo "$CHECK_STDOUT" | grep -qF "zero runtime strays across all test suites"; then
    echo "PASS  case-m: OK line emitted on CI_COMMIT_BEFORE_SHA resolution"
    pass=$((pass + 1))
  else
    echo "FAIL  case-m: missing OK line (stdout: $CHECK_STDOUT)"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# CI-topology fixtures (issue #1401).
#
# actions/checkout leaves a detached HEAD and creates only
# refs/remotes/<remote>/<name> for the base branch; there is no local branch
# named after $GITHUB_BASE_REF. mk_ci_fixture reproduces that: a bare remote,
# a base commit pushed to `main` and `release/x`, an unrelated-history branch
# `orphan` (also pushed), then a feature commit checked out DETACHED with the
# only local branch deleted.
#
#   scripts/tests/test-changed.sh    clean; modified by the feature commit
#   scripts/tests/test-unchanged.sh  carries a stray; untouched by the feature
#
# So a changeset-scoped run exits 0 while a full scan exits 1.
# ---------------------------------------------------------------------------

# fxgit — git with the developer's global/system config out of the picture, so
# the fixtures do not depend on init.defaultBranch, signing or hooks.
fxgit() {
  GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 git "$@"
}

mk_ci_fixture() {
  local repo="$1" remote="${2:-origin}" bare empty_tree orphan_sha
  bare="$(mktemp -d "$TMP_ROOT/bare.XXXXXX")"
  mk_fixture "$repo"
  cat > "$repo/scripts/tests/test-changed.sh" << 'EOF'
#!/bin/bash
echo "version 1"
EOF
  cat > "$repo/scripts/tests/test-unchanged.sh" << 'EOF'
#!/bin/bash
some-bogus-command
EOF
  chmod +x "$repo/scripts/tests/test-changed.sh" "$repo/scripts/tests/test-unchanged.sh"
  fxgit init -q "$repo" 2>/dev/null
  fxgit -C "$repo" config user.email test@example.com
  fxgit -C "$repo" config user.name test
  fxgit -C "$repo" config commit.gpgsign false
  fxgit -C "$repo" add -A
  fxgit -C "$repo" commit -qm base
  fxgit -C "$repo" branch -M main
  fxgit init --bare -q "$bare" 2>/dev/null
  fxgit -C "$repo" remote add "$remote" "$bare"
  empty_tree="$(fxgit -C "$repo" mktree < /dev/null)"
  orphan_sha="$(fxgit -C "$repo" commit-tree -m orphan "$empty_tree")"
  fxgit -C "$repo" push -q "$remote" main HEAD:refs/heads/release/x \
    "$orphan_sha:refs/heads/orphan" 2>/dev/null
  # Feature commit: touches only the clean suite.
  cat > "$repo/scripts/tests/test-changed.sh" << 'EOF'
#!/bin/bash
echo "version 2"
EOF
  fxgit -C "$repo" add -A
  fxgit -C "$repo" commit -qm feature
  fxgit -C "$repo" checkout -q --detach
  fxgit -C "$repo" branch -D main >/dev/null 2>&1
}

# pass_if <label> <cmd...> — PASS when the command succeeds.
pass_if() {
  local label="$1"
  shift
  if "$@"; then
    echo "PASS  $label"
    pass=$((pass + 1))
  else
    echo "FAIL  $label"
    fail=$((fail + 1))
  fi
}

has_stderr() { grep -qF -- "$1" <<< "$CHECK_STDERR"; }
no_stderr()  { ! has_stderr "$1"; }
has_stdout() { grep -qF -- "$1" <<< "$CHECK_STDOUT"; }
no_stdout()  { ! has_stdout "$1"; }
exit_is()    { [ "$CHECK_EXIT" -eq "$1" ]; }
no_ref()     { ! fxgit -C "$1" rev-parse --verify --quiet "$2" >/dev/null 2>&1; }
has_ref()    { fxgit -C "$1" rev-parse --verify --quiet "$2" >/dev/null 2>&1; }

# scoped_case <label> <remote> <base-name> <ENV=value>... — one scoped
# resolution scenario. The check must exit 0 (scoped; a full scan would hit
# the stray), print the OK line, and emit no WARNING.
scoped_case() {
  local label="$1" remote="$2" base_name="$3" repo
  shift 3
  repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  mk_ci_fixture "$repo" "$remote"
  pass_if "$label: fixture is the CI topology (no local '$base_name')" \
    no_ref "$repo" "refs/heads/$base_name"
  pass_if "$label: fixture is the CI topology (remote-tracking ref present)" \
    has_ref "$repo" "refs/remotes/$remote/$base_name"
  RUN_ENV=(GIT_CONFIG_GLOBAL=/dev/null "$@")
  run_check "$repo" --cache-dir "$TMP_ROOT/cache-$label"
  RUN_ENV=()
  pass_if "$label: bare base name is resolved via the remote, scoped run exits 0" exit_is 0
  pass_if "$label: OK line emitted" has_stdout "zero runtime strays across all test suites"
  pass_if "$label: no WARNING on stderr" no_stderr "WARNING"
}

# ---------------------------------------------------------------------------
# Case n — Bare GITHUB_BASE_REF resolves via <remote>/<name> (issue #1401).
# ---------------------------------------------------------------------------
scoped_case case-n origin main GITHUB_BASE_REF=main

# ---------------------------------------------------------------------------
# Case o — Same with a slash-bearing base branch name.
# ---------------------------------------------------------------------------
scoped_case case-o origin release/x GITHUB_BASE_REF=release/x

# ---------------------------------------------------------------------------
# Case p — Same through CI_MERGE_REQUEST_TARGET_BRANCH_NAME (GitLab).
# ---------------------------------------------------------------------------
scoped_case case-p origin main CI_MERGE_REQUEST_TARGET_BRANCH_NAME=main

# ---------------------------------------------------------------------------
# Case s — The remote is derived from the repo under check, not from the
# harness's cwd: a fixture whose only remote is `crewrig` still resolves.
# ---------------------------------------------------------------------------
scoped_case case-s crewrig main GITHUB_BASE_REF=main

# ---------------------------------------------------------------------------
# Case q — Loud full-scan fallback (spec 0170 R6 fail-safe kept, issue #1401).
# ---------------------------------------------------------------------------
{
  # (a) The name resolves nowhere.
  repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  mk_ci_fixture "$repo" origin
  RUN_ENV=(GIT_CONFIG_GLOBAL=/dev/null GITHUB_BASE_REF=nope GITHUB_ACTIONS=true)
  run_check "$repo" --cache-dir "$TMP_ROOT/cache-q-a"
  RUN_ENV=()
  pass_if "case-q(a): unresolvable base falls back to a full scan (stray found, exit 1)" exit_is 1
  pass_if "case-q(a): stderr carries the WARNING prefix" has_stderr "check-test-strays: WARNING:"
  pass_if "case-q(a): warning says the ref did not resolve to a commit" has_stderr "did not resolve to a commit"
  pass_if "case-q(a): warning cites the raw name" has_stderr "'nope'"
  pass_if "case-q(a): ::warning:: annotation on stdout under GITHUB_ACTIONS=true" has_stdout "::warning::"

  RUN_ENV=(GIT_CONFIG_GLOBAL=/dev/null GITHUB_BASE_REF=nope)
  run_check "$repo" --cache-dir "$TMP_ROOT/cache-q-a2"
  RUN_ENV=()
  pass_if "case-q(a): no ::warning:: annotation outside GITHUB_ACTIONS" no_stdout "::warning::"
  pass_if "case-q(a): stderr WARNING still emitted outside GITHUB_ACTIONS" has_stderr "WARNING"

  # (b) The ref resolves (origin/orphan) but shares no history with HEAD.
  RUN_ENV=(GIT_CONFIG_GLOBAL=/dev/null GITHUB_BASE_REF=orphan)
  run_check "$repo" --cache-dir "$TMP_ROOT/cache-q-b"
  RUN_ENV=()
  pass_if "case-q(b): resolved ref without merge-base falls back to a full scan (exit 1)" exit_is 1
  pass_if "case-q(b): warning says there is no merge-base" has_stderr "no merge-base"
  pass_if "case-q(b): warning cites the raw name" has_stderr "'orphan'"
  pass_if "case-q(b): warning cites the resolved ref" has_stderr "'origin/orphan'"
  pass_if "case-q(b): not misreported as an unresolved ref" no_stderr "did not resolve to a commit"

  # (c) No base ref at all: no env, no HEAD~1 (single-commit repo).
  repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  mk_fixture "$repo"
  cat > "$repo/scripts/tests/test-unchanged.sh" << 'EOF'
#!/bin/bash
some-bogus-command
EOF
  fxgit init -q "$repo" 2>/dev/null
  fxgit -C "$repo" config user.email test@example.com
  fxgit -C "$repo" config user.name test
  fxgit -C "$repo" config commit.gpgsign false
  fxgit -C "$repo" add -A
  fxgit -C "$repo" commit -qm only
  RUN_ENV=(GIT_CONFIG_GLOBAL=/dev/null GITHUB_ACTIONS=true)
  run_check "$repo" --cache-dir "$TMP_ROOT/cache-q-c"
  RUN_ENV=()
  pass_if "case-q(c): no base ref falls back to a full scan (exit 1)" exit_is 1
  pass_if "case-q(c): stderr WARNING says no base ref could be determined" has_stderr "no base ref"
  pass_if "case-q(c): ::warning:: annotation on stdout" has_stdout "::warning::"
}

# ---------------------------------------------------------------------------
# Case r — resolve_remote_ref (scripts/lib/base-ref-resolve.sh) unit cases.
# ---------------------------------------------------------------------------
{
  # shellcheck source=../lib/base-ref-resolve.sh
  source "$SCRIPT_DIR/lib/base-ref-resolve.sh"

  if ! declare -F resolve_remote_ref >/dev/null; then
    echo "FAIL  case-r: resolve_remote_ref is not defined in scripts/lib/base-ref-resolve.sh"
    fail=$((fail + 1))
  else
    repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
    mk_ci_fixture "$repo" origin
    fxgit -C "$repo" branch localonly HEAD
    tree_sha="$(fxgit -C "$repo" rev-parse 'HEAD^{tree}')"
    fxgit -C "$repo" tag treetag "$tree_sha"
    head_sha="$(fxgit -C "$repo" rev-parse HEAD)"
    elsewhere="$(mktemp -d "$TMP_ROOT/elsewhere.XXXXXX")"

    # rr <want-rc> <want-stdout> <label> <args...> — runs from a directory
    # that is NOT the repo, so <repo-dir> must be honored.
    rr() {
      local want_rc="$1" want_out="$2" label="$3" out rc
      shift 3
      out="$(cd "$elsewhere" && GIT_CONFIG_GLOBAL=/dev/null resolve_remote_ref "$@")"
      rc=$?
      if [ "$rc" -eq "$want_rc" ] && [ "$out" = "$want_out" ]; then
        echo "PASS  case-r: $label"
        pass=$((pass + 1))
      else
        echo "FAIL  case-r: $label (rc=$rc want $want_rc; stdout='$out' want '$want_out')"
        fail=$((fail + 1))
      fi
    }

    rr 0 "localonly"        "bare local branch is returned as given"               localonly origin "$repo"
    rr 0 "origin/main"      "remote-only branch resolves to origin/<name>"         main origin "$repo"
    rr 0 "origin/release/x" "slash-bearing name resolves to origin/<name>"         release/x origin "$repo"
    rr 1 ""                 "unresolvable name: rc 1 and empty stdout"             nope origin "$repo"
    rr 0 "origin/main"      "already-prefixed name is returned as given"           origin/main origin "$repo"
    rr 1 ""                 "already-prefixed unresolvable: rc 1, no double prefix" origin/nope origin "$repo"
    rr 1 ""                 "empty name: rc 1 and empty stdout"                    "" origin "$repo"
    rr 1 ""                 "remote that does not exist: rc 1"                     main crewrig "$repo"
    rr 0 "$head_sha"        "a commit SHA resolves as given"                       "$head_sha" origin "$repo"
    rr 1 ""                 "a tag peeling to a tree is not a commit"              treetag origin "$repo"

    fixture_crewrig="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
    mk_ci_fixture "$fixture_crewrig" crewrig
    rr 0 "crewrig/main"     "custom <remote> is honored"                           main crewrig "$fixture_crewrig"

    # Defaults: remote=origin, repo-dir=. (cwd).
    out="$(cd "$repo" && GIT_CONFIG_GLOBAL=/dev/null resolve_remote_ref main)"
    rc=$?
    if [ "$rc" -eq 0 ] && [ "$out" = "origin/main" ]; then
      echo "PASS  case-r: <remote> defaults to origin and <repo-dir> to ."
      pass=$((pass + 1))
    else
      echo "FAIL  case-r: defaults (rc=$rc, stdout='$out')"
      fail=$((fail + 1))
    fi
  fi
}

# Summary
# ---------------------------------------------------------------------------
total=$((pass + fail))
echo ""
echo "Results: $pass/$total passed"
[ "$fail" -eq 0 ] && exit 0 || exit 1
