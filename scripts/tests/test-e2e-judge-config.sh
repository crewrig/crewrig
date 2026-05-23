#!/usr/bin/env bash
# test-e2e-judge-config.sh — Lock the [judge] schema in tests/e2e/defaults.toml
# and its surfacing through tests/e2e/lib/toml_merge.sh.
#
# ADR 0004 Decision 4: backend/model/api_key_env/strict/max_calls; the
# implementation also pins endpoint + max_tokens (called out in the lib).

set -uo pipefail

PASS=0
FAIL=0
SKIP=0

note_pass() { echo "# PASS $1"; PASS=$((PASS + 1)); }
note_fail() { echo "# FAIL $1 — $2"; FAIL=$((FAIL + 1)); }
note_skip() { echo "# SKIP $1: $2"; SKIP=$((SKIP + 1)); }

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEFAULTS="${REPO_DIR}/tests/e2e/defaults.toml"
MERGER="${REPO_DIR}/tests/e2e/lib/toml_merge.sh"

command -v yq >/dev/null 2>&1 || { note_skip "yq dependency" "yq not on PATH"; echo "# $PASS passed / $FAIL failed / $SKIP skipped"; exit 0; }
command -v jq >/dev/null 2>&1 || { note_skip "jq dependency" "jq not on PATH"; echo "# $PASS passed / $FAIL failed / $SKIP skipped"; exit 0; }

# 1. defaults.toml parses cleanly via yq.
parsed="$(yq -p=toml -o=json '.' "$DEFAULTS" 2>&1)" \
  && note_pass "defaults.toml parses as TOML" \
  || note_fail "defaults.toml parses as TOML" "yq: $parsed"

# 2-4. [judge] section + each pinned field.
check_field() {
  local path="$1" expected="$2"
  local actual
  actual="$(jq -r "$path" <<<"$parsed" 2>/dev/null)"
  if [[ "$actual" == "$expected" ]]; then
    note_pass "[judge] ${path#.judge.} == ${expected}"
  else
    note_fail "[judge] ${path#.judge.} == ${expected}" "actual='$actual'"
  fi
}

if jq -e '.judge' <<<"$parsed" >/dev/null 2>&1; then
  note_pass "[judge] table present"
else
  note_fail "[judge] table present" "missing"
  echo "# $PASS passed / $FAIL failed / $SKIP skipped"
  exit 1
fi

check_field '.judge.backend'     'anthropic'
check_field '.judge.model'       'claude-sonnet-4-6'
check_field '.judge.api_key_env' 'ANTHROPIC_JUDGE_API_KEY'
check_field '.judge.strict'      'false'
check_field '.judge.max_calls'   '30'
check_field '.judge.endpoint'    'https://api.anthropic.com/v1/messages'
check_field '.judge.max_tokens'  '256'

# 5. toml_merge.sh with no local.toml surfaces all six (well, seven) fields.
TMP="$(mktemp -d -t crewrig-judge-cfg.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT
merged="$(bash "$MERGER" "$DEFAULTS" 2>"$TMP/merge.err")" \
  || { note_fail "toml_merge.sh passes through defaults" "$(cat "$TMP/merge.err")";
       echo "# $PASS passed / $FAIL failed / $SKIP skipped"; exit 1; }
note_pass "toml_merge.sh passes through defaults"

for f in backend model api_key_env strict max_calls endpoint max_tokens; do
  # Use `has(...)` rather than `-e`/path, because a false-valued field
  # makes `jq -e` itself exit 1 despite the field being present.
  if jq -e ".judge | has(\"${f}\")" <<<"$merged" >/dev/null 2>&1; then
    note_pass "merged JSON exposes .judge.${f}"
  else
    note_fail "merged JSON exposes .judge.${f}" "field missing"
  fi
done

echo "# $PASS passed / $FAIL failed / $SKIP skipped"
(( FAIL == 0 )) || exit 1
