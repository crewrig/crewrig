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
#     P5   GHA preinstalled-tool exemption: a capability requiring `git` (or
#          `diff`) is not flagged even with no setup step installing it —
#          ubuntu-latest ships both (issue #1216).
#     P6   `python3` tool requirement satisfied by `actions/setup-python`
#          alone (no explicit apt-get install needed) — issue #1216.
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
#     S12  Negative twin of P6: `python3` required, no setup-python AND no
#          explicit install → still fails closed (guards against
#          over-exemption — issue #1216).
#
#   Stray-scan wiring (spec 0170 delta-01 R16): the parity unwrap strips only
#   the generated cache layer, never the `--stray-scan` wrapper.
#     SC1  A step equal to the declared scanned command passes, bare
#          (usage-pricing) and inside a cache layer (docs-index).
#     SC2  A bare step missing the scan fails, naming capability + platform.
#     SC3  A cache-layer step missing the scan fails the same way.
#
#   GitHub path filters (spec 0049 delta-01 R12-R21; the executable form of
#   R21). ONE GHA-only fixture carries ~30 capability-scoped mutations, each on
#   a distinct capability, applied with one `yq -i` per file and checked by ONE
#   harness run (R22: the self-test must stay within 1.20x of its baseline).
#   Assertions are per capability (block_of / expect_side), plus a global count
#   of the expected failures so a pass row that printed something, or a
#   mutation that tripped an unrelated check, is caught.
#     FX1-FX6   Divergence, both shapes: entry only in the reference / only on
#               the GitHub side (two lists, R18), per-event mismatch on a
#               dedicated workflow, in-job filter facing differing reference
#               triggers, `dir/**` vs `dir/**/*` (R13).
#     FX7-FX10  Exclusions on the GitHub side (R16): a `!` entry (in-job and
#               dedicated), `paths-ignore` (dedicated and in-job shape).
#     FX11-FX17 Triggers that differ, filtered vs unfiltered in both
#               directions, event declared with `paths` on one side only in
#               both directions, no comparable reference trigger.
#     UX1-UX9   Fail closed (R17): two filter steps, two named filters, a
#               filter not named after the capability, a non-list value, a
#               non-string entry, a filters text that is not a mapping, an
#               in-job filter plus workflow-level `paths`, a malformed
#               reference `paths`, a filters text that is not valid YAML.
#     PF1-PF5   Passing verdicts: absent vs unfiltered event (both ways),
#               reordered/repeated/requoted entries (both shapes), `branches`
#               not compared (R19), an in-job filter facing a capability with
#               no `push` trigger (the s2-F1 decision).
#     P1        also asserts its stdout is unchanged (R18, R24); P4b also
#               asserts the comparison is skipped without `.github/` (R20).
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
  if grep -qF "$needle" <<< "$hay"; then
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
  if grep -qF "$needle" <<< "$hay"; then
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

  # R18/R24: the path-filter comparison adds nothing to the success reporting.
  if [ "$CHECK_STDOUT" = "OK: reference, GitHub Actions, GitLab agree on the portable capability set; every pipeline job is traceable." ]; then
    ok "P1: stdout is exactly the unchanged OK line"
  else
    ko "P1: stdout differs from the unchanged OK line"
    echo "      out: $CHECK_STDOUT"
  fi

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
  refute_in err "path filters diverge" "P4b: path-filter comparison skipped without .github/ (R20)"
}

# ---------------------------------------------------------------------------
# P5 — GHA preinstalled-tool exemption: `git` and `diff` are not flagged even
# with no setup step installing them (ubuntu-latest ships both). GitLab has no
# install recipe for either yet (delta-02 Scenario 2), so this arm is exercised
# GHA-only (no .gitlab-ci.yml in the fixture) — otherwise Arm 2 would fail on
# the unrelated, expected "no GitLab install recipe" error.
# ---------------------------------------------------------------------------
{
  f="$(make_fixture)"
  rm -f "$f/.gitlab-ci.yml"
  yq -i '(.capabilities[] | select(.id == "check-agents-size") | .requires.tools) = ["git"]' \
    "$f/ci/ci-capabilities.yml"

  run_check "$f"
  expect_exit 0 "P5a: 'git' tool requirement is not flagged on GitHub Actions"
  refute_in err "requires tool 'git'" "P5a: no false-positive drift for git"
}
{
  f="$(make_fixture)"
  rm -f "$f/.gitlab-ci.yml"
  yq -i '(.capabilities[] | select(.id == "check-agents-size") | .requires.tools) = ["diff"]' \
    "$f/ci/ci-capabilities.yml"

  run_check "$f"
  expect_exit 0 "P5b: 'diff' tool requirement is not flagged on GitHub Actions"
  refute_in err "requires tool 'diff'" "P5b: no false-positive drift for diff"
}

