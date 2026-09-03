#!/bin/bash
# test-check-model-mappings.sh — Regression test for check-model-mappings.sh
# (spec 0197 R46-R51, PLAN v2 step 7 of issue #1114).
#
# The `scripts/tests/test-check-feedback-routing.sh` idiom: `set -uo pipefail`
# without `-e` (exit behavior is asserted via explicit pass/fail counters, not
# by letting the harness abort on the first non-zero exit), `mktemp -d` +
# `trap`, `render_*` fixture generators, a `run_case` pass/fail counter, and a
# closing `[ "$fail" -eq 0 ]`.
#
# Three sections:
#   1. Rejection coverage — a valid baseline proven green, then one
#      single-cell mutation per rejection class proven red, asserting BOTH the
#      exit code and the presence of the expected assertion id in stderr.
#      A11 is the one class with no independent single-cell red shape (it is
#      total by construction whenever at least one offering declares
#      provides.intelligence — spec 0197 Decision 2); its fixture blanks
#      provides.intelligence on EVERY offering, which co-fires A26, and the
#      case asserts both ids. A zero-offerings fixture is proven green
#      (spec 0197 R49's own scenario), and an exit-2 case runs with PATH
#      stripped of yq.
#   2. Golden per-rung selection tables — for each of the four COMMITTED
#      mappings, the expected offering id at each of the seven intelligence
#      rungs, pinned literally and compared against --print-selection. Two
#      mutations of the committed claude.yml prove the table is single-cell
#      falsifiable (the corrected row counts of PLAN v2's named edit 1).
#   3. Committed content — the four real files run green, plus targeted `yq`
#      assertions pinning content the generic checker cannot know on its own.
#
# Usage:
#   bash scripts/tests/test-check-model-mappings.sh

# -e is intentionally omitted: exit behavior is asserted via explicit
# pass/fail counters; -e would abort the harness on the expected non-zero
# exit codes this suite exists to exercise.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SCRIPT_UNDER_TEST="$SCRIPT_DIR/check-model-mappings.sh"

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

