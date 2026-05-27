#!/usr/bin/env bash
# test-e2e-llm-judge-lib.sh — Regression for tests/e2e/lib/llm_judge.sh.
#
# Locks ADR 0004 Decision 4 + ADR 0007 (pluggable judge backend):
#   - Sourceable, preflights env vars and tools.
#   - 2-of-3 quorum with PASS/PASS and FAIL/FAIL early-exit.
#   - UNCERTAIN warns by default, fails when E2E_JUDGE_STRICT=1.
#   - auth-missing warns by default (UNCERTAIN, exit 0), fails strict (exit 1).
#   - Per-run counter at ${E2E_REPORT_DIR}/judge.count.
#   - max_calls cap enforced via [judge] in effective.json.
#   - temperature forwarded from effective.json into JUDGE_TEMPERATURE.
#   - Unknown backend → hard failure (exit 1 + FAIL diag).
#
# All API calls are mocked by substituting a stub driver loaded via
# E2E_LIB_DIR — no network, no real key required.

set -uo pipefail

PASS=0
FAIL=0
SKIP=0

note_pass() { echo "# PASS $1"; PASS=$((PASS + 1)); }
note_fail() { echo "# FAIL $1 — $2"; FAIL=$((FAIL + 1)); }
note_skip() { echo "# SKIP $1: $2"; SKIP=$((SKIP + 1)); }

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LIB="${REPO_DIR}/tests/e2e/lib/llm_judge.sh"

if [[ ! -f "$LIB" ]]; then
  note_fail "llm_judge.sh present" "missing at $LIB"
  echo "# $PASS passed / $FAIL failed / $SKIP skipped"
  exit 1
fi
note_pass "llm_judge.sh present"

if ! command -v jq >/dev/null 2>&1; then
  note_skip "llm_judge sourceable" "jq not on PATH"
  echo "# $PASS passed / $FAIL failed / $SKIP skipped"
  exit 0
fi

# 1. Sourceable, exports llm_judge function.
if bash -c "set -euo pipefail; source '$LIB'; type llm_judge >/dev/null"; then
  note_pass "llm_judge.sh sources and defines llm_judge"
else
  note_fail "llm_judge.sh sources and defines llm_judge" "source/type failed"
fi

TMP="$(mktemp -d -t crewrig-llm-judge.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

PROMPT="$TMP/prompt"; printf 'judge politely\n' > "$PROMPT"
SUBJECT="$TMP/subject"; printf 'the response text\n' > "$SUBJECT"

# Build an effective.json fixture matching the runner contract.
# Usage: mk_effective_json <max_calls> <report_dir> [backend] [temperature]
mk_effective_json() {
  local cap="$1"
  local rd="$2"
  local backend="${3:-anthropic}"
  local temperature="${4:-0.0}"
  jq -n \
    --argjson cap "$cap" \
    --arg backend "$backend" \
    --argjson temperature "$temperature" '
    { judge: {
        backend: $backend,
        model: "claude-sonnet-4-6",
        api_key_env: "ANTHROPIC_JUDGE_API_KEY",
        strict: false,
        max_calls: $cap,
        endpoint: "https://api.anthropic.com/v1/messages",
        max_tokens: 256,
        temperature: $temperature
    } }' > "$rd/effective.json"
}

# --------------------------------------------------------------------------
# Stub driver: substitutes a queue-driven _llm_judge_driver_anthropic_call
# in place of the real Anthropic driver. We override the driver itself
# (not _llm_judge_one_call, which no longer exists) so that llm_judge()
# loads our stub when it sources "${E2E_LIB_DIR}/llm_judge_drivers/<backend>.sh".
# --------------------------------------------------------------------------
FAKE_LIB="$TMP/fake_lib"
mkdir -p "$FAKE_LIB/llm_judge_drivers"
cat > "$FAKE_LIB/llm_judge_drivers/anthropic.sh" <<'STUB'
# Stub Anthropic driver: ignores model/endpoint/auth/etc. and pops one
# response from $QUEUE_FILE per call. MALFORMED or empty → return 1
# (UNCERTAIN slot in the quorum); valid line → return 0 with stdout.
_llm_judge_driver_anthropic_preflight() {
  printf 'AUTH_TOKEN=stub\n'
  return 0
}
_llm_judge_driver_anthropic_call() {
  # Args 1-8: model endpoint auth max_tokens temperature prompt subject criterion
  # Arg 9: mock marker (unused here — we are the mock).
  local line=""
  if [[ -s "$QUEUE_FILE" ]]; then
    line="$(head -n1 "$QUEUE_FILE")"
    tail -n +2 "$QUEUE_FILE" > "$QUEUE_FILE.tmp" && mv "$QUEUE_FILE.tmp" "$QUEUE_FILE"
  fi
  if [[ -z "$line" || "$line" == "MALFORMED" ]]; then
    _llm_judge_counter_increment 2>/dev/null || true
    return 1
  fi
  _llm_judge_counter_increment 2>/dev/null || true
  printf '%s\n' "$line"
}
STUB

