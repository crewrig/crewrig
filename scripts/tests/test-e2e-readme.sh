#!/bin/bash
# test-e2e-readme.sh — Content guarantees for tests/e2e/README.md.
#
# Locks the user-facing walkthrough surface for the auth flow (issue #77):
#
#   - file exists, stays small (≤200 lines)
#   - covers all three CLI flows
#   - mentions the PAT rotation cadence (90 days)
#   - states the security posture (read-only mount)
#   - cross-references the related epic / child issues

set -uo pipefail

PASS=0
FAIL=0
SKIP=0

note_pass() { echo "PASS  $1"; PASS=$((PASS + 1)); }
note_fail() { echo "FAIL  $1 — $2"; FAIL=$((FAIL + 1)); }
note_skip() { echo "SKIP  $1 — $2"; SKIP=$((SKIP + 1)); }

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
README="${REPO_DIR}/tests/e2e/README.md"

if [[ -f "$README" ]]; then
  note_pass "tests/e2e/README.md — exists"
else
  note_fail "tests/e2e/README.md — exists" "missing at $README"
  echo ""
  echo "Results: $PASS passed, $FAIL failed, $SKIP skipped"
  exit 1
fi

# --- Size budget (≤200 lines) ------------------------------------------------
lines="$(wc -l <"$README" | tr -d ' ')"
if [[ "$lines" -le 200 ]]; then
  note_pass "tests/e2e/README.md — within 200-line budget ($lines lines)"
else
  note_fail "tests/e2e/README.md — within 200-line budget" \
            "$lines lines (>200 — split or trim)"
fi

# --- All three CLI flows covered --------------------------------------------
for cli in claude gemini copilot; do
  if grep -qiE "(^|[^a-z])${cli}([^a-z]|$)" "$README"; then
    note_pass "tests/e2e/README.md — mentions $cli"
  else
    note_fail "tests/e2e/README.md — mentions $cli" "no match"
  fi
done

# --- PAT rotation reminder (90 days) ----------------------------------------
# Look for "90" within ~80 characters of "PAT" or "day(s)" — same line context.
if grep -nE '90' "$README" \
   | grep -iE 'pat|day|rotat|expir' >/dev/null; then
  note_pass "tests/e2e/README.md — PAT/90-day rotation reminder present"
else
  note_fail "tests/e2e/README.md — PAT/90-day rotation reminder" \
            "no line containing both '90' and PAT/day/expiry/rotation keyword"
fi

# --- Security posture statement (per-CLI, not universal read-only) ---------
# Tightened per spec 0194 PLAN v2 step 21: the file must NOT claim every
# mount is read-only (false since Copilot's :rw bundle mount, step 16) and
# MUST name the copilot read-write exception explicitly.
if grep -qiE 'read-only|:ro\b' "$README"; then
  note_pass "tests/e2e/README.md — read-only mount posture documented"
else
  note_fail "tests/e2e/README.md — read-only mount posture" \
            "neither 'read-only' nor ':ro' found"
fi
if grep -qiE 'mounts? read-only|read-only volume mounts at scenario time' "$README"; then
  note_fail "tests/e2e/README.md — no universal read-only claim" \
            "found a phrase asserting every mount is read-only — false since Copilot's :rw bundle mount"
else
  note_pass "tests/e2e/README.md — does not claim every mount is read-only"
fi
if grep -qiE 'copilot.*:rw|:rw.*copilot' "$README"; then
  note_pass "tests/e2e/README.md — names the copilot read-write exception"
else
  note_fail "tests/e2e/README.md — copilot read-write exception" \
            "no line naming copilot alongside ':rw'"
fi

# --- Cross-references to the epic / child issues ----------------------------
found_refs=()
for ref in '#75' '#78' '#80' '#81'; do
  if grep -q "$ref" "$README"; then
    found_refs+=("$ref")
  fi
done
if [[ "${#found_refs[@]}" -ge 1 ]]; then
  note_pass "tests/e2e/README.md — cross-references epic/child issues (${found_refs[*]:-})"
else
  note_fail "tests/e2e/README.md — issue cross-references" \
            "none of #75/#78/#80/#81 found"
fi

echo ""
echo "Results: $PASS passed, $FAIL failed, $SKIP skipped"
[[ "$FAIL" -eq 0 ]]
