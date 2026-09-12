#!/bin/bash
# test-check-pipefail-grep.sh — Regression tests for check-pipefail-grep.sh.
#
# Tests the CI guard enforcing docs/scripting-conventions.md Rule 6:
# rejection of printf ... | grep -q pipelines under set -o pipefail.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CHECK_SCRIPT="$REPO_ROOT/scripts/check-pipefail-grep.sh"

pass=0
fail=0

record_pass() {
  echo "PASS: $1"
  pass=$((pass + 1))
}

record_fail() {
  echo "FAIL: $1 — $2" >&2
  fail=$((fail + 1))
}

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# Case 1: Repository clean check
out=""
rc=0
out="$(bash "$CHECK_SCRIPT" 2>&1)" || rc=$?
if [ "$rc" -eq 0 ] && grep -q "OK: no printf ... | grep -q anti-pattern" <<< "$out"; then
  record_pass "repository as it stands passes check-pipefail-grep.sh"
else
  record_fail "repository as it stands passes check-pipefail-grep.sh" "rc=$rc, out=$out"
fi

# Helper to create fixture repo
setup_fixture_repo() {
  local dir="$1"
  rm -rf "$dir"
  mkdir -p "$dir/scripts"
}

# Pipe symbol variable to avoid matching the guard pattern in fixture-builder lines
P='|'

# Case 2: Violation detection (bare printf ... | grep -q)
FIX_DIR="$TMP_DIR/case2"
setup_fixture_repo "$FIX_DIR"
{
  echo "#!/bin/bash"
  echo "printf '%s\\n' \"\$var\" $P grep -q \"target\""
} > "$FIX_DIR/scripts/bad.sh"
rc=0
out=""
out="$(CREWRIG_REPO_DIR="$FIX_DIR" bash "$CHECK_SCRIPT" 2>&1)" || rc=$?
if [ "$rc" -eq 1 ] && grep -q "FAILED: 1 line(s)" <<< "$out" && grep -q "scripts/bad.sh:2:" <<< "$out"; then
  record_pass "rejects bare printf ... | grep -q with exit 1 naming file:line"
else
  record_fail "rejects bare printf ... | grep -q with exit 1 naming file:line" "rc=$rc, out=$out"
fi

# Case 3: Flag variations (grep -Eq, grep -qi, grep -qxF, grep -Fq)
FIX_DIR="$TMP_DIR/case3"
setup_fixture_repo "$FIX_DIR"
{
  echo "#!/bin/bash"
  echo "if printf '%s' \"\$a\" $P grep -Eq '^[0-9]+\$'; then :; fi"
  echo "printf '%s' \"\$b\" $P grep -qi \"case-fold\""
  echo "! printf '%s\\n' \"\$c\" $P grep -qxF \"exact\""
  echo "foo && printf '%s' \"\$d\" $P grep -Fq \"fast\""
} > "$FIX_DIR/scripts/bad_flags.sh"
rc=0
out=""
out="$(CREWRIG_REPO_DIR="$FIX_DIR" bash "$CHECK_SCRIPT" 2>&1)" || rc=$?
if [ "$rc" -eq 1 ] && grep -q "FAILED: 4 line(s)" <<< "$out"; then
  record_pass "detects grep flag variations (-Eq, -qi, -qxF, -Fq) and command positions (if, !, &&)"
else
  record_fail "detects grep flag variations (-Eq, -qi, -qxF, -Fq) and command positions (if, !, &&)" "rc=$rc, out=$out"
fi

# Case 4: Comments are ignored
FIX_DIR="$TMP_DIR/case4"
setup_fixture_repo "$FIX_DIR"
{
  echo "#!/bin/bash"
  echo "# printf '%s\\n' \"\$var\" $P grep -q \"target\""
  echo "  # if printf '%s' \"\$b\" $P grep -Eq \"foo\"; then"
  echo 'echo "nothing here"'
} > "$FIX_DIR/scripts/comment.sh"
rc=0
out=""
out="$(CREWRIG_REPO_DIR="$FIX_DIR" bash "$CHECK_SCRIPT" 2>&1)" || rc=$?
if [ "$rc" -eq 0 ] && grep -q "OK:" <<< "$out"; then
  record_pass "ignores commented-out lines"
else
  record_fail "ignores commented-out lines" "rc=$rc, out=$out"
fi

# Case 5: Acknowledged exception
FIX_DIR="$TMP_DIR/case5"
setup_fixture_repo "$FIX_DIR"
{
  echo "#!/bin/bash"
  echo "printf '%s' \"\$out\" $P grep -q \"needle\" # acknowledged-exception: legacy subshell"
} > "$FIX_DIR/scripts/exception.sh"
rc=0
out=""
out="$(CREWRIG_REPO_DIR="$FIX_DIR" bash "$CHECK_SCRIPT" 2>&1)" || rc=$?
if [ "$rc" -eq 0 ] && grep -q "OK:" <<< "$out"; then
  record_pass "honours acknowledged-exception tag"
else
  record_fail "honours acknowledged-exception tag" "rc=$rc, out=$out"
fi

# Case 6: Mention in string or non-command position is not a violation
FIX_DIR="$TMP_DIR/case6"
setup_fixture_repo "$FIX_DIR"
{
  echo "#!/bin/bash"
  echo "echo \"Use here-strings instead of printf ... $P grep -q\""
  echo "msg=\"avoid printf '%s' $P grep -q pattern\""
} > "$FIX_DIR/scripts/prose.sh"
rc=0
out=""
out="$(CREWRIG_REPO_DIR="$FIX_DIR" bash "$CHECK_SCRIPT" 2>&1)" || rc=$?
if [ "$rc" -eq 0 ] && grep -q "OK:" <<< "$out"; then
  record_pass "does not flag mention inside strings or echo"
else
  record_fail "does not flag mention inside strings or echo" "rc=$rc, out=$out"
fi

# Case 7: Rule 4 input verification — empty scripts directory fails closed (exit 2)
FIX_DIR="$TMP_DIR/case7"
setup_fixture_repo "$FIX_DIR"
rc=0
out=""
out="$(CREWRIG_REPO_DIR="$FIX_DIR" bash "$CHECK_SCRIPT" 2>&1)" || rc=$?
if [ "$rc" -eq 2 ] && grep -q "scanned 0 files" <<< "$out"; then
  record_pass "fails closed with exit 2 when 0 files scanned (Rule 4)"
else
  record_fail "fails closed with exit 2 when 0 files scanned (Rule 4)" "rc=$rc, out=$out"
fi

# Case 8: Missing scripts/ and hooks/ directory fails with exit 2
FIX_DIR="$TMP_DIR/case8"
mkdir -p "$FIX_DIR"
rc=0
out=""
out="$(CREWRIG_REPO_DIR="$FIX_DIR" bash "$CHECK_SCRIPT" 2>&1)" || rc=$?
if [ "$rc" -eq 2 ] && grep -q "neither scripts/ nor hooks/ exists" <<< "$out"; then
  record_pass "fails closed with exit 2 when neither scripts/ nor hooks/ exists"
else
  record_fail "fails closed with exit 2 when neither scripts/ nor hooks/ exists" "rc=$rc, out=$out"
fi

echo ""
echo "Summary: $pass passed, $fail failed."
if [ "$fail" -gt 0 ]; then
  exit 1
fi
exit 0
