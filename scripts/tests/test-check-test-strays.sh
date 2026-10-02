#!/bin/bash
# test-check-test-strays.sh — Regression tests for scripts/check-test-strays.sh
# (issue #738, specs 0170 and 0171; rewritten for the single-run guard, issue
# #1445, spec 0170 delta-01 R9).
#
# scripts/check-test-strays.sh is a static syntax guard: it runs `bash -n` over
# every scripts/tests/test-*.sh and EXECUTES ZERO SUITES, in every circumstance.
# Runtime stray detection lives in `scripts/ci-cache-guard.sh --stray-scan`
# (covered by scripts/tests/ci-cache-guard-scan.test.ts), not here.
#
# Cases:
#   a   A clean tree passes with the exact OK line.
#   b   R14 pin: a runtime stray in a syntactically valid suite is NOT seen by
#       this check (exit 0). That is the documented trade-off, not a bug.
#   g   A syntax error exits 1 naming the file, before anything runs.
#   n   "Executes nothing", parameterised: a suite that touches a sentinel file
#       and carries a stray is run over with no git, `--base-ref`,
#       GITHUB_BASE_REF (resolvable and not), CI_MERGE_REQUEST_TARGET_BRANCH_NAME,
#       CI_COMMIT_BEFORE_SHA (a real ref and GitLab's all-zero value), a warm
#       `.ci-cache` of markers, and the legacy `--cache-dir`/`--jobs` options.
#       The sentinel is never created, the exit is 0, stdout is exactly the OK
#       line and stderr is empty (no WARNING, no notice, no cache write).
#   u   Usage errors exit 2: a suite-path positional argument, an option
#       without its value, a missing tests directory.
#   t   Time bound on the real tree (R9: under 2 s; asserted under 5 s).
#   r   resolve_remote_ref unit cases for scripts/lib/base-ref-resolve.sh (the
#       only unit tests of that library, which other scripts still source).
#
# Usage:
#   bash scripts/tests/test-check-test-strays.sh

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
# every variable the script under test could read, so the suite behaves the
# same locally and inside PR CI (where GITHUB_BASE_REF and GITHUB_ACTIONS are
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

# fxgit — git with the developer's global/system config out of the picture, so
# the fixtures do not depend on init.defaultBranch, signing or hooks.
fxgit() {
  GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 git "$@"
}

# mk_ci_fixture <repo> [remote] — the CI topology of issue #1401.
#
# actions/checkout leaves a detached HEAD and creates only
# refs/remotes/<remote>/<name> for the base branch; there is no local branch
# named after $GITHUB_BASE_REF. This reproduces that: a bare remote, a base
# commit pushed to `main` and `release/x`, an unrelated-history branch
# `orphan` (also pushed), then a feature commit checked out DETACHED with the
# only local branch deleted.
#
#   scripts/tests/test-changed.sh    clean; modified by the feature commit
#   scripts/tests/test-unchanged.sh  carries a stray; untouched by the feature
#
# The guard no longer reads any of this; the topology is kept because case n
# must prove that a realistic CI checkout, base refs included, changes nothing,
# and because case r resolves refs against it.
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
    echo "      exit: $CHECK_EXIT"
    echo "      stdout: $CHECK_STDOUT"
    echo "      stderr: $CHECK_STDERR"
    fail=$((fail + 1))
  fi
}

has_stderr()   { grep -qF -- "$1" <<< "$CHECK_STDERR"; }
exit_is()      { [ "$CHECK_EXIT" -eq "$1" ]; }
stdout_is()    { [ "$CHECK_STDOUT" = "$1" ]; }
stdout_empty() { [ -z "$CHECK_STDOUT" ]; }
stderr_empty() { [ -z "$CHECK_STDERR" ]; }
absent()       { [ ! -e "$1" ]; }

# ok_line <n> — the exact stdout of a clean run over n suites.
ok_line() { printf 'OK: %s test suites pass the static syntax check; none executed.' "$1"; }

