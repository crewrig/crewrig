#!/usr/bin/env bash
# test-e2e-report.sh — Regression for tests/e2e/lib/report.sh.
#
# Locks the v1 contract of the TAP aggregator:
#   - executable + syntactically valid
#   - empty TAP dir → exit 2 (not 0)
#   - one `ok` line → exit 0, scenario name on stdout
#   - one `not ok` line → exit 1
#   - `# SKIP` directive → exit 0 with ⚠ glyph on stdout
#   - --dry-run never writes a markdown file
#   - non-dry-run writes parity-*.md to the output dir
#   - Taskfile carries an e2e:report entry
#   - tests/e2e/README.md mentions Prerequisites
#
# No docker, no network.

set -uo pipefail

PASS=0
FAIL=0
SKIP=0

note_pass() { echo "# PASS $1"; PASS=$((PASS + 1)); }
note_fail() { echo "# FAIL $1 — $2"; FAIL=$((FAIL + 1)); }
note_skip() { echo "# SKIP $1: $2"; SKIP=$((SKIP + 1)); }

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REPORT_SH="${REPO_DIR}/tests/e2e/lib/report.sh"
TASKFILE="${REPO_DIR}/Taskfile.yml"
README="${REPO_DIR}/tests/e2e/README.md"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# --- Case 1: report.sh exists and is executable --------------------------
if [[ -f "$REPORT_SH" && -x "$REPORT_SH" ]]; then
  note_pass "report.sh exists and is executable"
else
  note_fail "report.sh exists/executable" "path=$REPORT_SH exists=$([[ -f $REPORT_SH ]] && echo y || echo n) exec=$([[ -x $REPORT_SH ]] && echo y || echo n)"
fi

# --- Case 2: bash -n passes ----------------------------------------------
if bash -n "$REPORT_SH" 2>"$TMP/syntax.err"; then
  note_pass "report.sh passes bash -n"
else
  note_fail "report.sh bash -n" "$(tr '\n' '|' < "$TMP/syntax.err")"
fi

# --- Case 3: empty TAP dir → exit 2 --------------------------------------
empty_dir="$TMP/empty-tap"
mkdir -p "$empty_dir"
out3="$(bash "$REPORT_SH" --tap-dir "$empty_dir" --output-dir "$TMP/out3" --dry-run 2>"$TMP/c3.err")"
rc3=$?
if [[ $rc3 -eq 2 ]]; then
  note_pass "empty TAP dir exits 2"
else
  note_fail "empty TAP dir exits 2" "rc=$rc3 stderr=$(tr '\n' '|' < "$TMP/c3.err") stdout=$(echo "$out3" | tr '\n' '|')"
fi

# --- Case 4: single ok line → exit 0, scenario name on stdout ------------
tap4_dir="$TMP/c4-tap"
out4_dir="$TMP/c4-out"
mkdir -p "$tap4_dir/run-001" "$out4_dir"
cat > "$tap4_dir/run-001/run.tap" <<'EOF'
TAP version 13
1..1
ok 1 - claude/01-layered-context
EOF
out4="$(bash "$REPORT_SH" --tap-dir "$tap4_dir" --output-dir "$out4_dir" --dry-run 2>"$TMP/c4.err")"
rc4=$?
if [[ $rc4 -eq 0 ]]; then
  note_pass "single ok line — exit 0"
else
  note_fail "single ok line — exit 0" "rc=$rc4 stderr=$(tr '\n' '|' < "$TMP/c4.err")"
fi
if grep -q '01-layered-context' <<< "$out4"; then
  note_pass "single ok line — scenario name on stdout"
else
  note_fail "scenario name on stdout" "stdout=$(echo "$out4" | tr '\n' '|')"
fi

# --- Case 5: single not ok line → exit 1 ---------------------------------
tap5_dir="$TMP/c5-tap"
out5_dir="$TMP/c5-out"
mkdir -p "$tap5_dir/run-001" "$out5_dir"
cat > "$tap5_dir/run-001/run.tap" <<'EOF'
TAP version 13
1..1
not ok 1 - claude/01-layered-context
EOF
bash "$REPORT_SH" --tap-dir "$tap5_dir" --output-dir "$out5_dir" --dry-run >/dev/null 2>"$TMP/c5.err"
rc5=$?
if [[ $rc5 -eq 1 ]]; then
  note_pass "single not-ok line — exit 1"
