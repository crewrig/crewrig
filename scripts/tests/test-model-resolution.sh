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
echo "=== O0 — silent org channel stubs: drift check green, compiled agent trees byte-identical (spec 0199 plan step 1; R8, R9, R47) ==="

# AGENT_TREES — the four compiled agent output trees reclassified
# `regenerable` by this ticket (spec 0199 R43). Upstream's four org channel
# stubs (model-mappings/*.org.yml) declare nothing, so no compiled output may
# move on their account (R47): the byte-identity check below is what proves
# that structurally rather than by inspection.
AGENT_TREES=".claude/agents .gemini/agents .github/agents .agents/agents"

# hash_agent_trees — SHA-256 of every file under the four compiled agent
# trees, one "<hash> <repo-relative-path>" line per file, sorted by path. A
# per-run baseline: O0 pins it before any production edit and re-compares it
# once at the close of this suite (below), after every other case in this
# file — including every throwaway-root build this suite runs — has had its
# chance to leave something behind in the real, non-overridden $REPO_DIR.
hash_agent_trees() {
  local tree
  for tree in $AGENT_TREES; do
    [ -d "$REPO_DIR/$tree" ] || continue
    find "$REPO_DIR/$tree" -type f | sort | while IFS= read -r f; do
      if command -v shasum >/dev/null 2>&1; then
        shasum -a 256 "$f"
      else
        sha256sum "$f"
      fi
    done | sed "s#$REPO_DIR/##"
  done
}

O0_BASELINE="$(hash_agent_trees)"

out="$(bash "$BUILD_SCRIPT" --target all --check 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] && printf '%s\n' "$out" | grep -qF "OK: All generated files match source."; then
  ok "O0 — silent org channel stubs: --target all --check exits 0 printing the OK line"
else
  bad "O0 — silent org channel stubs: --target all --check exits 0" "exit=$rc" "$out"
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

