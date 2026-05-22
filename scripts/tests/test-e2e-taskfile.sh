#!/bin/bash
# test-e2e-taskfile.sh — Regression test for the e2e Taskfile entries.
#
# Locks the public surface added by issue #76 to Taskfile.yml. We assert
# both static (YAML grep) and dynamic (task --list) properties so that
# either a rename or a Taskfile syntax error is caught.
#
# Usage:
#   bash scripts/tests/test-e2e-taskfile.sh

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TASKFILE="$REPO_ROOT/Taskfile.yml"

PASS=0
FAIL=0
SKIP=0

note_pass() { echo "PASS  $1"; PASS=$((PASS + 1)); }
note_fail() { echo "FAIL  $1 — $2"; FAIL=$((FAIL + 1)); }
note_skip() { echo "SKIP  $1 — $2"; SKIP=$((SKIP + 1)); }

if [[ ! -f "$TASKFILE" ]]; then
  note_fail "Taskfile.yml present" "$TASKFILE not found"
  echo "Results: $PASS passed, $FAIL failed"
  exit 1
fi
note_pass "Taskfile.yml present"

# ---------------------------------------------------------------------------
# 1. Static check: each required entry is declared as a top-level task
#    (left-anchored, two-space indent, trailing colon).
# ---------------------------------------------------------------------------
ENTRIES=(
  "e2e:build"
  "e2e:build:base"
  "e2e:build:claude"
  "e2e:build:gemini"
  "e2e:build:copilot"
  "e2e:build:mempalace"
  "e2e:lock"
)

for entry in "${ENTRIES[@]}"; do
  if grep -qE "^  ${entry}:\s*$" "$TASKFILE"; then
    note_pass "entry declared: $entry"
  else
    note_fail "entry declared: $entry" "no '  ${entry}:' line in Taskfile.yml"
  fi
done

# ---------------------------------------------------------------------------
# 2. Static check: per-CLI build targets reference E2E_IMG_PREFIX and
#    E2E_DOCKER_DIR so future renames cannot silently break the contract.
# ---------------------------------------------------------------------------
# We scan the e2e:build:* block as a whole — simpler and just as strict.
e2e_block="$(awk '
  /^  e2e:build:base:/   { capture = 1 }
  capture                 { print }
  /^  e2e:lock:/         { exit }
' "$TASKFILE")"

if [[ "$e2e_block" == *'{{.E2E_IMG_PREFIX}}'* ]]; then
  note_pass "per-CLI build targets reference E2E_IMG_PREFIX"
else
  note_fail "per-CLI build targets reference E2E_IMG_PREFIX" \
    "no '{{.E2E_IMG_PREFIX}}' found between e2e:build:base and e2e:lock"
fi

if [[ "$e2e_block" == *'{{.E2E_DOCKER_DIR}}'* ]]; then
  note_pass "per-CLI build targets reference E2E_DOCKER_DIR"
else
  note_fail "per-CLI build targets reference E2E_DOCKER_DIR" \
    "no '{{.E2E_DOCKER_DIR}}' found between e2e:build:base and e2e:lock"
fi

# ---------------------------------------------------------------------------
# 3. Dynamic check: `task --list` enumerates every entry.
# ---------------------------------------------------------------------------
if command -v task >/dev/null 2>&1; then
  if list_out="$( ( cd "$REPO_ROOT" && task --list 2>&1 ) )"; then
    for entry in "${ENTRIES[@]}"; do
      if printf '%s\n' "$list_out" | grep -qE "(^|\s)\* ${entry}:" \
         || printf '%s\n' "$list_out" | grep -qE "(^|\s)${entry}:"; then
        note_pass "task --list shows: $entry"
      else
        note_fail "task --list shows: $entry" "not found in 'task --list' output"
      fi
    done
  else
    note_fail "task --list runs cleanly" "exit non-zero; output: $list_out"
  fi
else
  note_skip "dynamic task --list checks" "task binary not on PATH"
fi

echo ""
echo "Results: $PASS passed, $FAIL failed, $SKIP skipped"
[[ "$FAIL" -eq 0 ]]
