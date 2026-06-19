#!/bin/bash
# test-check-ci-parity.sh — Regression tests for check-ci-parity.sh (spec 0049).
#
# check-ci-parity.sh is the 3-way CI drift harness: it treats
# ci/ci-capabilities.yml as the source of truth and verifies that the GitHub
# Actions workflows and the committed .gitlab-ci.yml both faithfully exhibit its
# PORTABLE capability set, that the two engines agree, that no pipeline job is
# untraceable, and that the reference is itself well-formed. This is the parity
# sibling mandated by spec 0049 R10 and the repo convention "every check-*.sh
# has a test-*.sh" (mirrors scripts/tests/test-check-core-paths.sh).
#
# Every fixture is a hermetic temp COPY of the real ci/, .github/, and
# .gitlab-ci.yml tree; the real repo tree is never mutated. The harness composes
# the real scripts/build-ci.sh for its reference↔GitLab arm (Arm 2), reading the
# fixture via CREWRIG_REPO_DIR — so the copied ci/ + .gitlab-ci.yml are all Arm 2
# needs from the fixture.
#
# Cases (each asserts the exit code AND that the message names the offending
# capability + platform where applicable):
#
#   Positive:
#     P1   Conforming tree → exit 0; OK line enumerates BOTH GitHub Actions
#          AND GitLab (regression guard for the silent-skip bug — the OK line
#          must prove every present engine was actually checked).
#     P2a  Fallback resolution (PLAN Step 2a, load-bearing): the conforming
#          fixture's GHA `deploy` job carries `# ci-capability: pages-deploy`;
#          assert it resolves (no `untraceable job 'deploy'`) and exit 0.
#     P2b  Negative twin: STRIP the annotation → `untraceable job 'deploy'`
#          + exit 1.
#     P3   Boilerplate tolerance (S2): an extra hand-authored setup step
#          (uses:) → exit 0, no drift.
#     P4a  Graceful degradation (S9/R11): missing .gitlab-ci.yml → exit 0
#          (GHA-only; OK line omits GitLab).
#     P4b  Graceful degradation (S9/R11): missing .github/ → exit 0
#          (GitLab-only; OK line omits GitHub Actions).
#
#   Fail-closed (exit 1 each):
#     S3   Drifted GHA business step → names github-actions.
#     S4   Drifted committed .gitlab-ci.yml → names gitlab; surfaces the
#          composed build-ci.sh --check.
#     S5   An engine omits a portable capability → cross-engine parity (R6).
#     S6   Untraceable job (key != id, no fallback annotation).
#     S7   `specific` capability with empty evidence.
#     S10a Reference validity: unknown trigger kind.
#     S10b Reference validity: duplicate id.
#     S10c Reference validity: portable without command.
#     S10d Reference validity: portable with an unmet requirement.
#     R4d  Missing fetch-depth: 0 where requires history-depth: full.
#     R4t  Missing tool install (yq).
#     R4r  Wrong runtime version (node-version).
#
# Usage:
#   bash scripts/tests/test-check-ci-parity.sh

# -e intentionally omitted: pass/fail counters control the harness; adding -e
# would abort on the expected non-zero exits from the script under test.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT_UNDER_TEST="$SCRIPT_DIR/check-ci-parity.sh"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ ! -f "$SCRIPT_UNDER_TEST" ]; then
  echo "FATAL: cannot find $SCRIPT_UNDER_TEST" >&2
  exit 2
fi

if ! command -v yq >/dev/null 2>&1; then
  echo "FATAL: yq (mikefarah v4) is required to run these tests" >&2
  exit 2
fi

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

pass=0
fail=0

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

ok()  { echo "PASS  $1"; pass=$((pass + 1)); }
ko()  { echo "FAIL  $1"; fail=$((fail + 1)); }

# make_fixture — print the path to a fresh hermetic copy of the conforming tree
# (the real ci/, .github/, and .gitlab-ci.yml). Callers mutate the copy only.
make_fixture() {
  local fx
  fx="$(mktemp -d "$TMP_ROOT/fx.XXXXXX")"
  cp -R "$REPO_ROOT/ci"             "$fx/ci"
  cp -R "$REPO_ROOT/.github"        "$fx/.github"
  cp    "$REPO_ROOT/.gitlab-ci.yml" "$fx/.gitlab-ci.yml"
  printf '%s' "$fx"
}

