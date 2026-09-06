#!/bin/bash
# test-agent-profile-migration.sh — Regression suite for the spec 0200
# migration of the 22 core agent sources to capability profiles.
#
# Mirrors the scripts/tests/test-model-resolution.sh idiom: `set -uo
# pipefail` (exit behavior asserted via explicit counters, never -e),
# mktemp -d + trap, an ok/bad pass-fail counter.
#
# Every case here is decidable at HEAD, over the committed tree — no case
# diffs against a named commit (spec 0200 PLAN v2, v1-F2). The one-time
# historical measurements against 723ad8f (H1-H4) are recorded on the
# logbook issue, not asserted here.
#
# Cases:
#   T1 — R36: component-drift's --check command is still wired.
#   T2 — R14,R16,R17,R18: one real source per rung, across all four
#        targets, over the committed outputs (not a fixture build).
#   T3 — R15: no effort: frontmatter field on any of the four agent trees.
#   T4 — R21: the diagnostic stream of a plain build over a throwaway root
#        seeded with all 22 real migrated sources is exactly 44 lines.
#   T5 — R20, R5: harness-curator stays profile-less; a build over a
#        throwaway root seeded with it emits no note/drop and its four
#        compiled outputs carry no model/effort key and no guidance prose.
#   T7 — R1, R2, R4: a 22-row <name> <rung> baseline, checked five ways,
#        including the published R3 table in docs/agent-profile-migration.md
#        (T7(e), PLAN v2's Decision 9 plus the plan/1123#2 review's v2-F1:
#        the published table carries 23 rows, harness-curator's declaring
#        no rung).
#   R40 mutation — a profile edited without regenerating reds
#        component-drift's --check, naming the three drifted targets.
#
# Usage:
#   bash scripts/tests/test-agent-profile-migration.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD_SCRIPT="$SCRIPT_DIR/build-components.sh"
CI_CAPABILITIES="$REPO_DIR/ci/ci-capabilities.yml"
BASELINE_DOC="$REPO_DIR/docs/agent-profile-migration.md"

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

# --- The 22-row <name> <rung> baseline (spec 0200 PLAN v2 *Translation*) ---
# Authoritative in this suite, per Decision 9: parsing the published table
# as the baseline would make this suite's correctness hostage to a
# markdownlint reflow of a prose document. T7(e) below checks the document
# AGAINST this baseline, not the reverse.
BASELINE='accessibility-auditor medium
accessibility-tester medium
architect xhigh
astro-developer high
ci-configurator high
ci-debugger high
ci-parity high
copywriter medium
designer high
developer high
doc-writer medium
frontend-developer high
pr-logbook medium
pr-reviewer high
regression-sentinel medium
scenario-author medium
security high
seo-specialist medium
spec-author high
tester high
visual-regression-tester medium
web-conformity-checker medium'

echo "=== T1 — R36: component-drift's --check command is still wired ==="

t1_command_list="$(yq '.capabilities[] | select(.id=="component-drift") | .command[]' "$CI_CAPABILITIES" 2>/dev/null)"
if printf '%s\n' "$t1_command_list" | grep -qF 'bash scripts/build-components.sh --target all --check'; then
  ok "T1 — component-drift's command: list carries the --check invocation"
else
  bad "T1 — component-drift's command: list carries the --check invocation" "$t1_command_list"
fi

echo ""
echo "=== T2 — R14,R16,R17,R18: one real committed source per rung, all four targets ==="

# assert_claude <name> <alias> — description ends with the guidance
# sentence naming <alias>; no model: or effort: frontmatter key.
assert_claude() {
  local name="$1" alias="$2" fm has_model has_effort desc
  fm="$(extract_frontmatter "$REPO_DIR/.claude/agents/$name/AGENT.md")"
  desc="$(printf '%s\n' "$fm" | yq -r '.description' 2>/dev/null)"
  has_model="$(printf '%s\n' "$fm" | yq 'has("model")' 2>/dev/null || echo false)"
  has_effort="$(printf '%s\n' "$fm" | yq 'has("effort")' 2>/dev/null || echo false)"
  if printf '%s' "$desc" | grep -qF "Run this agent on the $alias model." \
     && [ "$has_model" = false ] && [ "$has_effort" = false ]; then
    ok "T2 — .claude/agents/$name/AGENT.md carries the $alias guidance sentence, no model:/effort:"
  else
    bad "T2 — .claude/agents/$name/AGENT.md carries the $alias guidance sentence, no model:/effort:" \
      "description=$desc" "has_model=$has_model has_effort=$has_effort"
  fi
}

