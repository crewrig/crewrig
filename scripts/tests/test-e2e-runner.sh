#!/usr/bin/env bash
# test-e2e-runner.sh — Regression for tests/e2e/run.sh dry-run path.
#
# Locks ADR 0003's v1 contract for the runner:
#   - --dry-run never spawns containers
#   - report dir <ts>-<rand> is created with effective.json
#   - TAP 13 header + a `1..12` plan line — defaults.toml defines 5 scenarios
#     which expand to 12 (scenario,cli) pairs; every pair dry-run-SKIPs, so the
#     plan line and exit 0 hold whether or not CLI auth is configured
#   - --keep N prunes older report dirs
#   - --cli <invalid> and unknown flag fail with usage hint
#   - the runner sources scripts/e2e/lib/auth-common.sh
#
# Hermetic: runs entirely under a throwaway E2E_REPORTS_ROOT (temp dir, swept on
# EXIT). It never reads, creates, or deletes under the committed
# tests/e2e/reports/ fixtures. No docker.

set -uo pipefail

PASS=0
FAIL=0
SKIP=0

note_pass() { echo "# PASS $1"; PASS=$((PASS + 1)); }
note_fail() { echo "# FAIL $1 — $2"; FAIL=$((FAIL + 1)); }
note_skip() { echo "# SKIP $1: $2"; SKIP=$((SKIP + 1)); }

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUN_SH="${REPO_DIR}/tests/e2e/run.sh"

# Hermetic reports root (spec 0078): run.sh honours E2E_REPORTS_ROOT and falls
# back to tests/e2e/reports/ only when it is unset. Point it at a throwaway temp
# dir and export it so the runner writes there too — no case reads, creates, or
# deletes under the committed tests/e2e/reports/ fixtures.
export E2E_REPORTS_ROOT="$(mktemp -d)"
REPORTS="$E2E_REPORTS_ROOT"
# Scratch stderr captures live under the temp root too, so a crash mid-run
# leaves nothing behind at the repo root.
ERR_DIR="$E2E_REPORTS_ROOT"

# Snapshot of existing report dirs (we only inspect new entries).
#
# Two bash 3.2 (stock macOS) accommodations run throughout this file, both per
# docs/scripting-conventions.md Rule 5:
#   - `while read` rather than `mapfile`, which is a bash 4 builtin;
#   - every array expansion written `${A[@]+"${A[@]}"}`, because bash 3.2 treats
#     an empty array as an unset variable and aborts on it under `set -u`.
pre_dirs=()
while IFS= read -r line || [ -n "$line" ]; do pre_dirs+=("$line"); done \
  < <(find "$REPORTS" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort)

# Track every dir we create so we can clean up after ourselves. The temp root
# itself is swept unconditionally on EXIT — that is the authoritative
# hermeticity guarantee; the per-dir tracking is kept for parity with the
# original idiom.
CREATED=()
cleanup() {
  for d in ${CREATED[@]+"${CREATED[@]}"}; do
    [[ -n "$d" && -d "$d" ]] && rm -rf -- "$d"
  done
  [[ -n "${E2E_REPORTS_ROOT:-}" && -d "$E2E_REPORTS_ROOT" ]] && rm -rf -- "$E2E_REPORTS_ROOT"
}
trap cleanup EXIT

if [[ ! -x "$RUN_SH" && ! -f "$RUN_SH" ]]; then
  note_fail "run.sh exists" "missing at $RUN_SH"
  echo "# 0 passed / 1 failed / 0 skipped"
  exit 1
fi
note_pass "run.sh exists"

# --- Case 1: dry-run exits 0 in a clean shell -----------------------------
out1="$(bash "$RUN_SH" --dry-run 2>"$ERR_DIR/.test-runner.err")"
rc1=$?
if [[ $rc1 -eq 0 ]]; then
  note_pass "dry-run exit 0"
else
  note_fail "dry-run exit 0" "rc=$rc1 stderr=$(tr '\n' '|' < "$ERR_DIR/.test-runner.err")"
fi

# Identify the new report dir produced by case 1.
post1_dirs=()
while IFS= read -r line || [ -n "$line" ]; do post1_dirs+=("$line"); done \
  < <(find "$REPORTS" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort)
