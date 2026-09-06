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

echo "=== C2 — the committed agent outputs are pinned and derivable (baseline harness) ==="

# --- C2(a) — bash scripts/build-components.sh --target all --check exits 0 -
out="$(bash "$BUILD_SCRIPT" --target all --check 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] && grep -qF "OK: All generated files match source." <<< "$out"; then
  ok "C2(a) — --target all --check exits 0 on the untouched tree"
else
  bad "C2(a) — --target all --check exits 0 on the untouched tree" "exit=$rc" "$out"
fi

# --- C2(b) — pinned extract_frontmatter block of three committed outputs ---
# Pins the frontmatter of the 'architect' agent on three targets (Claude,
# Gemini, Antigravity — the fourth, GitHub Copilot CLI, is pinned in the
# emission suite once its case exists — scripts/tests/test-agent-profile-migration.sh
# case T2). A byte-for-byte literal *modulo one interpolation*, not a regex:
# any drift in these three outputs must turn this red. The expected
# provenance version is read from the source itself
# (artifacts/core/agents/architect/AGENT.md), not pinned as a literal — spec
# 0200 PLAN v2 Decision 8 (v1-F1): pinning it literally makes this case expire
# on architect's every future MINOR version bump, which is the defect class
# this migration already falsified once. Deriving it instead keeps every byte
# pinned AND adds a real assertion: the compiled provenance version equals its
# source's, i.e. the inject_provenance splice is faithful.
ARCHITECT_VERSION="$(extract_frontmatter "$REPO_DIR/artifacts/core/agents/architect/AGENT.md" | yq -r '.metadata.provenance.version')"

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
"name: architect
description: \"Generic architecture agent. Drafts ADRs, runs design reviews, proposes alternatives with explicit trade-offs, and maps blast radius. Run this agent on the opus model.\"
metadata:
  provenance:
    canonical: \"https://github.com/crewrig/crewrig\"
    feedback: \"https://github.com/crewrig/crewrig\"
    version: \"$ARCHITECT_VERSION\""

assert_frontmatter ".gemini/agents/architect.md" ".gemini/agents/architect.md" \
'name: architect
description: "Generic architecture agent. Drafts ADRs, runs design reviews, proposes alternatives with explicit trade-offs, and maps blast radius."
model: gemini-3.1-pro-preview'

assert_frontmatter ".agents/agents/architect/AGENT.md" ".agents/agents/architect/AGENT.md" \
"name: architect
description: \"Generic architecture agent. Drafts ADRs, runs design reviews, proposes alternatives with explicit trade-offs, and maps blast radius. Run this agent on the gemini-3.1-pro-low model.\"
metadata:
  provenance:
    canonical: \"https://github.com/crewrig/crewrig\"
    feedback: \"https://github.com/crewrig/crewrig\"
    version: \"$ARCHITECT_VERSION\""

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
if [ "$rc" -eq 0 ] && grep -qF "OK: All generated files match source." <<< "$out"; then
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
if [ "$checker_rc" -eq 1 ] && grep -qF ': A9 ' <<< "$checker_out"; then
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
if ! grep -q '^temperature:' <<< "$gemini_fm_joined" \
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
if [ "$c9_rc" -ne 0 ] && grep -q "^DRIFT:" <<< "$c9_out"; then
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
  && ! grep -q '^temperature:' <<< "$fm_joined" \
  && ! grep -q '^max_turns:' <<< "$fm_joined" \
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
if [ -z "$EMIT_PROSE" ] || ! grep -qF '{{modell}}' <<< "$EMIT_PROSE"; then
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
echo "=== O1-O12 — the org-level override merge (spec 0199, plan step 5) ==="

