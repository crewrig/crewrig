#!/bin/bash
# test-check-extension-pivot.sh — Regression test for check-extension-pivot.sh.
#
# Pins the contract from spec 0042 R1/R7: every skill, agent, and command under
# an upstream-owned extension tier MUST be pivot-authored. The guard walks the
# whole extensions/{core,library} tree (org exempt) from the CWD, so each case
# builds a temp tree and runs the guard inside it.
#
# Cases:
#   1. command pivot present (commands/x.md + commands/x.toml)      → exit 0
#   2. command-native orphan (commands/x.toml, NO commands/x.md)    → exit 1
#   3. agent pivot present (agents/a/AGENT.md)                      → exit 0
#   4. agent-native (agents/a/ lacking AGENT.md)                    → exit 1
#   5. adopter-owned tier (extensions/org) with an orphan .toml     → exit 0 (exempt)
#   6. empty extensions tree (no components)                       → exit 0
#
# Usage:
#   bash scripts/tests/test-check-extension-pivot.sh
#
# -e is intentionally omitted: exit codes are asserted via explicit counters.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT_UNDER_TEST="$SCRIPT_DIR/check-extension-pivot.sh"

if [ ! -f "$SCRIPT_UNDER_TEST" ]; then
  echo "FATAL: cannot find $SCRIPT_UNDER_TEST" >&2
  exit 2
fi

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

pass=0
fail=0

new_tree() {
  local dir
  dir="$(mktemp -d "$TMP_ROOT/tree.XXXXXX")"
  echo "$dir"
}

write_pivot_command() {
  local cmd_dir="$1"
  mkdir -p "$cmd_dir"
  cat > "$cmd_dir/x.md" <<'EOF'
---
name: x
description: "A pivot command"
type: command
---

Body.
EOF
}

write_command_toml() {
  local cmd_dir="$1"
  mkdir -p "$cmd_dir"
  cat > "$cmd_dir/x.toml" <<'EOF'
description = "A command"

prompt = """

Body.
"""
EOF
}

run_case() {
  local name="$1" tree="$2" expected_exit="$3"
  local actual_exit=0
  ( cd "$tree" && bash "$SCRIPT_UNDER_TEST" >/dev/null 2>&1 ) || actual_exit=$?
  if [ "$actual_exit" -eq "$expected_exit" ]; then
    echo "PASS  $name (exit $actual_exit)"
    pass=$((pass + 1))
  else
    echo "FAIL  $name (expected exit $expected_exit, got $actual_exit)"
    fail=$((fail + 1))
  fi
}

# Case 1 — command pivot present (.md + generated .toml) → exit 0
t1="$(new_tree)"
write_pivot_command "$t1/extensions/core/demo/commands"
write_command_toml  "$t1/extensions/core/demo/commands"
run_case "Case 1 — command pivot (.md + .toml) passes" "$t1" 0

# Case 2 — command-native orphan (.toml, no .md) → exit 1
t2="$(new_tree)"
write_command_toml "$t2/extensions/core/demo/commands"
run_case "Case 2 — orphan command .toml (no pivot .md) fails" "$t2" 1

# Case 3 — agent pivot present (agents/a/AGENT.md) → exit 0
t3="$(new_tree)"
mkdir -p "$t3/extensions/core/demo/agents/a"
cat > "$t3/extensions/core/demo/agents/a/AGENT.md" <<'EOF'
---
name: a
description: "A pivot agent"
type: agent
---

System prompt.
EOF
run_case "Case 3 — agent pivot (AGENT.md) passes" "$t3" 0

# Case 4 — agent-native: agents/a/ lacking AGENT.md → exit 1
t4="$(new_tree)"
mkdir -p "$t4/extensions/core/demo/agents/a"
cat > "$t4/extensions/core/demo/agents/a/PROMPT.md" <<'EOF'
Native agent prompt, no AGENT.md.
EOF
run_case "Case 4 — agent dir lacking AGENT.md fails" "$t4" 1

# Case 5 — adopter-owned extensions/org with an orphan .toml → exit 0 (exempt)
t5="$(new_tree)"
write_command_toml "$t5/extensions/org/demo/commands"
run_case "Case 5 — adopter-owned extensions/org is exempt" "$t5" 0

# Case 6 — empty tree (no extension components) → exit 0
t6="$(new_tree)"
mkdir -p "$t6/extensions/core"
run_case "Case 6 — empty extensions tree passes" "$t6" 0

echo ""
echo "Results: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