run_judge_sequence() {
  # Args: <REPORT_DIR> <strict 0|1> <responses-file-with-one-line-per-call>
  local rd="$1"; local strict="$2"; local queue="$3"
  cp "$queue" "$rd/queue"
  E2E_REPORT_DIR="$rd" \
  E2E_LIB_DIR="$FAKE_LIB" \
  E2E_JUDGE_STRICT="$strict" \
  ANTHROPIC_JUDGE_API_KEY="dummy-key" \
  QUEUE_FILE="$rd/queue" \
  bash -c '
    set -uo pipefail
    source "'"$LIB"'"
    llm_judge "'"$PROMPT"'" "'"$SUBJECT"'" "is it polite?"
  '
}

# Convenience: make a queue file from arguments.
mk_queue() {
  local f="$1"; shift
  : > "$f"
  for line in "$@"; do
    printf '%s\n' "$line" >> "$f"
  done
}

# ---------- 2. auth-missing (default mode) → UNCERTAIN + warn, exit 0 -----
rd2="$TMP/rd_nokey"; mkdir -p "$rd2"; mk_effective_json 30 "$rd2"
err="$TMP/err_nokey"; out="$TMP/out_nokey"
set +e
( unset ANTHROPIC_JUDGE_API_KEY
  E2E_REPORT_DIR="$rd2" \
  bash -c "set -uo pipefail; source '$LIB'; llm_judge '$PROMPT' '$SUBJECT' 'criterion'"
) 2>"$err" >"$out"
rc=$?
set -e
if [[ "$rc" == 0 ]] \
   && grep -q '^VERDICT=UNCERTAIN' "$out" \
   && grep -q 'WARN llm_judge UNCERTAIN reason=auth-missing' "$err"; then
  note_pass "auth-missing default → UNCERTAIN + warn, exit 0"
else
  note_fail "auth-missing default → UNCERTAIN + warn, exit 0" \
    "rc=$rc out=$(cat "$out") err=$(head -c 300 "$err")"
fi

# ---------- 2b. auth-missing + strict → FAIL diag, exit 1 -----------------
rd2b="$TMP/rd_nokey_strict"; mkdir -p "$rd2b"; mk_effective_json 30 "$rd2b"
err="$TMP/err_nokey_strict"
set +e
( unset ANTHROPIC_JUDGE_API_KEY
  E2E_REPORT_DIR="$rd2b" \
  E2E_JUDGE_STRICT=1 \
  bash -c "set -uo pipefail; source '$LIB'; llm_judge '$PROMPT' '$SUBJECT' 'criterion'"
) 2>"$err" >/dev/null
rc=$?
set -e
if [[ "$rc" != 0 ]] && grep -q '# FAIL' "$err" && grep -q 'auth-missing' "$err"; then
  note_pass "auth-missing strict → FAIL diag, exit 1"
else
  note_fail "auth-missing strict → FAIL diag, exit 1" \
    "rc=$rc err=$(head -c 300 "$err")"
fi

# ---------- 3. Mocked quorum scenarios ------------------------------------
# 3a. 3× PASS (early-exits after 2) → PASS, exit 0.
rd="$TMP/rd_3pass"; mkdir -p "$rd"; mk_effective_json 30 "$rd"
queue="$TMP/q_3pass"; mk_queue "$queue" "VERDICT=PASS CONF=0.9" "VERDICT=PASS CONF=0.9" "VERDICT=PASS CONF=0.9"
out="$TMP/out_3pass"
set +e
run_judge_sequence "$rd" 0 "$queue" >"$out" 2>&1
rc=$?
set -e
if [[ "$rc" == 0 ]] && grep -q '^VERDICT=PASS confidence=' "$out"; then
  note_pass "quorum: PASS/PASS → exit 0 + VERDICT=PASS"