# count_suites <repo> — number of scripts/tests/test-*.sh in a fixture.
count_suites() {
  find "$1/scripts/tests" -maxdepth 1 -name 'test-*.sh' | wc -l | tr -d ' '
}

# now_ms — milliseconds since the epoch, sub-second where the platform allows.
# The integer SECONDS variable is useless for a 2 s bound: it ticks on whole
# seconds, so a 1.2 s run can read as 1 or 2. Preference order: EPOCHREALTIME
# (bash 5; absent from macOS's system bash 3.2), `date +%s%N` (GNU; BSD date
# prints a literal N, rejected by the digits check), perl's Time::HiRes, and
# finally whole seconds (coarse, but the bound below tolerates it).
now_ms() {
  local t
  if [ -n "${EPOCHREALTIME:-}" ]; then
    t="${EPOCHREALTIME/[.,]/}"   # microseconds; the separator is locale-dependent
    echo $((t / 1000))
    return
  fi
  t="$(date +%s%N 2>/dev/null)"
  case "$t" in
    ''|*[!0-9]*) ;;
    *) echo $((t / 1000000)); return ;;
  esac
  t="$(perl -MTime::HiRes=time -e 'printf "%d\n", time() * 1000' 2>/dev/null)"
  case "$t" in
    ''|*[!0-9]*) ;;
    *) echo "$t"; return ;;
  esac
  echo $(( $(date +%s) * 1000 ))
}

# ---------------------------------------------------------------------------
# Case a — Clean tree passes with the exact OK line.
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

  pass_if "case-a: a clean suite passes the check (exit 0)" exit_is 0
  pass_if "case-a: stdout is exactly the OK line for 1 suite" stdout_is "$(ok_line 1)"
  pass_if "case-a: stderr is empty" stderr_empty
}

# ---------------------------------------------------------------------------
# Case b — R14 pin (spec 0170 delta-01): this check is static, so a runtime
# stray in a syntactically valid suite is NOT detected here. It is detected, per
# suite, by `ci-cache-guard.sh --stray-scan` in the job that runs the suite. If
# this case ever turns red, the guard started executing suites again.
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

  pass_if "case-b: a runtime stray is not seen by the static check (exit 0)" exit_is 0
  pass_if "case-b: stdout is exactly the OK line" stdout_is "$(ok_line 1)"
  pass_if "case-b: nothing is reported on stderr" stderr_empty
}