# ---------------------------------------------------------------------------
# P6 — `python3` tool requirement satisfied by `actions/setup-python` alone.
# figure-labels declares `requires.tools: [tesseract, python3]`; its GHA job
# step[3] is the "Install python3" apt-get recipe — swap it for a bare
# `actions/setup-python@v5` step (no explicit apt-get install) and confirm the
# tool requirement still resolves.
# ---------------------------------------------------------------------------
{
  f="$(make_fixture)"
  yq -i '.jobs."figure-labels".steps[3] = {"name": "Set up Python", "uses": "actions/setup-python@v5", "with": {"python-version": "3.12"}}' \
    "$f/.github/workflows/build.yml"

  run_check "$f"
  expect_exit 0 "P6: python3 requirement satisfied by actions/setup-python"
  refute_in err "requires tool 'python3'" "P6: no false-positive drift for python3"
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
# S12 — Negative twin of P6: `python3` required, but the job has NEITHER
# actions/setup-python NOR an explicit apt-get install → still fails closed.
# Regression guard against turning the P6 fix into an unconditional exemption.
# ---------------------------------------------------------------------------
{
  f="$(make_fixture)"
  yq -i 'del(.jobs."figure-labels".steps[3])' \
    "$f/.github/workflows/build.yml"

  run_check "$f"
  expect_exit 1 "S12: python3 requirement still fails closed with no setup step"
  expect_in err "figure-labels"          "S12: names the capability"
  expect_in err "requires tool 'python3'" "S12: names the unmet tool requirement"
}

# ---------------------------------------------------------------------------
# S10e — Reference validity: env must be a key-value mapping (spec 0131).
# ---------------------------------------------------------------------------
{
  f="$(make_fixture)"
  yq -i '(.capabilities[] | select(.id == "build") | .env) = "invalid-string"' \
    "$f/ci/ci-capabilities.yml"

  run_check "$f"
  expect_exit 1 "S10e: invalid env schema fails closed"
  expect_in err "build" "S10e: names the capability"
  expect_in err "env must be a key-value mapping" "S10e: names the env mapping violation"
}

# ---------------------------------------------------------------------------
# S11 — Env block divergence (spec 0131): GHA defines an undeclared env variable.
# ---------------------------------------------------------------------------
{
  f="$(make_fixture)"
  yq -i '(.jobs.build.env.UNEXPECTED_VAR) = "val"' \
    "$f/.github/workflows/build.yml"

  run_check "$f"
  expect_exit 1 "S11: GHA env block divergence fails closed"
  expect_in err "capability 'build' (github-actions)" "S11: names capability + platform"
  expect_in err "UNEXPECTED_VAR"                     "S11: names the divergent env variable"
}

# ---------------------------------------------------------------------------
# C1 — Cached capability: GHA cache key inputs must agree with the reference
# cache.files (spec 0147 R6/R7). A divergence fails closed naming the capability.
# ---------------------------------------------------------------------------
{
  f="$(make_fixture)"
  # Drift the ci-parity job's actions/cache key so its hashFiles(...) inputs no
  # longer match the reference cache.files.
  yq -i '(.jobs."ci-parity".steps[] | select(.uses == "actions/cache@v4") | .with.key) = "${{ hashFiles('"'"'scripts/check-ci-parity.sh'"'"') }}"' \
    "$f/.github/workflows/build.yml"

  run_check "$f"
  expect_exit 1 "C1: cache key input divergence fails closed"
  expect_in err "capability 'ci-parity' (github-actions)" "C1: names the capability"
  expect_in err "cache key inputs diverge"                "C1: names the R6 divergence"
}

# ---------------------------------------------------------------------------
# SC — Stray-scan wiring (spec 0170 delta-01 R16, issue #1445). A registered
# suite command is declared in the SCANNED form
#   bash scripts/ci-cache-guard.sh --stray-scan -- bash scripts/tests/<suite>
# The parity unwrap strips only the generated cache layer
# (`bash scripts/ci-cache-guard.sh --cache-dir ... -- `), never the scan, so
# the scan is part of what a GitHub step must exhibit.
#   SC1  the step equals the declared scanned command, BARE (usage-pricing) and
#        INSIDE a generated cache layer (docs-index): both pass.
#   SC2  a bare step missing the scan fails, naming capability and platform.
#   SC3  a step inside a cache layer missing the scan fails the same way.
# ---------------------------------------------------------------------------
SCAN_PREFIX="bash scripts/ci-cache-guard.sh --stray-scan -- "
{
  f="$(make_fixture)"
  want_bare="$(yq -r '.capabilities[] | select(.id == "usage-pricing") | .command[-1]' "$f/ci/ci-capabilities.yml")"
  want_layered="$(yq -r '.capabilities[] | select(.id == "docs-index") | .command[-1]' "$f/ci/ci-capabilities.yml")"
  got_bare="$(yq -r '.jobs."usage-pricing".steps[] | select((.run // "") | test("test-usage-pricing")) | .run' "$f/.github/workflows/usage-pricing.yml")"
  got_layered="$(yq -r '.jobs."docs-index".steps[] | select((.run // "") | test("test-build-docs-index")) | .run' "$f/.github/workflows/build.yml")"

  # Preconditions: the reference declares the scanned form, and the two
  # fixture steps are its bare and its layered exhibition.
  case "$want_bare" in "$SCAN_PREFIX"*) ok "SC1: usage-pricing declares the scanned form" ;; *) ko "SC1: usage-pricing command is not scanned: '$want_bare'" ;; esac
  case "$want_layered" in "$SCAN_PREFIX"*) ok "SC1: docs-index declares the scanned form" ;; *) ko "SC1: docs-index command is not scanned: '$want_layered'" ;; esac
  if [ "$got_bare" = "$want_bare" ]; then
    ok "SC1: the usage-pricing step is the declared scanned command, bare"
  else
    ko "SC1: usage-pricing step is not the declared command (got '$got_bare', want '$want_bare')"
  fi
  case "$got_layered" in
    "bash scripts/ci-cache-guard.sh --cache-dir "*" -- $want_layered") ok "SC1: the docs-index step is the declared scanned command inside a cache layer" ;;
    *) ko "SC1: docs-index step is not a cache layer around the declared command (got '$got_layered')" ;;
  esac

  run_check "$f"
  expect_exit 0 "SC1: scanned steps, bare and layered, pass"
  refute_in err "capability 'usage-pricing' (github-actions)" "SC1: no drift on the bare scanned step"
  refute_in err "capability 'docs-index' (github-actions)"    "SC1: no drift on the layered scanned step"
}
{
  f="$(make_fixture)"
  yq -i '(.jobs."usage-pricing".steps[] | select((.run // "") | test("stray-scan")) | .run) = "bash scripts/tests/test-usage-pricing.sh"' \
    "$f/.github/workflows/usage-pricing.yml"

  run_check "$f"
  expect_exit 1 "SC2: a bare step missing the scan fails closed"
  expect_in err "capability 'usage-pricing' (github-actions)" "SC2: names capability + platform"
  expect_in err "unexpected step: 'bash scripts/tests/test-usage-pricing.sh'" "SC2: names the unscanned step"
}
{
  f="$(make_fixture)"
  yq -i '(.jobs."docs-index".steps[] | select((.run // "") | test("stray-scan")) | .run) |= sub(" -- bash scripts/ci-cache-guard.sh --stray-scan -- ", " -- ")' \
    "$f/.github/workflows/build.yml"

  run_check "$f"
  expect_exit 1 "SC3: a layered step missing the scan fails closed"
  expect_in err "capability 'docs-index' (github-actions)" "SC3: names capability + platform"
  expect_in err "unexpected step: 'bash scripts/tests/test-build-docs-index.sh'" "SC3: names the unscanned step"
}

