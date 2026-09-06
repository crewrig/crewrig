#!/bin/bash
# test-check-agent-profiles.sh — Regression test for check-agent-profiles.sh
# (spec 0195 R23-R25, spec 0198 R36-R39, PLAN v3 step 11 of issue #1116).
#
# Mirrors the scripts/tests/test-check-model-mappings.sh idiom: `set -uo
# pipefail` (exit behavior asserted via explicit counters, never -e),
# mktemp -d + trap, render_* fixture generators, a run_case pass/fail
# counter, and a closing `[ "$fail" -eq 0 ]`.
#
# Sections:
#   1. Rejection coverage — a valid baseline proven green, then one
#      single-cell mutation red per assertion id (P1-P11) — ten ids
#      correspond to the plan's P1-P10, plus P11 (v3-F4's modalities-shape
#      addition). P6 and P8 get more than one mutation each, since both
#      bundle several genuinely distinct predicates under one id.
#   2. The three green cases of the "unknown profile key" scenario, plus a
#      case asserting the build still compiles an offending source without
#      failing, degrading the key it cannot read.
#   3. Exit-2 with yq stripped from PATH.
#
# Usage:
#   bash scripts/tests/test-check-agent-profiles.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SCRIPT_UNDER_TEST="$SCRIPT_DIR/check-agent-profiles.sh"
BUILD_SCRIPT="$SCRIPT_DIR/build-components.sh"

if [ ! -f "$SCRIPT_UNDER_TEST" ]; then
  echo "FATAL: cannot find $SCRIPT_UNDER_TEST" >&2
  exit 2
fi

command -v yq >/dev/null 2>&1 || {
  echo "FATAL: yq is required to build fixtures for this suite." >&2
  exit 2
}

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

pass=0
fail=0

run_case() {
  # run_case <name> <expected-exit> "<space-separated expected assertion ids, or empty>" <file...>
  local name="$1" expected_exit="$2" expected_ids="$3"
  shift 3
  local out actual_exit=0 ok=1 id
  out=$(bash "$SCRIPT_UNDER_TEST" "$@" 2>&1) || actual_exit=$?
  if [ "$actual_exit" -ne "$expected_exit" ]; then
    ok=0
  fi
  if [ -n "$expected_ids" ]; then
    for id in $expected_ids; do
      printf '%s\n' "$out" | grep -qF ": ${id} " || ok=0
    done
  fi
  if [ "$ok" -eq 1 ]; then
    echo "PASS  $name (exit $actual_exit${expected_ids:+, saw: $expected_ids})"
    pass=$((pass + 1))
  else
    echo "FAIL  $name (expected exit $expected_exit${expected_ids:+ with: $expected_ids}, got exit $actual_exit)"
    echo "  --- output ---"
    printf '%s\n' "$out" | sed 's/^/  /'
    echo "  --------------"
    fail=$((fail + 1))
  fi
}

# --- Section 1 fixture machinery ---------------------------------------------

# A fully conformant profile: every axis, every tuning knob, at valid
# values — one mutation should touch exactly one cell.
render_base() {
  cat <<'EOF'
---
name: probe
description: "Fixture agent source for the spec 0198 profile validator test suite."
metadata:
  model:
    intelligence: medium
    reasoning: medium
    specialization: general
    context: 100000
    speed: fast
    modalities: [text, vision]
    locality: any
    tuning:
      temperature: 0.7
      top-p: 0.9
      top-k: 40
      max-output-tokens: 2048
      max-turns: 10
---
Body.
EOF
}

# render_case_file <stem> <yq-expr>... — a fresh copy of render_base at
# <stem>.md, mutated in place by each yq expression in order. Echoes path.
render_case_file() {
  local stem="$1"
  shift
  local dir f e
  dir="$(mktemp -d "$TMP_ROOT/case.XXXXXX")"
  f="$dir/${stem}.md"
  render_base > "$f"
  for e in "$@"; do
    yq eval -i --front-matter=process "$e" "$f" >/dev/null
  done
  echo "$f"
}