# org_root <suffix> <target> <org-content> — a throwaway REPO_DIR root
# carrying an untouched copy of model-mappings/ except <target>.org.yml,
# overwritten with <org-content>. Echoes the root. Outside artifacts/ and
# model-mappings/ (D10): no tier discovery, no drift guard, and the
# checker's own default glob never sees it.
org_root() {
  local suffix="$1" target="$2" content="$3" root
  root="$TMP_ROOT/org-$suffix"
  mkdir -p "$root/model-mappings"
  cp -r "$REPO_DIR/model-mappings"/* "$root/model-mappings/"
  printf '%s\n' "$content" > "$root/model-mappings/${target}.org.yml"
  echo "$root"
}

# --- O1 — an absent org file and a silent one are indistinguishable -------
O1_ABSENT_ROOT="$TMP_ROOT/o1-absent"
mkdir -p "$O1_ABSENT_ROOT/model-mappings"
cp "$REPO_DIR/model-mappings/claude.yml" "$O1_ABSENT_ROOT/model-mappings/claude.yml"
O1_SILENT_ROOT="$TMP_ROOT/o1-silent"
mkdir -p "$O1_SILENT_ROOT/model-mappings"
cp "$REPO_DIR/model-mappings/claude.yml" "$O1_SILENT_ROOT/model-mappings/claude.yml"
cp "$REPO_DIR/model-mappings/claude.org.yml" "$O1_SILENT_ROOT/model-mappings/claude.org.yml"

write_fixture "$FIXTURE" "intelligence: medium"
o1_absent_err="$TMP_ROOT/o1-absent.err"
REPO_DIR="$O1_ABSENT_ROOT" resolve_agent probe "$FIXTURE" claude 2>"$o1_absent_err"
o1_absent_handle="$(REPO_DIR="$O1_ABSENT_ROOT" mapping_in_force claude)"
o1_absent_offering="$RESOLVED_OFFERING_ID"

o1_silent_err="$TMP_ROOT/o1-silent.err"
REPO_DIR="$O1_SILENT_ROOT" resolve_agent probe "$FIXTURE" claude 2>"$o1_silent_err"
o1_silent_handle="$(REPO_DIR="$O1_SILENT_ROOT" mapping_in_force claude)"
o1_silent_offering="$RESOLVED_OFFERING_ID"

if [ "$o1_absent_offering" = "$o1_silent_offering" ] \
  && [ "$o1_absent_offering" = "haiku" ] \
  && [ "$o1_absent_handle" = "$O1_ABSENT_ROOT/model-mappings/claude.yml" ] \
  && [ "$o1_silent_handle" = "$O1_SILENT_ROOT/model-mappings/claude.yml" ] \
  && [ ! -s "$o1_absent_err" ] && [ ! -s "$o1_silent_err" ]; then
  ok "O1 — an absent org file and a silent one are indistinguishable: same handle shape, same resolution, empty merge stderr"
else
  bad "O1 — absent vs silent org file" "absent=$o1_absent_offering silent=$o1_silent_offering" "$(cat "$o1_absent_err" "$o1_silent_err")"
fi

# --- O2 — replace one offering (R10, R12, R18) -----------------------------
O2_ROOT="$(org_root o2 claude 'target: claude
offerings:
  - id: opus
    rank: 3
    native-value: opus-org-o2
    provides:
      intelligence: xhigh
      specialization: general
    encodes:
      intelligence: opus
    supports-reasoning-surface: true
    grounds:
      - declares: native-value
        assumption: O2 fixture
      - declares: provides.intelligence
        assumption: O2 fixture')"
# A shared, TMP_ROOT-scoped merge directory for every direct resolve_agent
# call below: cleaned by the suite's own TMP_ROOT trap, so none of these
# ad-hoc merges ever falls back to the auto-derived ${TMPDIR}/crewrig-mapping-$$
# root a real build would use and clean itself (R27's proving cases are O10
# and O11, which use their own explicit roots).
DIRECT_MERGE_DIR="$TMP_ROOT/direct-merge-dir"
mkdir -p "$DIRECT_MERGE_DIR"

write_fixture "$FIXTURE" "intelligence: xhigh"
o2_err="$TMP_ROOT/o2.err"
REPO_DIR="$O2_ROOT" MAPPING_MERGE_DIR="$DIRECT_MERGE_DIR" resolve_agent probe "$FIXTURE" claude 2>"$o2_err"
o2_handle="$(REPO_DIR="$O2_ROOT" MAPPING_MERGE_DIR="$DIRECT_MERGE_DIR" mapping_in_force claude)"
o2_old_field_gone=1
grep -qF 'Declaration surface: `opus` appears' "$o2_handle" && o2_old_field_gone=0
if [ "$RESOLVED_NATIVE_VALUE" = "opus-org-o2" ] \
  && grep -qF "$(printf 'mapping-merge\tclaude\tofferings/opus\treplaced')" "$o2_err" \
  && [ "$o2_old_field_gone" -eq 1 ]; then
  ok "O2 — replace one offering: emitted native value changes, report names offerings/opus replaced, no core field survives"
else
  bad "O2 — replace one offering" "native=$RESOLVED_NATIVE_VALUE old_field_gone=$o2_old_field_gone" "$(cat "$o2_err")"
fi

# --- O3 — add an offering at an unused rank, above every core offering -----
O3_ROOT="$(org_root o3 claude 'target: claude
offerings:
  - id: o3-super
    rank: 10
    native-value: o3-super-native
    provides:
      intelligence: max
      specialization: general
    encodes:
      intelligence: o3-super
    supports-reasoning-surface: false
    grounds:
      - declares: native-value
        assumption: O3 fixture
      - declares: provides.intelligence
        assumption: O3 fixture
      - declares: supports-reasoning-surface
        assumption: O3 fixture')"
write_fixture "$FIXTURE" "intelligence: max"
o3_err="$TMP_ROOT/o3.err"
REPO_DIR="$O3_ROOT" MAPPING_MERGE_DIR="$DIRECT_MERGE_DIR" resolve_agent probe "$FIXTURE" claude 2>"$o3_err"
if [ "$RESOLVED_OFFERING_ID" = "o3-super" ] \
  && grep -qF "$(printf 'mapping-merge\tclaude\tofferings/o3-super\tadded')" "$o3_err"; then
  ok "O3 — add an offering at an unused rank above every core offering: selected at intelligence: max, reported added"
else
  bad "O3 — add an offering" "offering=$RESOLVED_OFFERING_ID" "$(cat "$o3_err")"
fi

# --- O4 — remove: [offerings/sonnet]: unselectable, selection stays total -
O4_ROOT="$(org_root o4 claude 'target: claude
remove: [offerings/sonnet]')"
o4_err="$TMP_ROOT/o4.err"
o4_ok=1
for o4_rung in medium high xhigh xxhigh max; do
  write_fixture "$FIXTURE" "intelligence: $o4_rung"
  REPO_DIR="$O4_ROOT" MAPPING_MERGE_DIR="$DIRECT_MERGE_DIR" resolve_agent probe "$FIXTURE" claude 2>>"$o4_err"
  [ "$RESOLVED_OFFERING_ID" = "sonnet" ] && o4_ok=0
  [ -z "$RESOLVED_OFFERING_ID" ] && o4_ok=0
done
if [ "$o4_ok" -eq 1 ] && grep -qF "$(printf 'mapping-merge\tclaude\tofferings/sonnet\tremoved')" "$o4_err"; then
  ok "O4 — remove: [offerings/sonnet]: unselectable at every rung, reported removed, selection stays total"
else
  bad "O4 — remove: an offering" "$(cat "$o4_err")"
fi

# --- O5 — replaces-core: substituting -------------------------------------
O5_ROOT="$(org_root o5 claude 'target: claude
replaces-core: true
surfaces:
  - id: guidance
    kind: guidance
    carries: [model]
    template: |
      ORG template using {{model}}.
    items:
      - item: model
        grounds:
          - declares: item
            assumption: O5 fixture
offerings:
  - id: o5-only
    rank: 1
    native-value: o5-only-native
    provides:
      intelligence: medium
      specialization: general
    encodes:
      intelligence: o5-only
    supports-reasoning-surface: false
    grounds:
      - declares: native-value
        assumption: O5 fixture
      - declares: provides.intelligence
        assumption: O5 fixture
      - declares: supports-reasoning-surface
        assumption: O5 fixture')"
write_fixture "$FIXTURE" "intelligence: medium"
REPO_DIR="$O5_ROOT" MAPPING_MERGE_DIR="$DIRECT_MERGE_DIR" resolve_agent probe "$FIXTURE" claude
if [ "$RESOLVED_OFFERING_ID" = "o5-only" ] && [ "$EMIT_PROSE" = "ORG template using o5-only-native." ]; then
  ok "O5 — replaces-core: substituting: only the org offering is a candidate, its template renders"
else
  bad "O5 — replaces-core substituting" "offering=$RESOLVED_OFFERING_ID prose=[$EMIT_PROSE]"
fi
# R39: the drift check is evaluated against the merged result — a
# substituting org file whose compiled outputs are not regenerated fails.
O5D_ROOT="$TMP_ROOT/o5d-root"
setup_emission_root "$O5D_ROOT"
REPO_DIR="$O5D_ROOT" bash "$BUILD_SCRIPT" --target claude >/dev/null 2>/dev/null
cat > "$O5D_ROOT/model-mappings/claude.org.yml" <<'EOF'
target: claude
replaces-core: true
offerings:
  - id: o5d-only
    rank: 1
    native-value: o5d-only-native
    provides:
      intelligence: medium
      specialization: general
    encodes:
      intelligence: o5d-only
    supports-reasoning-surface: false
    grounds:
      - declares: native-value
        assumption: O5 drift fixture
      - declares: provides.intelligence
        assumption: O5 drift fixture
      - declares: supports-reasoning-surface
        assumption: O5 drift fixture
EOF
o5d_out="$(REPO_DIR="$O5D_ROOT" bash "$BUILD_SCRIPT" --target claude --check 2>&1)"; o5d_rc=$?
if [ "$o5d_rc" -ne 0 ] && grep -q "^DRIFT:" <<< "$o5d_out"; then
  ok "R39 — a substituting org override whose outputs are not regenerated fails the drift check"
else
  bad "R39 — substituting org override drift" "exit=$o5d_rc" "$o5d_out"
fi

# --- O6 — org-only target over a core mapping declaring zero offerings ----
O6_ROOT="$TMP_ROOT/o6-root"
mkdir -p "$O6_ROOT/model-mappings"
cp -r "$REPO_DIR/model-mappings"/* "$O6_ROOT/model-mappings/"
cat > "$O6_ROOT/model-mappings/copilot.org.yml" <<'EOF'
target: copilot
surfaces:
  - id: agent-file-model
    kind: frontmatter
    items:
      - item: model
        key: model
        domain:
          values: [o6-model]
        grounds:
          - declares: key
            assumption: O6 fixture
          - declares: domain
            assumption: O6 fixture
offerings:
  - id: o6-offering
    rank: 1
    native-value: o6-model
    provides:
      intelligence: medium
      specialization: general
    encodes:
      intelligence: o6
    supports-reasoning-surface: false
    grounds:
      - declares: native-value
        assumption: O6 fixture
      - declares: provides.intelligence
        assumption: O6 fixture
      - declares: supports-reasoning-surface
        assumption: O6 fixture
EOF
write_fixture "$FIXTURE" "intelligence: medium"
REPO_DIR="$O6_ROOT" MAPPING_MERGE_DIR="$DIRECT_MERGE_DIR" resolve_agent probe "$FIXTURE" copilot
if fm_has "model: o6-model"; then
  ok "O6 — an org-only target override over a zero-offerings core mapping (copilot shape) emits where none existed before"
else
  bad "O6 — org-only target over zero-offerings core" "n_fm=${#EMIT_FM_LINES[@]}" "${EMIT_FM_LINES[@]+"${EMIT_FM_LINES[@]}"}"
fi

# --- O6b — no core mapping at all for the target ---------------------------
O6B_ROOT="$TMP_ROOT/o6b-root"
mkdir -p "$O6B_ROOT/model-mappings"
cp -r "$REPO_DIR/model-mappings"/* "$O6B_ROOT/model-mappings/"
cat > "$O6B_ROOT/model-mappings/o6bfake.org.yml" <<'EOF'
target: o6bfake
remove: [offerings/nonexistent]
surfaces:
  - id: fm
    kind: frontmatter
    items:
      - item: model
        key: model
        domain:
          values: [o6b-model]
        grounds:
          - declares: key
            assumption: O6b fixture
          - declares: domain
            assumption: O6b fixture
offerings:
  - id: o6b-offering
    rank: 1
    native-value: o6b-model
    provides:
      intelligence: medium
      specialization: general
    encodes:
      intelligence: o6b
    supports-reasoning-surface: false
    grounds:
      - declares: native-value
        assumption: O6b fixture
      - declares: provides.intelligence
        assumption: O6b fixture
      - declares: supports-reasoning-surface
        assumption: O6b fixture
EOF
write_fixture "$FIXTURE" "intelligence: medium"
o6b_err="$TMP_ROOT/o6b.err"
REPO_DIR="$O6B_ROOT" MAPPING_MERGE_DIR="$DIRECT_MERGE_DIR" resolve_agent probe "$FIXTURE" o6bfake 2>"$o6b_err"
if [ "$RESOLVED_OFFERING_ID" = "o6b-offering" ] \
  && ! diag_has "$(printf 'model-note\tprobe\to6bfake\tno-mapping\tno mapping file is present for target o6bfake')" \
  && grep -qF "$(printf 'mapping-merge\to6bfake\tofferings/nonexistent\tno-effect')" "$o6b_err"; then
  ok "O6b — no core mapping at all: resolution succeeds against the org file alone, no no-mapping note, a remove: entry is no-effect"
else
  bad "O6b — no core mapping at all" "offering=$RESOLVED_OFFERING_ID" "$(cat "$o6b_err")" "${DIAG_LINES[@]+"${DIAG_LINES[@]}"}"
fi

# --- O7 — determinism: two merges of identical inputs under two distinct --
# MAPPING_MERGE_DIR roots are byte-identical, offerings ordered by (rank,
# id). A single root would make the second merge a cache HIT returning the
# same path, so `cmp` would compare a file with itself — a green
# certifying nothing (v1-F1's row D). The two paths are asserted to differ
# BEFORE the byte comparison, so this case cannot pass vacuously.
O7_ROOT="$(org_root o7 claude 'target: claude
offerings:
  - id: o7-zzz
    rank: 5
    native-value: o7-zzz-native
    provides:
      intelligence: high
      specialization: general
    encodes:
      intelligence: o7zzz
    supports-reasoning-surface: false
    grounds:
      - declares: native-value
        assumption: O7 fixture
      - declares: provides.intelligence
        assumption: O7 fixture
      - declares: supports-reasoning-surface
        assumption: O7 fixture
  - id: o7-aaa
    rank: 5
    native-value: o7-aaa-native
    provides:
      intelligence: high
      specialization: general
    encodes:
      intelligence: o7aaa
    supports-reasoning-surface: false
    grounds:
      - declares: native-value
        assumption: O7 fixture
      - declares: provides.intelligence
        assumption: O7 fixture
      - declares: supports-reasoning-surface
        assumption: O7 fixture')"
O7_DIR_A="$TMP_ROOT/o7-merge-a"
O7_DIR_B="$TMP_ROOT/o7-merge-b"
mkdir -p "$O7_DIR_A" "$O7_DIR_B"
o7_handle_a="$(REPO_DIR="$O7_ROOT" MAPPING_MERGE_DIR="$O7_DIR_A" mapping_in_force claude)"
o7_handle_b="$(REPO_DIR="$O7_ROOT" MAPPING_MERGE_DIR="$O7_DIR_B" mapping_in_force claude)"
o7_order="$(yq -r '.offerings[] | select(.rank == 5) | .id' "$o7_handle_a" | tr '\n' ' ')"
if [ "$o7_handle_a" != "$o7_handle_b" ] \
  && cmp -s "$o7_handle_a" "$o7_handle_b" \
  && [ "$o7_order" = "o7-aaa o7-zzz " ]; then
  ok "O7 — determinism: two merges under distinct roots are byte-identical (paths differ, bytes do not), offerings ordered by (rank, id)"
else
  bad "O7 — determinism" "handle_a=[$o7_handle_a] handle_b=[$o7_handle_b] order=[$o7_order]"
fi
rm -rf "$O7_DIR_A" "$O7_DIR_B"

# --- O8 — accessor invariance (R24, R25) ------------------------------------
# _hash_function_blocks <file> — one "<name><TAB><sha256>" line per
# top-level function (a block opens at ^[_a-zA-Z][_a-zA-Z0-9]*\(\) \{ in
# column 1 and closes at ^}). Compared against the committed golden: the
# case passes iff every name present in BOTH maps carries the same hash,
# except `mapping_in_force` — falsifiable in one byte (M8 below).
_hash_function_blocks() {
  local file="$1" name="" buf="" line
  while IFS= read -r line; do
    if [ -z "$name" ] && [[ "$line" =~ ^[_a-zA-Z][_a-zA-Z0-9]*\(\)\ \{ ]]; then
      name="${line%%(*}"
      buf="$line"$'\n'
      continue
    fi
    if [ -n "$name" ]; then
      buf="$buf$line"$'\n'
      if [ "$line" = "}" ]; then
        local h
        if command -v shasum >/dev/null 2>&1; then
          h=$(printf '%s' "$buf" | shasum -a 256 | awk '{print $1}')
        else
          h=$(printf '%s' "$buf" | sha256sum | awk '{print $1}')
        fi
        printf '%s\t%s\n' "$name" "$h"
        name=""
        buf=""
      fi
    fi
  done < "$file"
}
O8_GOLDEN="$SCRIPT_DIR/tests/fixtures/model-resolve-accessor-hashes.txt"
assert_accessor_invariance() {
  local lib="$1" label="$2" current deleted differing
  current="$(_hash_function_blocks "$lib" | sort)"
  deleted="$(comm -23 <(cut -f1 "$O8_GOLDEN" | sort) <(printf '%s\n' "$current" | cut -f1))"
  differing="$(awk -F'\t' 'NR==FNR{g[$1]=$2; next} ($1 in g) && g[$1]!=$2 {print $1}' "$O8_GOLDEN" <(printf '%s\n' "$current") | sort)"
  printf '%s\t%s' "$deleted" "$differing"
}
o8_result="$(assert_accessor_invariance "$SCRIPT_DIR/lib/model-resolve.sh" "O8")"
o8_deleted="${o8_result%%$'\t'*}"
o8_differing="${o8_result#*$'\t'}"
if [ -z "$o8_deleted" ] && [ "$o8_differing" = "mapping_in_force" ]; then
  ok "O8 — accessor invariance: every pre-existing accessor is byte-identical except mapping_in_force"
else
  bad "O8 — accessor invariance" "deleted=[$o8_deleted] differing=[$o8_differing]"
fi

# --- M8 — accessor invariance is falsifiable in one byte: mutating
# mapping_item_key (an existing, untouched accessor) must turn O8 red.
M8_LIB="$TMP_ROOT/model-resolve.m8.sh"
sed 's/mapping_item_key() {/mapping_item_key() {\n  : # M8 mutation/' \
  "$SCRIPT_DIR/lib/model-resolve.sh" > "$M8_LIB"
if diff -q "$SCRIPT_DIR/lib/model-resolve.sh" "$M8_LIB" >/dev/null 2>&1; then
  bad "M8 — mutation actually changed the resolver source" "sed pattern did not match; mutation is a no-op"
else
  m8_result="$(assert_accessor_invariance "$M8_LIB" "M8")"
  m8_differing="${m8_result#*$'\t'}"
  if grep -qxF "mapping_item_key" <<< "$m8_differing"; then
    ok "M8 — mutating an untouched accessor (mapping_item_key) turns O8's invariance case red"
  else
    bad "M8 — mutating mapping_item_key did not turn O8 red" "differing=[$m8_differing]"
  fi
fi

# --- O9 — a duplicate rank across core and org does not fail ---------------
O9_ROOT="$(org_root o9 claude 'target: claude
offerings:
  - id: zzz-dup
    rank: 2
    native-value: zzz-dup-native
    provides:
      intelligence: high
      specialization: general
    encodes:
      intelligence: zzzdup
    supports-reasoning-surface: false
    grounds:
      - declares: native-value
        assumption: O9 fixture
      - declares: provides.intelligence
        assumption: O9 fixture
      - declares: supports-reasoning-surface
        assumption: O9 fixture')"
O9_MERGE_DIR="$TMP_ROOT/o9-merge-dir"
mkdir -p "$O9_MERGE_DIR"
write_fixture "$FIXTURE" "intelligence: high"
o9_err="$TMP_ROOT/o9.err"
: > "$o9_err"
REPO_DIR="$O9_ROOT" MAPPING_MERGE_DIR="$O9_MERGE_DIR" resolve_agent probe "$FIXTURE" claude 2>>"$o9_err"
o9_first="$RESOLVED_OFFERING_ID"
REPO_DIR="$O9_ROOT" MAPPING_MERGE_DIR="$O9_MERGE_DIR" resolve_agent probe "$FIXTURE" claude 2>>"$o9_err"
o9_second="$RESOLVED_OFFERING_ID"
o9_note_count="$(grep -cF "$(printf 'mapping-merge-note\tclaude\tduplicate-rank')" "$o9_err")"
rm -rf "$O9_MERGE_DIR"
if [ "$o9_first" = "sonnet" ] && [ "$o9_second" = "sonnet" ] \
  && [ "$o9_note_count" -eq 1 ] \
  && grep -qF "$(printf 'mapping-merge-note\tclaude\tduplicate-rank\trank=2 offerings=sonnet,zzz-dup')" "$o9_err"; then
  ok "O9 — a duplicate rank across core and org does not fail: the lower identifier is selected, exactly one note across two resolutions"
else
  bad "O9 — duplicate rank" "first=$o9_first second=$o9_second note_count=$o9_note_count" "$(cat "$o9_err")"
fi

# --- O10 — a merged document is removed when the build that created it ----
# ends (R27), on BOTH exit paths a build can take: the main build/--check
# path (cleanup_check_staging) and the --resolve fast-exit arm (v2-F6),
# which exits before the trap installing that cleanup is even reached.
O10_ROOT="$TMP_ROOT/o10-root"
setup_emission_root "$O10_ROOT"
cat > "$O10_ROOT/model-mappings/claude.org.yml" <<'EOF'
target: claude
offerings:
  - id: o10-org-extra
    rank: 21
    native-value: o10-org-extra-native
    provides:
      intelligence: max
      specialization: general
    encodes:
      intelligence: o10org
    supports-reasoning-surface: false
    grounds:
      - declares: native-value
        assumption: O10 fixture
      - declares: provides.intelligence
        assumption: O10 fixture
      - declares: supports-reasoning-surface
        assumption: O10 fixture
EOF

# In-process assertion: the live handle a merge produces lies outside
# $REPO_DIR (spec 0197 R2/scripts/check-no-machine-paths.sh's partial net —
# the stable defence is this assertion, not the path pattern).
O10_INPROC_DIR="$TMP_ROOT/o10-inproc-dir"
mkdir -p "$O10_INPROC_DIR"
o10_inproc_handle="$(REPO_DIR="$O10_ROOT" MAPPING_MERGE_DIR="$O10_INPROC_DIR" mapping_in_force claude)"
case "$o10_inproc_handle" in
  "$O10_ROOT"/*) o10_outside_repo=0 ;;
  *)             o10_outside_repo=1 ;;
esac

# Main build path: TMPDIR is a case-owned directory, MAPPING_MERGE_DIR
# unset, so the build derives its own root and its own trap removes it.
O10_CASE_TMP="$TMP_ROOT/o10-case-tmp"
mkdir -p "$O10_CASE_TMP"
REPO_DIR="$O10_ROOT" TMPDIR="$O10_CASE_TMP" bash "$BUILD_SCRIPT" --target claude >/dev/null 2>/dev/null
o10_build_rc=$?
o10_stray_after_build="$(find "$O10_CASE_TMP" -maxdepth 1 -name 'crewrig-mapping-*' 2>/dev/null)"
o10_committed_stray="$(find "$O10_ROOT" -name '*.merge.*' -o -name '.merges' 2>/dev/null)"

# --resolve fast-exit arm: same populated fixture, same TMPDIR isolation —
# this arm exits before the EXIT trap at build-components.sh:508 is
# installed, so nothing else could clean up on its behalf without the
# explicit mapping_merge_cleanup call v2-F6 adds.
O10_RESOLVE_TMP="$TMP_ROOT/o10-resolve-tmp"
mkdir -p "$O10_RESOLVE_TMP"
REPO_DIR="$O10_ROOT" TMPDIR="$O10_RESOLVE_TMP" bash "$BUILD_SCRIPT" \
  --resolve "$O10_ROOT/artifacts/core/agents/probe/AGENT.md" claude >/dev/null 2>/dev/null
o10_resolve_rc=$?
o10_stray_after_resolve="$(find "$O10_RESOLVE_TMP" -maxdepth 1 -name 'crewrig-mapping-*' 2>/dev/null)"

if [ "$o10_build_rc" -eq 0 ] && [ "$o10_resolve_rc" -eq 0 ] \
  && [ -z "$o10_stray_after_build" ] && [ -z "$o10_stray_after_resolve" ] \
  && [ -z "$o10_committed_stray" ] \
  && [ "$o10_outside_repo" -eq 1 ]; then
  ok "O10 — a merged document is removed when the build ends, on both the main build path and the --resolve fast-exit arm; the live handle lies outside \$REPO_DIR"
else
  bad "O10 — merged document cleanup" \
    "build_rc=$o10_build_rc resolve_rc=$o10_resolve_rc outside_repo=$o10_outside_repo" \
    "stray_after_build=[$o10_stray_after_build]" "stray_after_resolve=[$o10_stray_after_resolve]" \
    "committed_stray=[$o10_committed_stray]"
fi

# --- M10 — deleting the mapping_merge_cleanup call from cleanup_check_staging
# must turn O10's build-path assertion red: without it, O10 would certify
# only that no merge happened, never that cleanup itself works. Run from a
# scratch scripts/ directory (a symlinked lib/, so every OTHER library stays
# real) rather than a bare copy: build-components.sh sources its siblings
# relative to its own $(dirname "$0"), and a copy dropped elsewhere cannot
# find them.
M10_SCRIPTS="$TMP_ROOT/m10-scripts"
mkdir -p "$M10_SCRIPTS"
ln -s "$SCRIPT_DIR/lib" "$M10_SCRIPTS/lib"
ln -s "$SCRIPT_DIR/tests" "$M10_SCRIPTS/tests"
M10_BUILD="$M10_SCRIPTS/build-components.sh"
sed 's/^  mapping_merge_cleanup$/  : # M10: cleanup call removed/' "$BUILD_SCRIPT" > "$M10_BUILD"
if [ "$(grep -c '^  mapping_merge_cleanup$' "$BUILD_SCRIPT")" -lt 1 ] || diff -q "$BUILD_SCRIPT" "$M10_BUILD" >/dev/null 2>&1; then
  bad "M10 — mutation actually changed build-components.sh" "sed pattern did not match; mutation is a no-op"
else
  M10_CASE_TMP="$TMP_ROOT/m10-case-tmp"
  mkdir -p "$M10_CASE_TMP"
  m10_out="$(REPO_DIR="$O10_ROOT" TMPDIR="$M10_CASE_TMP" bash "$M10_BUILD" --target claude 2>&1)"; m10_rc=$?
  m10_stray="$(find "$M10_CASE_TMP" -maxdepth 1 -name 'crewrig-mapping-*' 2>/dev/null)"
  rm -rf "$M10_CASE_TMP"
  if [ "$m10_rc" -eq 0 ] && [ -n "$m10_stray" ]; then
    ok "M10 — deleting the mapping_merge_cleanup call from cleanup_check_staging turns O10's build-path assertion red"
  else
    bad "M10 — deleting the cleanup call did not leave a stray root" "rc=$m10_rc" "$m10_out"
  fi
fi

# --- O11 — the merge counter (R28's proving case) ---------------------------
O11_ROOT="$TMP_ROOT/o11-root"
setup_emission_root "$O11_ROOT"
mkdir -p "$O11_ROOT/artifacts/core/agents/probe2"
cat > "$O11_ROOT/artifacts/core/agents/probe2/AGENT.md" <<'EOF'
---
name: probe2
description: "Probe agent 2."
metadata:
  model:
    intelligence: medium
---
Body.
EOF
for o11_t in claude gemini copilot antigravity; do
  cat > "$O11_ROOT/model-mappings/${o11_t}.org.yml" <<EOF
target: ${o11_t}
offerings:
  - id: o11-extra-${o11_t}
    rank: 20
    native-value: o11-extra-native
    provides:
      intelligence: max
      specialization: general
    encodes:
      intelligence: o11extra
    supports-reasoning-surface: false
    grounds:
      - declares: native-value
        assumption: O11 fixture
      - declares: provides.intelligence
        assumption: O11 fixture
      - declares: supports-reasoning-surface
        assumption: O11 fixture
EOF
done
# Two distinct roots, not a reused one plus a deleted counter file: the
# cached merged document under the first root would otherwise survive
# untouched into the second run, silently skipping "claude" a second time
# and undercounting exactly the target that carried it (the same class of
# hazard O7 guards on the read side).
O11_MERGE_DIR_1="$TMP_ROOT/o11-merge-dir-1"
O11_MERGE_DIR_2="$TMP_ROOT/o11-merge-dir-2"
mkdir -p "$O11_MERGE_DIR_1" "$O11_MERGE_DIR_2"
REPO_DIR="$O11_ROOT" MAPPING_MERGE_DIR="$O11_MERGE_DIR_1" bash "$BUILD_SCRIPT" --target claude >/dev/null 2>/dev/null
o11_claude_count="$(wc -l < "$O11_MERGE_DIR_1/.merges" | tr -d ' ')"
REPO_DIR="$O11_ROOT" MAPPING_MERGE_DIR="$O11_MERGE_DIR_2" bash "$BUILD_SCRIPT" --target all >/dev/null 2>/dev/null
o11_all_count="$(wc -l < "$O11_MERGE_DIR_2/.merges" | tr -d ' ')"
o11_all_targets="$(sort -u "$O11_MERGE_DIR_2/.merges" | wc -l | tr -d ' ')"
rm -rf "$O11_MERGE_DIR_1" "$O11_MERGE_DIR_2"
if [ "$o11_claude_count" -eq 1 ] && [ "$o11_all_count" -eq 4 ] && [ "$o11_all_targets" -eq 4 ]; then
  ok "O11 — the merge counter: exactly 1 merge for --target claude (two agent sources), exactly 4 over 4 distinct targets for --target all"
else
  bad "O11 — merge counter" "claude=$o11_claude_count all=$o11_all_count all_targets=$o11_all_targets"
fi

# --- M11 — replacing the `[ -f "$out" ]` cache short-circuit with an
# unconditional merge must turn O11's count assertion red (2 merges for one
# resolution pair called twice, not 1): without this mutation, O11 would
# certify only that a merge happened at all, never that the cache works.
M11_LIB="$TMP_ROOT/model-resolve.m11.sh"
sed 's/if \[ -f "\$out" \]; then/if false; then/' "$SCRIPT_DIR/lib/model-resolve.sh" > "$M11_LIB"
if diff -q "$SCRIPT_DIR/lib/model-resolve.sh" "$M11_LIB" >/dev/null 2>&1; then
  bad "M11 — mutation actually changed the resolver source" "sed pattern did not match; mutation is a no-op"
else
  (
    unset -f mapping_in_force _merge_mapping resolve_agent 2>/dev/null
    . "$M11_LIB"
    M11_MERGE_DIR="$TMP_ROOT/m11-merge-dir"
    mkdir -p "$M11_MERGE_DIR"
    write_fixture "$FIXTURE" "intelligence: high"
    REPO_DIR="$O9_ROOT" MAPPING_MERGE_DIR="$M11_MERGE_DIR" resolve_agent probe "$FIXTURE" claude >/dev/null
    REPO_DIR="$O9_ROOT" MAPPING_MERGE_DIR="$M11_MERGE_DIR" resolve_agent probe "$FIXTURE" claude >/dev/null
    m11_count="$(wc -l < "$M11_MERGE_DIR/.merges" | tr -d ' ')"
    rm -rf "$M11_MERGE_DIR"
    [ "$m11_count" -eq 1 ]
  )
  if [ $? -ne 0 ]; then
    ok "M11 — removing the cache short-circuit turns O11's merge-count assertion red (2 merges, not 1)"
  else
    bad "M11 — removing the cache short-circuit did not turn the count red" "still exactly 1 merge"
  fi
fi

# --- O12 — remove: [guard] is ignored by the merge, the resolution degrades
O12_ROOT="$(org_root o12 claude 'target: claude
remove: [guard]')"
write_fixture "$FIXTURE" "intelligence: medium" "reasoning: medium"
REPO_DIR="$O12_ROOT" MAPPING_MERGE_DIR="$DIRECT_MERGE_DIR" resolve_agent probe "$FIXTURE" claude
o12_handle="$(REPO_DIR="$O12_ROOT" MAPPING_MERGE_DIR="$DIRECT_MERGE_DIR" mapping_in_force claude)"
if [ "$RESOLVED_OFFERING_ID" = "haiku" ] \
  && [ "$(yq '. | has("guard")' "$o12_handle" 2>/dev/null)" = "true" ] \
  && diag_has "$(printf 'model-note\tprobe\tclaude\tguard-withheld\tterms=defect-not-established-fixed,copilot-reader-consumes-claude-surface surface=guidance')"; then
  ok "O12 — remove: [guard] (rejected by the checker, R14) is ignored by the merge: the guard survives, resolution degrades rather than fails"
else
  bad "O12 — remove: [guard]" "offering=$RESOLVED_OFFERING_ID" "${DIAG_LINES[@]+"${DIAG_LINES[@]}"}"
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
