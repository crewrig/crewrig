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
echo "=== C1/C3-C7, C13(i) — the resolution rule engine (plan steps 2, 3, 8) ==="

. "$SCRIPT_DIR/lib/model-resolve.sh"

# write_fixture <path> [<metadata.model line>...] — an agent source whose
# metadata.model carries the given lines (each auto-indented under
# `metadata: model:`), or none at all when no line is given.
write_fixture() {
  local path="$1"
  shift
  {
    echo "---"
    echo "name: probe"
    echo 'description: "Probe agent."'
    if [ "$#" -gt 0 ]; then
      echo "metadata:"
      echo "  model:"
      printf '%s\n' "$@" | sed 's/^/    /'
    fi
    echo "---"
    echo "Body."
  } > "$path"
}

# diag_has <line...> — true iff every given literal line is a member of
# DIAG_LINES (set by the most recent resolve_agent call).
diag_has() {
  local want line found
  for want in "$@"; do
    found=0
    for line in ${DIAG_LINES[@]+"${DIAG_LINES[@]}"}; do
      [ "$line" = "$want" ] && { found=1; break; }
    done
    [ "$found" -eq 1 ] || return 1
  done
  return 0
}

diag_count() { echo "${#DIAG_LINES[@]}"; }

fm_has() {
  local want="$1" line
  for line in ${EMIT_FM_LINES[@]+"${EMIT_FM_LINES[@]}"}; do
    [ "$line" = "$want" ] && return 0
  done
  return 1
}

FIXTURE="$TMP_ROOT/probe.md"

# --- C1 — the canonical example on Claude Code ------------------------------
write_fixture "$FIXTURE" "intelligence: medium" "reasoning: medium"
resolve_agent probe "$FIXTURE" claude
if [ "$RESOLVED_OFFERING_ID" = "haiku" ] \
  && [ "${#EMIT_FM_LINES[@]}" -eq 0 ] \
  && [ "$EMIT_PROSE" = "Run this agent on the haiku model." ] \
  && [ "$(diag_count)" -eq 2 ] \
  && diag_has "$(printf 'model-drop\tprobe\tclaude\tmetadata.model.reasoning\tmedium\tunsupported-on-model')" \
              "$(printf 'model-note\tprobe\tclaude\tguard-withheld\tterms=defect-not-established-fixed,copilot-reader-consumes-claude-surface surface=guidance')"; then
  ok "C1 — canonical example: haiku selected, no fm fields, reasoning sentence omitted, one drop + one guard note"
else
  bad "C1 — canonical example" "offering=$RESOLVED_OFFERING_ID prose=[$EMIT_PROSE] n_fm=${#EMIT_FM_LINES[@]}" "${DIAG_LINES[@]+"${DIAG_LINES[@]}"}"
fi

# --- C3 — the resolver agrees with the mapping checker ----------------------
RUNGS="minimal low medium high xhigh xxhigh max"
c3_ok=1
c3_detail=""
for mapping_target in claude gemini copilot antigravity; do
  selection_table="$(bash "$SCRIPT_DIR/check-model-mappings.sh" --print-selection "$REPO_DIR/model-mappings/${mapping_target}.yml" | cut -f2,3)"
  for rung in $RUNGS; do
    checker_id="$(printf '%s\n' "$selection_table" | awk -F'\t' -v r="$rung" '$1 == r { print $2 }')"
    write_fixture "$FIXTURE" "intelligence: $rung"
    resolve_agent probe "$FIXTURE" "$mapping_target"
    if [ "$RESOLVED_OFFERING_ID" != "$checker_id" ]; then
      c3_ok=0
      c3_detail="$c3_detail
  mismatch: target=$mapping_target rung=$rung checker=$checker_id resolver=$RESOLVED_OFFERING_ID"
    fi
  done
done
if [ "$c3_ok" -eq 1 ]; then
  ok "C3 — resolve_agent agrees with check-model-mappings.sh --print-selection for all 4 mappings x 7 rungs (copilot selects none for any rung)"
else
  bad "C3 — resolve_agent agrees with check-model-mappings.sh --print-selection" "$c3_detail"
fi