# assert_gemini <name> <model-id> — model: field present and correct; no
# guidance sentence in description.
assert_gemini() {
  local name="$1" model_id="$2" fm got_model desc
  fm="$(extract_frontmatter "$REPO_DIR/.gemini/agents/$name.md")"
  got_model="$(printf '%s\n' "$fm" | yq -r '.model' 2>/dev/null)"
  desc="$(printf '%s\n' "$fm" | yq -r '.description' 2>/dev/null)"
  if [ "$got_model" = "$model_id" ] && ! printf '%s' "$desc" | grep -qF "Run this agent on the"; then
    ok "T2 — .gemini/agents/$name.md carries model: $model_id, no guidance sentence"
  else
    bad "T2 — .gemini/agents/$name.md carries model: $model_id, no guidance sentence" \
      "got model=$got_model" "description=$desc"
  fi
}

# assert_antigravity <name> <offering> — description ends with the
# guidance sentence naming <offering>; no model frontmatter key.
assert_antigravity() {
  local name="$1" offering="$2" fm has_model desc
  fm="$(extract_frontmatter "$REPO_DIR/.agents/agents/$name/AGENT.md")"
  desc="$(printf '%s\n' "$fm" | yq -r '.description' 2>/dev/null)"
  has_model="$(printf '%s\n' "$fm" | yq 'has("model")' 2>/dev/null || echo false)"
  if printf '%s' "$desc" | grep -qF "Run this agent on the $offering model." && [ "$has_model" = false ]; then
    ok "T2 — .agents/agents/$name/AGENT.md carries the $offering guidance sentence, no model:"
  else
    bad "T2 — .agents/agents/$name/AGENT.md carries the $offering guidance sentence, no model:" \
      "description=$desc" "has_model=$has_model"
  fi
}

# assert_copilot <name> — no model:/effort: frontmatter key, no guidance
# sentence in description (R17 as narrowed by delta-01: unchanged except
# the provenance version line, which carries neither key nor prose).
assert_copilot() {
  local name="$1" fm has_model has_effort desc
  fm="$(extract_frontmatter "$REPO_DIR/.github/agents/$name.md")"
  desc="$(printf '%s\n' "$fm" | yq -r '.description' 2>/dev/null)"
  has_model="$(printf '%s\n' "$fm" | yq 'has("model")' 2>/dev/null || echo false)"
  has_effort="$(printf '%s\n' "$fm" | yq 'has("effort")' 2>/dev/null || echo false)"
  if [ "$has_model" = false ] && [ "$has_effort" = false ] && ! printf '%s' "$desc" | grep -qF "Run this agent on the"; then
    ok "T2 — .github/agents/$name.md carries no model:/effort:, no guidance sentence"
  else
    bad "T2 — .github/agents/$name.md carries no model:/effort:, no guidance sentence" \
      "has_model=$has_model has_effort=$has_effort" "description=$desc"
  fi
}

assert_claude doc-writer haiku
assert_gemini doc-writer gemini-3.5-flash
assert_antigravity doc-writer gemini-3.8-flash-low
assert_copilot doc-writer

assert_claude developer sonnet
assert_gemini developer gemini-3.1-pro-preview
assert_antigravity developer gemini-3.1-pro-low
assert_copilot developer

assert_claude architect opus
assert_gemini architect gemini-3.1-pro-preview
assert_antigravity architect gemini-3.1-pro-low
assert_copilot architect

echo ""
echo "=== T3 — R15: no effort: frontmatter field on any of the four agent trees ==="

t3_hits="$(grep -rl '^effort:' "$REPO_DIR/.claude/agents" "$REPO_DIR/.gemini/agents" "$REPO_DIR/.github/agents" "$REPO_DIR/.agents/agents" 2>/dev/null | wc -l | tr -d ' ')"
if [ "$t3_hits" -eq 0 ]; then
  ok "T3 — 0 effort: frontmatter fields across the four agent trees"
else
  bad "T3 — 0 effort: frontmatter fields across the four agent trees" "found $t3_hits"
fi

echo ""
echo "=== T4 — R21: diagnostic stream of a plain build, 22-source throwaway root ==="