echo "=== Section 1 — rejection coverage ==="

f="$(render_case_file probe)"
run_case "baseline conforms" 0 "" "$f"

# --- P1 — metadata.model present but not a mapping -------------------------
f="$(render_case_file probe '.metadata.model = "not-a-map"')"
run_case "P1 — metadata.model is not a mapping" 1 "P1" "$f"

# --- P2 — a key under metadata.model: outside the eight admitted ----------
f="$(render_case_file probe '.metadata.model.bogus = "x"')"
run_case "P2 — unknown metadata.model key" 1 "P2" "$f"

# --- P3 — a key under tuning: outside the five admitted --------------------
f="$(render_case_file probe '.metadata.model.tuning.bogus-knob = 1')"
run_case "P3 — unknown tuning key" 1 "P3" "$f"

# --- P4 — intelligence outside the seven rungs ------------------------------
f="$(render_case_file probe '.metadata.model.intelligence = "bogus"')"
run_case "P4 — intelligence outside domain" 1 "P4" "$f"

# --- P4, spec 0200 R38's second mutation: a Claude Code model alias is a
# rung outside the domain, not merely an unenumerated bogus value. This is
# the out-of-domain rung the spec 0200 migration guards against a source
# declaring by mistake — sonnet is a model alias, not one of the seven
# spec 0195 rungs.
f="$(render_case_file probe '.metadata.model.intelligence = "sonnet"')"
run_case "P4 — intelligence: sonnet is rejected (a model alias, not a rung; spec 0200 R38)" 1 "P4" "$f"

# --- P5 — reasoning outside the six rungs -----------------------------------
f="$(render_case_file probe '.metadata.model.reasoning = "off"')"
run_case "P5 — reasoning outside domain" 1 "P5" "$f"

# --- P6 — speed / locality / a modalities member outside domain ------------
f="$(render_case_file probe '.metadata.model.speed = "bogus"')"
run_case "P6 — speed outside domain" 1 "P6" "$f"

f="$(render_case_file probe '.metadata.model.locality = "bogus"')"
run_case "P6 — locality outside domain" 1 "P6" "$f"

f="$(render_case_file probe '.metadata.model.modalities = ["text", "bogus"]')"
run_case "P6 — modalities member outside domain" 1 "P6" "$f"

# --- P7 — context not a positive integer ------------------------------------
f="$(render_case_file probe '.metadata.model.context = 0')"
run_case "P7 — context not a positive integer" 1 "P7" "$f"

# --- P8 — one mutation per knob boundary (v3-F4: five distinct predicates) -
f="$(render_case_file probe '.metadata.model.tuning.temperature = 5.0')"
run_case "P8 — temperature above its closed ceiling" 1 "P8" "$f"

f="$(render_case_file probe '.metadata.model.tuning.temperature = "hot"')"
run_case "P8 — temperature wrong type" 1 "P8" "$f"

f="$(render_case_file probe '.metadata.model.tuning."top-p" = 0')"
run_case "P8 — top-p at the open floor (forbidden)" 1 "P8" "$f"

f="$(render_case_file probe '.metadata.model.tuning."top-p" = 1.5')"
run_case "P8 — top-p above its closed ceiling" 1 "P8" "$f"

f="$(render_case_file probe '.metadata.model.tuning."top-k" = 0')"
run_case "P8 — top-k below its integer minimum" 1 "P8" "$f"

f="$(render_case_file probe '.metadata.model.tuning."max-output-tokens" = 0')"
run_case "P8 — max-output-tokens below its integer minimum" 1 "P8" "$f"

f="$(render_case_file probe '.metadata.model.tuning."max-turns" = 0')"
run_case "P8 — max-turns below its integer minimum" 1 "P8" "$f"

# --- P9 — specialization shape only, never membership -----------------------
f="$(render_case_file probe '.metadata.model.specialization = "Not_Kebab"')"
run_case "P9 — specialization not kebab-case" 1 "P9" "$f"