# run_check <fixture> — run the harness over the fixture, capturing exit/stdout/
# stderr into CHECK_EXIT / CHECK_STDOUT / CHECK_STDERR.
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

# expect_exit <expected> <label>
expect_exit() {
  if [ "$CHECK_EXIT" -eq "$1" ]; then
    ok "$2 (exit $1)"
  else
    ko "$2: expected exit $1, got $CHECK_EXIT"
    echo "      stderr: $CHECK_STDERR"
  fi
}

# expect_in <stream> <substring> <label> — assert the captured stream contains
# the literal substring. <stream> is "out" or "err".
expect_in() {
  local stream="$1" needle="$2" label="$3" hay
  case "$stream" in out) hay="$CHECK_STDOUT" ;; *) hay="$CHECK_STDERR" ;; esac
  if printf '%s' "$hay" | grep -qF "$needle"; then
    ok "$label"
  else
    ko "$label: $stream missing '$needle'"
    echo "      $stream: $hay"
  fi
}

# refute_in <stream> <substring> <label> — assert the stream does NOT contain it.
refute_in() {
  local stream="$1" needle="$2" label="$3" hay
  case "$stream" in out) hay="$CHECK_STDOUT" ;; *) hay="$CHECK_STDERR" ;; esac
  if printf '%s' "$hay" | grep -qF "$needle"; then
    ko "$label: $stream unexpectedly contains '$needle'"
    echo "      $stream: $hay"
  else
    ok "$label"
  fi
}

# ===========================================================================
# Positive cases
# ===========================================================================

# ---------------------------------------------------------------------------
# P1 + P2a — Conforming tree → exit 0; OK line enumerates BOTH engines; the
# `deploy` fallback annotation resolves (no untraceable-job failure).
# ---------------------------------------------------------------------------
{
  f="$(make_fixture)"
  run_check "$f"

  expect_exit 0 "P1: conforming tree passes"
  expect_in out "OK:"            "P1: OK line emitted on stdout"
  expect_in out "GitHub Actions" "P1: OK line enumerates GitHub Actions"
  expect_in out "GitLab"         "P1: OK line enumerates GitLab"

  # P2a — the load-bearing fallback-regression guard: `deploy` (key != id
  # pages-deploy) must resolve via its `# ci-capability: pages-deploy`
  # annotation, never surfacing as untraceable on the conforming repo.
  refute_in err "untraceable job 'deploy'" "P2a: deploy fallback resolves (not untraceable)"
}

# ---------------------------------------------------------------------------
# P2b — Negative twin: strip the `# ci-capability:` annotation from `deploy`
# → untraceable job + exit 1.
# ---------------------------------------------------------------------------
{
  f="$(make_fixture)"
  # Drop the trailing key-comment so `deploy` is neither an id nor annotated.
  sed -i.bak 's/^  deploy: # ci-capability: pages-deploy/  deploy:/' \
    "$f/.github/workflows/pages.yml"
  rm -f "$f/.github/workflows/pages.yml.bak"

  run_check "$f"
  expect_exit 1 "P2b: stripped fallback annotation fails closed"
  expect_in err "untraceable job 'deploy'" "P2b: names the untraceable deploy job"
  expect_in err "github-actions"           "P2b: names the github-actions platform"
}

# ---------------------------------------------------------------------------
# P3 — Boilerplate tolerance (S2): an extra hand-authored setup step (a `uses:`
# step) is not a divergence.
# ---------------------------------------------------------------------------
{
  f="$(make_fixture)"
  yq -i '.jobs.build.steps += [{"uses": "actions/cache@v4"}]' \
    "$f/.github/workflows/build.yml"

  run_check "$f"
  expect_exit 0 "P3: extra setup boilerplate is tolerated"
  expect_in out "OK:" "P3: clean OK line on stdout"
}

# ---------------------------------------------------------------------------
# P4a — Graceful degradation: missing .gitlab-ci.yml → exit 0, GHA-only.
# ---------------------------------------------------------------------------
{
  f="$(make_fixture)"
  rm -f "$f/.gitlab-ci.yml"

  run_check "$f"
  expect_exit 0 "P4a: GHA-only repo passes (GitLab absent)"
  expect_in out "GitHub Actions" "P4a: OK line names the present GitHub Actions arm"
  refute_in out "GitLab"         "P4a: OK line omits the absent GitLab arm"
}

