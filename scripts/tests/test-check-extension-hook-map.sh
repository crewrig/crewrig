#!/bin/bash
# test-check-extension-hook-map.sh — mutation tests for the R6 agreement
# check (spec 0179 issue #1005, plan step 24). Proves
# check-extension-hook-map.sh turns red from EACH side independently, and
# that the reconciliation arm (v3-F1) turns red too. A sandboxed COPY of
# scripts/ and docs/ is mutated per case — never the real repository tree.
#
# Usage:
#   bash scripts/tests/test-check-extension-hook-map.sh
#
# -e is intentionally omitted: outcomes are asserted via explicit counters.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

pass=0
fail=0
ok() { echo "PASS  $1"; pass=$((pass + 1)); }
ng() { echo "FAIL  $1"; fail=$((fail + 1)); }

# make_sandbox — a fresh copy of scripts/ + docs/, so the check under test
# (invoked from inside the sandbox) reads and mutates ONLY the copy.
make_sandbox() {
  local sandbox
  sandbox="$(mktemp -d "$TMP_ROOT/sandbox.XXXXXX")"
  cp -r "$SCRIPT_DIR" "$sandbox/scripts"
  mkdir -p "$sandbox/docs"
  cp -r "$REPO_DIR/docs/extension-hook-events.md" "$sandbox/docs/"
  echo "$sandbox"
}

echo "0. Baseline — the unmutated pair agrees"
sandbox="$(make_sandbox)"
out="$( cd "$sandbox" && bash scripts/check-extension-hook-map.sh 2>&1 )"
rc=$?
[ "$rc" -eq 0 ] && ok "Case 0 — baseline passes" || ng "Case 0 — baseline unexpectedly fails:"$'\n'"$out"

echo "1. Exact-token (a) — mutate the TABLE only"
sandbox="$(make_sandbox)"
sed -i.bak 's/| `PreToolUse` | `PreToolUse` |/| `PreToolUse` | `WrongEvent` |/' "$sandbox/docs/extension-hook-events.md"
out="$( cd "$sandbox" && bash scripts/check-extension-hook-map.sh 2>&1 )"
rc=$?
if [ "$rc" -ne 0 ] && echo "$out" | grep -q "PreToolUse" && echo "$out" | grep -q "claude"; then
  ok "Case 1 — a table-only mutation fails, naming the disagreeing cell"
else
  ng "Case 1 — did not fail as expected (rc=$rc):"$'\n'"$out"
fi

echo "2. Exact-token (b) — mutate the TRANSLATOR only"
sandbox="$(make_sandbox)"
sed -i.bak 's/claude:PreToolUse) echo "PreToolUse" ;;/claude:PreToolUse) echo "WrongEvent" ;;/' "$sandbox/scripts/lib/extension-hooks.sh"
out="$( cd "$sandbox" && bash scripts/check-extension-hook-map.sh 2>&1 )"
rc=$?
if [ "$rc" -ne 0 ] && echo "$out" | grep -q "PreToolUse" && echo "$out" | grep -q "claude"; then
  ok "Case 2 — a translator-only mutation fails, naming the disagreeing cell"
else
  ng "Case 2 — did not fail as expected (rc=$rc):"$'\n'"$out"
fi

echo "3. Growth (c) — add a table row with no translator counterpart"
sandbox="$(make_sandbox)"
awk '{
  print;
  if ($0 ~ /^\| `UserPromptSubmit` \|/) print "| `NeverHeardOfIt` | `X` | `Y` | `Z` | `W` |";
}' "$sandbox/docs/extension-hook-events.md" > "$sandbox/docs/extension-hook-events.md.tmp"
mv "$sandbox/docs/extension-hook-events.md.tmp" "$sandbox/docs/extension-hook-events.md"
out="$( cd "$sandbox" && bash scripts/check-extension-hook-map.sh 2>&1 )"
rc=$?
if [ "$rc" -ne 0 ] && echo "$out" | grep -q "NeverHeardOfIt"; then
  ok "Case 3 — an untranslated table row fails, naming the event"
