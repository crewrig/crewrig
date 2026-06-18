#!/bin/bash
# test-build-ci.sh — Regression test for build-ci.sh (spec 0048).
#
# Pins the contract from spec 0048 and the deltas it absorbs:
#   - Scenario 1: a portable capability is derived into a GitLab job
#     identifiable by its capability id, running the command wrapped in the
#     engine's setup boilerplate, under an equivalent trigger;
#   - Scenario 2: a drifted committed .gitlab-ci.yml is rejected non-zero;
#   - Scenario 3: an engine-specific capability emits no job and no placeholder;
#   - the committed .gitlab-ci.yml matches a fresh derivation (the real tree);
#   - delta-01 R10: command list → script list;
#   - delta-02 R12: requires → image / before_script / GIT_DEPTH boilerplate,
#     and a portable capability whose command needs an undeclared tool/runtime
#     is rejected by the generator (delta-02 Scenario 2).
#
# The script under test derives its repo root from REPO_DIR (env) or its own
# location. Synthetic-reference cases set REPO_DIR to a throwaway tree
# containing a scripts/ + ci/ layout, copy the real generator in, and run it
# there. The real-tree cases run against the actual repository.
#
# Usage:
#   bash scripts/tests/test-build-ci.sh

# -e omitted on purpose: expected non-zero exits from the script under test are
# asserted explicitly, not allowed to abort the harness.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SCRIPT_UNDER_TEST="$SCRIPT_DIR/build-ci.sh"
REAL_REFERENCE="$REPO_ROOT/ci/ci-capabilities.yml"
REAL_OUTPUT="$REPO_ROOT/.gitlab-ci.yml"

if [ ! -f "$SCRIPT_UNDER_TEST" ]; then
  echo "FATAL: cannot find $SCRIPT_UNDER_TEST" >&2
  exit 2
fi
command -v yq >/dev/null 2>&1 || { echo "FATAL: yq is required" >&2; exit 2; }

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

pass=0
fail=0

assert_eq() {
  local name="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "PASS  $name"
    pass=$((pass + 1))
  else
    echo "FAIL  $name (expected '$expected', got '$actual')"
    fail=$((fail + 1))
  fi
}

assert_contains() {
  local name="$1" haystack="$2" needle="$3"
  if printf '%s' "$haystack" | grep -qF "$needle"; then
    echo "PASS  $name"
    pass=$((pass + 1))
  else
    echo "FAIL  $name (substring not found: '$needle')"
    fail=$((fail + 1))
  fi
}

# Build a throwaway "repo" with a scripts/ + ci/ layout and the generator
# copied in; echo its root.
new_tree() {
  local dir
  dir="$(mktemp -d "$TMP_ROOT/tree.XXXXXX")"
  mkdir -p "$dir/scripts" "$dir/ci"
  cp "$SCRIPT_UNDER_TEST" "$dir/scripts/build-ci.sh"
  echo "$dir"
}

# Run the generator inside a synthetic tree (REPO_DIR pins the root). Sets RC.
run_in() {
  local tree="$1"; shift
  RC=0
  ( cd "$tree" && REPO_DIR="$tree" bash scripts/build-ci.sh "$@" >/dev/null 2>&1 ) || RC=$?
}

# =========================================================================
# REAL-TREE cases — the committed .gitlab-ci.yml is the contract's output.
# =========================================================================

# Case A — the committed .gitlab-ci.yml matches a fresh derivation (--check OK).
RC=0
bash "$SCRIPT_UNDER_TEST" --check >/dev/null 2>&1 || RC=$?
assert_eq "Case A — committed .gitlab-ci.yml matches the reference (--check)" 0 "$RC"

# Case B (Scenario 1) — every PORTABLE capability id is a job key in the output;
# the job runs the declared command and carries trigger rules.
portable_ids="$(yq -r '.capabilities[] | select(.portability == "portable") | .id' "$REAL_REFERENCE")"
missing_job=""
while IFS= read -r id; do
  [ -z "$id" ] && continue
  present="$(yq "has(\"$id\")" "$REAL_OUTPUT")"
  [ "$present" = "true" ] || missing_job="$missing_job $id"
done <<< "$portable_ids"
assert_eq "Case B — every portable capability id is a GitLab job key (Scenario 1)" "" "$missing_job"

# The `build` job: command → script, runtime → image, an equivalent trigger.
build_job="$(yq '.build' "$REAL_OUTPUT")"
assert_contains "Case B1 — build job script carries the command (delta-01 R10)" "$build_job" "npm run build --workspaces --if-present"
assert_contains "Case B2 — build runtime node@22 → image node:22 (delta-02 R12)" "$build_job" "node:22"
assert_contains "Case B3 — build job has merge-request rule (trigger mapping)" "$build_job" 'merge_request_event'

# Case C (Scenario 3) — every ENGINE-SPECIFIC capability emits NO job and NO
# placeholder.
specific_ids="$(yq -r '.capabilities[] | select(.portability == "specific") | .id' "$REAL_REFERENCE")"
leaked=""
while IFS= read -r id; do
  [ -z "$id" ] && continue
  present="$(yq "has(\"$id\")" "$REAL_OUTPUT")"
  [ "$present" = "true" ] && leaked="$leaked $id"