T4_ROOT="$TMP_ROOT/t4-root"
mkdir -p "$T4_ROOT/artifacts/core/agents"
for d in "$REPO_DIR"/artifacts/core/agents/*/; do
  name="$(basename "$d")"
  mkdir -p "$T4_ROOT/artifacts/core/agents/$name"
  cp "$d/AGENT.md" "$T4_ROOT/artifacts/core/agents/$name/AGENT.md"
done
cp "$REPO_DIR/crewrig.config.toml" "$T4_ROOT/crewrig.config.toml"
cp -r "$REPO_DIR/model-mappings" "$T4_ROOT/model-mappings"
# Fields are tab-separated (model-note <name> claude guard-withheld ...),
# so a space-anchored grep never matches; classify by line-start plus a
# loose substring check instead.
t4_err="$(REPO_DIR="$T4_ROOT" bash "$BUILD_SCRIPT" --target all 2>&1 >/dev/null)"
t4_lines="$(printf '%s\n' "$t4_err" | grep -c '.')"
t4_notes="$(printf '%s\n' "$t4_err" | grep -c '^model-note.*claude.*guard-withheld')"
t4_drops="$(printf '%s\n' "$t4_err" | grep -c '^model-drop.*copilot.*metadata\.model\.intelligence.*unsupported-on-cli')"
t4_other="$(printf '%s\n' "$t4_err" | grep -vc '^model-note.*claude.*guard-withheld\|^model-drop.*copilot.*metadata\.model\.intelligence.*unsupported-on-cli')"
if [ "$t4_lines" -eq 44 ] && [ "$t4_notes" -eq 22 ] && [ "$t4_drops" -eq 22 ] && [ "$t4_other" -eq 0 ]; then
  ok "T4 — a plain build over the 22-source root emits exactly 44 lines (22 guard-withheld + 22 unsupported-on-cli)"
else
  bad "T4 — a plain build over the 22-source root emits exactly 44 lines (22 guard-withheld + 22 unsupported-on-cli)" \
    "total=$t4_lines notes=$t4_notes drops=$t4_drops other=$t4_other" "$t4_err"
fi

t4_compiled_hits="$(grep -rl 'model-note\|model-drop' "$T4_ROOT/.claude" "$T4_ROOT/.gemini" "$T4_ROOT/.github" "$T4_ROOT/.agents" 2>/dev/null | wc -l | tr -d ' ')"
if [ "$t4_compiled_hits" -eq 0 ]; then
  ok "T4 — no compiled output contains a note or a drop record"
else
  bad "T4 — no compiled output contains a note or a drop record" "found in $t4_compiled_hits file(s)"
fi

echo ""
echo "=== T5 — R20,R5: harness-curator stays the tree's profile-less witness ==="

HC_SOURCE="$REPO_DIR/artifacts/library/agents/harness-curator/AGENT.md"
hc_fm="$(extract_frontmatter "$HC_SOURCE")"
hc_has_model="$(printf '%s\n' "$hc_fm" | yq '.metadata // {} | has("model")' 2>/dev/null || echo false)"
hc_has_claude="$(printf '%s\n' "$hc_fm" | yq '.metadata // {} | has("claude")' 2>/dev/null || echo false)"
if [ "$hc_has_model" = false ] && [ "$hc_has_claude" = false ]; then
  ok "T5 — harness-curator's source declares no metadata.model and no metadata.claude"
else
  bad "T5 — harness-curator's source declares no metadata.model and no metadata.claude" \
    "has_model=$hc_has_model has_claude=$hc_has_claude"
fi

T5_ROOT="$TMP_ROOT/t5-root"
mkdir -p "$T5_ROOT/artifacts/library/agents/harness-curator"
cp "$HC_SOURCE" "$T5_ROOT/artifacts/library/agents/harness-curator/AGENT.md"
cp "$REPO_DIR/crewrig.config.toml" "$T5_ROOT/crewrig.config.toml"
cp -r "$REPO_DIR/model-mappings" "$T5_ROOT/model-mappings"
t5_err="$(REPO_DIR="$T5_ROOT" bash "$BUILD_SCRIPT" --target all 2>&1 >/dev/null)"
t5_hits="$(printf '%s\n' "$t5_err" | grep -c 'model-note\|model-drop')"
if [ "$t5_hits" -eq 0 ]; then
  ok "T5 — a build seeded with harness-curator alone emits 0 model-note/model-drop lines"
else
  bad "T5 — a build seeded with harness-curator alone emits 0 model-note/model-drop lines" "$t5_err"
fi

t5_outputs_ok=1
for out in "$T5_ROOT/dist/library/.claude/agents/harness-curator/AGENT.md" \
           "$T5_ROOT/dist/library/.gemini/agents/harness-curator.md" \
           "$T5_ROOT/dist/library/.github/agents/harness-curator.md" \
           "$T5_ROOT/dist/library/.agents/agents/harness-curator/AGENT.md"; do
  if [ ! -f "$out" ]; then t5_outputs_ok=0; continue; fi
  fm="$(extract_frontmatter "$out")"
  has_model="$(printf '%s\n' "$fm" | yq 'has("model")' 2>/dev/null || echo false)"
  has_effort="$(printf '%s\n' "$fm" | yq 'has("effort")' 2>/dev/null || echo false)"
  desc="$(printf '%s\n' "$fm" | yq -r '.description' 2>/dev/null)"
  if [ "$has_model" != false ] || [ "$has_effort" != false ] || printf '%s' "$desc" | grep -qF "Run this agent on the"; then
    t5_outputs_ok=0
  fi
done
if [ "$t5_outputs_ok" -eq 1 ]; then
  ok "T5 — harness-curator's four compiled outputs carry no model:/effort: key and no guidance prose"
else
  bad "T5 — harness-curator's four compiled outputs carry no model:/effort: key and no guidance prose"
fi

echo ""
echo "=== T7 — R1,R2,R4: the 22-row baseline, checked five ways ==="

# --- T7(a) — the baseline's name set equals artifacts/core/agents/'s -----
t7a_actual="$(cd "$REPO_DIR/artifacts/core/agents" && ls -d */ | sed 's#/##' | sort)"
t7a_expected="$(printf '%s\n' "$BASELINE" | awk '{print $1}' | sort)"
if [ "$t7a_actual" = "$t7a_expected" ]; then
  ok "T7(a) — baseline name set equals artifacts/core/agents/'s directory listing (22)"