# ---------------------------------------------------------------------------
# P4b — Graceful degradation: missing .github/ → exit 0, GitLab-only.
# ---------------------------------------------------------------------------
{
  f="$(make_fixture)"
  rm -rf "$f/.github"

  run_check "$f"
  expect_exit 0 "P4b: GitLab-only repo passes (GitHub Actions absent)"
  expect_in out "GitLab"          "P4b: OK line names the present GitLab arm"
  refute_in out "GitHub Actions"  "P4b: OK line omits the absent GitHub Actions arm"
}

# ===========================================================================
# Fail-closed cases
# ===========================================================================

# ---------------------------------------------------------------------------
# S3 — A drifted GHA business step → fail closed naming the capability + GHA.
# ---------------------------------------------------------------------------
{
  f="$(make_fixture)"
  # build job steps: [0] checkout, [1] setup-node, [2] `npm install`,
  # [3] `npm run build …`. Break the business step at index 3.
  yq -i '.jobs.build.steps[3].run = "npm run bogus"' \
    "$f/.github/workflows/build.yml"

  run_check "$f"
  expect_exit 1 "S3: drifted GHA business step fails closed"
  expect_in err "capability 'build' (github-actions)" "S3: names capability + github-actions"
}

# ---------------------------------------------------------------------------
# S4 — A drifted committed .gitlab-ci.yml → fail closed naming GitLab via the
# composed build-ci.sh --check.
# ---------------------------------------------------------------------------
{
  f="$(make_fixture)"
  # Any hand-edit makes the committed file differ from a fresh derivation.
  printf '\n# hand-edited drift\n' >> "$f/.gitlab-ci.yml"

  run_check "$f"
  expect_exit 1 "S4: drifted .gitlab-ci.yml fails closed"
  expect_in err "(gitlab)"             "S4: names the gitlab platform"
  expect_in err "build-ci.sh --check"  "S4: surfaces the composed build-ci.sh --check"
}

# ---------------------------------------------------------------------------
# S5 — An engine omits a portable capability → cross-engine parity (R6).
# Removing check-agents-size from GHA leaves GitLab exhibiting it: Arm 3 flags
# the github-actions omission (Arm 2 stays green — ci/ and .gitlab-ci.yml are
# untouched, so build-ci.sh --check still passes).
# ---------------------------------------------------------------------------
{
  f="$(make_fixture)"
  yq -i 'del(.jobs.check-agents-size)' "$f/.github/workflows/build.yml"

  run_check "$f"
  expect_exit 1 "S5: cross-engine portable-set mismatch fails closed"
  expect_in err "check-agents-size" "S5: names the mismatched capability"
  expect_in err "github-actions"    "S5: names the affected platform"
  expect_in err "R6"                "S5: cites the parity rule R6"
}

# ---------------------------------------------------------------------------
# S6 — An untraceable job (key != id, no fallback) → fail closed naming the job.
# ---------------------------------------------------------------------------
{
  f="$(make_fixture)"
  yq -i '.jobs."mystery" = {"runs-on": "ubuntu-latest", "steps": [{"run": "echo hi"}]}' \
    "$f/.github/workflows/build.yml"

  run_check "$f"
  expect_exit 1 "S6: untraceable job fails closed"
  expect_in err "untraceable job 'mystery'" "S6: names the untraceable job"
  expect_in err "github-actions"            "S6: names the platform"
}

# ---------------------------------------------------------------------------
# S7 — A `specific` capability with empty evidence → reference-validity (rule 3).
# ---------------------------------------------------------------------------
{
  f="$(make_fixture)"
  yq -i '(.capabilities[] | select(.id == "pages-deploy") | .exception.evidence) = ""' \
    "$f/ci/ci-capabilities.yml"

  run_check "$f"
  expect_exit 1 "S7: evidence-less engine-specific exception fails closed"
  expect_in err "pages-deploy"  "S7: names the offending capability"
  expect_in err "evidence"      "S7: names the empty evidence violation"
}

