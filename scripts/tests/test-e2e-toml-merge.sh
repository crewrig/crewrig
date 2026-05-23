#!/usr/bin/env bash
# test-e2e-toml-merge.sh — Regression for tests/e2e/lib/toml_merge.sh.
#
# Locks ADR 0003 Decision 2 merge semantics:
#   - tables merge recursively
#   - arrays APPEND (yq `*+`)
#   - scalars override
#   - new tables/keys graft in
#   - missing local.toml → defaults pass through
#   - malformed defaults → non-zero exit
#   - no /tmp residue after a clean run
#
# This test does not invoke docker.

set -uo pipefail

PASS=0
FAIL=0
SKIP=0

note_pass() { echo "# PASS $1"; PASS=$((PASS + 1)); }
note_fail() { echo "# FAIL $1 — $2"; FAIL=$((FAIL + 1)); }
note_skip() { echo "# SKIP $1: $2"; SKIP=$((SKIP + 1)); }

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MERGER="${REPO_DIR}/tests/e2e/lib/toml_merge.sh"

TMP="$(mktemp -d -t crewrig-toml-merge.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

if [[ ! -f "$MERGER" ]]; then
  note_fail "merger exists" "missing at $MERGER"
  echo "# 0 passed / 1 failed / 0 skipped"
  exit 1
fi
note_pass "merger exists"

command -v yq >/dev/null 2>&1 || { note_skip "yq dependency" "yq not on PATH"; }
command -v jq >/dev/null 2>&1 || { note_skip "jq dependency" "jq not on PATH"; }

# --- Case 1: empty local.toml → output equals defaults --------------------
c1_d="$TMP/c1-defaults.toml"
c1_l="$TMP/c1-local.toml"
cat > "$c1_d" <<'TOML'
[cli.claude]
image = "X"
mounts = ["a"]
TOML
: > "$c1_l"  # empty file is valid TOML (empty document)
d_json="$(bash "$MERGER" "$c1_d" 2>/dev/null | jq -S .)"
m_json="$(bash "$MERGER" "$c1_d" "$c1_l" 2>/dev/null | jq -S .)"
if [[ "$d_json" == "$m_json" ]]; then
  note_pass "empty local — output equals defaults"
else
  note_fail "empty local — output equals defaults" "diff: $(diff <(echo "$d_json") <(echo "$m_json") | tr '\n' '|')"
fi

# --- Case 2: array APPEND (AC #3, critical) -------------------------------
c2_d="$TMP/c2-defaults.toml"
c2_l="$TMP/c2-local.toml"
cat > "$c2_d" <<'TOML'
[cli.claude]
mounts = ["a"]
TOML
cat > "$c2_l" <<'TOML'
[cli.claude]
mounts = ["b"]
TOML
out="$(bash "$MERGER" "$c2_d" "$c2_l" 2>/dev/null)"
if echo "$out" | jq -e '.cli.claude.mounts | length == 2 and .[0] == "a" and .[1] == "b"' >/dev/null; then
  note_pass "array APPEND preserves order [a,b]"
else
  note_fail "array APPEND" "got: $(echo "$out" | jq -c '.cli.claude.mounts')"
fi

# --- Case 3: table merge / scalar override --------------------------------
c3_d="$TMP/c3-defaults.toml"
c3_l="$TMP/c3-local.toml"
cat > "$c3_d" <<'TOML'
[cli.claude]
image    = "X"
command  = ["claude"]
env_keys = ["ANTHROPIC_API_KEY"]
TOML
cat > "$c3_l" <<'TOML'
[cli.claude]
image = "Y"
TOML
out="$(bash "$MERGER" "$c3_d" "$c3_l" 2>/dev/null)"
if echo "$out" | jq -e '
  .cli.claude.image == "Y" and
  (.cli.claude.command | length == 1 and .[0] == "claude") and
  (.cli.claude.env_keys | length == 1 and .[0] == "ANTHROPIC_API_KEY")
' >/dev/null; then
  note_pass "scalar override — image replaced, sibling keys intact"
else
  note_fail "scalar override" "got: $(echo "$out" | jq -c .cli.claude)"
fi

# --- Case 4: key add in local --------------------------------------------
c4_d="$TMP/c4-defaults.toml"
c4_l="$TMP/c4-local.toml"
cat > "$c4_d" <<'TOML'
[cli.claude]
image = "X"
TOML
cat > "$c4_l" <<'TOML'
[cli.claude]
extra = "new"