else
  bad "T7(a) — baseline name set equals artifacts/core/agents/'s directory listing (22)" \
    "--- expected ---" "$t7a_expected" "--- actual ---" "$t7a_actual"
fi

# --- T7(b) — each source's declared rung equals its baseline rung --------
t7b_fail=0
while IFS=' ' read -r name rung; do
  [ -z "$name" ] && continue
  got="$(extract_frontmatter "$REPO_DIR/artifacts/core/agents/$name/AGENT.md" | yq -r '.metadata.model.intelligence' 2>/dev/null)"
  if [ "$got" != "$rung" ]; then
    bad "T7(b) — $name declares intelligence: $rung" "got: $got"
    t7b_fail=1
  fi
done <<< "$BASELINE"
[ "$t7b_fail" -eq 0 ] && ok "T7(b) — all 22 sources declare their baseline rung"

# --- T7(c) — the 23 agent sources' metadata.model is absent or {intelligence} alone
t7c_fail=0
t7c_count=0
for f in "$REPO_DIR"/artifacts/core/agents/*/AGENT.md "$REPO_DIR"/artifacts/library/agents/*/AGENT.md; do
  t7c_count=$((t7c_count + 1))
  fm="$(extract_frontmatter "$f")"
  has_model="$(printf '%s\n' "$fm" | yq '.metadata // {} | has("model")' 2>/dev/null || echo false)"
  if [ "$has_model" = true ]; then
    keys="$(printf '%s\n' "$fm" | yq -r '.metadata.model | keys | join(",")' 2>/dev/null)"
    if [ "$keys" != "intelligence" ]; then
      bad "T7(c) — $f's metadata.model carries exactly {intelligence}" "got keys: $keys"
      t7c_fail=1
    fi
  fi
done
if [ "$t7c_count" -eq 23 ] && [ "$t7c_fail" -eq 0 ]; then
  ok "T7(c) — all 23 agent sources' metadata.model is absent or {intelligence} alone"
else
  [ "$t7c_count" -ne 23 ] && bad "T7(c) — exactly 23 agent sources examined" "got: $t7c_count"
fi

# --- T7(d) — the measured rung multiset is exactly medium x10, high x11, xhigh x1
t7d_medium=0; t7d_high=0; t7d_xhigh=0; t7d_other=0
while IFS=' ' read -r name rung; do
  [ -z "$name" ] && continue
  got="$(extract_frontmatter "$REPO_DIR/artifacts/core/agents/$name/AGENT.md" | yq -r '.metadata.model.intelligence' 2>/dev/null)"
  case "$got" in
    medium) t7d_medium=$((t7d_medium + 1)) ;;
    high) t7d_high=$((t7d_high + 1)) ;;
    xhigh) t7d_xhigh=$((t7d_xhigh + 1)) ;;
    *) t7d_other=$((t7d_other + 1)) ;;
  esac