else
  note_fail "quorum: PASS/PASS → exit 0 + VERDICT=PASS" "rc=$rc out=$(cat "$out")"
fi
# Counter should be 2 (early-exit after 2 PASS).
count="$(cat "$rd/judge.count" 2>/dev/null || echo 0)"
if [[ "$count" == "2" ]]; then
  note_pass "quorum: counter increments to 2 on early-exit PASS"
else
  note_fail "quorum: counter increments to 2 on early-exit PASS" "count=$count"
fi

# 3b. FAIL/FAIL early-exit → FAIL.
rd="$TMP/rd_2fail"; mkdir -p "$rd"; mk_effective_json 30 "$rd"
queue="$TMP/q_2fail"; mk_queue "$queue" "VERDICT=FAIL CONF=0.8" "VERDICT=FAIL CONF=0.8" "VERDICT=PASS CONF=0.9"
out="$TMP/out_2fail"
set +e
run_judge_sequence "$rd" 0 "$queue" >"$out" 2>&1
rc=$?
set -e
if [[ "$rc" != 0 ]] && grep -q '^VERDICT=FAIL confidence=' "$out"; then
  note_pass "quorum: FAIL/FAIL → exit 1 + VERDICT=FAIL"
else
  note_fail "quorum: FAIL/FAIL → exit 1 + VERDICT=FAIL" "rc=$rc out=$(cat "$out")"
fi

# 3c. PASS/FAIL/PASS → no early-exit until slot 3 → 2 PASS → PASS.
rd="$TMP/rd_pfp"; mkdir -p "$rd"; mk_effective_json 30 "$rd"
queue="$TMP/q_pfp"; mk_queue "$queue" "VERDICT=PASS CONF=0.7" "VERDICT=FAIL CONF=0.7" "VERDICT=PASS CONF=0.7"
out="$TMP/out_pfp"
set +e
run_judge_sequence "$rd" 0 "$queue" >"$out" 2>&1
rc=$?
set -e
if [[ "$rc" == 0 ]] && grep -q '^VERDICT=PASS confidence=' "$out"; then
  note_pass "quorum: PASS/FAIL/PASS → majority PASS"
else
  note_fail "quorum: PASS/FAIL/PASS → majority PASS" "rc=$rc out=$(cat "$out")"
fi

# 3d. PASS/FAIL/UNCERTAIN → no majority → UNCERTAIN; default = exit 0 with warn.
rd="$TMP/rd_pfu"; mkdir -p "$rd"; mk_effective_json 30 "$rd"
queue="$TMP/q_pfu"; mk_queue "$queue" "VERDICT=PASS CONF=0.6" "VERDICT=FAIL CONF=0.6" "VERDICT=UNCERTAIN CONF=0.5"
out="$TMP/out_pfu"
set +e
run_judge_sequence "$rd" 0 "$queue" >"$out" 2>&1
rc=$?
set -e
if [[ "$rc" == 0 ]] && grep -q '^VERDICT=UNCERTAIN confidence=' "$out" && grep -q 'WARN llm_judge UNCERTAIN' "$out"; then
  note_pass "quorum: no majority → UNCERTAIN, default warns (exit 0)"
else
  note_fail "quorum: no majority → UNCERTAIN, default warns" "rc=$rc out=$(cat "$out")"
fi

# 3e. Same sequence but strict=1 → exit 1.
rd="$TMP/rd_strict"; mkdir -p "$rd"; mk_effective_json 30 "$rd"
queue="$TMP/q_strict"; mk_queue "$queue" "VERDICT=PASS CONF=0.6" "VERDICT=FAIL CONF=0.6" "VERDICT=UNCERTAIN CONF=0.5"
out="$TMP/out_strict"
set +e
run_judge_sequence "$rd" 1 "$queue" >"$out" 2>&1
rc=$?
set -e
if [[ "$rc" != 0 ]] && grep -q '^VERDICT=UNCERTAIN' "$out"; then
  note_pass "quorum: UNCERTAIN + strict → exit 1"