# ===========================================================================
# GitHub path filters (spec 0049 delta-01, R12-R21)
#
# One GHA-only fixture (no .gitlab-ci.yml: the reference edits below would
# otherwise add an unrelated Arm 2 failure, same precedent as P5/P6), one
# mutation per capability, edits batched to ONE `yq -i` per file, ONE harness
# run, then per-capability assertions. A workflow file is only touched through
# the job (or `on:` of the dedicated workflow) of the capability under test: an
# `on:` edit of build.yml would taint all 23 in-job capabilities at once.
# ===========================================================================

# block_of <capability> <fragment> — the failure block of one capability: the
# `  DRIFT:` header line that names the capability and holds the fragment, plus
# the indented lines that follow it, up to the next header (R18 message shape).
block_of() {
  printf '%s\n' "$CHECK_STDERR" | awk -v cap="capability '$1' (" -v frag="$2" '
    /^  DRIFT: / { on = (index($0, cap) > 0 && index($0, frag) > 0) }
    !/^  DRIFT: / && !/^    / { on = 0 }
    on { print }'
}

# need_block <capability> <fragment> <label> — assert the block exists; the
# block text is left in BLK for the assertions that follow.
need_block() {
  BLK="$(block_of "$1" "$2")"
  if [ -n "$BLK" ]; then
    ok "$3"
  else
    ko "$3: no DRIFT block for capability '$1' holding '$2'"
  fi
}