# --- run_case ----------------------------------------------------------------
# run_case <name> <expected-exit> "<space-separated expected assertion ids, or empty>" <file...>
# Every expected id must appear in the output as "<something>: <ID> " —
# the checker's own "<file>: <assertion-id> <message>" line shape.
run_case() {
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

# A minimal but fully conformant Claude-shaped mapping: two offerings (one
# rung apart from claude.yml's real four, deliberately smaller so a mutation
# touches exactly one cell), a frontmatter surface with model+reasoning
# (full six-rung projection), a guidance surface (two items, two sentences),
# and a withheld guard with two terms.
render_base() {
  cat <<'EOF'
target: claude

surfaces:
  - id: frontmatter
    kind: frontmatter
    items:
      - item: model
        key: model
        domain:
          values: [alpha, beta]
        grounds:
          - declares: key
            citation: cite-key
          - declares: domain
            citation: cite-domain
      - item: reasoning
        key: effort
        domain:
          values: [low, high]
        projection:
          none: unmapped
          low: low
          medium: low
          high: high
          xhigh: high
          max: high
        grounds:
          - declares: key
            citation: cite-key2
          - declares: domain
            citation: cite-domain2

  - id: guidance
    kind: guidance
    carries: [model, reasoning]
    template: |
      Run on {{model}}.
      Use {{reasoning}} effort.
    items:
      - item: model
        grounds:
          - declares: item
            assumption: assume-model
      - item: reasoning
        grounds:
          - declares: item
            assumption: assume-reasoning

offerings:
  - id: alpha
    rank: 1
    native-value: alpha
    provides:
      intelligence: medium
      specialization: general
    encodes:
      intelligence: alpha
    supports-reasoning-surface: false
    grounds:
      - declares: native-value
        citation: cite-nv-alpha
      - declares: provides.intelligence
        citation: cite-pi-alpha
      - declares: supports-reasoning-surface
        assumption: assume-srs
      - declares: supports-reasoning-surface.behavior
        citation: cite-behavior
  - id: beta
    rank: 2
    native-value: beta
    provides:
      intelligence: xxhigh
      specialization: general
    encodes:
      intelligence: beta
    supports-reasoning-surface: true
    grounds:
      - declares: native-value
        citation: cite-nv-beta
      - declares: provides.intelligence
        citation: cite-pi-beta

guard:
  id: g1
  spec: "spec ref"
  state: withheld
  terms:
    - id: t1
      statement: s1
      holds: true
      evidence: e1
      grounds:
        - declares: holds
          citation: cite-t1
    - id: t2
      statement: s2
      holds: false
      evidence: e2
      grounds:
        - declares: holds
          citation: cite-t2
EOF
}

# A valid, minimal ZERO-OFFERINGS mapping (spec 0197 R49's own scenario).
render_zero_offerings_valid() {
  cat <<'EOF'
target: gemini

surfaces:
  - id: frontmatter
    kind: frontmatter
    items:
      - item: model
        key: model
        domain:
          values: [only-model]
        grounds:
          - declares: key
            citation: cite-key
          - declares: domain
            citation: cite-domain

offerings: []
EOF
}

# render_case_file <stem> <yq-expr>... — a fresh copy of render_base at
# <stem>.yml, mutated in place by each yq expression in order. Echoes the
# resulting file path.
render_case_file() {
  local stem="$1"
  shift
  local dir f e
  dir="$(mktemp -d "$TMP_ROOT/case.XXXXXX")"
  f="$dir/${stem}.yml"
  render_base > "$f"
  for e in "$@"; do
    yq eval -i "$e" "$f" >/dev/null
  done
  echo "$f"
}

echo "=== Section 1 — rejection coverage ==="

# --- Baseline: green -----------------------------------------------------
f="$(render_case_file claude)"
run_case "baseline conforms" 0 "" "$f"

# --- A1 — target outside the closed vocabulary ----------------------------
f="$(render_case_file claude '.target = "bogus"')"
run_case "A1 — target outside vocabulary" 1 "A1" "$f"

# --- A2 — target disagrees with filename stem (isolated: file named 'other') --
f="$(render_case_file other)"
run_case "A2 — target disagrees with filename stem" 1 "A2" "$f"

# --- A3 — a key no node's closed key set admits ---------------------------
f="$(render_case_file claude '.bogus-top-level = "x"')"
run_case "A3 — unknown top-level key" 1 "A3" "$f"

# --- A4 — an R5 node's grounds list absent or empty -----------------------
f="$(render_case_file claude '.offerings[0].grounds = []')"
run_case "A4 — empty grounds list" 1 "A4" "$f"

# --- A5 — a grounds entry carrying both citation and assumption -----------
f="$(render_case_file claude '.offerings[0].grounds[0].assumption = "also-assumed"')"
run_case "A5 — grounds entry carries both marks" 1 "A5" "$f"

# --- A6 — a duplicate offering id -----------------------------------------
f="$(render_case_file claude '.offerings[1].id = "alpha"')"
run_case "A6 — duplicate offering id" 1 "A6" "$f"

# --- A7 — a duplicate offering rank ---------------------------------------
f="$(render_case_file claude '.offerings[1].rank = 1')"
run_case "A7 — duplicate offering rank" 1 "A7" "$f"

# --- A8 — a provides value outside its spec 0195 domain -------------------
f="$(render_case_file claude '.offerings[0].provides.intelligence = "nope"')"
run_case "A8 — provides value outside domain" 1 "A8" "$f"

# --- A9 — a directed native value outside its declared domain -------------
f="$(render_case_file claude '.offerings[0].native-value = "gamma"')"
run_case "A9 — native-value outside declared domain" 1 "A9" "$f"

# --- A10 — an encodes disagreement (clause i: not a key of provides) ------
f="$(render_case_file claude '.offerings[0].encodes = {"reasoning": "alpha"}')"
run_case "A10 — encodes names a characteristic not provided" 1 "A10" "$f"

# --- A11 (+A26 co-fire) — every offering lacks provides.intelligence ------
f="$(render_case_file claude 'del(.offerings[0].provides.intelligence)' 'del(.offerings[1].provides.intelligence)')"
run_case "A11 — no offering selectable at any rung (co-fires A26)" 1 "A11 A26" "$f"

# --- A12 — frontmatter reasoning item's projection missing a rung --------
f="$(render_case_file claude 'del(.surfaces[0].items[1].projection.medium)')"
run_case "A12 — projection missing a reasoning rung" 1 "A12" "$f"

# --- A13 — target claude with no guard block ------------------------------
f="$(render_case_file claude 'del(.guard)')"
run_case "A13 — claude target with no guard block" 1 "A13" "$f"

# --- A14a / A14b — directed guard, evidence and holds-ground kind ---------
# Base a valid DIRECTED guard first (both terms false, satisfying A23), then
# mutate each of A14a and A14b from that intermediate independently.
DIRECTED_BASE_EXPRS=('.guard.state = "directed"' '.guard.terms[0].holds = false')
f="$(render_case_file claude ${DIRECTED_BASE_EXPRS[@]+"${DIRECTED_BASE_EXPRS[@]}"} '.guard.terms[0].evidence = "   "')"
run_case "A14a — directed guard term's evidence is blank" 1 "A14a" "$f"

f="$(render_case_file claude ${DIRECTED_BASE_EXPRS[@]+"${DIRECTED_BASE_EXPRS[@]}"} 'del(.guard.terms[0].grounds[0].citation)' '.guard.terms[0].grounds[0].assumption = "not-a-citation"')"
run_case "A14b — directed guard term's holds ground is an assumption" 1 "A14b" "$f"

# --- A15 — a node missing a required key ----------------------------------
f="$(render_case_file claude 'del(.offerings[0].rank)')"
run_case "A15 — offering missing a required key" 1 "A15" "$f"

# --- A16 — a grounds entry's mark text is empty/whitespace-only ----------
f="$(render_case_file claude '.offerings[0].grounds[0].citation = "   "')"
run_case "A16 — grounds mark text is whitespace-only" 1 "A16" "$f"

# --- A17 — supports-reasoning-surface: true with no frontmatter reasoning item --
f="$(render_case_file claude 'del(.surfaces[0].items[1])' '.offerings[0].supports-reasoning-surface = true')"
run_case "A17 — supports-reasoning-surface true with no reasoning item" 1 "A17" "$f"

# --- A18 — a guidance item declaring key/domain/projection ---------------
f="$(render_case_file claude '.surfaces[1].items[0].key = "model"')"
run_case "A18 — guidance item declares a frontmatter-only field" 1 "A18" "$f"

# --- A19 — a kind outside the closed vocabulary ---------------------------
f="$(render_case_file claude '.surfaces[0].kind = "bogus"')"
run_case "A19 — surface kind outside vocabulary" 1 "A19" "$f"

# --- A20a — guidance placeholder set differs from carries -----------------
f="$(render_case_file claude '.surfaces[1].carries = ["model"]')"
run_case "A20a — placeholder set differs from carries" 1 "A20a" "$f"

# --- A20b — more than one placeholder in one sentence ---------------------
f="$(render_case_file claude '.surfaces[1].template = "Run on {{model}} with {{reasoning}} effort."')"
run_case "A20b — two placeholders in one sentence" 1 "A20b" "$f"

# --- A21 — a second frontmatter surface -----------------------------------
f="$(render_case_file claude '.surfaces += [{"id": "frontmatter2", "kind": "frontmatter", "items": []}]')"
run_case "A21 — second frontmatter surface" 1 "A21" "$f"

# --- A22 — guard.state outside withheld|directed --------------------------
f="$(render_case_file claude '.guard.state = "bogus"')"
run_case "A22 — guard state outside vocabulary" 1 "A22" "$f"

# --- A23 — guard state contradicts its terms ------------------------------
f="$(render_case_file claude '.guard.terms[0].holds = false')"
run_case "A23 — withheld guard with no term holding" 1 "A23" "$f"

# --- A24 — two grounds entries for one target, different mark kinds ------
f="$(render_case_file claude '.offerings[0].grounds += [{"declares": "native-value", "assumption": "conflict"}]')"
run_case "A24 — two grounds entries disagree on one target" 1 "A24" "$f"

# --- A25 — a grounds entry's declares target does not resolve -------------
f="$(render_case_file claude '.offerings[0].grounds += [{"declares": "totally-bogus-field", "citation": "x"}]')"
run_case "A25 — grounds declares an unresolvable target" 1 "A25" "$f"

# A25 regression case — the v2-F3 hole: an open aspect vocabulary would have
# let a second grounds entry manufacture a fresh target by appending an
# arbitrary token. Confirms the closed aspect vocabulary (behavior only)
# rejects it, and confirms A24 does NOT fire (the two entries name different
# declares strings, so A24's same-target comparison never engages — this is
# exactly what made the hole invisible to A24 alone).
dir="$(mktemp -d "$TMP_ROOT/case.XXXXXX")"
f="$dir/claude.yml"
render_base > "$f"
yq eval -i '.offerings[0].grounds += [{"declares": "provides.intelligence.rung", "assumption": "contradicts the citation above"}]' "$f" >/dev/null
out="$(bash "$SCRIPT_UNDER_TEST" "$f" 2>&1)"; rc=$?
if [ "$rc" -eq 1 ] && printf '%s\n' "$out" | grep -qF ": A25 " && ! printf '%s\n' "$out" | grep -qF ": A24 "; then
  echo "PASS  A25 regression — open aspect vocabulary closed (v2-F3), A24 does not co-fire"
  pass=$((pass + 1))
else
  echo "FAIL  A25 regression — expected A25 alone, got:"
  printf '%s\n' "$out" | sed 's/^/  /'
  fail=$((fail + 1))
fi

# --- A26 — an offering with no provides.intelligence (single offering) ---
f="$(render_case_file claude 'del(.offerings[0].provides.intelligence)')"
run_case "A26 — one offering has no provides.intelligence" 1 "A26" "$f"

# --- A27 — an item value outside the closed item vocabulary --------------
f="$(render_case_file claude '.surfaces[1].items += [{"item": "bogus-item", "grounds": [{"declares": "item", "citation": "x"}]}]')"
run_case "A27 — item value outside closed vocabulary" 1 "A27" "$f"

# --- A0 — a file that does not parse as YAML ------------------------------
dir="$(mktemp -d "$TMP_ROOT/case.XXXXXX")"
f="$dir/claude.yml"
printf 'target: claude\nsurfaces: [\nofferings: []\n' > "$f"
run_case "A0 — file does not parse as YAML" 1 "A0" "$f"

# --- Zero-offerings, valid: green (spec 0197 R49's own scenario) ---------
dir="$(mktemp -d "$TMP_ROOT/case.XXXXXX")"
f="$dir/gemini.yml"
render_zero_offerings_valid > "$f"
run_case "zero-offerings mapping conforms" 0 "" "$f"

# --- Exit 2 — yq absent from PATH -----------------------------------------
# Invoke bash by its resolved absolute path: the child's PATH is what must be
# yq-less, not bash's own lookup.
f="$(render_case_file claude)"
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
echo "=== Section 2 — golden per-rung selection tables (committed mappings) ==="

RUNGS="minimal low medium high xhigh xxhigh max"

# assert_selection_table <mapping-file> <expected id1> <expected id2> ... (7, one per rung)
assert_selection_table() {
  local file="$1"
  shift
  local out i=1 rung expected got all_ok=1
  out="$(bash "$SCRIPT_UNDER_TEST" --print-selection "$file")"
  for rung in $RUNGS; do
    expected="$1"
    shift
    got="$(printf '%s\n' "$out" | awk -F'\t' -v r="$rung" '$2 == r { print $3 }')"
    if [ "$got" != "$expected" ]; then
      echo "  MISMATCH rung=$rung expected='$expected' got='$got'"
      all_ok=0
    fi
    i=$((i + 1))
  done
  [ "$all_ok" -eq 1 ]
}

if assert_selection_table "$REPO_DIR/model-mappings/claude.yml" haiku haiku haiku sonnet opus fable fable; then
  echo "PASS  claude.yml golden per-rung table"
  pass=$((pass + 1))
else
  echo "FAIL  claude.yml golden per-rung table"
  fail=$((fail + 1))
fi

if assert_selection_table "$REPO_DIR/model-mappings/gemini.yml" \
     gemini-3.1-flash-lite gemini-3.1-flash-lite gemini-3.5-flash \
     gemini-3.1-pro-preview gemini-3.1-pro-preview gemini-3.1-pro-preview gemini-3.1-pro-preview; then
  echo "PASS  gemini.yml golden per-rung table"
  pass=$((pass + 1))
else
  echo "FAIL  gemini.yml golden per-rung table"
  fail=$((fail + 1))
fi

if assert_selection_table "$REPO_DIR/model-mappings/antigravity.yml" \
     gemini-3.8-flash-low gemini-3.8-flash-low gemini-3.8-flash-low \
     gemini-3.1-pro-low gemini-3.1-pro-low gemini-3.1-pro-low gemini-3.1-pro-low; then
  echo "PASS  antigravity.yml golden per-rung table"
  pass=$((pass + 1))
else
  echo "FAIL  antigravity.yml golden per-rung table"
  fail=$((fail + 1))
fi

if assert_selection_table "$REPO_DIR/model-mappings/copilot.yml" "" "" "" "" "" "" ""; then
  echo "PASS  copilot.yml golden per-rung table (zero offerings, all empty)"
  pass=$((pass + 1))
else
  echo "FAIL  copilot.yml golden per-rung table"
  fail=$((fail + 1))
fi

# --- Falsifiability of the golden table: two single-offering mutations ---
# (PLAN v2 named edit 1's corrected counts, re-derived here rather than
# trusted from the plan's prose.)
dir="$(mktemp -d "$TMP_ROOT/case.XXXXXX")"
f="$dir/claude.yml"
cp "$REPO_DIR/model-mappings/claude.yml" "$f"
yq eval -i 'del(.offerings[] | select(.id == "haiku"))' "$f" >/dev/null
if assert_selection_table "$f" sonnet sonnet sonnet sonnet opus fable fable; then
  echo "PASS  golden table falsifiable — deleting haiku flips 3 rows (minimal, low, medium -> sonnet)"
  pass=$((pass + 1))
else
  echo "FAIL  golden table mutation 1 (delete haiku) did not match the expected 3-row flip"
  fail=$((fail + 1))
fi

dir="$(mktemp -d "$TMP_ROOT/case.XXXXXX")"
f="$dir/claude.yml"
cp "$REPO_DIR/model-mappings/claude.yml" "$f"
yq eval -i 'del(.offerings[] | select(.id != "haiku"))' "$f" >/dev/null
if assert_selection_table "$f" haiku haiku haiku haiku haiku haiku haiku; then
  echo "PASS  golden table falsifiable — keeping only haiku flips 4 rows (high, xhigh, xxhigh, max -> haiku)"
  pass=$((pass + 1))
else
  echo "FAIL  golden table mutation 2 (keep only haiku) did not match the expected 4-row flip"
  fail=$((fail + 1))
fi

echo ""
echo "=== Section 3 — committed content ==="

run_case "claude.yml conforms" 0 "" "$REPO_DIR/model-mappings/claude.yml"
run_case "gemini.yml conforms" 0 "" "$REPO_DIR/model-mappings/gemini.yml"
run_case "copilot.yml conforms" 0 "" "$REPO_DIR/model-mappings/copilot.yml"
run_case "antigravity.yml conforms" 0 "" "$REPO_DIR/model-mappings/antigravity.yml"

# assert_yq <name> <file> <yq-expr> <expected>
assert_yq() {
  local name="$1" file="$2" expr="$3" expected="$4" got
  got="$(yq -r "$expr" "$file" 2>/dev/null)"
  if [ "$got" = "$expected" ]; then
    echo "PASS  $name"
    pass=$((pass + 1))
  else
    echo "FAIL  $name (expected '$expected', got '$got')"
    fail=$((fail + 1))
  fi
}

CLAUDE_MAP="$REPO_DIR/model-mappings/claude.yml"

# Four Claude offerings at their four rungs (rank, native-value, rung).
assert_yq "claude offering 1 is haiku, rank 1, rung medium" "$CLAUDE_MAP" \
  '.offerings[0].id + "|" + (.offerings[0].rank | tostring) + "|" + .offerings[0].provides.intelligence' \
  "haiku|1|medium"
assert_yq "claude offering 2 is sonnet, rank 2, rung high" "$CLAUDE_MAP" \
  '.offerings[1].id + "|" + (.offerings[1].rank | tostring) + "|" + .offerings[1].provides.intelligence' \
  "sonnet|2|high"
assert_yq "claude offering 3 is opus, rank 3, rung xhigh" "$CLAUDE_MAP" \
  '.offerings[2].id + "|" + (.offerings[2].rank | tostring) + "|" + .offerings[2].provides.intelligence' \
  "opus|3|xhigh"
assert_yq "claude offering 4 is fable, rank 4, rung xxhigh" "$CLAUDE_MAP" \
  '.offerings[3].id + "|" + (.offerings[3].rank | tostring) + "|" + .offerings[3].provides.intelligence' \
  "fable|4|xxhigh"

# haiku: supports-reasoning-surface false, with both R36 grounds present and
# of the right kind (assumption on the fact, citation on the behavior).
assert_yq "claude haiku supports-reasoning-surface is false" "$CLAUDE_MAP" \
  '.offerings[0]."supports-reasoning-surface" | tostring' "false"
assert_yq "claude haiku carries an assumption ground on supports-reasoning-surface" "$CLAUDE_MAP" \
  '[.offerings[0].grounds[] | select(.declares == "supports-reasoning-surface")] | .[0] | has("assumption")' "true"
assert_yq "claude haiku carries a citation ground on supports-reasoning-surface.behavior" "$CLAUDE_MAP" \
  '[.offerings[0].grounds[] | select(.declares == "supports-reasoning-surface.behavior")] | .[0] | has("citation")' "true"

# The none: unmapped projection entry.
assert_yq "claude reasoning projection: none is unmapped" "$CLAUDE_MAP" \
  '.surfaces[0].items[1].projection.none' "unmapped"

# The guard: withheld, two terms.
assert_yq "claude guard state is withheld" "$CLAUDE_MAP" '.guard.state' "withheld"
assert_yq "claude guard has exactly two terms" "$CLAUDE_MAP" '.guard.terms | length' "2"

# Named edit 3 — R35's negative half: the guidance items on Claude carry an
# ASSUMPTION ground, never a citation of the live-verification research
# report (the analogous R36 case is already pinned above).
assert_yq "claude guidance model item carries an assumption, not a citation" "$CLAUDE_MAP" \
  '[.surfaces[1].items[] | select(.item == "model")] | .[0].grounds[0] | has("assumption")' "true"
assert_yq "claude guidance reasoning item carries an assumption, not a citation" "$CLAUDE_MAP" \
  '[.surfaces[1].items[] | select(.item == "reasoning")] | .[0].grounds[0] | has("assumption")' "true"

# Named edit 2 — the three Gemini offerings state supports-reasoning-surface
# explicitly (rather than leaving it to A17's inference).
GEMINI_MAP="$REPO_DIR/model-mappings/gemini.yml"
assert_yq "gemini has exactly three offerings" "$GEMINI_MAP" '.offerings | length' "3"
assert_yq "gemini offering 1 declares supports-reasoning-surface explicitly" "$GEMINI_MAP" \
  '.offerings[0] | has("supports-reasoning-surface")' "true"
assert_yq "gemini offering 2 declares supports-reasoning-surface explicitly" "$GEMINI_MAP" \
  '.offerings[1] | has("supports-reasoning-surface")' "true"
assert_yq "gemini offering 3 declares supports-reasoning-surface explicitly" "$GEMINI_MAP" \
  '.offerings[2] | has("supports-reasoning-surface")' "true"

# Copilot: zero offerings, with its zero-offerings: block.
COPILOT_MAP="$REPO_DIR/model-mappings/copilot.yml"
assert_yq "copilot has zero offerings" "$COPILOT_MAP" '.offerings | length' "0"
assert_yq "copilot declares a zero-offerings block" "$COPILOT_MAP" '. | has("zero-offerings")' "true"

# Antigravity: five offerings, each providing the reasoning rung its suffix
# encodes.
ANTIGRAVITY_MAP="$REPO_DIR/model-mappings/antigravity.yml"
assert_yq "antigravity has exactly five offerings" "$ANTIGRAVITY_MAP" '.offerings | length' "5"
assert_yq "antigravity offering 1 encodes and provides matching reasoning (low)" "$ANTIGRAVITY_MAP" \
  '.offerings[0].encodes.reasoning + "|" + .offerings[0].provides.reasoning' "low|low"
assert_yq "antigravity offering 2 encodes and provides matching reasoning (medium)" "$ANTIGRAVITY_MAP" \
  '.offerings[1].encodes.reasoning + "|" + .offerings[1].provides.reasoning' "medium|medium"
assert_yq "antigravity offering 3 encodes and provides matching reasoning (high)" "$ANTIGRAVITY_MAP" \
  '.offerings[2].encodes.reasoning + "|" + .offerings[2].provides.reasoning' "high|high"
assert_yq "antigravity offering 4 encodes and provides matching reasoning (low)" "$ANTIGRAVITY_MAP" \
  '.offerings[3].encodes.reasoning + "|" + .offerings[3].provides.reasoning' "low|low"
assert_yq "antigravity offering 5 encodes and provides matching reasoning (high)" "$ANTIGRAVITY_MAP" \
  '.offerings[4].encodes.reasoning + "|" + .offerings[4].provides.reasoning' "high|high"

# Named edit 3 (antigravity half) — the guidance item's ground is an
# assumption, not a citation.
assert_yq "antigravity guidance model item carries an assumption, not a citation" "$ANTIGRAVITY_MAP" \
  '.surfaces[0].items[0].grounds[0] | has("assumption")' "true"

# Nine observed-not-declared entries.
assert_yq "antigravity records nine observed-not-declared identifiers" "$ANTIGRAVITY_MAP" \
  '."observed-not-declared" | length' "9"

echo ""
echo "Results: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
