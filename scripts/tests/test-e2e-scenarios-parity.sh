#!/usr/bin/env bash
# test-e2e-scenarios-parity.sh — Lockstep test between the scenario
# scaffolding (#80) and the CLI parity matrix (docs/cli-matrix.md).
#
# Verifies that:
#   - docs/cli-matrix.md contains a row mentioning each scenario key
#     (01-layered-context, 02-cross-tool-memory, 03-skill-build,
#     04-harness-loop).
#   - The cross-tool-memory copilot gap is documented in cli-matrix.md
#     (per AGENTS.md "Gap-acceptance evidence rule").
#   - Every [scenarios.<name>] table in defaults.toml carries an
#     `applies_to` field declaring the parity contract.
#
# Host-side, no Docker, no auth. Safe to run in CI.

set -uo pipefail

PASS=0
FAIL=0
SKIP=0

note_pass() { echo "# PASS $1"; PASS=$((PASS + 1)); }
note_fail() { echo "# FAIL $1 — $2"; FAIL=$((FAIL + 1)); }
note_skip() { echo "# SKIP $1: $2"; SKIP=$((SKIP + 1)); }

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MATRIX="${REPO_DIR}/docs/cli-matrix.md"
DEFAULTS_TOML="${REPO_DIR}/tests/e2e/defaults.toml"

SCENARIOS=(01-layered-context 02-cross-tool-memory 03-skill-build 04-harness-loop)

# --- 0. Sources exist -------------------------------------------------------
for f in "$MATRIX" "$DEFAULTS_TOML"; do
  if [[ -f "$f" ]]; then
    note_pass "source file present — $(basename "$f")"
  else
    note_fail "source file present — $(basename "$f")" "missing at $f"
  fi
done
if [[ ! -f "$MATRIX" || ! -f "$DEFAULTS_TOML" ]]; then
  echo "# $PASS passed / $FAIL failed / $SKIP skipped"
  exit 1
fi

# --- 1. Each scenario key is mentioned in cli-matrix.md ---------------------
for s in "${SCENARIOS[@]}"; do
  if grep -Fq "$s" "$MATRIX"; then
    note_pass "cli-matrix.md — mentions scenario key '$s'"
  else
    note_fail "cli-matrix.md — mentions scenario key '$s'" \
              "no occurrence of '$s' in $MATRIX"
  fi
done

# --- 2. Copilot gap for cross-tool memory is documented --------------------
# The Gap-acceptance evidence rule requires the parity gap to be recorded
# in the matrix. Look for `copilot` co-occurring with the scenario key
# anywhere in the matrix, then verify it sits in/near a `[GAP-soft]`
# or `Parity gaps` context.
if grep -E -A1 -B1 '02-cross-tool-memory' "$MATRIX" | grep -qi 'copilot'; then
  note_pass "cli-matrix.md — copilot mentioned near 02-cross-tool-memory"
else
  note_fail "cli-matrix.md — copilot near 02-cross-tool-memory" \
            "no 'copilot' line within 1 line of '02-cross-tool-memory'"
fi
if grep -E '02-cross-tool-memory|cross-tool memory' "$MATRIX" | grep -qiE 'GAP|gap'; then
  note_pass "cli-matrix.md — cross-tool-memory row flagged as a GAP"
else
  note_fail "cli-matrix.md — cross-tool-memory GAP flag" \
            "no 'GAP' marker on a line mentioning the scenario"
fi

# --- 3. Each scenario in defaults.toml has applies_to -----------------------
# Strategy: for each scenario, find the `[scenarios.<name>]` header line,
# then scan the next 10 lines for an `applies_to` assignment. This survives
# blank lines and comments inside the table.
for s in "${SCENARIOS[@]}"; do
  hdr_line="$(grep -n -E "^\[scenarios\.${s}\]" "$DEFAULTS_TOML" | head -1 | cut -d: -f1)"
  if [[ -z "$hdr_line" ]]; then
    note_fail "defaults.toml — applies_to for '$s'" \
              "no '[scenarios.${s}]' header"
    continue
  fi
  block="$(sed -n "${hdr_line},$((hdr_line + 10))p" "$DEFAULTS_TOML")"
  if grep -Eq '^[[:space:]]*applies_to[[:space:]]*=' <<< "$block"; then
    note_pass "defaults.toml — '$s' declares applies_to"
  else
    note_fail "defaults.toml — '$s' declares applies_to" \
              "no 'applies_to =' within 10 lines of header"
  fi
done

echo ""
echo "# $PASS passed / $FAIL failed / $SKIP skipped"
[[ "$FAIL" -eq 0 ]]
