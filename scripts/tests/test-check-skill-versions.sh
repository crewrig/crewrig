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

# -e is intentionally omitted: exit behaviour is controlled through explicit
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
  mkdir -p community-config/skills/new-skill
  render_skill "1.0.0" > community-config/skills/new-skill/SKILL.md
  git add community-config/skills/new-skill/SKILL.md
  git commit -q -m "add new skill"
)
run_case "Case 1 — new component (status A) requires no bump" "$repo1" 0

# -------------------------------------------------------------------------
# Case 2 — Status M: existing SKILL.md modified, no bump → exit 1
# -------------------------------------------------------------------------
repo2="$(new_repo)"
(
  cd "$repo2"
  mkdir -p community-config/skills/old-skill
  render_skill "1.0.0" > community-config/skills/old-skill/SKILL.md
  git add community-config/skills/old-skill/SKILL.md
  git commit -q -m "seed old-skill at 1.0.0"

  # Head commit: modify body, but leave version untouched.
  printf '\nExtra line.\n' >> community-config/skills/old-skill/SKILL.md
  git add community-config/skills/old-skill/SKILL.md
  git commit -q -m "tweak body, forget version bump"
)
run_case "Case 2 — modified component without bump fails" "$repo2" 1

# -------------------------------------------------------------------------
# Case 3 — Status M: existing SKILL.md modified, with bump → exit 0
# -------------------------------------------------------------------------
repo3="$(new_repo)"
(
  cd "$repo3"
  mkdir -p community-config/skills/old-skill
  render_skill "1.0.0" > community-config/skills/old-skill/SKILL.md
  git add community-config/skills/old-skill/SKILL.md
  git commit -q -m "seed old-skill at 1.0.0"

  # Head commit: bump version (and tweak body for realism).
  render_skill "1.0.1" > community-config/skills/old-skill/SKILL.md
  printf '\nExtra line.\n' >> community-config/skills/old-skill/SKILL.md
  git add community-config/skills/old-skill/SKILL.md
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
  mkdir -p community-config/skills/old-skill
  render_skill "1.0.0" > community-config/skills/old-skill/SKILL.md
  git add community-config/skills/old-skill/SKILL.md
  git commit -q -m "seed old-skill at 1.0.0"

  # Head commit: bump version.
  render_skill "1.0.1" > community-config/skills/old-skill/SKILL.md
  printf '\nExtra line.\n' >> community-config/skills/old-skill/SKILL.md
  git add community-config/skills/old-skill/SKILL.md
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
# Summary
# -------------------------------------------------------------------------
echo ""
echo "Results: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