NEW_DIR=""
for d in ${post1_dirs[@]+"${post1_dirs[@]}"}; do
  found=0
  for p in ${pre_dirs[@]+"${pre_dirs[@]}"}; do
    [[ "$d" == "$p" ]] && { found=1; break; }
  done
  if [[ $found -eq 0 ]]; then NEW_DIR="$d"; CREATED+=("$d"); break; fi
done

# --- Case 2: report dir exists with effective.json ------------------------
if [[ -n "$NEW_DIR" && -d "$NEW_DIR" && -f "$NEW_DIR/effective.json" ]]; then
  note_pass "dry-run creates <ts>-<rand>/ with effective.json"
else
  note_fail "report dir + effective.json" "NEW_DIR=$NEW_DIR contents=$(ls "$NEW_DIR" 2>/dev/null | tr '\n' ' ')"
fi

# --- Case 3: effective.json is valid JSON ---------------------------------
if [[ -f "$NEW_DIR/effective.json" ]] && jq . "$NEW_DIR/effective.json" >/dev/null 2>&1; then
  note_pass "effective.json is valid JSON"
else
  note_fail "effective.json is valid JSON" "jq parse failed"
fi

# --- Case 4: TAP output to stdout -----------------------------------------
if grep -q '^TAP version 13$' <<< "$out1"; then
  note_pass "TAP version 13 header present"
else
  note_fail "TAP version 13 header" "stdout: $(echo "$out1" | head -3 | tr '\n' '|')"
fi
if grep -q '^1\.\.12$' <<< "$out1"; then
  note_pass "1..12 plan line present (5 scenarios → 12 (scenario,cli) pairs)"
else
  note_fail "1..12 plan line" "stdout: $(echo "$out1" | tr '\n' '|')"
fi

# --- Case 5: --keep N prunes older report dirs ----------------------------
# Remove the dir created by case 1 so it does not consume a "keep" slot.
[[ -n "$NEW_DIR" && -d "$NEW_DIR" ]] && rm -rf -- "$NEW_DIR"
N=3
TMP_REPORTS_ROOT="$REPORTS"
pre_keep_dirs=()
while IFS= read -r line || [ -n "$line" ]; do pre_keep_dirs+=("$line"); done \
  < <(find "$TMP_REPORTS_ROOT" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort)
# Create N+5 fakes with old, lexicographically-low names so they appear "older".
FAKES=()
for i in $(seq 1 $((N + 5))); do
  d="$TMP_REPORTS_ROOT/00000000T000000Z-fake$(printf '%02d' "$i")"
  mkdir -p "$d"
  FAKES+=("$d")
  CREATED+=("$d")
done
# Run dry-run with --keep N. After the run only N+1 dirs from our fakes+new
# should remain (N kept + the new one). We measure within our own fakes set
# plus the freshly created run dir to avoid interfering with unrelated dirs.
out5="$(bash "$RUN_SH" --dry-run --keep "$N" 2>/dev/null)"
rc5=$?
[[ $rc5 -eq 0 ]] || note_fail "dry-run --keep N exit 0" "rc=$rc5"

# Identify the new run dir from this invocation.
post5_dirs=()
while IFS= read -r line || [ -n "$line" ]; do post5_dirs+=("$line"); done \
  < <(find "$TMP_REPORTS_ROOT" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort)
NEW_DIR2=""
for d in ${post5_dirs[@]+"${post5_dirs[@]}"}; do
  is_fake=0
  for f in ${FAKES[@]+"${FAKES[@]}"}; do [[ "$d" == "$f" ]] && { is_fake=1; break; }; done
  is_old=0
  for p in ${pre_keep_dirs[@]+"${pre_keep_dirs[@]}"}; do [[ "$d" == "$p" ]] && { is_old=1; break; }; done
  if [[ $is_fake -eq 0 && $is_old -eq 0 ]]; then NEW_DIR2="$d"; CREATED+=("$d"); break; fi
done

# Surviving fakes after prune:
surviving_fakes=0
for f in ${FAKES[@]+"${FAKES[@]}"}; do [[ -d "$f" ]] && surviving_fakes=$((surviving_fakes + 1)); done

