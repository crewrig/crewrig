#!/bin/bash
# test-check-skill-versions.sh — Regression test for check-skill-versions.sh.
#
# Pins the contract from issue #26: the version-bump rule applies only to
# MODIFIED skill/agent sources (git status `M`), never to newly ADDED ones
# (status `A`). New components start at 1.0.0 by definition and are not
# subject to the bump rule until they are subsequently modified.
#
# Cases:
#   1. Status A (new component, no bump)      → exit 0
#   2. Status M (modified, no bump)           → exit 1
#   3. Status M (modified, with version bump) → exit 0
#
# Usage:
#   bash scripts/tests/test-check-skill-versions.sh

# -e is intentionally omitted: exit behavior is controlled through explicit
# pass/fail counters and a final assertion; adding -e would cause the harness
# to abort on the expected non-zero exit codes from the script under test.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT_UNDER_TEST="$SCRIPT_DIR/check-skill-versions.sh"

if [ ! -x "$SCRIPT_UNDER_TEST" ] && [ ! -f "$SCRIPT_UNDER_TEST" ]; then
  echo "FATAL: cannot find $SCRIPT_UNDER_TEST" >&2
  exit 2
fi

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

pass=0
fail=0

# Render a minimal SKILL.md with the given version string.
render_skill() {
  local version="$1"
  cat <<EOF
---
name: example
description: Example skill used as a test fixture.
metadata:
  provenance:
    version: "$version"
---

# Example

Body.
EOF
}

# Render a minimal command source with the given version string.
render_command() {
  local version="$1"
  cat <<EOF
---
name: example-cmd
description: Example command used as a test fixture.
type: command
metadata:
  provenance:
    version: "$version"
---

# Example Command

Prompt body.
EOF
}

# Set up a fresh temp git repo and return its path on stdout.
new_repo() {
  local dir
  dir="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  (
    cd "$dir"
    git init -q
    git config user.email "test@example.com"
    git config user.name "Test"
    git config commit.gpgsign false
  )
  echo "$dir"
}

run_case() {
  local name="$1"
  local repo="$2"
  local expected_exit="$3"

  local actual_exit=0
  ( cd "$repo" && bash "$SCRIPT_UNDER_TEST" HEAD~1 >/dev/null 2>&1 ) || actual_exit=$?

  if [ "$actual_exit" -eq "$expected_exit" ]; then
    echo "PASS  $name (exit $actual_exit)"
    pass=$((pass + 1))
  else
    echo "FAIL  $name (expected exit $expected_exit, got $actual_exit)"
    fail=$((fail + 1))
  fi
}

# -------------------------------------------------------------------------
# Case 1 — Status A: new SKILL.md, no bump required → exit 0
# -------------------------------------------------------------------------
repo1="$(new_repo)"
(
  cd "$repo1"
  # Base commit: unrelated file, no skill yet.
  echo "seed" > README.md
  git add README.md
  git commit -q -m "seed"

  # Head commit: ADD a brand-new skill source.
  mkdir -p artifacts/core/skills/new-skill
  render_skill "1.0.0" > artifacts/core/skills/new-skill/SKILL.md
  git add artifacts/core/skills/new-skill/SKILL.md
  git commit -q -m "add new skill"
)
run_case "Case 1 — new component (status A) requires no bump" "$repo1" 0

# -------------------------------------------------------------------------
# Case 2 — Status M: existing SKILL.md modified, no bump → exit 1
# -------------------------------------------------------------------------
repo2="$(new_repo)"
(
  cd "$repo2"
  mkdir -p artifacts/core/skills/old-skill
  render_skill "1.0.0" > artifacts/core/skills/old-skill/SKILL.md
  git add artifacts/core/skills/old-skill/SKILL.md
  git commit -q -m "seed old-skill at 1.0.0"

  # Head commit: modify body, but leave version untouched.
  printf '\nExtra line.\n' >> artifacts/core/skills/old-skill/SKILL.md
  git add artifacts/core/skills/old-skill/SKILL.md
  git commit -q -m "tweak body, forget version bump"
)
run_case "Case 2 — modified component without bump fails" "$repo2" 1

# -------------------------------------------------------------------------
# Case 3 — Status M: existing SKILL.md modified, with bump → exit 0
# -------------------------------------------------------------------------
repo3="$(new_repo)"
(
  cd "$repo3"
  mkdir -p artifacts/core/skills/old-skill
  render_skill "1.0.0" > artifacts/core/skills/old-skill/SKILL.md
  git add artifacts/core/skills/old-skill/SKILL.md
  git commit -q -m "seed old-skill at 1.0.0"

  # Head commit: bump version (and tweak body for realism).
  render_skill "1.0.1" > artifacts/core/skills/old-skill/SKILL.md
  printf '\nExtra line.\n' >> artifacts/core/skills/old-skill/SKILL.md
  git add artifacts/core/skills/old-skill/SKILL.md
  git commit -q -m "patch bump"
)
run_case "Case 3 — modified component with bump passes" "$repo3" 0