# expect_in_block <block> <substring> <label> / refute_in_block
expect_in_block() {
  if grep -qF -- "$2" <<< "$1"; then ok "$3"; else ko "$3: block missing '$2'"; echo "      block: $1"; fi
}
refute_in_block() {
  if grep -qF -- "$2" <<< "$1"; then ko "$3: block unexpectedly holds '$2'"; echo "      block: $1"; else ok "$3"; fi
}

# sorted <list> — the non-empty lines of a newline-joined list, sorted.
sorted() { printf '%s\n' "$1" | awk 'NF' | sort; }

# block_side <block> <ref|gh> — the entries of one labelled list of a block.
block_side() {
  printf '%s\n' "$1" | awk -v side="$2" '
    /^    only in the reference:/ { s = "ref"; next }
    /^    only on the GitHub side:/ { s = "gh"; next }
    s == side && /^      - / { sub(/^      - /, ""); print }' | sort
}

# expect_side <block> <ref|gh> <label> <expected-entries> — the labelled list
# equals the expected entries as a set (empty expectation = the list is empty).
expect_side() {
  local got want
  if [ -z "$1" ]; then ko "$3: block missing"; return; fi
  got="$(block_side "$1" "$2")"
  want="$(sorted "$4")"
  if [ "$got" = "$want" ]; then
    ok "$3"
  else
    ko "$3: expected [$(printf '%s' "$want" | tr '\n' ' ')], got [$(printf '%s' "$got" | tr '\n' ' ')]"
  fi
}

# expect_nblocks <capability> <n> <label> — the capability has exactly n
# path-filter divergence blocks (R18: one block per mismatch).
expect_nblocks() {
  local n
  n="$(grep -cF "capability '$1' (github-actions): path filters diverge on" <<< "$CHECK_STDERR")"
  if [ "$n" -eq "$2" ]; then ok "$3"; else ko "$3: expected $2 divergence block(s), got $n"; fi
}

# ref_paths <capability> <trigger-kind> — the reference `paths` of the REAL
# (unmutated) tree, one per line; the matrix derives its expected lists from it
# so a later edit of a capability's paths does not break the self-test.
ref_paths() {
  yq -r "(.capabilities[] | select(.id == \"$1\") | .trigger[] | select(.on == \"$2\") | .paths[])" \
    "$REPO_ROOT/ci/ci-capabilities.yml"
}

# filters_of <job> — yq path of the embedded `with.filters` text of the
# dorny/paths-filter step of a build.yml job.
filters_of() {
  printf '(.jobs."%s".steps[] | select((.uses // "") | test("^dorny/paths-filter@")) | .with.filters)' "$1"
}
# cap_of <capability> — yq path of one reference capability.
cap_of() { printf '(.capabilities[] | select(.id == "%s")' "$1"; }