# The new dir is the "newest" lexicographically (real ISO timestamp >
# 00000000T000000Z). The N kept slots all get taken by newer entries first,
# which means all N+5 fakes can be pruned. So surviving_fakes is expected
# to be 0 OR (N - 1) depending on the prune strategy. Verify the bound:
# at most N total dirs should remain when counting fakes + the new dir.
# The runner's prune_reports skips the dir it just created, then keeps the
# top N of the rest. Our fakes ARE the rest, so it keeps the N
# lexicographically-largest fakes and drops the rest.
# Expected: surviving_fakes == N.
if [[ $surviving_fakes -eq $N ]]; then
  note_pass "--keep $N retains exactly N older dirs (got $surviving_fakes)"
else
  note_fail "--keep $N" "expected $N surviving fakes, got $surviving_fakes (NEW_DIR2=$NEW_DIR2)"
fi

# --- Case 6: --cli <invalid> fails with clear message --------------------
err6_file="$ERR_DIR/.test-runner-c6.err"
if bash "$RUN_SH" --dry-run --cli bogus >/dev/null 2>"$err6_file"; then
  note_fail "--cli invalid — non-zero exit" "exited 0"
else
  if grep -qiE "cli|unknown|invalid" "$err6_file"; then
    note_pass "--cli invalid — clear error message + non-zero"
  else
    note_fail "--cli invalid — message" "stderr: $(cat "$err6_file")"
  fi
fi
rm -f "$err6_file"

# Cleanup any new dir that case 6 happened to create before failing.
post6_dirs=()
while IFS= read -r line || [ -n "$line" ]; do post6_dirs+=("$line"); done \
  < <(find "$REPORTS" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort)
for d in ${post6_dirs[@]+"${post6_dirs[@]}"}; do
  known=0
  for c in ${CREATED[@]+"${CREATED[@]}"} ${pre_dirs[@]+"${pre_dirs[@]}"}; do [[ "$d" == "$c" ]] && { known=1; break; }; done
  if [[ $known -eq 0 ]]; then CREATED+=("$d"); fi
done

# --- Case 7: unknown flag fails -----------------------------------------
err7_file="$ERR_DIR/.test-runner-c7.err"
if bash "$RUN_SH" --no-such-flag >/dev/null 2>"$err7_file"; then
  note_fail "unknown flag — non-zero exit" "exited 0"
else
  if grep -qiE "unknown|usage" "$err7_file"; then
    note_pass "unknown flag — usage hint + non-zero"
  else
    note_fail "unknown flag — message" "stderr: $(cat "$err7_file")"
  fi
fi
rm -f "$err7_file"

# --- Case 8: runner sources auth-common.sh -------------------------------
if grep -q 'scripts/e2e/lib/auth-common.sh' "$RUN_SH"; then
  note_pass "runner sources scripts/e2e/lib/auth-common.sh"
else
  note_fail "runner sources auth-common.sh" "no reference found in run.sh"
fi

# --- Case 9: default scenario set (all) enumerates every (scenario,cli) pair ---
# Scenarios are now populated in defaults.toml, so the default (no --scenario)
# enumerates all (scenario,cli) pairs and yields the 1..12 plan. We assert the
# default behavior because there's no "all" sentinel in v1 — the default IS
# "all". Every pair dry-run-SKIPs, so the plan line and exit 0 are identical
# whether or not CLI auth is configured (CI has none).
out9="$(bash "$RUN_SH" --dry-run 2>/dev/null)"
rc9=$?
if [[ $rc9 -eq 0 ]] && grep -q '^1\.\.12$' <<< "$out9"; then
  note_pass "default scenario set (all) → 1..12 plan line"
else
  note_fail "default scenario set → 1..12" "rc=$rc9 stdout=$(echo "$out9" | tr '\n' '|')"
fi
post9_dirs=()
while IFS= read -r line || [ -n "$line" ]; do post9_dirs+=("$line"); done \
  < <(find "$REPORTS" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort)
for d in ${post9_dirs[@]+"${post9_dirs[@]}"}; do
  known=0
  for c in ${CREATED[@]+"${CREATED[@]}"} ${pre_dirs[@]+"${pre_dirs[@]}"}; do [[ "$d" == "$c" ]] && { known=1; break; }; done
  if [[ $known -eq 0 ]]; then CREATED+=("$d"); fi
done

rm -f "$ERR_DIR/.test-runner.err"

echo "# $PASS passed / $FAIL failed / $SKIP skipped"
if [[ $FAIL -gt 0 ]]; then exit 1; fi
exit 0
