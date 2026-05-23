#!/usr/bin/env bash
# test-e2e-runner-taskfile.sh — Asserts Taskfile entries added by issue #78
# for the e2e runner. SKIPs the `task --list` check when go-task is absent.

set -uo pipefail

PASS=0
FAIL=0
SKIP=0

note_pass() { echo "# PASS $1"; PASS=$((PASS + 1)); }
note_fail() { echo "# FAIL $1 — $2"; FAIL=$((FAIL + 1)); }
note_skip() { echo "# SKIP $1: $2"; SKIP=$((SKIP + 1)); }

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TASKFILE="${REPO_DIR}/Taskfile.yml"

# --- Case 1: three entries declared --------------------------------------
for entry in 'e2e:test:' 'e2e:test:scenario:' 'e2e:test:cli:'; do
  if grep -qE "^[[:space:]]+${entry//:/\\:}[[:space:]]*$" "$TASKFILE"; then
    note_pass "Taskfile declares ${entry%:}"
  else
    note_fail "Taskfile declares ${entry%:}" "no '$entry' line found"
  fi
done

# --- Case 2: task --list enumerates each with non-empty desc -------------
if command -v task >/dev/null 2>&1; then
  list_out="$(cd "$REPO_DIR" && task --list 2>/dev/null || true)"
  for name in 'e2e:test' 'e2e:test:scenario' 'e2e:test:cli'; do
    if grep -qE "^\* $name:[[:space:]]+\S" <<< "$list_out"; then
      note_pass "task --list shows $name with non-empty description"
    else
      note_fail "task --list shows $name + desc" "no matching line"
    fi
  done
else
  note_skip "task --list enumeration" "go-task binary not on PATH"
fi

# --- Case 3: scenario/cli entries reference CLI_ARGS ---------------------
if grep -q '{{.CLI_ARGS}}' "$TASKFILE"; then
  note_pass "Taskfile references {{.CLI_ARGS}}"
else
  note_fail "CLI_ARGS reference" "no {{.CLI_ARGS}} in Taskfile.yml"
fi

# --- Case 4: base e2e:test runs bash tests/e2e/run.sh --------------------
if grep -A 3 -E '^[[:space:]]+e2e:test:[[:space:]]*$' "$TASKFILE" \
   | grep -q 'bash .*tests/e2e/run.sh'; then
  note_pass "e2e:test invokes bash tests/e2e/run.sh"
else
  note_fail "e2e:test invokes run.sh" "no matching cmd line under e2e:test"
fi

echo "# $PASS passed / $FAIL failed / $SKIP skipped"
if [[ $FAIL -gt 0 ]]; then exit 1; fi
exit 0
