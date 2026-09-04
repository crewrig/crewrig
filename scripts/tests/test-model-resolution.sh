#!/bin/bash
# test-model-resolution.sh — Regression suite for the spec 0198 build-time
# resolution of capability profiles against per-CLI model mappings.
#
# Mirrors the scripts/tests/test-check-model-mappings.sh idiom: `set -uo
# pipefail` (exit behavior asserted via explicit counters, never via -e),
# mktemp -d + trap, a run_case-style pass/fail counter, fixture generators
# under scripts/tests/fixtures/agent-profiles/ (never under artifacts/, so no
# tier discovery, no drift guard and no install path ever sees them).
#
# Case C2 (this step) is the byte-identity harness: it must be written and
# green BEFORE any resolver code exists (plan step 1). It is re-run after
# every later step. Every other case (C1, C3-C13) is added by the step that
# implements the mechanism it proves; see PLAN v3 (issue #1116 comment
# 5544463372) -> Test strategy.
#
# Usage:
#   bash scripts/tests/test-model-resolution.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD_SCRIPT="$SCRIPT_DIR/build-components.sh"
FIXTURES_DIR="$SCRIPT_DIR/tests/fixtures/agent-profiles"

command -v yq >/dev/null 2>&1 || {
  echo "FATAL: yq is required to run this suite." >&2
  exit 2
}

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

pass=0
fail=0

ok() {
  echo "PASS  $1"
  pass=$((pass + 1))
}
bad() {
  echo "FAIL  $1"
  shift
  if [ "$#" -gt 0 ]; then
    printf '%s\n' "$@" | sed 's/^/  /'
  fi
  fail=$((fail + 1))
}

extract_frontmatter() {
  awk 'NR==1 && /^---$/{inblk=1; next} inblk && /^---$/{exit} inblk{print}' "$1"
}

echo "=== C2 — profile-less source is byte-identical (baseline harness) ==="

# --- C2(a) — bash scripts/build-components.sh --target all --check exits 0 -
out="$(bash "$BUILD_SCRIPT" --target all --check 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] && printf '%s\n' "$out" | grep -qF "OK: All generated files match source."; then
  ok "C2(a) — --target all --check exits 0 on the untouched tree"
else
  bad "C2(a) — --target all --check exits 0 on the untouched tree" "exit=$rc" "$out"
fi

# --- C2(b) — pinned extract_frontmatter block of three committed outputs ---
# Pins the frontmatter of the 'architect' agent on three targets (Claude,
# Gemini, Antigravity — the fourth, GitHub Copilot CLI, is pinned in the
# emission suite once its case exists). A byte-for-byte literal, not a
# regex: any drift in these three outputs must turn this red.
assert_frontmatter() {
  local label="$1" file="$2" expected="$3" got
  got="$(extract_frontmatter "$REPO_DIR/$file")"
  if [ "$got" = "$expected" ]; then
    ok "C2(b) — $label frontmatter matches the pinned baseline"
  else
    bad "C2(b) — $label frontmatter matches the pinned baseline" "--- expected ---" "$expected" "--- got ---" "$got"
  fi
}

assert_frontmatter ".claude/agents/architect/AGENT.md" ".claude/agents/architect/AGENT.md" \
'name: architect
description: "Generic architecture agent. Drafts ADRs, runs design reviews, proposes alternatives with explicit trade-offs, and maps blast radius."
metadata:
  provenance:
    canonical: "https://github.com/crewrig/crewrig"
    feedback: "https://github.com/crewrig/crewrig"
    version: "1.1.3"'

assert_frontmatter ".gemini/agents/architect.md" ".gemini/agents/architect.md" \
'name: architect
description: "Generic architecture agent. Drafts ADRs, runs design reviews, proposes alternatives with explicit trade-offs, and maps blast radius."'

assert_frontmatter ".agents/agents/architect/AGENT.md" ".agents/agents/architect/AGENT.md" \
'name: architect
description: "Generic architecture agent. Drafts ADRs, runs design reviews, proposes alternatives with explicit trade-offs, and maps blast radius."
metadata:
  provenance:
    canonical: "https://github.com/crewrig/crewrig"
    feedback: "https://github.com/crewrig/crewrig"
    version: "1.1.3"'

# --- C2(c) — the 88-file surface is exactly 22 core agent sources x 4 targets
n_sources=$(find "$REPO_DIR/artifacts/core/agents" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')
if [ "$n_sources" -eq 22 ]; then
  ok "C2(c) — 22 core agent sources (88-file surface = 22 x 4 targets)"
else
  bad "C2(c) — 22 core agent sources (88-file surface = 22 x 4 targets)" "got $n_sources"
fi

echo ""
echo "Results: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