else
  note_fail "quorum: UNCERTAIN + strict → exit 1" "rc=$rc out=$(cat "$out")"
fi

# 3f. Malformed in 2 of 3 slots → UNCERTAIN.
rd="$TMP/rd_mal"; mkdir -p "$rd"; mk_effective_json 30 "$rd"
queue="$TMP/q_mal"; mk_queue "$queue" "VERDICT=PASS CONF=0.7" "MALFORMED" "MALFORMED"
out="$TMP/out_mal"
set +e
run_judge_sequence "$rd" 0 "$queue" >"$out" 2>&1
rc=$?
set -e
if [[ "$rc" == 0 ]] && grep -q '^VERDICT=UNCERTAIN' "$out"; then
  note_pass "quorum: 2/3 malformed → UNCERTAIN"
else
  note_fail "quorum: 2/3 malformed → UNCERTAIN" "rc=$rc out=$(cat "$out")"
fi

# ---------- 4. temperature forwarded from effective.json ------------------
rd="$TMP/rd_temp"; mkdir -p "$rd"; mk_effective_json 30 "$rd" anthropic 0.5
temp_out="$TMP/out_temp"
set +e
E2E_REPORT_DIR="$rd" bash -c "
  set -uo pipefail
  source '$LIB'
  eval \"\$(_llm_judge_load_config)\"
  printf 'JUDGE_TEMPERATURE=%s\n' \"\$JUDGE_TEMPERATURE\"
" >"$temp_out" 2>&1
set -e
if grep -q '^JUDGE_TEMPERATURE=0.5$' "$temp_out"; then
  note_pass "temperature: effective.json value forwarded as JUDGE_TEMPERATURE"
else
  note_fail "temperature: effective.json value forwarded as JUDGE_TEMPERATURE" \
    "out=$(cat "$temp_out")"
fi

# ---------- 4b. driver-not-found → hard failure ---------------------------
rd="$TMP/rd_nodrv"; mkdir -p "$rd"; mk_effective_json 30 "$rd" nonexistent
out="$TMP/out_nodrv"; err="$TMP/err_nodrv"
set +e
E2E_REPORT_DIR="$rd" \
ANTHROPIC_JUDGE_API_KEY="dummy-key" \
bash -c "set -uo pipefail; source '$LIB'; llm_judge '$PROMPT' '$SUBJECT' 'criterion'" \
  >"$out" 2>"$err"
rc=$?
set -e
if [[ "$rc" != 0 ]] \
   && grep -q '# FAIL' "$err" \
   && grep -qE 'driver for backend=nonexistent' "$err"; then
  note_pass "driver-not-found → exit 1 + FAIL diag"
else
  note_fail "driver-not-found → exit 1 + FAIL diag" \
    "rc=$rc err=$(head -c 300 "$err")"
fi

# ---------- 5. max_calls cap ---------------------------------------------
# Cap=1 in effective.json; pre-bump counter to 1; next call must refuse.
rd="$TMP/rd_cap"; mkdir -p "$rd"; mk_effective_json 1 "$rd"
printf '1\n' > "$rd/judge.count"
queue="$TMP/q_cap"; mk_queue "$queue" "VERDICT=PASS CONF=0.9" "VERDICT=PASS CONF=0.9" "VERDICT=PASS CONF=0.9"
out="$TMP/out_cap"
set +e
run_judge_sequence "$rd" 0 "$queue" >"$out" 2>&1
rc=$?
set -e
if [[ "$rc" != 0 ]] && grep -q 'per-run cap exceeded' "$out"; then
  note_pass "max_calls: cap reached → FAIL+diag pointing at judge.count"
else
  note_fail "max_calls: cap reached → FAIL+diag" "rc=$rc out=$(cat "$out")"
fi
# And the queue MUST still be 3 lines — nothing consumed.
remaining=$(wc -l < "$rd/queue" | tr -d ' ')
if [[ "$remaining" == "3" ]]; then
  note_pass "max_calls: refusal consumes zero queue items"
else
  note_fail "max_calls: refusal consumes zero queue items" "remaining=$remaining"
fi

echo "# $PASS passed / $FAIL failed / $SKIP skipped"
(( FAIL == 0 )) || exit 1