# -------------------------------------------------------------------------
# Case 4 — Remote probing: repo with crewrig remote (no origin) and no
# explicit argument exercises the default BASE_REF resolution on line 24.
# -------------------------------------------------------------------------
repo4="$(new_repo)"
(
  cd "$repo4"
  git branch -m main  # ensure the branch is named main for crewrig/main
  mkdir -p artifacts/core/skills/old-skill
  render_skill "1.0.0" > artifacts/core/skills/old-skill/SKILL.md
  git add artifacts/core/skills/old-skill/SKILL.md
  git commit -q -m "seed old-skill at 1.0.0"

  # Head commit: bump version.
  render_skill "1.0.1" > artifacts/core/skills/old-skill/SKILL.md
  printf '\nExtra line.\n' >> artifacts/core/skills/old-skill/SKILL.md
  git add artifacts/core/skills/old-skill/SKILL.md
  git commit -q -m "patch bump"

  # Add a remote named crewrig (no origin) pointing at the repo itself.
  git remote add crewrig "$repo4"
  git fetch crewrig >/dev/null 2>&1
)

# Run without explicit base ref — exercises the remote-probe fallback.
actual_exit=0
( cd "$repo4" && bash "$SCRIPT_UNDER_TEST" >/dev/null 2>&1 ) || actual_exit=$?
if [ "$actual_exit" -eq 0 ]; then
  echo "PASS  Case 4 — remote probing (crewrig, no origin) (exit $actual_exit)"
  pass=$((pass + 1))
else
  echo "FAIL  Case 4 — remote probing (crewrig, no origin) (expected exit 0, got $actual_exit)"
  fail=$((fail + 1))
fi

# -------------------------------------------------------------------------
# Case 5 — Status A: new command source (artifacts/core/commands/*.md) → exit 0
# -------------------------------------------------------------------------
repo5="$(new_repo)"
(
  cd "$repo5"
  echo "seed" > README.md
  git add README.md
  git commit -q -m "seed"

  mkdir -p artifacts/core/commands
  render_command "1.0.0" > artifacts/core/commands/new-cmd.md
  git add artifacts/core/commands/new-cmd.md
  git commit -q -m "add new command"
)
run_case "Case 5 — new command (status A) requires no bump" "$repo5" 0

# -------------------------------------------------------------------------
# Case 6 — Status M: existing command modified without bump → exit 1
# -------------------------------------------------------------------------
repo6="$(new_repo)"
(
  cd "$repo6"
  mkdir -p artifacts/core/commands
  render_command "1.0.0" > artifacts/core/commands/old-cmd.md
  git add artifacts/core/commands/old-cmd.md
  git commit -q -m "seed old-cmd at 1.0.0"

  printf '\nExtra line.\n' >> artifacts/core/commands/old-cmd.md
  git add artifacts/core/commands/old-cmd.md
  git commit -q -m "tweak command, forget version bump"
)
run_case "Case 6 — modified command without bump fails" "$repo6" 1

# -------------------------------------------------------------------------
# Case 7 — Status M: existing command modified with bump → exit 0
# -------------------------------------------------------------------------
repo7="$(new_repo)"
(
  cd "$repo7"
  mkdir -p artifacts/core/commands
  render_command "1.0.0" > artifacts/core/commands/old-cmd.md
  git add artifacts/core/commands/old-cmd.md
  git commit -q -m "seed old-cmd at 1.0.0"

  render_command "1.0.1" > artifacts/core/commands/old-cmd.md
  printf '\nExtra line.\n' >> artifacts/core/commands/old-cmd.md
  git add artifacts/core/commands/old-cmd.md
  git commit -q -m "patch bump command"
)
run_case "Case 7 — modified command with bump passes" "$repo7" 0

# -------------------------------------------------------------------------
# Case 8 (issue #1214) — a BASE_REF ending in `/` (an unexpanded CI variable,
# e.g. a push event or an interpolated merge-request target-branch variable
# that came back empty) is normalized to unset rather than handed to git
# verbatim.
#
# The exit code alone cannot pin this: `git diff --name-status "$BASE_REF" --
# ... 2>/dev/null || true` on line 51 swallows a slash-terminated ref's git
# error and yields an EMPTY diff, which the script reads as "nothing to
# check" and exits 0 — the same code a real, correctly-resolved pass produces.
# Silently skipping the check is the more dangerous shape of this bug (a
# forgotten bump would slip through undetected), so this asserts on OUTPUT:
# the per-file "OK" line only appears when the diff genuinely ran and found
# the bumped file, and the false-negative skip message must be absent.
#
# The remote is fetched right after the SEED commit, before the bump commit —
# unlike Case 4, whose fetch-after-both-commits fixture can only prove
# resolution succeeds, never that the resulting base ref actually predates the
# change.
# -------------------------------------------------------------------------
repo8="$(new_repo)"
(
  cd "$repo8"
  git branch -m main
  mkdir -p artifacts/core/skills/old-skill
  render_skill "1.0.0" > artifacts/core/skills/old-skill/SKILL.md
  git add artifacts/core/skills/old-skill/SKILL.md
  git commit -q -m "seed old-skill at 1.0.0"

  git remote add crewrig "$repo8"
  git fetch crewrig >/dev/null 2>&1

  render_skill "1.0.1" > artifacts/core/skills/old-skill/SKILL.md
  printf '\nExtra line.\n' >> artifacts/core/skills/old-skill/SKILL.md
  git add artifacts/core/skills/old-skill/SKILL.md
  git commit -q -m "patch bump"
)

