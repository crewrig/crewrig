#!/bin/bash
# test-check-gemini-overlay-enrollment.sh — Regression tests for
# check-gemini-overlay-enrollment.sh (spec 0085).
#
# check-gemini-overlay-enrollment.sh is the CI guard that fails the build when a
# user-level Gemini overlay deployed by scripts/setup-gemini-interactive.sh is
# not enrolled in the `context.fileName` list of config/gemini/settings.json,
# naming the offender. This is the parity sibling mandated by the repo
# convention "every check-*.sh has a test-*.sh".
#
# Each case builds a self-contained fixture repository under a temp dir with a
# minimal setup script (deploying a known overlay set) and a settings.json
# (enrolling some subset), then runs the guard with CREWRIG_REPO_DIR pointed at
# the fixture. The guard reads plain files (not `git grep`), so the fixture need
# not be a git repo — but we mirror the sibling harness's isolation discipline.
#
# Cases:
#   a. Happy path (R7) — a fixture reproducing current `main` (all 9 overlays
#      enrolled + AGENTS.md) → exit 0 with the OK line, no AGENTS.md warning.
#   b. Failure path (R1/R9) — the pre-fix state with 65_TOOLS.md AND
#      66_ORG_RULES.md removed from context.fileName → exit 1 and BOTH named.
#   c. R3 non-regression — 30_USER_PROFILE.md (deployed indirectly via $TARGET)
#      removed from enrollment → exit 1 and it is named. Proves the deployed set
#      includes an overlay whose deploy target is a variable, not a literal
#      install_file argument.
#   d. R5 exception — AGENTS.md enrolled but not deployed → exit 0 with NO
#      warning naming AGENTS.md.
#   e. R6 reverse warning — a bogus enrolled entry (99_GHOST.md) not deployed →
#      exit 0 (non-blocking) and a warning names it.
#   f. Broadened name class (R2) — a future mixed-case overlay (67_NewTool.md)
#      deployed but not enrolled → exit 1 naming it. Proves [A-Za-z0-9_]+ catches
#      names that are not all-uppercase, so a future overlay cannot silently drop
#      out of the deployed set.
#   g. Fail-closed: a missing source file (settings absent) → exit 2.
#   h. Fail-closed: an empty deployed set (setup with zero deploy tokens) → exit 2.
#   i. Fail-closed: malformed settings JSON → exit 2.
#   j. Fail-closed: settings missing the context.fileName key → exit 2.
#   k. Boundary: context.fileName PRESENT but an empty list → exit 1 (a forward
#      failure, NOT the exit-2 malformed case) — locks the Finding-2 distinction.
#
# Usage:
#   bash scripts/tests/test-check-gemini-overlay-enrollment.sh

# -e intentionally omitted: pass/fail counters control the harness; adding -e
# would abort on expected non-zero exits from the script under test.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT_UNDER_TEST="$SCRIPT_DIR/check-gemini-overlay-enrollment.sh"

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

# make_setup_script <repo>
# Write a minimal setup script that deploys the full current-main overlay set.
# 30_USER_PROFILE.md is deployed through an intermediate $TARGET variable (as in
# the real script), and 66_ORG_RULES.md inside a conditional guard, so the
# fixture exercises the indirect-target (R3) and conditional-guard (R4) paths.
make_setup_script() {
  local repo="$1"
  mkdir -p "$repo/scripts"
  cat > "$repo/scripts/setup-gemini-interactive.sh" <<'SETUP'
#!/bin/bash
# Minimal setup fixture — reproduces the deploy shape under test.
install_file "$REPO_DIR/config/SOUL.md" "$GEMINI_HOME/00_SOUL.md" "x"
install_file "$REPO_DIR/config/level/x.md" "$GEMINI_HOME/10_USER_LEVEL.md" "x"
install_file "$REPO_DIR/config/ORGANIZATION.md" "$GEMINI_HOME/20_ORGANIZATION.md" "x"
install_file "$REPO_DIR/config/expertise/x.md" "$GEMINI_HOME/40_USER_EXPERTISE.md" "x"
install_file "$REPO_DIR/config/teams/x.md" "$GEMINI_HOME/50_USER_TEAM.md" "x"
install_file "$REPO_DIR/artifacts/core/rules/60-tools.md" "$GEMINI_HOME/60_TOOLS.md" "x"
install_file "$REPO_DIR/config/TOOLS.md" "$GEMINI_HOME/65_TOOLS.md" "x"
if [ -f "$REPO_DIR/AGENTS.org.md" ]; then
  install_file "$REPO_DIR/AGENTS.org.md" "$GEMINI_HOME/66_ORG_RULES.md" "x"
fi
# Indirect deployment target (the R3 case): the filename is bound to a variable.
TARGET="$GEMINI_HOME/30_USER_PROFILE.md"
install_file "$REPO_DIR/config/PROFILE.md" "$TARGET" "x"
SETUP
}

