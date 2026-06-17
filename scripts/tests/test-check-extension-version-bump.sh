#!/bin/bash
# test-check-extension-version-bump.sh — Regression test for
# check-extension-version-bump.sh (spec 0044, R2/R3/R4 + F2 edge cases).
#
# Mirrors test-check-skill-versions.sh: each case spins a throwaway `git init`
# repo, renders an extension SKILL.md whose version lives on the crewrig-
# provenance carrier (first body line, per spec 0043), commits a base, mutates
# the head commit, and invokes the guard with `HEAD~1` as $BASE_REF so the
# `git show "$BASE_REF:$path"` old-carrier read resolves against a real base
# commit — no network, no dependency on crewrig/main.
#
# Cases:
#   1. Status A (new component)                         → exit 0 (R3 exempt)
#   2. Status M, body changed, version NOT bumped       → exit 1 (R2)
#   3. Status M, version bumped 1.0.0 → 1.0.1           → exit 0
#   4. F2: OLD carrier WHOLLY absent (component gains a carrier this PR) → exit 0 (exempt)
#   5. F2: OLD carrier present but version="" (empty)   → exit 1 (hard FAIL, not exempt)
#   6. NEW carrier version="" on a modified component   → exit 1 (hard FAIL)
#
# Usage:
#   bash scripts/tests/test-check-extension-version-bump.sh
#
# -e is intentionally omitted: exit codes are asserted via explicit counters.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT_UNDER_TEST="$SCRIPT_DIR/check-extension-version-bump.sh"

if [ ! -f "$SCRIPT_UNDER_TEST" ]; then
  echo "FATAL: cannot find $SCRIPT_UNDER_TEST" >&2
  exit 2
fi

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

pass=0
fail=0

# render_skill <version|--no-carrier|--empty-version> [extra-body-line]
# Renders an extension SKILL.md with a crewrig-provenance carrier as the first
# body line (matching the shipped greeter contract). Special modes:
#   --no-carrier   → no carrier line at all (pre-0043 component)
#   --empty-version→ carrier present but version=""
render_skill() {
  local mode="$1" extra="${2:-}"
  printf -- '---\n'
  printf -- 'name: example\n'
  printf -- 'description: Example extension skill fixture.\n'
  printf -- '---\n'
  case "$mode" in
    --no-carrier)
      ;;
    --empty-version)
      printf -- '<!-- crewrig-provenance: version="" canonical="https://github.com/crewrig/crewrig" feedback="https://github.com/crewrig/crewrig" -->\n'
      ;;
    *)
      printf -- '<!-- crewrig-provenance: version="%s" canonical="https://github.com/crewrig/crewrig" feedback="https://github.com/crewrig/crewrig" -->\n' "$mode"
      ;;
  esac
  printf -- '\n# Example\n\nBody.\n'
  [ -n "$extra" ] && printf -- '%s\n' "$extra"
}

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

SKILL_PATH="extensions/core/skills/example/SKILL.md"

run_case() {
  local name="$1" repo="$2" expected_exit="$3"
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

# Case 1 — Status A: new extension SKILL.md, no bump required → exit 0
repo1="$(new_repo)"
(
  cd "$repo1"
  echo "seed" > README.md
  git add README.md
  git commit -q -m "seed"

  mkdir -p "$(dirname "$SKILL_PATH")"
  render_skill "1.0.0" > "$SKILL_PATH"
  git add "$SKILL_PATH"
  git commit -q -m "add new extension skill"
)
run_case "Case 1 — new component (status A) requires no bump" "$repo1" 0

# Case 2 — Status M: body changed, version NOT bumped → exit 1
repo2="$(new_repo)"
(
  cd "$repo2"
  mkdir -p "$(dirname "$SKILL_PATH")"
  render_skill "1.0.0" > "$SKILL_PATH"
  git add "$SKILL_PATH"
  git commit -q -m "seed at 1.0.0"

  render_skill "1.0.0" "Extra line." > "$SKILL_PATH"
  git add "$SKILL_PATH"
  git commit -q -m "tweak body, forget bump"
)
run_case "Case 2 — modified without bump fails" "$repo2" 1

# Case 3 — Status M: version bumped 1.0.0 → 1.0.1 → exit 0
repo3="$(new_repo)"
(
  cd "$repo3"
  mkdir -p "$(dirname "$SKILL_PATH")"
  render_skill "1.0.0" > "$SKILL_PATH"
  git add "$SKILL_PATH"
  git commit -q -m "seed at 1.0.0"

  render_skill "1.0.1" "Extra line." > "$SKILL_PATH"
  git add "$SKILL_PATH"
  git commit -q -m "patch bump"
)
run_case "Case 3 — modified with bump passes" "$repo3" 0

# Case 4 — F2: OLD carrier WHOLLY absent (pre-0043), this PR adds it → exit 0
repo4="$(new_repo)"
(
  cd "$repo4"
  mkdir -p "$(dirname "$SKILL_PATH")"
  render_skill --no-carrier > "$SKILL_PATH"   # base: NO carrier
  git add "$SKILL_PATH"
  git commit -q -m "seed pre-0043 (no carrier)"

  render_skill "1.0.0" > "$SKILL_PATH"         # head: gains a carrier
  git add "$SKILL_PATH"
  git commit -q -m "add provenance carrier"
)
run_case "Case 4 — OLD carrier wholly absent is exempt" "$repo4" 0

# Case 5 — F2: OLD carrier present but version="" → hard FAIL (not exempt)
repo5="$(new_repo)"
(
  cd "$repo5"
  mkdir -p "$(dirname "$SKILL_PATH")"
  render_skill --empty-version > "$SKILL_PATH" # base: carrier present, version=""
  git add "$SKILL_PATH"
  git commit -q -m "seed with empty-version carrier"

  render_skill "1.0.0" "Extra line." > "$SKILL_PATH"  # head: gives it a real version, body changed
  git add "$SKILL_PATH"
  git commit -q -m "modify body, set version"
)
# OLD has a carrier line but empty version → branch 3 → hard FAIL regardless of NEW.
run_case "Case 5 — OLD carrier present but version empty fails" "$repo5" 1

# Case 6 — NEW carrier version="" on a modified component → hard FAIL
repo6="$(new_repo)"
(
  cd "$repo6"
  mkdir -p "$(dirname "$SKILL_PATH")"
  render_skill "1.0.0" > "$SKILL_PATH"
  git add "$SKILL_PATH"
  git commit -q -m "seed at 1.0.0"

  render_skill --empty-version > "$SKILL_PATH"  # head: carrier present but version stripped
  git add "$SKILL_PATH"
  git commit -q -m "strip version"
)
run_case "Case 6 — NEW carrier with empty version fails" "$repo6" 1

echo ""
echo "Results: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