# --- P10 — tuning: present but not a mapping (list AND scalar) --------------
f="$(render_case_file probe '.metadata.model.tuning = ["a", "b"]')"
run_case "P10 — tuning is a list, not a mapping (the v3-F4 case)" 1 "P10" "$f"

f="$(render_case_file probe '.metadata.model.tuning = 3')"
run_case "P10 — tuning is a scalar, not a mapping" 1 "P10" "$f"

# --- P11 — modalities shape (list only), the v3-F4 addition ----------------
f="$(render_case_file probe '.metadata.model.modalities = "text"')"
run_case "P11 — modalities is a scalar, not a list" 1 "P11" "$f"

f="$(render_case_file probe '.metadata.model.modalities = {"a": "text"}')"
run_case "P11 — modalities is a mapping, not a list" 1 "P11" "$f"

echo ""
echo "=== Section 2 — green cases and build resilience ==="

# --- an unenumerated specialization is a valid declaration (open enum) ----
f="$(render_case_file probe '.metadata.model.specialization = "image-generation"')"
run_case "specialization: image-generation is green (open enum)" 0 "" "$f"

# --- metadata.claude.model, no metadata.model: never rejected -------------
dir="$(mktemp -d "$TMP_ROOT/case.XXXXXX")"
f="$dir/probe.md"
cat > "$f" <<'EOF'
---
name: probe
description: "Fixture carrying the legacy metadata.claude.model key alone."
metadata:
  claude:
    model: sonnet
---
Body.
EOF
run_case "metadata.claude.model alone is green" 0 "" "$f"

# --- an empty tuning: mapping is green (spec 0195 R17's own clause) -------
f="$(render_case_file probe '.metadata.model.tuning = {}')"
run_case "empty tuning: mapping is green" 0 "" "$f"

# --- a source with no metadata.model at all is green ----------------------
dir="$(mktemp -d "$TMP_ROOT/case.XXXXXX")"
f="$dir/probe.md"
cat > "$f" <<'EOF'
---
name: probe
description: "Fixture with no capability profile at all."
---
Body.
EOF
run_case "no metadata.model at all is green" 0 "" "$f"

# --- the build still compiles an offending source, degrading the key -----
BUILD_ROOT="$TMP_ROOT/build-root"
mkdir -p "$BUILD_ROOT/artifacts/core/agents/probe"
render_case_file probe '.metadata.model.intelligence = "bogus"' > /dev/null
f="$(render_case_file probe '.metadata.model.intelligence = "bogus"')"
cp "$f" "$BUILD_ROOT/artifacts/core/agents/probe/AGENT.md"
cp "$REPO_DIR/crewrig.config.toml" "$BUILD_ROOT/crewrig.config.toml"
cp -r "$REPO_DIR/model-mappings" "$BUILD_ROOT/model-mappings"
build_out="$(REPO_DIR="$BUILD_ROOT" bash "$BUILD_SCRIPT" --target claude 2>&1)"
build_rc=$?
if [ "$build_rc" -eq 0 ] && [ -f "$BUILD_ROOT/.claude/agents/probe/AGENT.md" ]; then
  echo "PASS  build still compiles an offending source (degrading the unreadable key, not failing)"
  pass=$((pass + 1))
else
  echo "FAIL  build still compiles an offending source (exit $build_rc)"
  printf '%s\n' "$build_out" | sed 's/^/  /'
  fail=$((fail + 1))
fi

echo ""
echo "=== Section 3 — exit 2, yq absent from PATH ==="

f="$(render_case_file probe)"
BASH_ABS="$(command -v bash)"
out="$(PATH=/nonexistent-dir-for-this-test "$BASH_ABS" "$SCRIPT_UNDER_TEST" "$f" 2>&1)"; rc=$?
if [ "$rc" -eq 2 ]; then
  echo "PASS  exit 2 — yq absent from PATH"
  pass=$((pass + 1))
else
  echo "FAIL  exit 2 — yq absent from PATH (got exit $rc): $out"
  fail=$((fail + 1))
fi

echo ""
echo "Results: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