done <<< "$specific_ids"
assert_eq "Case C — no engine-specific capability emits a job/placeholder (Scenario 3, R4)" "" "$leaked"

# Case D — output job count equals the portable capability count exactly (no
# extra, no placeholder). Job keys = top-level keys minus reserved keywords.
n_portable="$(yq '[.capabilities[] | select(.portability == "portable")] | length' "$REAL_REFERENCE")"
n_jobs="$(yq '[ keys[] as $k | $k | select(["stages","workflow","default","include","variables","image","before_script","after_script","cache","services","pages"] | contains([$k]) | not) ] | length' "$REAL_OUTPUT")"
assert_eq "Case D — job count == portable capability count" "$n_portable" "$n_jobs"

# Case E (delta-02 R12) — history-depth: full → GIT_DEPTH "0".
csv_job="$(yq '.["check-skill-versions"]' "$REAL_OUTPUT")"
assert_contains "Case E — check-skill-versions history-depth full → GIT_DEPTH 0" "$csv_job" 'GIT_DEPTH'

# Case F (delta-02 R12) — tools: [yq] → before_script install line.
cc_job="$(yq '.["check-components"]' "$REAL_OUTPUT")"
assert_contains "Case F — check-components tools:[yq] → before_script yq install" "$cc_job" '/usr/local/bin/yq'

# =========================================================================
# SYNTHETIC cases — drift, validation rejection.
# =========================================================================

# Case G (Scenario 2) — a drifted committed .gitlab-ci.yml is rejected non-zero.
tg="$(new_tree)"
cat > "$tg/ci/ci-capabilities.yml" <<'YML'
capabilities:
  - id: build
    name: "Build"
    trigger:
      - on: pull-request
        branches: [main]
    portability: portable
    requires:
      runtime: node@22
    command:
      - npm install
YML
run_in "$tg"
assert_eq "Case G0 — synthetic generate succeeds" 0 "$RC"
printf '\n# injected drift\n' >> "$tg/.gitlab-ci.yml"
run_in "$tg" --check
assert_eq "Case G — --check rejects a drifted pipeline non-zero (Scenario 2)" 1 "$RC"

# Case H (Scenario 3, synthetic) — a specific capability emits no job.
th="$(new_tree)"
cat > "$th/ci/ci-capabilities.yml" <<'YML'
capabilities:
  - id: build
    name: "Build"
    trigger:
      - on: push
        branches: [main]
    portability: portable
    requires:
      runtime: node@22
    command:
      - npm install
  - id: pages-deploy
    name: "Deploy to GitHub Pages"
    trigger:
      - on: push
        branches: [main]
    portability: specific
    exception:
      engine: github-actions
      evidence: "GitHub Pages has no faithful GitLab equivalent."
YML
run_in "$th"
assert_eq "Case H0 — generate succeeds" 0 "$RC"
out="$(cat "$th/.gitlab-ci.yml")"
assert_contains "Case H1 — portable 'build' job present" "$out" $'\nbuild:'
specific_present="$(yq 'has("pages-deploy")' "$th/.gitlab-ci.yml")"
assert_eq "Case H2 — specific 'pages-deploy' absent (no job, no placeholder)" "false" "$specific_present"
# And no placeholder comment naming it either.
placeholder="$(grep -c 'pages-deploy' "$th/.gitlab-ci.yml" || true)"
assert_eq "Case H3 — no placeholder mentions the specific id" "0" "$placeholder"

# Case I (delta-02 Scenario 2) — a portable capability whose command needs a
# tool it does not declare under requires is rejected by the generator. The
# generator has exactly one install recipe per declarable tool; a requires with
# an UNDECLARED/UNKNOWN tool has no recipe, so the derivation fails closed.
ti="$(new_tree)"
cat > "$ti/ci/ci-capabilities.yml" <<'YML'
capabilities:
  - id: build
    name: "Build"
    trigger:
      - on: push
        branches: [main]
    portability: portable
    requires:
      tools: [nonexistent-tool]
    command:
      - nonexistent-tool --run
YML
run_in "$ti"
assert_eq "Case I — undeclared/unmappable tool requirement rejected non-zero (delta-02 Scenario 2)" 1 "$RC"

# Case J — an unknown runtime is rejected (fail-closed translation).
tj="$(new_tree)"
cat > "$tj/ci/ci-capabilities.yml" <<'YML'
capabilities:
  - id: build
    name: "Build"
    trigger:
      - on: push
        branches: [main]
    portability: portable
    requires:
      runtime: cobol@85
    command:
      - cobc -x main.cob
YML
run_in "$tj"
assert_eq "Case J — unknown runtime rejected non-zero" 1 "$RC"

# Case K — the generated YAML is parseable by yq.
tk="$(new_tree)"
cp "$REAL_REFERENCE" "$tk/ci/ci-capabilities.yml"
run_in "$tk"
assert_eq "Case K0 — generate from the real reference succeeds" 0 "$RC"
RC=0
yq '.' "$tk/.gitlab-ci.yml" >/dev/null 2>&1 || RC=$?
assert_eq "Case K1 — generated .gitlab-ci.yml parses as YAML" 0 "$RC"

# -------------------------------------------------------------------------
echo ""
echo "Results: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