# ---------------------------------------------------------------------------
# Case g — Static syntax error fails immediately (spec 0170 R1), naming the
# file, and nothing runs: a sibling probe suite must leave no sentinel.
# ---------------------------------------------------------------------------
{
  repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  mk_fixture "$repo"
  sentinel="$TMP_ROOT/sentinel.g"
  cat > "$repo/scripts/tests/test-probe.sh" << EOF
#!/bin/bash
touch '$sentinel'
EOF
  cat > "$repo/scripts/tests/test-syntax-err.sh" << 'EOF'
#!/bin/bash
if [ -f "foo" ; then
  echo "broken"
EOF
  chmod +x "$repo/scripts/tests/test-probe.sh" "$repo/scripts/tests/test-syntax-err.sh"

  run_check "$repo"

  pass_if "case-g: syntax error fails the check (exit 1)" exit_is 1
  pass_if "case-g: stderr names the suite with the syntax error" has_stderr "test-syntax-err.sh has syntax errors"
  pass_if "case-g: no OK line on stdout" stdout_empty
  pass_if "case-g: no suite was executed" absent "$sentinel"
}

# ---------------------------------------------------------------------------
# Case n — The guard executes nothing (spec 0170 delta-01 R9), parameterised.
#
# Every fixture carries scripts/tests/test-probe.sh, which touches a sentinel
# file and then runs a stray command. Whatever the topology, environment or
# arguments, the sentinel must never appear, the exit must be 0, stdout must be
# exactly the OK line, and stderr must be empty: no WARNING, no `::warning::`
# annotation, no cache notice.
#
# nothing_executes <label> <kind> [args...]   (RUN_ENV set by the caller)
#   kind nogit   a plain directory, not a git repository
#   kind git     the CI topology of mk_ci_fixture (detached HEAD, origin/main)
#   kind warm    a plain directory with a warm .ci-cache of markers, passed
#                with --cache-dir; the cache must be left byte-identical
#   kind legacy  the CI topology plus the three legacy options with values
#                (--base-ref main --cache-dir X --jobs 4); X must not appear
# ---------------------------------------------------------------------------
CI_TEMPLATE=

nothing_executes() {
  local label="$1" kind="$2" repo sentinel n cache before after
  shift 2
  repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  sentinel="$TMP_ROOT/sentinel.$label"
  cache="$TMP_ROOT/never-created.$label"
  case "$kind" in
    git|legacy)
      # Build the git topology once and copy it: eight git fixtures built from
      # scratch cost several seconds, a copy costs milliseconds. The copy keeps
      # the (never-pushed-to-again) bare remote's absolute path.
      if [ -z "$CI_TEMPLATE" ]; then
        CI_TEMPLATE="$(mktemp -d "$TMP_ROOT/template.XXXXXX")"
        mk_ci_fixture "$CI_TEMPLATE" origin
      fi
      cp -R "$CI_TEMPLATE/." "$repo/"
      ;;
    *) mk_fixture "$repo" ;;
  esac
  cat > "$repo/scripts/tests/test-probe.sh" << EOF
#!/bin/bash
touch '$sentinel'
some-bogus-command
EOF
  chmod +x "$repo/scripts/tests/test-probe.sh"
  n="$(count_suites "$repo")"

  case "$kind" in
    warm)
      mkdir -p "$repo/.ci-cache"
      printf 'pass\n' > "$repo/.ci-cache/0123456789abcdef.marker"
      printf 'pass\n' > "$repo/.ci-cache/fedcba9876543210.marker"
      before="$(find "$repo/.ci-cache" -type f -exec cksum {} + | sort)"
      run_check "$repo" --cache-dir "$repo/.ci-cache" "$@"
      after="$(find "$repo/.ci-cache" -type f -exec cksum {} + | sort)"
      pass_if "case-n $label: the warm cache is left byte-identical" test "$before" = "$after"
      ;;
    legacy)
      run_check "$repo" --base-ref main --cache-dir "$cache" --jobs 4 "$@"
      pass_if "case-n $label: the legacy --cache-dir directory is never created" absent "$cache"
      ;;
    *)
      run_check "$repo" "$@"
      ;;
  esac
  RUN_ENV=()

  pass_if "case-n $label: the probe suite was not executed (no sentinel)" absent "$sentinel"
  pass_if "case-n $label: exit 0" exit_is 0
  pass_if "case-n $label: stdout is exactly the OK line for $n suites" stdout_is "$(ok_line "$n")"
  pass_if "case-n $label: stderr is empty" stderr_empty
}

nothing_executes no-git          nogit
nothing_executes base-ref-arg    git    --base-ref main
nothing_executes ci-topology     git
RUN_ENV=(GITHUB_BASE_REF=main)
nothing_executes github-base     git
RUN_ENV=(GITHUB_BASE_REF=nope GITHUB_ACTIONS=true)
nothing_executes github-base-unresolvable git
RUN_ENV=(CI_MERGE_REQUEST_TARGET_BRANCH_NAME=main)
nothing_executes gitlab-target   git
RUN_ENV=(CI_COMMIT_BEFORE_SHA=HEAD~1)
nothing_executes gitlab-before   git
RUN_ENV=(CI_COMMIT_BEFORE_SHA=0000000000000000000000000000000000000000)
nothing_executes gitlab-before-zero git
nothing_executes warm-cache      warm
nothing_executes legacy-options  legacy