# make_setup_script_no_tokens <repo>
# A setup fixture with NO "$GEMINI_HOME/NN_NAME.md" deploy tokens, so the guard's
# deployed set is empty and it must fail closed (exit 2).
make_setup_script_no_tokens() {
  local repo="$1"
  mkdir -p "$repo/scripts"
  cat > "$repo/scripts/setup-gemini-interactive.sh" <<'SETUP'
#!/bin/bash
# Fixture with no overlay deploy tokens at all.
echo "nothing to deploy"
SETUP
}

# append_deploy_token <repo> <overlay-basename>
# Append one extra install_file deploy line to the fixture setup script so the
# deployed set gains <overlay-basename>. Used to exercise a future overlay whose
# name is not all-uppercase.
append_deploy_token() {
  local repo="$1" name="$2"
  printf 'install_file "$REPO_DIR/config/x.md" "$GEMINI_HOME/%s" "x"\n' \
    "$name" >> "$repo/scripts/setup-gemini-interactive.sh"
}

# make_settings <repo> <name>...
# Write config/gemini/settings.json enrolling exactly the given basenames in
# context.fileName, as a JSON array.
make_settings() {
  local repo="$1"; shift
  mkdir -p "$repo/config/gemini"
  {
    printf '{\n  "context": {\n    "fileName": [\n'
    local first=1 name
    for name in "$@"; do
      [ "$first" -eq 1 ] || printf ',\n'
      printf '      "%s"' "$name"
      first=0
    done
    printf '\n    ]\n  }\n}\n'
  } > "$repo/config/gemini/settings.json"
}

# The full current-main enrolled set (9 deployed overlays + the AGENTS.md
# exception), reused as the happy-path baseline and mutated by other cases.
MAIN_ENROLLED=(
  00_SOUL.md 10_USER_LEVEL.md 20_ORGANIZATION.md 30_USER_PROFILE.md
  40_USER_EXPERTISE.md 50_USER_TEAM.md 60_TOOLS.md 65_TOOLS.md 66_ORG_RULES.md
  AGENTS.md
)

# run_check <repo>
# Run the guard with CREWRIG_REPO_DIR set, capturing stdout, stderr, and exit
# code into CHECK_EXIT / CHECK_STDOUT / CHECK_STDERR.
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