else
  note_fail "single not-ok line — exit 1" "rc=$rc5 stderr=$(tr '\n' '|' < "$TMP/c5.err")"
fi

# --- Case 6: # SKIP directive → exit 0 with ⚠ glyph ----------------------
tap6_dir="$TMP/c6-tap"
out6_dir="$TMP/c6-out"
mkdir -p "$tap6_dir/run-001" "$out6_dir"
cat > "$tap6_dir/run-001/run.tap" <<'EOF'
TAP version 13
1..1
ok 1 - copilot/01-layered-context # SKIP no auth
EOF
out6="$(bash "$REPORT_SH" --tap-dir "$tap6_dir" --output-dir "$out6_dir" --dry-run 2>"$TMP/c6.err")"
rc6=$?
if [[ $rc6 -eq 0 ]]; then
  note_pass "# SKIP directive — exit 0 (not a failure)"
else
  note_fail "# SKIP directive — exit 0" "rc=$rc6 stderr=$(tr '\n' '|' < "$TMP/c6.err")"
fi
if grep -q '⚠' <<< "$out6"; then
  note_pass "# SKIP directive — ⚠ glyph on stdout"
else
  note_fail "⚠ glyph on stdout" "stdout=$(echo "$out6" | tr '\n' '|')"
fi

# --- Case 7: --dry-run does NOT write a markdown file --------------------
tap7_dir="$TMP/c7-tap"
out7_dir="$TMP/c7-out"
mkdir -p "$tap7_dir/run-001" "$out7_dir"
cat > "$tap7_dir/run-001/run.tap" <<'EOF'
TAP version 13
1..1
ok 1 - claude/01-layered-context
EOF
bash "$REPORT_SH" --tap-dir "$tap7_dir" --output-dir "$out7_dir" --dry-run >/dev/null 2>"$TMP/c7.err"
mapfile -t md_files7 < <(find "$out7_dir" -maxdepth 1 -name '*.md' 2>/dev/null)
if [[ ${#md_files7[@]} -eq 0 ]]; then
  note_pass "--dry-run writes no markdown file"
else
  note_fail "--dry-run writes no markdown file" "found: ${md_files7[*]}"
fi

# --- Case 8: without --dry-run, parity-*.md is created -------------------
tap8_dir="$TMP/c8-tap"
out8_dir="$TMP/c8-out"
mkdir -p "$tap8_dir/run-001" "$out8_dir"
cat > "$tap8_dir/run-001/run.tap" <<'EOF'
TAP version 13
1..1
ok 1 - claude/01-layered-context
EOF
bash "$REPORT_SH" --tap-dir "$tap8_dir" --output-dir "$out8_dir" >/dev/null 2>"$TMP/c8.err"
rc8=$?
mapfile -t md_files8 < <(find "$out8_dir" -maxdepth 1 -name 'parity-*.md' 2>/dev/null)
if [[ $rc8 -eq 0 && ${#md_files8[@]} -ge 1 ]]; then
  note_pass "non-dry-run creates parity-*.md"
else
  note_fail "non-dry-run creates parity-*.md" "rc=$rc8 files=${md_files8[*]:-(none)} stderr=$(tr '\n' '|' < "$TMP/c8.err")"
fi

# --- Case 9: Taskfile contains e2e:report task ---------------------------
if [[ -f "$TASKFILE" ]] && grep -qE '^\s*e2e:report\s*:' "$TASKFILE"; then
  note_pass "Taskfile.yml carries e2e:report task"
else
  note_fail "Taskfile.yml carries e2e:report task" "not found in $TASKFILE"
fi

# --- Case 10: tests/e2e/README.md mentions Prerequisites -----------------
if [[ -s "$README" ]] && grep -q 'Prerequisites' "$README"; then
  note_pass "tests/e2e/README.md is non-empty and mentions Prerequisites"
else
  note_fail "tests/e2e/README.md sanity check" "path=$README size=$(wc -c < "$README" 2>/dev/null || echo 0)"
fi

echo "# $PASS passed / $FAIL failed / $SKIP skipped"
if [[ $FAIL -gt 0 ]]; then exit 1; fi
exit 0