{
  f="$(make_fixture)"
  rm -f "$f/.gitlab-ci.yml"
  wf="$f/.github/workflows"
  want_drift=0
  fails_before=$fail

  # --- Reference side: one `yq -i`, rows keyed by capability id -------------
  rx=''
  # FX1  in-job   figure-labels: an entry only in the reference, on both triggers
  rx+="$(cap_of figure-labels) | .trigger[].paths) += [\"zz/ref-only/**\"]"
  # FX2  in-job   docs-index: 1 entry only in the reference (pull-request), 2 only in the filter
  rx+=" | $(cap_of docs-index) | .trigger[] | select(.on == \"pull-request\") | .paths) += [\"zz/c/**\"]"
  # FX3  dedic.   usage-storage: pull-request trigger gains an entry the workflow lacks
  rx+=" | $(cap_of usage-storage) | .trigger[] | select(.on == \"pull-request\") | .paths) += [\"zz/d/**\"]"
  # FX5  in-job   markdown-links: a different spelling of the same glob (R13)
  rx+=" | $(cap_of markdown-links) | .trigger[].paths[] | select(. == \"docs/**\")) = \"docs/**/*\""
  # FX11 in-job   check-model-mappings: only the push trigger differs
  rx+=" | $(cap_of check-model-mappings) | .trigger[] | select(.on == \"push\") | .paths) += [\"zz/p/**\"]"
  # FX12 in-job   mempalace: reference unfiltered, the in-job filter lists globs
  rx+=" | del($(cap_of mempalace) | .trigger[].paths))"
  # FX14 dedic.   windows-hook-probe: reference unfiltered, the workflow lists globs
  rx+=" | del($(cap_of windows-hook-probe) | .trigger[].paths))"
  # FX16 dedic.   audit: a reference push trigger with paths, a workflow with no push event
  rx+=" | $(cap_of audit) | .trigger) += [{\"on\": \"push\", \"paths\": [\"zz/g/**\"]}]"
  # FX17 in-job   extension-manifest: no comparable reference trigger at all
  rx+=" | $(cap_of extension-manifest) | .trigger) = [{\"on\": \"manual\"}]"
  # UX8  reference e2e: pull-request paths is a scalar
  rx+=" | $(cap_of e2e) | .trigger[] | select(.on == \"pull-request\") | .paths) = \"x\""
  # PF4  usage-pricing: branches differ on both sides (R19), path sets equal
  rx+=" | $(cap_of usage-pricing) | .trigger[].branches) = [\"zz-ref\"]"
  # PF5  ci-parity: in-job, no push trigger in the reference (the s2-F1 decision)
  rx+=" | del($(cap_of ci-parity) | .trigger[] | select(.on == \"push\")))"
  yq -i "$rx" "$f/ci/ci-capabilities.yml"

  # --- build.yml: in-job filters, edited through their job text only --------
  bx=''
  # FX2  docs-index: two entries only in the filter
  bx+="$(filters_of docs-index)"' += "  - zz/a/**\n  - zz/b/**\n"'
  # FX7  frontmatter: a negated entry in the filter
  bx+=' | '"$(filters_of frontmatter)"' += "  - \"!zz/neg/**\"\n"'
  # FX13 chroma-mcp: the filter step is deleted (unfiltered job, filtered reference)
  bx+=' | del(.jobs."chroma-mcp".steps[] | select((.uses // "") | test("^dorny/paths-filter@")))'
  # UX1  setup: a second path-filter step
  bx+=' | .jobs.setup.steps += [{"uses": "dorny/paths-filter@v3", "id": "filter2", "with": {"filters": "setup:\n  - zz/s/**\n"}}]'
  # UX2  check-agent-profiles: a second named filter
  bx+=' | '"$(filters_of check-agent-profiles)"' += "other-filter:\n  - zz/o/**\n"'
  # UX3  check-metadata-keys: the only filter is not named after the capability
  bx+=' | '"$(filters_of check-metadata-keys)"' |= sub("^check-metadata-keys:"; "other-name:")'
  # UX4  check-claude-agent-layout: the filter value is a scalar
  bx+=' | '"$(filters_of check-claude-agent-layout)"' = "check-claude-agent-layout: zz/x/**\n"'
  # UX5  core-paths: entries that are not strings
  bx+=' | '"$(filters_of core-paths)"' = "core-paths:\n  - 1\n  - true\n"'
  # UX6  extension-provenance: the filters text is a file name, not a mapping
  bx+=' | '"$(filters_of extension-provenance)"' = ".github/filters.yml"'
  # UX9  test-wiring: the filters text is not valid YAML
  bx+=' | '"$(filters_of test-wiring)"' = "test-wiring: [unclosed\n"'
  # PF3  extension-install: filter reversed, one entry repeated, quotes changed
  bx+=' | '"$(filters_of extension-install)"' |= ([split("\n") | .[] | select(length > 0)] | . as $l | ($l[0:1] + ($l[1:] | reverse) + [$l[1]]) | join("\n") + "\n" | sub("\x27"; "\""))'
  yq -i "$bx" "$wf/build.yml"

  # --- Dedicated workflows: one `yq -i` each --------------------------------
  # FX4  usage-capture: push gains an entry the reference lacks
  yq -i '.on.push.paths += ["zz/e/**"]' "$wf/usage-capture.yml"
  # FX6  release-notes: a different spelling of the same glob (R13), pull_request only
  yq -i '(.on.pull_request.paths[] | select(. == "scripts/lib/release-notes/**")) = "scripts/lib/release-notes/**/*"' \
    "$wf/release-notes.yml"
  # FX8  usage-attribution: a negated entry under pull_request
  yq -i '.on.pull_request.paths += ["!zz/neg/**"]' "$wf/usage-attribution.yml"
  # FX9  usage-dashboard: a push paths-ignore (an exclusion the reference cannot express)
  yq -i '.on.push."paths-ignore" = ["docs/**"]' "$wf/usage-dashboard.yml"
  # FX10 ticket-pickup: reshaped to an in-job filter equal to the reference, with a
  #      push paths-ignore (the workflow keeps no `paths`, so R17 does not apply)
  TP_FILTERS="ticket-pickup:"$'\n'"$(ref_paths ticket-pickup pull-request | sed 's/.*/  - "&"/')"$'\n'
  TP_FILTERS="$TP_FILTERS" yq -i '
    del(.on.pull_request.paths) | del(.on.push.paths)
    | .on.push."paths-ignore" = ["docs/**"]
    | .jobs."ticket-pickup".steps = [{"uses": "dorny/paths-filter@v3", "id": "filter", "with": {"filters": strenv(TP_FILTERS)}}] + .jobs."ticket-pickup".steps' \
    "$wf/ticket-pickup.yml"
  # FX15 grep-anti-patterns: the workflow filters push, the reference has no push trigger
  yq -i '.on.push.paths = ["zz/f/**"]' "$wf/scripting-conventions.yml"
  # UX7  usage-record-schema: an in-job filter added to a workflow that has on.*.paths
  yq -i '.jobs."usage-record-schema".steps += [{"uses": "dorny/paths-filter@v3", "id": "filter", "with": {"filters": "usage-record-schema:\n  - zz/r/**\n"}}]' \
    "$wf/usage-record-schema.yml"
  # PF1a release: reference push trigger without paths, workflow with no push event
  yq -i 'del(.on.push)' "$wf/release-monorepo.yml"
  # PF1b release-rehearsal: events declared without a filter (a null body and a
  #      branches-only body), the reference has neither trigger
  yq -i '.on.pull_request = null | .on.push.branches = ["main"]' "$wf/release-rehearsal.yml"
  # PF2  release-tests: reversed, first entry repeated, quotes mixed (single, plain, double)
  yq -i '.on.pull_request.paths |= (. as $p | ($p | reverse) + [$p[0]])
    | .on.pull_request.paths[0] style="single"
    | .on.pull_request.paths[1] style=""
    | .on.pull_request.paths[2] style="double"' "$wf/release-tests.yml"
  # PF4  usage-pricing: branches differ from the reference (R19)
  yq -i '.on.pull_request.branches = ["zz-gh"] | .on.push.branches = ["zz-gh"]' "$wf/usage-pricing.yml"

  run_check "$f"

  expect_exit 1 "PF matrix: the mutated tree fails closed (not a desynchronised stream)"

  # --- FX1-FX6: divergence in both shapes (R12-R15, R18) --------------------
  need_block figure-labels "in-job filter, reference trigger 'pull-request'" "FX1: in-job, pull-request block"
  expect_side "$BLK" ref "FX1: pull-request block lists the reference-only entry" "zz/ref-only/**"
  expect_side "$BLK" gh  "FX1: pull-request block GitHub-only list is empty" ""
  need_block figure-labels "in-job filter, reference trigger 'push'" "FX1: in-job, push block"
  expect_side "$BLK" ref "FX1: push block lists the reference-only entry" "zz/ref-only/**"
  expect_nblocks figure-labels 2 "FX1: one block per compared trigger, no more"
  want_drift=$((want_drift + 2))

  need_block docs-index "in-job filter, reference trigger 'pull-request'" "FX2: in-job, pull-request block"
  expect_in_block "$BLK" "(github-actions)" "FX2: block names the GitHub platform"
  expect_in_block "$BLK" "only in the reference:"    "FX2: block labels the reference-only list"
  expect_in_block "$BLK" "only on the GitHub side:"  "FX2: block labels the GitHub-only list"
  expect_side "$BLK" ref "FX2: one reference-only entry" "zz/c/**"
  expect_side "$BLK" gh  "FX2: two GitHub-only entries"  "zz/a/**
zz/b/**"
  need_block docs-index "in-job filter, reference trigger 'push'" "FX2: the unchanged push trigger also diverges (event-agnostic filter)"
  expect_side "$BLK" ref "FX2: push block reference-only list is empty" ""
  expect_nblocks docs-index 2 "FX2: two blocks"
  want_drift=$((want_drift + 2))

  need_block usage-storage "event 'pull_request'" "FX3: dedicated workflow, pull_request block"
  expect_in_block "$BLK" "reference trigger 'pull-request'" "FX3: names the reference trigger compared"
  expect_side "$BLK" ref "FX3: reference-only entry" "zz/d/**"
  expect_side "$BLK" gh  "FX3: GitHub-only list is empty" ""
  expect_nblocks usage-storage 1 "FX3: event-specific, no block for push"
  want_drift=$((want_drift + 1))

  need_block usage-capture "event 'push'" "FX4: dedicated workflow, push block"
  expect_in_block "$BLK" "reference trigger 'push'" "FX4: names the reference trigger compared"
  expect_side "$BLK" gh  "FX4: GitHub-only entry" "zz/e/**"
  expect_side "$BLK" ref "FX4: reference-only list is empty" ""
  expect_nblocks usage-capture 1 "FX4: event-specific, no block for pull_request"
  want_drift=$((want_drift + 1))

  need_block markdown-links "in-job filter, reference trigger 'pull-request'" "FX5: in-job, pull-request block"
  expect_side "$BLK" ref "FX5: reference-only spelling" "docs/**/*"
  expect_side "$BLK" gh  "FX5: GitHub-only spelling"    "docs/**"
  expect_nblocks markdown-links 2 "FX5: both triggers diverge"
  want_drift=$((want_drift + 2))

  need_block release-notes "event 'pull_request'" "FX6: dedicated workflow, pull_request block"
  expect_side "$BLK" ref "FX6: reference-only spelling" "scripts/lib/release-notes/**"
  expect_side "$BLK" gh  "FX6: GitHub-only spelling"    "scripts/lib/release-notes/**/*"
  expect_nblocks release-notes 1 "FX6: push is unchanged, no block for it"
  want_drift=$((want_drift + 1))

  # --- FX7-FX10: exclusions the reference cannot express (R16) --------------
  need_block frontmatter "negated entries" "FX7: in-job negation reported"
  expect_in_block "$BLK" "- !zz/neg/**" "FX7: names the negated entry"
  expect_nblocks frontmatter 0 "FX7: the rest of the filter is still compared (equal, one defect = one message)"
  want_drift=$((want_drift + 1))

  need_block usage-attribution "negated entries" "FX8: dedicated negation reported"
  expect_in_block "$BLK" "event 'pull_request'" "FX8: names the event"
  expect_in_block "$BLK" "- !zz/neg/**"         "FX8: names the negated entry"
  expect_nblocks usage-attribution 0 "FX8: the rest of the event is still compared (equal, one defect = one message)"
  want_drift=$((want_drift + 1))

  need_block usage-dashboard "declares paths-ignore" "FX9: paths-ignore reported"
  expect_in_block "$BLK" "event 'push'" "FX9: names the event"
  expect_in_block "$BLK" "- docs/**"    "FX9: names the ignored entry"
  expect_nblocks usage-dashboard 0 "FX9: no set divergence besides the exclusion"
  want_drift=$((want_drift + 1))

  need_block ticket-pickup "declares paths-ignore" "FX10: paths-ignore reported for an in-job capability"
  expect_in_block "$BLK" "- docs/**" "FX10: names the ignored entry"
  expect_nblocks ticket-pickup 0 "FX10: in-job list equals the reference, no set divergence"
  want_drift=$((want_drift + 1))

  # --- FX11-FX17: triggers, filtered vs unfiltered, absent events -----------
  need_block check-model-mappings "in-job filter, reference trigger 'push'" "FX11: in-job filter cannot match differing triggers"
  expect_side "$BLK" ref "FX11: reference-only entry" "zz/p/**"
  expect_side "$BLK" gh  "FX11: GitHub-only list is empty" ""
  expect_nblocks check-model-mappings 1 "FX11: the unchanged pull-request trigger matches"
  want_drift=$((want_drift + 1))

  need_block mempalace "in-job filter, reference trigger 'pull-request'" "FX12: unfiltered reference vs filtered job"
  expect_side "$BLK" gh  "FX12: pull-request block lists the filter" "$(ref_paths mempalace pull-request)"
  expect_side "$BLK" ref "FX12: pull-request block reference-only list is empty" ""
  expect_nblocks mempalace 2 "FX12: one block per trigger"
  want_drift=$((want_drift + 2))

  need_block chroma-mcp "event 'pull_request'" "FX13: filtered reference vs unfiltered job (pull_request)"
  expect_side "$BLK" ref "FX13: pull_request block lists the reference paths" "$(ref_paths chroma-mcp pull-request)"
  expect_side "$BLK" gh  "FX13: pull_request block GitHub-only list is empty" ""
  need_block chroma-mcp "event 'push'" "FX13: filtered reference vs unfiltered job (push)"
  expect_side "$BLK" ref "FX13: push block lists the reference paths" "$(ref_paths chroma-mcp push)"
  want_drift=$((want_drift + 2))

  need_block windows-hook-probe "event 'pull_request'" "FX14: unfiltered reference vs filtered workflow (pull_request)"
  expect_side "$BLK" gh  "FX14: pull_request block lists the workflow paths" "$(ref_paths windows-hook-probe pull-request)"
  expect_side "$BLK" ref "FX14: pull_request block reference-only list is empty" ""
  need_block windows-hook-probe "event 'push'" "FX14: unfiltered reference vs filtered workflow (push)"
  expect_nblocks windows-hook-probe 2 "FX14: one block per event"
  want_drift=$((want_drift + 2))

  need_block grep-anti-patterns "event 'push'" "FX15: workflow filters push, reference has no push trigger"
  expect_in_block "$BLK" "no reference 'push' trigger" "FX15: says the reference has no push trigger"
  expect_side "$BLK" gh  "FX15: GitHub-only entry" "zz/f/**"
  expect_side "$BLK" ref "FX15: reference-only list is empty" ""
  expect_nblocks grep-anti-patterns 1 "FX15: pull_request agrees"
  want_drift=$((want_drift + 1))

  need_block audit "event 'push'" "FX16: reference push trigger with paths, workflow without push"
  expect_in_block "$BLK" "reference trigger 'push'" "FX16: names the reference trigger"
  expect_side "$BLK" ref "FX16: reference-only entry" "zz/g/**"
  expect_side "$BLK" gh  "FX16: GitHub-only list is empty" ""
  expect_nblocks audit 1 "FX16: pull_request agrees"
  want_drift=$((want_drift + 1))

  need_block extension-manifest "in-job filter, no comparable reference trigger" "FX17: in-job filter without comparable trigger"
  expect_side "$BLK" gh  "FX17: GitHub-only lists the filter" "$(ref_paths extension-manifest pull-request)"
  expect_side "$BLK" ref "FX17: reference-only list is empty" ""
  expect_nblocks extension-manifest 1 "FX17: compared once with the empty set"
  want_drift=$((want_drift + 1))

  # --- UX1-UX9: a filter that cannot be determined fails closed (R17) -------
  undet() { # <capability> <cause fragment> <label>
    need_block "$1" "cannot be determined" "$3: reported as undeterminable (R17)"
    expect_in_block "$BLK" "$2" "$3: names the cause"
    expect_nblocks "$1" 0 "$3: not compared afterwards, not treated as unfiltered"
    want_drift=$((want_drift + 1))
  }
  undet setup                    "carries 2 path-filter steps"                   "UX1"
  undet check-agent-profiles     "2 named filters"                               "UX2"
  undet check-metadata-keys      "defines only the filter 'other-name'"          "UX3"
  undet check-claude-agent-layout "not a list of strings"                        "UX4"
  undet core-paths               "not a list of strings"                         "UX5"
  undet extension-provenance     "not a mapping of named lists"                  "UX6"
  undet usage-record-schema      "also declares paths under 'pull_request'"      "UX7"
  undet test-wiring              "filters text is not valid YAML"                "UX9"
  need_block e2e "not a list" "UX8: malformed reference paths reported"
  expect_in_block "$BLK" "(reference)" "UX8: attributed to the reference"
  expect_nblocks e2e 0 "UX8: not compared afterwards"
  want_drift=$((want_drift + 1))

  # --- PF1-PF5: passing verdicts print nothing -------------------------------
  refute_in err "capability 'release' "           "PF1a: absent push event vs reference push trigger without paths agrees"
  refute_in err "capability 'release-rehearsal' " "PF1b: events declared without a filter vs no reference trigger agree"
  refute_in err "capability 'release-tests' "     "PF2: reordered, repeated, requoted workflow entries agree (dedicated)"
  refute_in err "capability 'extension-install' " "PF3: reordered, repeated, requoted filter entries agree (in-job)"
  refute_in err "capability 'usage-pricing' "     "PF4: differing branches are not compared (R19)"
  refute_in err "capability 'ci-parity' "         "PF5: in-job filter vs a capability with no push trigger agrees (s2-F1)"

  # --- Run-level: every expected block, nothing else ------------------------
  expect_in err "FAILED: $want_drift CI parity violation(s)" "PF matrix: exactly the $want_drift expected failures, no other"
  drift_lines="$(grep -c '^  DRIFT: ' <<< "$CHECK_STDERR")"
  if [ "$drift_lines" -eq "$want_drift" ]; then
    ok "PF matrix: $want_drift DRIFT blocks printed (pass rows printed none)"
  else
    ko "PF matrix: expected $want_drift DRIFT blocks, got $drift_lines"
  fi
  if [ "$fail" -gt "$fails_before" ]; then
    echo "      matrix stderr:"
    printf '%s\n' "$CHECK_STDERR" | sed 's/^/      | /'
  fi
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
total=$((pass + fail))
echo ""
echo "Results: $pass/$total passed"
[ "$fail" -eq 0 ] && exit 0 || exit 1