# ---------------------------------------------------------------------------
# Case a — Happy path: full main enrollment → exit 0, OK line, no AGENTS.md warn.
# ---------------------------------------------------------------------------
{
  repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  make_setup_script "$repo"
  make_settings "$repo" ${MAIN_ENROLLED[@]+"${MAIN_ENROLLED[@]}"}

  run_check "$repo"

  if [ "$CHECK_EXIT" -eq 0 ]; then
    echo "PASS  case-a: full main enrollment passes (exit 0)"
    pass=$((pass + 1))
  else
    echo "FAIL  case-a: expected exit 0, got $CHECK_EXIT"
    echo "      actual stderr: $CHECK_STDERR"
    fail=$((fail + 1))
  fi

  if echo "$CHECK_STDOUT" | grep -qF "OK: all"; then
    echo "PASS  case-a: OK line emitted on stdout"
    pass=$((pass + 1))
  else
    echo "FAIL  case-a: missing OK line"
    echo "      actual stdout: $CHECK_STDOUT"
    fail=$((fail + 1))
  fi

  if echo "$CHECK_STDERR" | grep -qF "AGENTS.md"; then
    echo "FAIL  case-a: AGENTS.md must not trigger a warning (R5)"
    echo "      actual stderr: $CHECK_STDERR"
    fail=$((fail + 1))
  else
    echo "PASS  case-a: AGENTS.md exception triggers no warning (R5)"
    pass=$((pass + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case b — Pre-fix state: 65_TOOLS.md AND 66_ORG_RULES.md un-enrolled → exit 1,
#          BOTH named (the exact regression spec 0085 R9 guards).
# ---------------------------------------------------------------------------
{
  repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  make_setup_script "$repo"
  make_settings "$repo" \
    00_SOUL.md 10_USER_LEVEL.md 20_ORGANIZATION.md 30_USER_PROFILE.md \
    40_USER_EXPERTISE.md 50_USER_TEAM.md 60_TOOLS.md AGENTS.md

  run_check "$repo"

  if [ "$CHECK_EXIT" -eq 1 ]; then
    echo "PASS  case-b: pre-fix state fails the check (exit 1)"
    pass=$((pass + 1))
  else
    echo "FAIL  case-b: expected exit 1, got $CHECK_EXIT"
    echo "      actual stderr: $CHECK_STDERR"
    fail=$((fail + 1))
  fi

  if echo "$CHECK_STDERR" | grep -qF "65_TOOLS.md" \
     && echo "$CHECK_STDERR" | grep -qF "66_ORG_RULES.md"; then
    echo "PASS  case-b: stderr names both missing overlays"
    pass=$((pass + 1))
  else
    echo "FAIL  case-b: stderr did not name both 65_TOOLS.md and 66_ORG_RULES.md"
    echo "      actual stderr: $CHECK_STDERR"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case c — R3 non-regression: 30_USER_PROFILE.md (deployed via $TARGET) removed
#          from enrollment → exit 1 and named. Proves the deployed set includes
#          the indirect-target overlay.
# ---------------------------------------------------------------------------
{
  repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  make_setup_script "$repo"
  make_settings "$repo" \
    00_SOUL.md 10_USER_LEVEL.md 20_ORGANIZATION.md \
    40_USER_EXPERTISE.md 50_USER_TEAM.md 60_TOOLS.md 65_TOOLS.md 66_ORG_RULES.md \
    AGENTS.md

  run_check "$repo"

  if [ "$CHECK_EXIT" -eq 1 ]; then
    echo "PASS  case-c: un-enrolled indirect-target overlay fails (exit 1)"
    pass=$((pass + 1))
  else
    echo "FAIL  case-c: expected exit 1, got $CHECK_EXIT"
    echo "      actual stderr: $CHECK_STDERR"
    fail=$((fail + 1))
  fi

  if echo "$CHECK_STDERR" | grep -qF "30_USER_PROFILE.md"; then
    echo "PASS  case-c: stderr names 30_USER_PROFILE.md (R3 — indirect target covered)"
    pass=$((pass + 1))
  else
    echo "FAIL  case-c: stderr did not name 30_USER_PROFILE.md"
    echo "      actual stderr: $CHECK_STDERR"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case d — R5 exception: full deployed set enrolled + AGENTS.md (enrolled but not
#          deployed) → exit 0 with NO warning naming AGENTS.md. (Same shape as
#          case a, asserted explicitly against the exception contract.)
# ---------------------------------------------------------------------------
{
  repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  make_setup_script "$repo"
  make_settings "$repo" ${MAIN_ENROLLED[@]+"${MAIN_ENROLLED[@]}"}

  run_check "$repo"

  if [ "$CHECK_EXIT" -eq 0 ] \
     && ! echo "$CHECK_STDERR" | grep -qF "AGENTS.md"; then
    echo "PASS  case-d: AGENTS.md is a silent enrolled-but-not-deployed exception (R5)"
    pass=$((pass + 1))
  else
    echo "FAIL  case-d: AGENTS.md exception not honored (exit $CHECK_EXIT)"
    echo "      actual stderr: $CHECK_STDERR"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case e — R6 reverse warning: a bogus enrolled entry (99_GHOST.md) not deployed
#          → exit 0 (non-blocking) and a warning names it.
# ---------------------------------------------------------------------------
{
  repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  make_setup_script "$repo"
  make_settings "$repo" ${MAIN_ENROLLED[@]+"${MAIN_ENROLLED[@]}"} 99_GHOST.md

  run_check "$repo"

  if [ "$CHECK_EXIT" -eq 0 ]; then
    echo "PASS  case-e: enrolled-but-not-deployed entry does not fail (exit 0, R6)"
    pass=$((pass + 1))
  else
    echo "FAIL  case-e: expected exit 0 (non-blocking), got $CHECK_EXIT"
    echo "      actual stderr: $CHECK_STDERR"
    fail=$((fail + 1))
  fi

  if echo "$CHECK_STDERR" | grep -qF "99_GHOST.md"; then
    echo "PASS  case-e: stderr warns about the un-deployed enrolled entry (R6)"
    pass=$((pass + 1))
  else
    echo "FAIL  case-e: stderr did not warn about 99_GHOST.md"
    echo "      actual stderr: $CHECK_STDERR"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case f — Finding 1 / R2: a future mixed-case overlay (67_NewTool.md) deployed
#          but not enrolled → exit 1 and named. Proves the broadened name class
#          catches names that are not all-uppercase.
# ---------------------------------------------------------------------------
{
  repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  make_setup_script "$repo"
  append_deploy_token "$repo" "67_NewTool.md"
  make_settings "$repo" ${MAIN_ENROLLED[@]+"${MAIN_ENROLLED[@]}"}   # 9 + AGENTS.md, NOT 67_NewTool.md

  run_check "$repo"

  if [ "$CHECK_EXIT" -eq 1 ]; then
    echo "PASS  case-f: un-enrolled mixed-case overlay fails (exit 1)"
    pass=$((pass + 1))
  else
    echo "FAIL  case-f: expected exit 1, got $CHECK_EXIT"
    echo "      actual stderr: $CHECK_STDERR"
    fail=$((fail + 1))
  fi

  if echo "$CHECK_STDERR" | grep -qF "67_NewTool.md"; then
    echo "PASS  case-f: stderr names 67_NewTool.md (broadened name class, R2)"
    pass=$((pass + 1))
  else
    echo "FAIL  case-f: stderr did not name 67_NewTool.md"
    echo "      actual stderr: $CHECK_STDERR"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case g — Fail-closed: the settings source file is absent → exit 2.
# ---------------------------------------------------------------------------
{
  repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  make_setup_script "$repo"
  # Deliberately create no config/gemini/settings.json.

  run_check "$repo"

  if [ "$CHECK_EXIT" -eq 2 ]; then
    echo "PASS  case-g: missing source file fails closed (exit 2)"
    pass=$((pass + 1))
  else
    echo "FAIL  case-g: expected exit 2, got $CHECK_EXIT"
    echo "      actual stderr: $CHECK_STDERR"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case h — Fail-closed: an empty deployed set (setup with zero deploy tokens) →
#          exit 2, rather than a vacuous forward pass.
# ---------------------------------------------------------------------------
{
  repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  make_setup_script_no_tokens "$repo"
  make_settings "$repo" ${MAIN_ENROLLED[@]+"${MAIN_ENROLLED[@]}"}

  run_check "$repo"

  if [ "$CHECK_EXIT" -eq 2 ]; then
    echo "PASS  case-h: empty deployed set fails closed (exit 2)"
    pass=$((pass + 1))
  else
    echo "FAIL  case-h: expected exit 2, got $CHECK_EXIT"
    echo "      actual stderr: $CHECK_STDERR"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case i — Fail-closed: malformed settings JSON → exit 2.
# ---------------------------------------------------------------------------
{
  repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  make_setup_script "$repo"
  mkdir -p "$repo/config/gemini"
  printf '{ this is not valid json ]\n' > "$repo/config/gemini/settings.json"

  run_check "$repo"

  if [ "$CHECK_EXIT" -eq 2 ]; then
    echo "PASS  case-i: malformed settings JSON fails closed (exit 2)"
    pass=$((pass + 1))
  else
    echo "FAIL  case-i: expected exit 2, got $CHECK_EXIT"
    echo "      actual stderr: $CHECK_STDERR"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case j — Fail-closed: settings missing the context.fileName key → exit 2
#          (a structurally-incomplete file must not read as "all unenrolled").
# ---------------------------------------------------------------------------
{
  repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  make_setup_script "$repo"
  mkdir -p "$repo/config/gemini"
  printf '{ "context": {} }\n' > "$repo/config/gemini/settings.json"

  run_check "$repo"

  if [ "$CHECK_EXIT" -eq 2 ]; then
    echo "PASS  case-j: settings missing context.fileName fails closed (exit 2)"
    pass=$((pass + 1))
  else
    echo "FAIL  case-j: expected exit 2, got $CHECK_EXIT"
    echo "      actual stderr: $CHECK_STDERR"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case k — Boundary: context.fileName PRESENT but an empty list → exit 1, not 2.
#          Locks the Finding-2 distinction: an empty list is a legitimate
#          forward failure (deployed overlays unenrolled), not the malformed
#          exit-2 case.
# ---------------------------------------------------------------------------
{
  repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  make_setup_script "$repo"
  make_settings "$repo"   # context.fileName present but empty

  run_check "$repo"

  if [ "$CHECK_EXIT" -eq 1 ]; then
    echo "PASS  case-k: present-but-empty fileName is a forward failure (exit 1, not 2)"
    pass=$((pass + 1))
  else
    echo "FAIL  case-k: expected exit 1, got $CHECK_EXIT"
    echo "      actual stderr: $CHECK_STDERR"
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
