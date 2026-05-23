#!/bin/bash
# test-e2e-auth-taskfile.sh — Lock the Taskfile surface for the auth flow.
#
# Asserts:
#   - three entries declared: e2e:auth:claude, e2e:auth:gemini, e2e:auth:copilot
#   - `task --list` enumerates each with a non-empty `desc:`
#   - the two interactive entries reference an image precondition
#     (docker image inspect or e2e:build: build hint)
#
# SKIPs `task --list` assertions when the `task` binary is absent.

set -uo pipefail

PASS=0
FAIL=0
SKIP=0

note_pass() { echo "PASS  $1"; PASS=$((PASS + 1)); }
note_fail() { echo "FAIL  $1 — $2"; FAIL=$((FAIL + 1)); }
note_skip() { echo "SKIP  $1 — $2"; SKIP=$((SKIP + 1)); }

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TASKFILE="${REPO_DIR}/Taskfile.yml"

if [[ ! -f "$TASKFILE" ]]; then
  note_fail "Taskfile.yml — exists" "missing at $TASKFILE"
  echo ""
  echo "Results: $PASS passed, $FAIL failed, $SKIP skipped"
  exit 1
fi
note_pass "Taskfile.yml — exists"

# --- 1. Three entries declared ----------------------------------------------
for entry in "e2e:auth:claude:" "e2e:auth:gemini:" "e2e:auth:copilot:"; do
  if grep -qE "^[[:space:]]+${entry}\$" "$TASKFILE"; then
    note_pass "Taskfile — declares $entry"
  else
    note_fail "Taskfile — declares $entry" "no matching key found"
  fi
done

# --- 2. task --list enumerates with non-empty desc --------------------------
if command -v task >/dev/null 2>&1; then
  list_out="$(cd "$REPO_DIR" && task --list 2>&1 || true)"
  for name in e2e:auth:claude e2e:auth:gemini e2e:auth:copilot; do
    line="$(echo "$list_out" | grep -E "^[*[:space:]]*${name}:" || true)"
    if [[ -z "$line" ]]; then
      note_fail "task --list — '$name' listed" "not found in: $list_out"
      continue
    fi
    desc="${line#*: }"
    # Strip leading/trailing whitespace.
    desc="$(echo "$desc" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
    if [[ -n "$desc" ]]; then
      note_pass "task --list — '$name' has non-empty desc"
    else
      note_fail "task --list — '$name' desc" "empty after the task name"
    fi
  done
else
  note_skip "task --list — enumerates entries" "task binary not installed"
fi

# --- 3. Interactive entries reference an image precondition -----------------
# Slice the YAML block for a given key down to the next top-level task entry.
slice_block() {
  local key="$1"
  awk -v k="$key" '
    $0 ~ "^[[:space:]]+"k"$" { capture = 1; print; next }
    capture && /^[[:space:]]{2}[a-zA-Z][a-zA-Z0-9:_-]*:$/ { capture = 0 }
    capture { print }
  ' "$TASKFILE"
}

for cli in claude gemini; do
  block="$(slice_block "e2e:auth:${cli}:")"
  if echo "$block" | grep -qE 'docker image inspect|e2e:build:'"${cli}"; then
    note_pass "Taskfile — e2e:auth:${cli} references an image precondition"
  else
    note_fail "Taskfile — e2e:auth:${cli} image precondition" \
              "no 'docker image inspect' or 'e2e:build:${cli}' reference found in the block"
  fi
done

echo ""
echo "Results: $PASS passed, $FAIL failed, $SKIP skipped"
[[ "$FAIL" -eq 0 ]]