# ---------------------------------------------------------------------------
# Case u — Usage errors exit 2 (spec 0171 delta-01): no suite can be passed,
# and a legacy option without its value is rejected, not silently swallowed.
# ---------------------------------------------------------------------------
{
  repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  mk_fixture "$repo"
  sentinel="$TMP_ROOT/sentinel.u"
  cat > "$repo/scripts/tests/test-probe.sh" << EOF
#!/bin/bash
touch '$sentinel'
EOF
  chmod +x "$repo/scripts/tests/test-probe.sh"

  run_check "$repo" scripts/tests/test-probe.sh
  pass_if "case-u: a suite-path argument is a usage error (exit 2)" exit_is 2
  pass_if "case-u: stderr names the rejected argument" has_stderr "unknown option or argument 'scripts/tests/test-probe.sh'"
  pass_if "case-u: no OK line on stdout" stdout_empty
  pass_if "case-u: the named suite was not executed" absent "$sentinel"

  for opt in --cache-dir --base-ref --jobs; do
    run_check "$repo" "$opt"
    pass_if "case-u: '$opt' without its value is a usage error (exit 2)" exit_is 2
    pass_if "case-u: '$opt' without its value says it requires a value" has_stderr "option '$opt' requires a value"
    pass_if "case-u: '$opt' without its value prints no OK line" stdout_empty
  done

  run_check "$repo" --base-ref main --jobs
  pass_if "case-u: a valueless option after a valid one is still exit 2" exit_is 2

  empty="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  run_check "$empty"
  pass_if "case-u: a missing tests directory is a usage error (exit 2)" exit_is 2
  pass_if "case-u: stderr says the tests directory was not found" has_stderr "tests directory not found"
}

# ---------------------------------------------------------------------------
# Case t — Time bound on the real tree (spec 0170 delta-01 R9: under 2 s).
#
# `bash -n` over the whole suite directory takes about 1.2 s on a laptop and
# 0.25 s in a container. The bound asserted is 5 s, not 2 s, on purpose: a hard
# 2 s would flake on a loaded shared runner and teach people to ignore the
# case, while "executes nothing" is already proven exactly, by the sentinel
# case above, independently of the clock. What this bound still catches is the
# failure mode it exists for: a return to running suites, which costs minutes
# (one suite alone is tens of seconds; the guard it replaces took 170-180 s).
# The clock is sub-second (now_ms), never the integer SECONDS.
# ---------------------------------------------------------------------------
{
  real_repo="$(cd "$SCRIPT_DIR/.." && pwd)"
  bound_ms=5000

  t0="$(now_ms)"
  run_check "$real_repo"
  t1="$(now_ms)"
  elapsed_ms=$((t1 - t0))

  pass_if "case-t: the real tree passes the static check (exit 0)" exit_is 0
  ok_re='^OK: ([0-9]+) test suites pass the static syntax check; none executed\.$'
  if [[ "$CHECK_STDOUT" =~ $ok_re ]] && [ "${BASH_REMATCH[1]}" -ge 1 ]; then
    echo "PASS  case-t: OK line on the real tree (${BASH_REMATCH[1]} suites)"
    pass=$((pass + 1))
  else
    echo "FAIL  case-t: unexpected stdout on the real tree: $CHECK_STDOUT"
    fail=$((fail + 1))
  fi
  if [ "$elapsed_ms" -lt "$bound_ms" ]; then
    echo "PASS  case-t: the real tree is checked in ${elapsed_ms} ms (bound ${bound_ms} ms)"
    pass=$((pass + 1))
  else
    echo "FAIL  case-t: the real tree took ${elapsed_ms} ms (bound ${bound_ms} ms)"
    fail=$((fail + 1))
  fi
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

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
total=$((pass + fail))
echo ""
echo "Results: $pass/$total passed"
[ "$fail" -eq 0 ] && exit 0 || exit 1