[cli.brand_new]
image = "Z"
TOML
out="$(bash "$MERGER" "$c4_d" "$c4_l" 2>/dev/null)"
if echo "$out" | jq -e '
  .cli.claude.image == "X" and
  .cli.claude.extra == "new" and
  .cli.brand_new.image == "Z"
' >/dev/null; then
  note_pass "key add — new keys and new tables grafted in"
else
  note_fail "key add" "got: $(echo "$out" | jq -c .)"
fi

# --- Case 5: missing local file → defaults pass through -------------------
c5_d="$TMP/c5-defaults.toml"
cat > "$c5_d" <<'TOML'
[cli.claude]
image = "X"
TOML
nope="$TMP/does-not-exist.toml"
if [[ -e "$nope" ]]; then note_fail "missing-local precondition" "fixture exists"; fi
out="$(bash "$MERGER" "$c5_d" "$nope" 2>/dev/null)"
rc=$?
if [[ $rc -eq 0 ]] && echo "$out" | jq -e '.cli.claude.image == "X"' >/dev/null; then
  note_pass "missing local — returns defaults as JSON, exit 0"
else
  note_fail "missing local" "rc=$rc out=$out"
fi

# Also: no local argument at all → defaults pass through.
out2="$(bash "$MERGER" "$c5_d" 2>/dev/null)"
if echo "$out2" | jq -e '.cli.claude.image == "X"' >/dev/null; then
  note_pass "no local arg — returns defaults as JSON"
else
  note_fail "no local arg" "got: $out2"
fi

# --- Case 6: malformed defaults → non-zero exit ---------------------------
c6_d="$TMP/c6-defaults.toml"
cat > "$c6_d" <<'TOML'
[cli.claude
image = "X"
TOML
if bash "$MERGER" "$c6_d" >/dev/null 2>"$TMP/c6.err"; then
  note_fail "malformed defaults — non-zero exit" "merger exited 0"
else
  if [[ -s "$TMP/c6.err" ]]; then
    note_pass "malformed defaults — non-zero exit with error on stderr"
  else
    note_fail "malformed defaults — stderr message" "stderr was empty"
  fi
fi

# Defaults file missing entirely → non-zero with clear message.
if bash "$MERGER" "$TMP/no-such-defaults.toml" >/dev/null 2>"$TMP/c6b.err"; then
  note_fail "missing defaults — non-zero exit" "merger exited 0"
else
  if grep -q "not found" "$TMP/c6b.err"; then
    note_pass "missing defaults — clear 'not found' error"
  else
    note_fail "missing defaults — error message" "stderr: $(cat "$TMP/c6b.err")"
  fi
fi

# --- Case 7: tmp cleanup — no /tmp residue --------------------------------
c7_d="$TMP/c7-defaults.toml"
c7_l="$TMP/c7-local.toml"
cat > "$c7_d" <<'TOML'
[cli.claude]
image = "X"
TOML
cat > "$c7_l" <<'TOML'
[cli.claude]
image = "Y"
TOML
before="$(ls /tmp 2>/dev/null | wc -l | tr -d ' ')"
bash "$MERGER" "$c7_d" "$c7_l" >/dev/null 2>&1
# Allow for the merger to make a tmp dir during execution, but it must be
# cleaned by its EXIT trap before this snapshot.
after="$(ls /tmp 2>/dev/null | wc -l | tr -d ' ')"
# Tolerate ±1 (other processes may create transient files during the test).
delta=$((after - before))
if [[ $delta -ge -1 && $delta -le 1 ]]; then
  note_pass "tmp cleanup — /tmp entry count stable (delta=$delta)"
else
  note_fail "tmp cleanup" "delta=$delta (before=$before after=$after)"
fi

# Specifically: no /tmp/d.json or /tmp/l.json at the canonical paths.
if [[ ! -e /tmp/d.json && ! -e /tmp/l.json ]]; then
  note_pass "tmp cleanup — no /tmp/d.json or /tmp/l.json residue"
else
  note_fail "tmp cleanup" "stray files: /tmp/d.json or /tmp/l.json present"
fi

echo "# $PASS passed / $FAIL failed / $SKIP skipped"
if [[ $FAIL -gt 0 ]]; then exit 1; fi
exit 0