actual_exit=0
case8_output=$( ( cd "$repo8" && BASE_REF="crewrig/" bash "$SCRIPT_UNDER_TEST" 2>&1 ) ) || actual_exit=$?
if [ "$actual_exit" -eq 0 ] \
  && echo "$case8_output" | grep -q "OK   artifacts/core/skills/old-skill/SKILL.md" \
  && ! echo "$case8_output" | grep -q "no existing component sources modified"; then
  echo "PASS  Case 8 — trailing-slash BASE_REF is normalized to unset, diff genuinely ran (exit $actual_exit)"
  pass=$((pass + 1))
else
  echo "FAIL  Case 8 — trailing-slash BASE_REF is normalized to unset (expected exit 0 with the bump found, got exit $actual_exit)"
  echo "Output:"
  echo "$case8_output"
  fail=$((fail + 1))
fi

# -------------------------------------------------------------------------
# Case 9 (issue #1214) — dynamic trunk fallback, positive control. The
# reference remote carries NO `main` branch at all — trunk is `develop` — so
# the default derivation must fall back to `<remote>/develop` rather than
# hard-failing on a hardcoded `<remote>/main`. Same fetch-before-bump shape as
# Case 8, so exit 0 means the bump was actually found via `crewrig/develop`.
# -------------------------------------------------------------------------
repo9="$(new_repo)"
(
  cd "$repo9"
  git branch -m develop
  mkdir -p artifacts/core/skills/old-skill
  render_skill "1.0.0" > artifacts/core/skills/old-skill/SKILL.md
  git add artifacts/core/skills/old-skill/SKILL.md
  git commit -q -m "seed old-skill at 1.0.0"

  git remote add crewrig "$repo9"
  git fetch crewrig >/dev/null 2>&1

  render_skill "1.0.1" > artifacts/core/skills/old-skill/SKILL.md
  printf '\nExtra line.\n' >> artifacts/core/skills/old-skill/SKILL.md
  git add artifacts/core/skills/old-skill/SKILL.md
  git commit -q -m "patch bump"
)

actual_exit=0
( cd "$repo9" && env -u BASE_REF bash "$SCRIPT_UNDER_TEST" >/dev/null 2>&1 ) || actual_exit=$?
if [ "$actual_exit" -eq 0 ]; then
  echo "PASS  Case 9 — no main branch falls back to develop, bump recognized (exit $actual_exit)"
  pass=$((pass + 1))
else
  echo "FAIL  Case 9 — no main branch falls back to develop, bump recognized (expected exit 0, got $actual_exit)"
  fail=$((fail + 1))
fi

# -------------------------------------------------------------------------
# Case 10 (issue #1214) — same develop-only trunk, negative control: NO
# version bump. Proves the fallback actually engaged the check against
# `develop` rather than the check silently no-op'ing (which would also read
# as exit 0 on Case 9 alone).
# -------------------------------------------------------------------------
repo10="$(new_repo)"
(
  cd "$repo10"
  git branch -m develop
  mkdir -p artifacts/core/skills/old-skill
  render_skill "1.0.0" > artifacts/core/skills/old-skill/SKILL.md
  git add artifacts/core/skills/old-skill/SKILL.md
  git commit -q -m "seed old-skill at 1.0.0"

  git remote add crewrig "$repo10"
  git fetch crewrig >/dev/null 2>&1

  printf '\nExtra line.\n' >> artifacts/core/skills/old-skill/SKILL.md
  git add artifacts/core/skills/old-skill/SKILL.md
  git commit -q -m "tweak body, forget version bump"
)

actual_exit=0
( cd "$repo10" && env -u BASE_REF bash "$SCRIPT_UNDER_TEST" >/dev/null 2>&1 ) || actual_exit=$?
if [ "$actual_exit" -eq 1 ]; then
  echo "PASS  Case 10 — develop fallback negative control: missing bump still fails (exit $actual_exit)"
  pass=$((pass + 1))
else
  echo "FAIL  Case 10 — develop fallback negative control: missing bump still fails (expected exit 1, got $actual_exit)"
  fail=$((fail + 1))
fi

# -------------------------------------------------------------------------
# Summary
# -------------------------------------------------------------------------
echo ""
echo "Results: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