# mutated_root <suffix> <yq-expr against a copy of model-mappings/claude.yml>
# Echoes the throwaway REPO_DIR root.
mutated_root() {
  local suffix="$1" expr="$2" root
  root="$TMP_ROOT/mut-$suffix"
  mkdir -p "$root/model-mappings"
  cp -r "$REPO_DIR/model-mappings"/* "$root/model-mappings/"
  yq eval -i "$expr" "$root/model-mappings/claude.yml" >/dev/null
  echo "$root"
}

# setup_emission_root <root> [<yq-expr against a copy of model-mappings/claude.yml>...]
# A throwaway artifacts/core/agents/probe/AGENT.md (the canonical fixture),
# a copy of the real crewrig.config.toml (risk 5: load_crewrig_config's own
# "not found" warning lands on stderr, the same stream the record
# assertions read), and a copy of model-mappings/ — mutated in place by
# each yq expression against claude.yml, if any are given.
setup_emission_root() {
  local root="$1"
  shift
  mkdir -p "$root/artifacts/core/agents/probe"
  cp "$FIXTURES_DIR/canonical-medium-reasoning.md" "$root/artifacts/core/agents/probe/AGENT.md"
  cp "$REPO_DIR/crewrig.config.toml" "$root/crewrig.config.toml"
  cp -r "$REPO_DIR/model-mappings" "$root/model-mappings"
  local e
  for e in "$@"; do
    yq eval -i "$e" "$root/model-mappings/claude.yml" >/dev/null
  done
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

# --- R7's tail clause — intelligence absent SHALL still direct the tuning
# knobs the target expresses on its frontmatter surface.
write_fixture "$FIXTURE" "reasoning: medium" "tuning:
  temperature: 0.5
  max-turns: 7"
resolve_agent probe "$FIXTURE" gemini
if [ -z "$RESOLVED_OFFERING_ID" ] \
  && fm_has "temperature: 0.5" && fm_has "max_turns: 7" \
  && [ "$(diag_count)" -eq 1 ] \
  && diag_has "$(printf 'model-drop\tprobe\tgemini\tmetadata.model.reasoning\tmedium\tunserved-value')"; then
  ok "R7 tail clause — intelligence absent still directs the tuning knobs the target expresses"
else
  bad "R7 tail clause — tuning knobs directed while intelligence absent" "n_fm=${#EMIT_FM_LINES[@]} n_diag=$(diag_count)" "${EMIT_FM_LINES[@]+"${EMIT_FM_LINES[@]}"}"
fi

# --- rule (d) — the five narrowings, v3-F3's remaining gap: no committed
# claude.yml offering declares a context window, so a context floor always
# empties the narrowing and is abandoned (spec 0197's own scenario).
write_fixture "$FIXTURE" "intelligence: medium" "context: 1000000"
resolve_agent probe "$FIXTURE" claude
if [ "$RESOLVED_OFFERING_ID" = "haiku" ] \
  && diag_has "$(printf 'model-drop\tprobe\tclaude\tmetadata.model.context\t1000000\tunserved-value')"; then
  ok "rule (d) — a context floor no claude offering declares is dropped, selection unchanged (haiku)"
else
  bad "rule (d) — context narrowing" "offering=$RESOLVED_OFFERING_ID" "${DIAG_LINES[@]+"${DIAG_LINES[@]}"}"
fi

# --- rule (d) — the general specialization fallback (R10, spec 0195 R12):
# no committed gemini offering serves an unenumerated specialization, so it
# falls back to general and records one unserved-value drop.
write_fixture "$FIXTURE" "intelligence: high" "specialization: image-generation"
resolve_agent probe "$FIXTURE" gemini
if [ "$RESOLVED_OFFERING_ID" = "gemini-3.1-pro-preview" ] \
  && diag_has "$(printf 'model-drop\tprobe\tgemini\tmetadata.model.specialization\timage-generation\tunserved-value')"; then
  ok "rule (d) — a specialization no gemini offering serves falls back to general"
else
  bad "rule (d) — specialization fallback" "offering=$RESOLVED_OFFERING_ID" "${DIAG_LINES[@]+"${DIAG_LINES[@]}"}"
fi

# --- rule (e) — an inexact encoded match is noted, not dropped (spec 0197's
# own scenario): antigravity's high-rung offerings encode low and high, none
# encodes medium, so the nearest-below rung (low, pro-low) is selected.
write_fixture "$FIXTURE" "intelligence: high" "reasoning: medium"
resolve_agent probe "$FIXTURE" antigravity
if [ "$RESOLVED_OFFERING_ID" = "gemini-3.1-pro-low" ] \
  && [ "$(diag_count)" -eq 1 ] \
  && diag_has "$(printf 'model-note\tprobe\tantigravity\treasoning-rung-substituted\tdeclared=medium encoded=low')"; then
  ok "rule (e) — an inexact encoded match selects the nearest lower rung and notes it, no drop"
else
  bad "rule (e) — inexact encoded match" "offering=$RESOLVED_OFFERING_ID n_diag=$(diag_count)" "${DIAG_LINES[@]+"${DIAG_LINES[@]}"}"
fi

# --- R24/D16 — a tuning knob is dropped unsupported-on-cli wherever the
# target's FRONTMATTER surface declares no item for it, even where a
# guidance surface exists (claude) or no surface at all exists (antigravity)
# — D16's item-class-specific (g)(3) predicate, frontmatter-only for knobs.
write_fixture "$FIXTURE" "intelligence: medium" "tuning:
  temperature: 0.5"
resolve_agent probe "$FIXTURE" claude
if diag_has "$(printf 'model-drop\tprobe\tclaude\tmetadata.model.tuning.temperature\t0.5\tunsupported-on-cli')"; then
  ok "R24/D16 — claude drops a tuning knob unsupported-on-cli (frontmatter declares none, guidance is irrelevant)"
else
  bad "R24/D16 — claude tuning knob drop" "${DIAG_LINES[@]+"${DIAG_LINES[@]}"}"
fi

resolve_agent probe "$FIXTURE" antigravity
if diag_has "$(printf 'model-drop\tprobe\tantigravity\tmetadata.model.tuning.temperature\t0.5\tunsupported-on-cli')"; then
  ok "R24/D16 — antigravity drops a tuning knob unsupported-on-cli (no frontmatter surface at all)"
else
  bad "R24/D16 — antigravity tuning knob drop" "${DIAG_LINES[@]+"${DIAG_LINES[@]}"}"
fi

# --- (g)(6) — R15's first sentence: a tuning knob's declared value falls
# outside the domain gemini's frontmatter surface declares for it.
write_fixture "$FIXTURE" "intelligence: medium" "tuning:
  temperature: 5.0"
resolve_agent probe "$FIXTURE" gemini
gemini_fm_joined=$(printf '%s\n' ${EMIT_FM_LINES[@]+"${EMIT_FM_LINES[@]}"})
if ! printf '%s' "$gemini_fm_joined" | grep -q '^temperature:' \
  && diag_has "$(printf 'model-drop\tprobe\tgemini\tmetadata.model.tuning.temperature\t5.0\tout-of-range-for-target')"; then
  ok "(g)(6) — an out-of-domain tuning value is dropped out-of-range-for-target"
else
  bad "(g)(6) — tuning value out of domain" "${DIAG_LINES[@]+"${DIAG_LINES[@]}"}"
fi

# --- (g)(5) — R13: a reasoning rung the projection declares unmapped is
# dropped out-of-range-for-target, never resolved to an adjacent rung
# (spec 0197's own scenario: claude.yml projects none: unmapped).
write_fixture "$FIXTURE" "intelligence: high" "reasoning: none"
resolve_agent probe "$FIXTURE" claude
if [ "$RESOLVED_OFFERING_ID" = "sonnet" ] \
  && [ "${#EMIT_FM_LINES[@]}" -eq 0 ] \
  && diag_has "$(printf 'model-drop\tprobe\tclaude\tmetadata.model.reasoning\tnone\tout-of-range-for-target')"; then
  ok "(g)(5) — reasoning: none projects unmapped on claude, dropped out-of-range-for-target, never resolved to low"
else
  bad "(g)(5) — unmapped projection" "offering=$RESOLVED_OFFERING_ID n_fm=${#EMIT_FM_LINES[@]}" "${DIAG_LINES[@]+"${DIAG_LINES[@]}"}"
fi

# --- D12/D17's second disjunct — R14 fires on "no offering was selected at
# all", not only on a refusing offering. Unreachable on any committed
# mapping (risk 9): a temp claude.yml copy with offerings: [] keeps its
# frontmatter reasoning surface, so the empty candidate set (D17) reaches
# (g)(4)'s second clause instead of (g)(3) taking the item first.
D12_ROOT="$(mutated_root d12 '.offerings = []')"
write_fixture "$FIXTURE" "intelligence: medium" "reasoning: medium"
REPO_DIR="$D12_ROOT" resolve_agent probe "$FIXTURE" claude
if [ -z "$RESOLVED_OFFERING_ID" ] \
  && diag_has "$(printf 'model-drop\tprobe\tclaude\tmetadata.model.reasoning\tmedium\tunsupported-on-model')"; then
  ok "D12/D17 — no offering selected at all still fires R14's second disjunct (temp mapping, risk 9)"
else
  bad "D12/D17 — R14's no-offering-selected disjunct" "offering=$RESOLVED_OFFERING_ID" "${DIAG_LINES[@]+"${DIAG_LINES[@]}"}"
fi

# --- C10 — a guidance surface retired without touching the resolver. With
# the shared-read guard withheld and no guidance surface left to redirect
# onto, the model item is now unsupported-on-cli rather than directed
# nowhere; R44's "no line of the emission is changed" is discharged by this
# case's own construction (no resolver line changed to write it).
C10_ROOT="$(mutated_root c10 'del(.surfaces[] | select(.id == "guidance"))')"
write_fixture "$FIXTURE" "intelligence: medium" "reasoning: medium"
REPO_DIR="$C10_ROOT" resolve_agent probe "$FIXTURE" claude
if [ "$RESOLVED_OFFERING_ID" = "haiku" ] && [ -z "$EMIT_PROSE" ] \
  && diag_has "$(printf 'model-drop\tprobe\tclaude\tmetadata.model.intelligence\tmedium\tunsupported-on-cli')"; then
  ok "C10 — retiring the guidance surface: no prose anywhere, model dropped unsupported-on-cli"
else
  bad "C10 — guidance surface retired" "offering=$RESOLVED_OFFERING_ID prose=[$EMIT_PROSE]" "${DIAG_LINES[@]+"${DIAG_LINES[@]}"}"
fi

# --- C9 — a mapping change without regenerated outputs fails the drift
# check, plus a mechanical assertion that model-mappings/** sits at all
# seven CI edit sites (R45/R46) — not a "documented CI scenario" standing
# in for a test.
C9_ROOT="$TMP_ROOT/c9-root"
setup_emission_root "$C9_ROOT"
REPO_DIR="$C9_ROOT" bash "$BUILD_SCRIPT" --target claude >/dev/null 2>/dev/null
yq eval -i '.offerings[0]."native-value" = "haiku-drifted"' "$C9_ROOT/model-mappings/claude.yml"
c9_out="$(REPO_DIR="$C9_ROOT" bash "$BUILD_SCRIPT" --target claude --check 2>&1)"
c9_rc=$?
if [ "$c9_rc" -ne 0 ] && printf '%s\n' "$c9_out" | grep -q "^DRIFT:"; then
  ok "C9 — a mapping change without regenerated outputs fails the drift check"
else
  bad "C9 — mapping-only drift" "exit=$c9_rc" "$c9_out"
fi

# Scoped to the component-drift block alone: ci-capabilities.yml and
# build.yml both name model-mappings/** elsewhere too (check-model-mappings'
# own trigger, the misc capability), which the R45 obligation does not bind.
c9_cap_count="$(awk '/^  - id: component-drift/{f=1} f && /^  - id:/ && !/component-drift/{exit} f' "$REPO_DIR/ci/ci-capabilities.yml" | grep -c 'model-mappings/\*\*')"
c9_gha_count="$(awk '/^  component-drift:/{f=1} f && /^  [a-z-]+:$/ && !/component-drift/{exit} f' "$REPO_DIR/.github/workflows/build.yml" | grep -c 'model-mappings/\*\*')"
if [ "$c9_cap_count" -eq 3 ] && [ "$c9_gha_count" -ge 4 ]; then
  ok "C9 — model-mappings/** sits at all seven CI edit sites (3 in ci-capabilities.yml, $c9_gha_count in build.yml)"
else
  bad "C9 — mechanical CI edit-site count" "ci-capabilities.yml=$c9_cap_count build.yml=$c9_gha_count"
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
  if [ "$m7_rule_b_red" -ne 0 ]; then
    ok "M7 — removing (g)(0) condition (i) turns the rule-(b) exhaustiveness case red (a second record appears)"
  else
    bad "M7 — removing (g)(0) condition (i) did not turn the rule-(b) case red" "the eligibility gate is not load-bearing as written"
  fi
fi

echo ""
echo "=== C11-C13 — emission (plan steps 4, 6, 7): real builds in throwaway roots ==="

C11_ROOT="$TMP_ROOT/c11-root"
setup_emission_root "$C11_ROOT" '.guard.state = "directed"'
C11_FIXTURE="$C11_ROOT/artifacts/core/agents/probe/AGENT.md"

resolve_out="$(REPO_DIR="$C11_ROOT" bash "$BUILD_SCRIPT" --resolve "$C11_FIXTURE" claude 2>"$TMP_ROOT/c11-resolve.err")"
c11_resolve_native="$(printf '%s\n' "$resolve_out" | sed -n 's/^native: //p')"
c11_resolve_fm="$(printf '%s\n' "$resolve_out" | sed -n 's/^fm: //p' | sort)"

REPO_DIR="$C11_ROOT" bash "$BUILD_SCRIPT" --target claude >/dev/null 2>"$TMP_ROOT/c11-build.err"
c11_compiled_fm="$(extract_frontmatter "$C11_ROOT/.claude/agents/probe-canonical/AGENT.md" | grep -E '^(model|effort):' | sort)"
c11_compiled_model="$(extract_frontmatter "$C11_ROOT/.claude/agents/probe-canonical/AGENT.md" | grep '^model:' | sed 's/^model: //')"

# (ii) directed items via a baseline diff: the same fixture without its
# metadata.model block, built in a second throwaway root, diffed against
# the compiled output above — the added lines must equal --resolve's fm:
# set exactly (no provenance-splice filtering needed, unlike a source diff).
C11_BASE_ROOT="$TMP_ROOT/c11-base-root"
setup_emission_root "$C11_BASE_ROOT" '.guard.state = "directed"'
sed '/^metadata:/,/reasoning: medium/d' "$C11_FIXTURE" > "$C11_BASE_ROOT/artifacts/core/agents/probe/AGENT.md"
REPO_DIR="$C11_BASE_ROOT" bash "$BUILD_SCRIPT" --target claude >/dev/null 2>/dev/null
c11_base_fm="$(extract_frontmatter "$C11_BASE_ROOT/.claude/agents/probe-canonical/AGENT.md" | grep -E '^(model|effort):' | sort)"
c11_added_lines="$(diff <(printf '%s\n' "$c11_base_fm") <(printf '%s\n' "$c11_compiled_fm") | sed -n 's/^> //p' | sort)"

# (iii)/(iv) drop records and notes: the two stderr sets are equal.
c11_resolve_diag="$(sort "$TMP_ROOT/c11-resolve.err")"
c11_build_diag="$(sort "$TMP_ROOT/c11-build.err")"

if [ "$c11_resolve_native" = "$c11_compiled_model" ] \
  && [ "$c11_resolve_fm" = "$c11_added_lines" ] \
  && [ "$c11_resolve_diag" = "$c11_build_diag" ]; then
  ok "C11 — --resolve and the build agree: offering, directed items (baseline diff), drop records and notes"
else
  bad "C11 — R6's standalone exercise" \
    "native=[$c11_resolve_native] compiled_model=[$c11_compiled_model]" \
    "resolve_fm=[$c11_resolve_fm] added_lines=[$c11_added_lines]" \
    "resolve_diag=[$c11_resolve_diag]" "build_diag=[$c11_build_diag]"
fi

# --- C12 — R5's --target independence, all four targets. Claude is the
# first branch that appends a fragment under an in-place-append defect
# (gemini declares no guidance surface, so its branch appends nothing), so
# all four are compared, not claude alone (a claude-only comparison would be
# vacuous for exactly the mechanism this case exists to catch).
C12_ALL_ROOT="$TMP_ROOT/c12-all-root"
C12_GEMINI_ROOT="$TMP_ROOT/c12-gemini-root"
C12_CLAUDE_ROOT="$TMP_ROOT/c12-claude-root"
C12_COPILOT_ROOT="$TMP_ROOT/c12-copilot-root"
C12_ANTIGRAVITY_ROOT="$TMP_ROOT/c12-antigravity-root"
for r in "$C12_ALL_ROOT" "$C12_GEMINI_ROOT" "$C12_CLAUDE_ROOT" "$C12_COPILOT_ROOT" "$C12_ANTIGRAVITY_ROOT"; do
  setup_emission_root "$r"
done
REPO_DIR="$C12_ALL_ROOT" bash "$BUILD_SCRIPT" --target all >/dev/null 2>"$TMP_ROOT/c12-all.err"
REPO_DIR="$C12_GEMINI_ROOT" bash "$BUILD_SCRIPT" --target gemini >/dev/null 2>"$TMP_ROOT/c12-gemini.err"
REPO_DIR="$C12_CLAUDE_ROOT" bash "$BUILD_SCRIPT" --target claude >/dev/null 2>"$TMP_ROOT/c12-claude.err"
REPO_DIR="$C12_COPILOT_ROOT" bash "$BUILD_SCRIPT" --target copilot >/dev/null 2>"$TMP_ROOT/c12-copilot.err"
REPO_DIR="$C12_ANTIGRAVITY_ROOT" bash "$BUILD_SCRIPT" --target antigravity >/dev/null 2>"$TMP_ROOT/c12-antigravity.err"

c12_ok=1
c12_detail=""
assert_slice() {
  local label="$1" all_file="$2" single_file="$3" all_err_grep="$4" single_err="$5"
  if ! diff -q "$all_file" "$single_file" >/dev/null 2>&1; then
    c12_ok=0
    c12_detail="$c12_detail
  $label output differs between --target all and --target $label"
  fi
  local a s
  a="$(grep -F "	$all_err_grep	" "$TMP_ROOT/c12-all.err" | sort)"
  s="$(sort "$single_err")"
  if [ "$a" != "$s" ]; then
    c12_ok=0
    c12_detail="$c12_detail
  $label stderr slice differs between --target all and --target $label"
  fi
}
assert_slice gemini "$C12_ALL_ROOT/.gemini/agents/probe-canonical.md" "$C12_GEMINI_ROOT/.gemini/agents/probe-canonical.md" gemini "$TMP_ROOT/c12-gemini.err"
assert_slice claude "$C12_ALL_ROOT/.claude/agents/probe-canonical/AGENT.md" "$C12_CLAUDE_ROOT/.claude/agents/probe-canonical/AGENT.md" claude "$TMP_ROOT/c12-claude.err"
assert_slice copilot "$C12_ALL_ROOT/.github/agents/probe-canonical.md" "$C12_COPILOT_ROOT/.github/agents/probe-canonical.md" copilot "$TMP_ROOT/c12-copilot.err"
assert_slice antigravity "$C12_ALL_ROOT/.agents/agents/probe-canonical/AGENT.md" "$C12_ANTIGRAVITY_ROOT/.agents/agents/probe-canonical/AGENT.md" antigravity "$TMP_ROOT/c12-antigravity.err"

if [ "$c12_ok" -eq 1 ]; then
  ok "C12 — --target all's per-target slice equals the matching --target <X> run, output and stderr, all four targets"
else
  bad "C12 — R5's --target independence" "$c12_detail"
fi

# --- C13(iii) — the compiled frontmatter carries no key beyond what an
# intelligence-only profile's own axes direct.
C13_ROOT="$TMP_ROOT/c13-root"
setup_emission_root "$C13_ROOT"
sed '/reasoning: medium/d' "$C13_ROOT/artifacts/core/agents/probe/AGENT.md" > "$TMP_ROOT/c13-fixture.tmp"
mv "$TMP_ROOT/c13-fixture.tmp" "$C13_ROOT/artifacts/core/agents/probe/AGENT.md"
REPO_DIR="$C13_ROOT" bash "$BUILD_SCRIPT" --target claude >/dev/null 2>/dev/null
c13_keys="$(extract_frontmatter "$C13_ROOT/.claude/agents/probe-canonical/AGENT.md" | yq -r 'keys | .[]' | sort | tr '\n' ' ')"
if [ "$c13_keys" = "description name " ]; then
  ok "C13(iii) — intelligence-only profile compiles with no frontmatter key beyond name/description"
else
  bad "C13(iii) — intelligence-only profile's compiled frontmatter key set" "got: $c13_keys"
fi

# --- C13(ii) — the gemini half: no fm: line for temperature/max_turns and
# zero model-drop records for an intelligence-only profile (via --resolve,
# so the case is independent of any Gemini emission gate).
write_fixture "$FIXTURE" "intelligence: medium"
resolve_agent probe "$FIXTURE" gemini
fm_joined=$(printf '%s\n' ${EMIT_FM_LINES[@]+"${EMIT_FM_LINES[@]}"})
if fm_has "model: gemini-3.5-flash" \
  && ! printf '%s' "$fm_joined" | grep -q '^temperature:' \
  && ! printf '%s' "$fm_joined" | grep -q '^max_turns:' \
  && [ "$(diag_count)" -eq 0 ]; then
  ok "C13(ii) — intelligence-only profile on gemini: model directed, no tuning fm lines, zero model-drop records"
else
  bad "C13(ii) — intelligence-only profile on gemini" "n_fm=${#EMIT_FM_LINES[@]} n_diag=$(diag_count)" "${EMIT_FM_LINES[@]+"${EMIT_FM_LINES[@]}"}"
fi

# --- R21 accept branch — a golden Gemini frontmatter case: a profile
# declaring all three Gemini-expressible items compiles model/temperature/
# max_turns in the mapping's declared item order, and the guidance-less
# target emits no prose.
R21_ROOT="$TMP_ROOT/r21-root"
setup_emission_root "$R21_ROOT"
cat > "$R21_ROOT/artifacts/core/agents/probe/AGENT.md" <<'EOF'
---
name: probe
description: "Probe."
metadata:
  model:
    intelligence: high
    tuning:
      temperature: 0.7
      max-turns: 12
---
Body.
EOF
REPO_DIR="$R21_ROOT" bash "$BUILD_SCRIPT" --target gemini >/dev/null 2>/dev/null
r21_fm="$(extract_frontmatter "$R21_ROOT/.gemini/agents/probe.md" | grep -E '^(model|temperature|max_turns):')"
r21_expected="model: gemini-3.1-pro-preview
temperature: 0.7
max_turns: 12"
if [ "$r21_fm" = "$r21_expected" ]; then
  ok "R21 accept branch — Gemini frontmatter golden: model, temperature, max_turns in mapping order, no prose"
else
  bad "R21 accept branch — Gemini frontmatter golden" "expected:" "$r21_expected" "got:" "$r21_fm"
fi

echo ""
echo "=== Mutations M1-M6 (plan step 14; M7 already ran above) ==="

# --- M1 — change haiku's native-value; the emitted sentence must change ---
M1_ROOT="$(mutated_root m1 '.offerings[0]."native-value" = "haiku-mutated-M1"')"
write_fixture "$FIXTURE" "intelligence: medium"
REPO_DIR="$M1_ROOT" resolve_agent probe "$FIXTURE" claude
if [ "$EMIT_PROSE" = "Run this agent on the haiku-mutated-M1 model." ]; then
  ok "M1 — mutating haiku's native-value changes the emitted description sentence"
else
  bad "M1 — mutating haiku's native-value" "got prose: [$EMIT_PROSE]"
fi

# --- M2 — deleting reasoning: medium removes the reasoning drop and adds
# no other record (the before/after contrast: C1's fixture has 2 records,
# the reasoning axis removed leaves exactly 1 — the guard note alone).
write_fixture "$FIXTURE" "intelligence: medium" "reasoning: medium"
resolve_agent probe "$FIXTURE" claude
m2_before_count=$(diag_count)
write_fixture "$FIXTURE" "intelligence: medium"
resolve_agent probe "$FIXTURE" claude
m2_after_count=$(diag_count)
if [ "$m2_before_count" -eq 2 ] && [ "$m2_after_count" -eq 1 ] \
  && ! diag_has "$(printf 'model-drop\tprobe\tclaude\tmetadata.model.reasoning\tmedium\tunsupported-on-model')"; then
  ok "M2 — removing reasoning: medium drops the reasoning record and adds no other (2 records -> 1)"
else
  bad "M2 — removing reasoning: medium" "before=$m2_before_count after=$m2_after_count"
fi

# --- M3 — flip guard.state to directed: model: appears, guard note vanishes
M3_ROOT="$(mutated_root m3 '.guard.state = "directed"')"
write_fixture "$FIXTURE" "intelligence: medium"
REPO_DIR="$M3_ROOT" resolve_agent probe "$FIXTURE" claude
if fm_has "model: haiku" && [ "$(diag_count)" -eq 0 ]; then
  ok "M3 — flipping guard.state to directed emits model: and the guard-withheld note vanishes"
else
  bad "M3 — guard.state directed" "n_fm=${#EMIT_FM_LINES[@]} n_diag=$(diag_count)"
fi

# --- M4 — adding an offering moves the C3 agreement table in lockstep -----
M4_ROOT="$(mutated_root m4 '.offerings += [{"id": "m4-cheap", "rank": 0, "native-value": "m4-cheap", "provides": {"intelligence": "xhigh", "specialization": "general"}, "encodes": {"intelligence": "m4-cheap"}, "supports-reasoning-surface": false, "grounds": [{"declares": "native-value", "assumption": "mutation fixture"}, {"declares": "provides.intelligence", "assumption": "mutation fixture"}, {"declares": "supports-reasoning-surface", "assumption": "mutation fixture"}]}]')"
write_fixture "$FIXTURE" "intelligence: xhigh"
REPO_DIR="$M4_ROOT" resolve_agent probe "$FIXTURE" claude
m4_resolver_pick="$RESOLVED_OFFERING_ID"
m4_checker_pick="$(bash "$SCRIPT_DIR/check-model-mappings.sh" --print-selection "$M4_ROOT/model-mappings/claude.yml" | awk -F'\t' '$2 == "xhigh" { print $3 }')"
if [ "$m4_resolver_pick" = "m4-cheap" ] && [ "$m4_checker_pick" = "m4-cheap" ]; then
  ok "M4 — adding a rank-0 offering moves both the resolver's pick and the checker's agreement table to it"
else
  bad "M4 — adding an offering" "resolver=$m4_resolver_pick checker=$m4_checker_pick"
fi

# --- M5 — rename {{model}} to {{modell}}: sentence omitted, never rendered
# literally (an unrecognised placeholder is dropped, not passed through).
M5_ROOT="$(mutated_root m5 '(.surfaces[] | select(.id == "guidance") | .template) = "Run this agent on the {{modell}} model.\nGive its work {{reasoning}} reasoning effort.\n"')"
write_fixture "$FIXTURE" "intelligence: medium" "reasoning: medium"
REPO_DIR="$M5_ROOT" resolve_agent probe "$FIXTURE" claude
if [ -z "$EMIT_PROSE" ] || ! printf '%s' "$EMIT_PROSE" | grep -qF '{{modell}}'; then
  if [ -z "$EMIT_PROSE" ]; then
    ok "M5 — an unrecognised {{modell}} placeholder omits its sentence (both template lines dropped, empty prose)"
  else
    bad "M5 — unrecognised placeholder rendered literally" "prose=[$EMIT_PROSE]"
  fi
else
  bad "M5 — unrecognised placeholder rendered literally" "prose=[$EMIT_PROSE]"
fi

# --- M6 — haiku encodes reasoning: medium: C1's unsupported-on-model drop
# disappears (D11's directed-by-selection guard now fires on this cell).
M6_ROOT="$(mutated_root m6 '.offerings[0].encodes.reasoning = "medium"')"
write_fixture "$FIXTURE" "intelligence: medium" "reasoning: medium"
REPO_DIR="$M6_ROOT" resolve_agent probe "$FIXTURE" claude
if ! diag_has "$(printf 'model-drop\tprobe\tclaude\tmetadata.model.reasoning\tmedium\tunsupported-on-model')"; then
  ok "M6 — haiku encoding reasoning: medium makes D11's guard fire; C1's unsupported-on-model drop disappears"
else
  bad "M6 — haiku encodes reasoning: medium" "${DIAG_LINES[@]+"${DIAG_LINES[@]}"}"
fi

# --- R30 build-twice diff — rendering is idempotent: a second build over an
# unchanged source and mapping produces a byte-identical output, and no
# rendered prose is ever appended to prose a previous build appended.
R30_ROOT="$TMP_ROOT/r30-root"
setup_emission_root "$R30_ROOT"
REPO_DIR="$R30_ROOT" bash "$BUILD_SCRIPT" --target claude >/dev/null 2>/dev/null
cp "$R30_ROOT/.claude/agents/probe-canonical/AGENT.md" "$TMP_ROOT/r30-first.md"
REPO_DIR="$R30_ROOT" bash "$BUILD_SCRIPT" --target claude >/dev/null 2>/dev/null
if diff -q "$TMP_ROOT/r30-first.md" "$R30_ROOT/.claude/agents/probe-canonical/AGENT.md" >/dev/null 2>&1; then
  ok "R30 — a second build over an unchanged source/mapping is byte-identical (rendering is idempotent)"
else
  bad "R30 — build-twice diff" "$(diff "$TMP_ROOT/r30-first.md" "$R30_ROOT/.claude/agents/probe-canonical/AGENT.md")"
fi

echo ""
echo "=== O0 (closing) — the four compiled agent trees are still byte-identical to the pre-suite baseline ==="
O0_FINAL="$(hash_agent_trees)"
if [ "$O0_FINAL" = "$O0_BASELINE" ]; then
  ok "O0 (closing) — compiled agent trees byte-identical to the O0 baseline (no compiled output moved)"
else
  bad "O0 (closing) — compiled agent trees changed during this suite" "$(diff <(printf '%s\n' "$O0_BASELINE") <(printf '%s\n' "$O0_FINAL"))"
fi

echo ""
echo "Results: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