# --- C4 — a composite offering carries reasoning through selection ---------
write_fixture "$FIXTURE" "intelligence: medium" "reasoning: high"
resolve_agent probe "$FIXTURE" antigravity
if [ "$RESOLVED_OFFERING_ID" = "gemini-3.8-flash-high" ] \
  && [ "${#EMIT_FM_LINES[@]}" -eq 0 ] \
  && [ "$EMIT_PROSE" = "Run this agent on the gemini-3.8-flash-high model." ] \
  && [ "$(diag_count)" -eq 0 ]; then
  ok "C4 — composite offering: gemini-3.8-flash-high selected (medium-rung floor selects gemini-3.8-flash-low alone), zero records"
else
  bad "C4 — composite offering carries reasoning" "offering=$RESOLVED_OFFERING_ID prose=[$EMIT_PROSE] n_diag=$(diag_count)"
fi

# --- C5 — an unconfigured target (GitHub Copilot CLI) emits nothing --------
write_fixture "$FIXTURE" "intelligence: xhigh" "reasoning: high"
resolve_agent probe "$FIXTURE" copilot
if [ -z "$RESOLVED_OFFERING_ID" ] \
  && [ "${#EMIT_FM_LINES[@]}" -eq 0 ] \
  && [ -z "$EMIT_PROSE" ] \
  && [ "$(diag_count)" -eq 2 ] \
  && diag_has "$(printf 'model-drop\tprobe\tcopilot\tmetadata.model.intelligence\txhigh\tunsupported-on-cli')" \
              "$(printf 'model-drop\tprobe\tcopilot\tmetadata.model.reasoning\thigh\tunsupported-on-cli')"; then
  ok "C5 — unconfigured target: no offering, no fields, two unsupported-on-cli drops (D14's intelligence dotted-path)"
else
  bad "C5 — unconfigured target emits nothing" "n_fm=${#EMIT_FM_LINES[@]} n_diag=$(diag_count)" "${DIAG_LINES[@]+"${DIAG_LINES[@]}"}"
fi

# --- C6 — a target with no mapping file at all ------------------------------
write_fixture "$FIXTURE" "intelligence: xhigh" "reasoning: high" "context: 500"
resolve_agent probe "$FIXTURE" no-such-target-at-all
if [ -z "$RESOLVED_OFFERING_ID" ] \
  && [ "${#EMIT_FM_LINES[@]}" -eq 0 ] \
  && [ "$(diag_count)" -eq 1 ] \
  && diag_has "$(printf 'model-note\tprobe\tno-such-target-at-all\tno-mapping\tno mapping file is present for target no-such-target-at-all')"; then
  ok "C6 — a target with no mapping file: no failure, no fields, one no-mapping note"
else
  bad "C6 — a target with no mapping file" "n_diag=$(diag_count)" "${DIAG_LINES[@]+"${DIAG_LINES[@]}"}"
fi

# --- C7 — a malformed mapping cell degrades instead of failing -------------
MALFORMED_ROOT="$TMP_ROOT/c7-root"
mkdir -p "$MALFORMED_ROOT/model-mappings"
cp "$REPO_DIR/model-mappings/gemini.yml" "$MALFORMED_ROOT/model-mappings/gemini.yml"
yq eval -i '.offerings[1]."native-value" = "not-a-domain-member"' "$MALFORMED_ROOT/model-mappings/gemini.yml"
write_fixture "$FIXTURE" "intelligence: medium"
EXPECTED_UNREADABLE_NOTE="$(printf 'model-note\tprobe\tgemini\tunreadable-cell\toffering=gemini-3.5-flash native-value=not-a-domain-member outside the frontmatter model key'"'"'s declared domain')"
(
  REPO_DIR="$MALFORMED_ROOT"
  resolve_agent probe "$FIXTURE" gemini
  [ "${#EMIT_FM_LINES[@]}" -eq 0 ] && diag_has "$EXPECTED_UNREADABLE_NOTE"
)
c7_resolve_ok=$?
checker_out="$(bash "$SCRIPT_DIR/check-model-mappings.sh" "$MALFORMED_ROOT/model-mappings/gemini.yml" 2>&1)"
checker_rc=$?
if [ "$checker_rc" -eq 1 ] && printf '%s\n' "$checker_out" | grep -qF ': A9 '; then
  c7_checker_ok=1
else
  c7_checker_ok=0