else
  ng "Case 3 — did not fail as expected (rc=$rc):"$'\n'"$out"
fi

echo "4. Growth (d) — add an event to the translator with no table row"
sandbox="$(make_sandbox)"
sed -i.bak 's/EXT_HOOKS_KNOWN_EVENTS="PreToolUse UserPromptSubmit"/EXT_HOOKS_KNOWN_EVENTS="PreToolUse UserPromptSubmit NeverInTheTable"/' "$sandbox/scripts/lib/extension-hooks.sh"
out="$( cd "$sandbox" && bash scripts/check-extension-hook-map.sh 2>&1 )"
rc=$?
if [ "$rc" -ne 0 ] && echo "$out" | grep -q "NeverInTheTable"; then
  ok "Case 4 — a translator-only new event with no table row fails, naming the event (constructible only because the probe manifest enumerates the translator's own closed set)"
else
  ng "Case 4 — did not fail as expected (rc=$rc):"$'\n'"$out"
fi

echo "5. Reconciliation (e) — mutate one descriptor row (hook file) without touching the artifact"
sandbox="$(make_sandbox)"
jq '.antigravity.hookFile = "somewhere-else.json"' "$sandbox/scripts/lib/extension-targets.json" > "$sandbox/scripts/lib/extension-targets.json.tmp"
mv "$sandbox/scripts/lib/extension-targets.json.tmp" "$sandbox/scripts/lib/extension-targets.json"
out="$( cd "$sandbox" && bash scripts/check-extension-hook-map.sh 2>&1 )"
rc=$?
if [ "$rc" -ne 0 ] && echo "$out" | grep -q "reconciliation"; then
  ok "Case 5 — a descriptor-only mutation (hook file) fails the reconciliation arm"
else
  ng "Case 5 — did not fail as expected (rc=$rc):"$'\n'"$out"
fi

echo "6. Reconciliation (e), other field — mutate the time unit descriptor row"
sandbox="$(make_sandbox)"
jq '.antigravity.timeUnit = "minutes"' "$sandbox/scripts/lib/extension-targets.json" > "$sandbox/scripts/lib/extension-targets.json.tmp"
mv "$sandbox/scripts/lib/extension-targets.json.tmp" "$sandbox/scripts/lib/extension-targets.json"
out="$( cd "$sandbox" && bash scripts/check-extension-hook-map.sh 2>&1 )"
rc=$?
if [ "$rc" -ne 0 ] && echo "$out" | grep -q "reconciliation" && echo "$out" | grep -qi "time unit"; then
  ok "Case 6 — a descriptor-only mutation (time unit) fails the reconciliation arm"
else
  ng "Case 6 — did not fail as expected (rc=$rc):"$'\n'"$out"
fi

echo "7. Reconciliation (e), third field (v3-F1 CONJUNCTIVE bar) — mutate the root-token descriptor row"
sandbox="$(make_sandbox)"
jq '.claude.rootToken = "${SOMETHING_ELSE}"' "$sandbox/scripts/lib/extension-targets.json" > "$sandbox/scripts/lib/extension-targets.json.tmp"
mv "$sandbox/scripts/lib/extension-targets.json.tmp" "$sandbox/scripts/lib/extension-targets.json"
out="$( cd "$sandbox" && bash scripts/check-extension-hook-map.sh 2>&1 )"
rc=$?
if [ "$rc" -ne 0 ] && echo "$out" | grep -q "reconciliation" && echo "$out" | grep -qi "extension-root form"; then
  ok "Case 7 — a descriptor-only mutation (root token) fails the reconciliation arm too — all three fields (hook file, time unit, root token) are conjunctively checked, not just one"
else
  ng "Case 7 — did not fail as expected (rc=$rc):"$'\n'"$out"
fi

echo ""
echo "Results: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
