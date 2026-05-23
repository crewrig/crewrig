#!/usr/bin/env bash
# test-e2e-libs-readme.sh — Content guarantees for tests/e2e/lib/README.md
# and the pointer added to tests/e2e/README.md (issue #79).

set -uo pipefail

PASS=0
FAIL=0
SKIP=0

note_pass() { echo "# PASS $1"; PASS=$((PASS + 1)); }
note_fail() { echo "# FAIL $1 — $2"; FAIL=$((FAIL + 1)); }

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LIB_README="${REPO_DIR}/tests/e2e/lib/README.md"
TOP_README="${REPO_DIR}/tests/e2e/README.md"

# --- lib/README.md -------------------------------------------------------
if [[ -f "$LIB_README" ]]; then
  note_pass "lib/README.md exists"
else
  note_fail "lib/README.md exists" "missing at $LIB_README"
  echo "# $PASS passed / $FAIL failed / $SKIP skipped"; exit 1
fi

lines="$(wc -l <"$LIB_README" | tr -d ' ')"
if [[ "$lines" -le 200 ]]; then
  note_pass "lib/README.md within 200-line budget ($lines lines)"
else
  note_fail "lib/README.md within 200-line budget" "$lines lines"
fi

# Headings / coverage of the three libs.
for needle in 'assert.sh' 'structural.sh' 'llm_judge.sh'; do
  if grep -q "$needle" "$LIB_README"; then
    note_pass "lib/README.md mentions $needle"
  else
    note_fail "lib/README.md mentions $needle" "no occurrence"
  fi
done

# ANTHROPIC_JUDGE_API_KEY separation rationale.
if grep -q 'ANTHROPIC_JUDGE_API_KEY' "$LIB_README" \
     && grep -qE 'separate|accounting|isolation' "$LIB_README"; then
  note_pass "lib/README.md explains ANTHROPIC_JUDGE_API_KEY separation"
else
  note_fail "lib/README.md explains ANTHROPIC_JUDGE_API_KEY separation" \
            "missing 'separate|accounting|isolation' near the key name"
fi

# max_calls cap documented.
if grep -q 'max_calls' "$LIB_README"; then
  note_pass "lib/README.md documents max_calls cap"
else
  note_fail "lib/README.md documents max_calls cap" "missing"
fi

# macOS / BSD grep caveat for assert_gitmoji_title.
if grep -qE 'BSD|macOS' "$LIB_README"; then
  note_pass "lib/README.md flags the macOS/BSD grep caveat"
else
  note_fail "lib/README.md flags the macOS/BSD grep caveat" "no BSD/macOS mention"
fi

# --- tests/e2e/README.md -------------------------------------------------
if [[ -f "$TOP_README" ]]; then
  note_pass "tests/e2e/README.md exists"
else
  note_fail "tests/e2e/README.md exists" "missing"
  echo "# $PASS passed / $FAIL failed / $SKIP skipped"; exit 1
fi

# Pointer to lib/README.md (relative link).
if grep -q 'lib/README.md' "$TOP_README"; then
  note_pass "tests/e2e/README.md points at lib/README.md"
else
  note_fail "tests/e2e/README.md points at lib/README.md" "no 'lib/README.md' reference"
fi

# Existing 200-line budget (locked by #78) still holds.
lines="$(wc -l <"$TOP_README" | tr -d ' ')"
if [[ "$lines" -le 200 ]]; then
  note_pass "tests/e2e/README.md within 200-line budget ($lines lines)"
else
  note_fail "tests/e2e/README.md within 200-line budget" "$lines lines"
fi

echo "# $PASS passed / $FAIL failed / $SKIP skipped"
(( FAIL == 0 )) || exit 1