done <<< "$BASELINE"
if [ "$t7d_medium" -eq 10 ] && [ "$t7d_high" -eq 11 ] && [ "$t7d_xhigh" -eq 1 ] && [ "$t7d_other" -eq 0 ]; then
  ok "T7(d) — the measured rung multiset is exactly medium x10, high x11, xhigh x1"
else
  bad "T7(d) — the measured rung multiset is exactly medium x10, high x11, xhigh x1" \
    "medium=$t7d_medium high=$t7d_high xhigh=$t7d_xhigh other=$t7d_other"
fi

# --- T7(e) — the published R3 table agrees with the baseline -------------
# Parses the block after "<!-- crewrig-table: agent-profile-baseline -->"
# in docs/agent-profile-migration.md: the header row and the separator row
# are skipped, every subsequent "| ... |" line is a data row, until the
# first line that is not a table row ends the block.
extract_published_table() {
  awk '
    state==0 && /<!-- crewrig-table: agent-profile-baseline -->/ { state=1; next }
    state==1 && /^\|/ { state=2; next }
    state==2 && /^\|---/ { state=3; next }
    state==3 && /^\|/ { print; next }
    state==3 { exit }
  ' "$1"
}

t7e_rows="$(extract_published_table "$BASELINE_DOC")"
t7e_row_count="$(printf '%s\n' "$t7e_rows" | grep -c '^|')"
if [ "$t7e_row_count" -eq 23 ]; then
  ok "T7(e) — exactly 23 rows parsed from docs/agent-profile-migration.md's baseline table"
else
  bad "T7(e) — exactly 23 rows parsed from docs/agent-profile-migration.md's baseline table" \
    "got: $t7e_row_count" "$t7e_rows"
fi

t7e_fail=0
t7e_seen_harness_curator=0
while IFS='|' read -r _ raw_name raw_tier raw_rung _rest; do
  [ -z "${raw_name:-}" ] && continue
  name="$(printf '%s' "$raw_name" | tr -d ' `')"
  rung="$(printf '%s' "$raw_rung" | tr -d ' `')"
  if [ "$name" = "harness-curator" ]; then
    t7e_seen_harness_curator=1
    if [ "$rung" != "*(none)*" ]; then
      bad "T7(e) — harness-curator's published row declares no rung" "got: $rung"
      t7e_fail=1
    fi
    continue
  fi
  expected="$(printf '%s\n' "$BASELINE" | awk -v n="$name" '$1==n{print $2}')"
  if [ -z "$expected" ]; then
    bad "T7(e) — $name is present in the published table and the baseline" "not found in baseline"
    t7e_fail=1
    continue
  fi
  if [ "$rung" != "$expected" ]; then
    bad "T7(e) — $name's published rung agrees with the baseline" "published: $rung, baseline: $expected"
    t7e_fail=1
  fi
done <<< "$t7e_rows"

if [ "$t7e_seen_harness_curator" -eq 1 ] && [ "$t7e_fail" -eq 0 ]; then
  ok "T7(e) — the 22 rung-bearing rows agree with the baseline, and harness-curator's row declares no rung"
elif [ "$t7e_seen_harness_curator" -eq 0 ]; then
  bad "T7(e) — the published table carries a harness-curator row"
fi

echo ""
echo "=== R40 mutation — a profile edit without regenerating reds component-drift's --check ==="

M1_ROOT="$TMP_ROOT/m1-root"
mkdir -p "$M1_ROOT"
(cd "$REPO_DIR" && git archive HEAD) | tar -x -C "$M1_ROOT"
yq eval -i --front-matter=process '.metadata.model.intelligence = "medium"' "$M1_ROOT/artifacts/core/agents/developer/AGENT.md"
m1_out="$(REPO_DIR="$M1_ROOT" bash "$BUILD_SCRIPT" --target all --check 2>&1)"; m1_rc=$?
if [ "$m1_rc" -ne 0 ] \
   && printf '%s\n' "$m1_out" | grep -q '\.claude/agents/developer/AGENT\.md differs from source' \
   && printf '%s\n' "$m1_out" | grep -q '\.gemini/agents/developer\.md differs from source' \
   && printf '%s\n' "$m1_out" | grep -q '\.agents/agents/developer/AGENT\.md differs from source' \
   && ! printf '%s\n' "$m1_out" | grep -q '\.github/agents/developer\.md differs from source'; then
  ok "R40 — component-drift's --check reds on an unregenerated profile edit, naming .claude/.gemini/.agents but not .github"
else
  bad "R40 — component-drift's --check reds on an unregenerated profile edit, naming .claude/.gemini/.agents but not .github" \
    "exit=$m1_rc" "$m1_out"
fi

echo ""
echo "Results: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