# ---------------------------------------------------------------------------
# S10a — Reference validity: an unknown trigger kind.
# ---------------------------------------------------------------------------
{
  f="$(make_fixture)"
  yq -i '(.capabilities[] | select(.id == "build") | .trigger[0].on) = "bogus"' \
    "$f/ci/ci-capabilities.yml"

  run_check "$f"
  expect_exit 1 "S10a: unknown trigger kind fails closed"
  expect_in err "build"           "S10a: names the offending capability"
  expect_in err "validity rule 2" "S10a: cites trigger-vocabulary rule 2"
}

# ---------------------------------------------------------------------------
# S10b — Reference validity: a duplicate traceability id.
# ---------------------------------------------------------------------------
{
  f="$(make_fixture)"
  yq -i '(.capabilities[] | select(.id == "lint-specs") | .id) = "build"' \
    "$f/ci/ci-capabilities.yml"

  run_check "$f"
  expect_exit 1 "S10b: duplicate id fails closed"
  expect_in err "duplicate"       "S10b: names the duplicate-id violation"
  expect_in err "validity rule 4" "S10b: cites id rule 4"
}

# ---------------------------------------------------------------------------
# S10c — Reference validity: a portable capability without a command.
# ---------------------------------------------------------------------------
{
  f="$(make_fixture)"
  yq -i 'del(.capabilities[] | select(.id == "build") | .command)' \
    "$f/ci/ci-capabilities.yml"

  run_check "$f"
  expect_exit 1 "S10c: portable-without-command fails closed"
  expect_in err "build"           "S10c: names the offending capability"
  expect_in err "validity rule 5" "S10c: cites command rule 5"
}

# ---------------------------------------------------------------------------
# S10d — Reference validity: a portable command needs a tool it does not declare.
# ---------------------------------------------------------------------------
{
  f="$(make_fixture)"
  # `build` declares runtime node@22 but no tools; add a jq invocation.
  yq -i '(.capabilities[] | select(.id == "build") | .command) += ["jq ."]' \
    "$f/ci/ci-capabilities.yml"

  run_check "$f"
  expect_exit 1 "S10d: portable-with-unmet-requirement fails closed"
  expect_in err "jq"              "S10d: names the undeclared tool"
  expect_in err "validity rule 6" "S10d: cites requirement rule 6"
}

# ---------------------------------------------------------------------------
# R4d — Missing fetch-depth: 0 where the capability requires history-depth: full.
# ---------------------------------------------------------------------------
{
  f="$(make_fixture)"
  # check-skill-versions GHA job step[0] is the checkout carrying fetch-depth: 0.
  yq -i 'del(.jobs.check-skill-versions.steps[0].with)' \
    "$f/.github/workflows/build.yml"

  run_check "$f"
  expect_exit 1 "R4d: missing full-history checkout fails closed"
  expect_in err "check-skill-versions" "R4d: names the capability"
  expect_in err "fetch-depth"          "R4d: names the unmet history-depth requirement"
}

# ---------------------------------------------------------------------------
# R4t — Missing tool install (yq) for a capability that requires it.
# ---------------------------------------------------------------------------
{
  f="$(make_fixture)"
  # check-feedback-routing GHA job step[1] is the "Install yq" recipe.
  yq -i 'del(.jobs.check-feedback-routing.steps[1])' \
    "$f/.github/workflows/build.yml"

  run_check "$f"
  expect_exit 1 "R4t: missing tool install fails closed"
  expect_in err "check-feedback-routing" "R4t: names the capability"
  expect_in err "requires tool 'yq'"     "R4t: names the unmet tool requirement"
}

# ---------------------------------------------------------------------------
# R4r — Wrong runtime version (node-version) versus the declared runtime.
# ---------------------------------------------------------------------------
{
  f="$(make_fixture)"
  # build requires node@22; downgrade the setup-node version to 20.
  yq -i '(.jobs.build.steps[1].with.node-version) = 20' \
    "$f/.github/workflows/build.yml"

  run_check "$f"
  expect_exit 1 "R4r: wrong runtime version fails closed"
  expect_in err "capability 'build' (github-actions)" "R4r: names capability + platform"
  expect_in err "node"                                "R4r: names the runtime mismatch"
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
total=$((pass + fail))
echo ""
echo "Results: $pass/$total passed"
[ "$fail" -eq 0 ] && exit 0 || exit 1
