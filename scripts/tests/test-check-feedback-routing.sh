#!/bin/bash
# test-check-feedback-routing.sh — Regression test for check-feedback-routing.sh.
#
# Pins the contract from spec 0030 (feedback-routing-upstream-tiers): an
# upstream-owned source MUST declare metadata.provenance.feedback equal to
# metadata.provenance.canonical. The guard compares the RAW unresolved strings
# (config-independent), so a "${FEEDBACK_REPO}" declaration fails even though
# the canonical repo resolves both placeholders to the same URL.
#
# Cases:
#   1. feedback == canonical ("${CANONICAL_REPO}")     → exit 0
#   2. feedback != canonical ("${FEEDBACK_REPO}")      → exit 1
#   3. source with no provenance block (no-op)         → exit 0
#   4. adopter-owned tier carrying "${FEEDBACK_REPO}"  → exit 0 (exempt)
#
# Usage:
#   bash scripts/tests/test-check-feedback-routing.sh

# -e is intentionally omitted: exit behavior is asserted via explicit pass/fail
# counters; -e would abort the harness on the expected non-zero exit codes.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT_UNDER_TEST="$SCRIPT_DIR/check-feedback-routing.sh"

if [ ! -f "$SCRIPT_UNDER_TEST" ]; then
  echo "FATAL: cannot find $SCRIPT_UNDER_TEST" >&2
  exit 2
fi

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

pass=0
fail=0

# Render a minimal SKILL.md with the given feedback value.
render_skill_with_feedback() {
  local feedback="$1"
  cat <<EOF
---
name: example
description: Example skill used as a test fixture.
type: skill
metadata:
  provenance:
    canonical: "\${CANONICAL_REPO}"
    feedback: "$feedback"
    version: "1.0.0"
---

# Example

Body.
EOF
}

# Render a minimal SKILL.md with NO provenance block.
render_skill_no_provenance() {
  cat <<EOF
---
name: example
description: Example skill with no provenance block.
type: skill
---

# Example

Body.
EOF
}

# Build a fresh tree root containing one core skill source and return its path.
new_tree() {
  local dir
  dir="$(mktemp -d "$TMP_ROOT/tree.XXXXXX")"
  mkdir -p "$dir/artifacts/core/skills/example"
  echo "$dir"
}

run_case() {
  local name="$1"
  local tree="$2"
  local expected_exit="$3"

  local actual_exit=0
  ( cd "$tree" && bash "$SCRIPT_UNDER_TEST" >/dev/null 2>&1 ) || actual_exit=$?

  if [ "$actual_exit" -eq "$expected_exit" ]; then
    echo "PASS  $name (exit $actual_exit)"
    pass=$((pass + 1))
  else
    echo "FAIL  $name (expected exit $expected_exit, got $actual_exit)"
    fail=$((fail + 1))
  fi
}

# -------------------------------------------------------------------------
# Case 1 — feedback == canonical → exit 0
# -------------------------------------------------------------------------
tree1="$(new_tree)"
render_skill_with_feedback '${CANONICAL_REPO}' > "$tree1/artifacts/core/skills/example/SKILL.md"
run_case "Case 1 — feedback == canonical passes" "$tree1" 0

# -------------------------------------------------------------------------
# Case 2 — feedback == ${FEEDBACK_REPO} (diverges) → exit 1
# -------------------------------------------------------------------------
tree2="$(new_tree)"
render_skill_with_feedback '${FEEDBACK_REPO}' > "$tree2/artifacts/core/skills/example/SKILL.md"
run_case "Case 2 — feedback != canonical fails" "$tree2" 1

# -------------------------------------------------------------------------
# Case 3 — source with no provenance block (no-op) → exit 0
# -------------------------------------------------------------------------
tree3="$(new_tree)"
render_skill_no_provenance > "$tree3/artifacts/core/skills/example/SKILL.md"
run_case "Case 3 — source without provenance is a no-op" "$tree3" 0

# -------------------------------------------------------------------------
# Case 4 — adopter-owned tier (artifacts/community) carrying ${FEEDBACK_REPO}
# is EXEMPT → exit 0. Confirms the guard scopes to upstream-owned tiers only.
# -------------------------------------------------------------------------
tree4="$(new_tree)"
mkdir -p "$tree4/artifacts/community/skills/adopter"
render_skill_with_feedback '${FEEDBACK_REPO}' > "$tree4/artifacts/community/skills/adopter/SKILL.md"
# Keep the upstream example canonical so only the community source diverges.
render_skill_with_feedback '${CANONICAL_REPO}' > "$tree4/artifacts/core/skills/example/SKILL.md"
run_case "Case 4 — adopter-owned tier is exempt" "$tree4" 0

# -------------------------------------------------------------------------
# Summary
# -------------------------------------------------------------------------
echo ""
echo "Results: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