fi
if [ "$c7_resolve_ok" -eq 0 ] && [ "$c7_checker_ok" -eq 1 ]; then
  ok "C7 — malformed cell degrades: no field derived, one unreadable-cell note, and check-model-mappings.sh rejects it on A9"
else
  bad "C7 — malformed mapping cell degrades instead of failing" "resolve_ok=$c7_resolve_ok checker_ok=$c7_checker_ok" "$checker_out"
fi

# --- C13(i) — an intelligence-only profile records nothing beyond its own --
# axes (the v2-F1 case: the shape seam (f) will put on most of the 22 core
# sources). Claude half: --resolve equivalent via resolve_agent directly.
write_fixture "$FIXTURE" "intelligence: medium"
resolve_agent probe "$FIXTURE" claude
if [ "$RESOLVED_OFFERING_ID" = "haiku" ] \
  && [ "${#EMIT_FM_LINES[@]}" -eq 0 ] \
  && [ "$EMIT_PROSE" = "Run this agent on the haiku model." ] \
  && [ "$(diag_count)" -eq 1 ] \
  && diag_has "$(printf 'model-note\tprobe\tclaude\tguard-withheld\tterms=defect-not-established-fixed,copilot-reader-consumes-claude-surface surface=guidance')"; then
  ok "C13(i) — intelligence-only profile on claude: haiku, zero model-drop records, one guard note"
else
  bad "C13(i) — intelligence-only profile on claude" "offering=$RESOLVED_OFFERING_ID n_diag=$(diag_count)" "${DIAG_LINES[@]+"${DIAG_LINES[@]}"}"
fi

# --- Rule (b) exhaustiveness — an intelligence-absent profile records EXACTLY
# one drop for a declared reasoning axis (the concrete failure v3-F3 names:
# without (g)(0)(ii), a second unsupported-on-model record would appear for
# the same dropped item, contradicting spec 0197 R27's one-record-per-drop).
write_fixture "$FIXTURE" "reasoning: medium"
resolve_agent probe "$FIXTURE" claude
if [ -z "$RESOLVED_OFFERING_ID" ] \
  && [ "$(diag_count)" -eq 1 ] \
  && diag_has "$(printf 'model-drop\tprobe\tclaude\tmetadata.model.reasoning\tmedium\tunserved-value')"; then
  ok "rule (b) — intelligence-absent + reasoning declared: exactly one unserved-value record, no second record"
else
  bad "rule (b) — intelligence-absent + reasoning declared" "n_diag=$(diag_count)" "${DIAG_LINES[@]+"${DIAG_LINES[@]}"}"
fi

# --- M7 — remove (g)(0) condition (i) from a scratch copy of the resolver;
# both C13(i) and the rule-(b) case above must turn red.
M7_LIB="$TMP_ROOT/model-resolve.m7.sh"
sed 's/\[ "\$(profile_declares_item "\$item")" != true \] && return 0/: # M7: condition (i) removed/' \
  "$SCRIPT_DIR/lib/model-resolve.sh" > "$M7_LIB"
if diff -q "$SCRIPT_DIR/lib/model-resolve.sh" "$M7_LIB" >/dev/null 2>&1; then
  bad "M7 — mutation actually changed the resolver source" "sed pattern did not match; mutation is a no-op"
else
  (
    unset -f resolve_agent _resolve_item profile_declares_item 2>/dev/null
    . "$M7_LIB"
    write_fixture "$FIXTURE" "reasoning: medium"
    resolve_agent probe "$FIXTURE" claude
    [ "$(diag_count)" -eq 1 ]
  )
  m7_rule_b_red=$?
  (
    . "$M7_LIB"
    write_fixture "$FIXTURE" "intelligence: medium"
    resolve_agent probe "$FIXTURE" gemini
    [ "${#EMIT_FM_LINES[@]}" -eq 1 ]
  )
  m7_gemini_still_one_fm=$?
  if [ "$m7_rule_b_red" -ne 0 ]; then
    ok "M7 — removing (g)(0) condition (i) turns the rule-(b) exhaustiveness case red (a second record appears)"
  else
    bad "M7 — removing (g)(0) condition (i) did not turn the rule-(b) case red" "the eligibility gate is not load-bearing as written"
  fi
fi

echo ""
echo "Results: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
