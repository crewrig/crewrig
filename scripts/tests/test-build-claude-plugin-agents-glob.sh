#!/bin/bash
# test-build-claude-plugin-agents-glob.sh — Regression test for the "Copy
# agents" step of build-claude-plugin.sh (issue #600).
#
# Pins the fix: the step MUST copy only the files matched by the fixed
# default glob (agents/*/AGENT.md), never `cp -r` the whole agent directory.
# A sibling pivot file for another CLI (e.g. PROMPT.md, the Gemini pivot
# source per extension-skeleton/agent/agents/sample-agent/PROMPT.md) must NOT
# leak into the Claude plugin output, where Claude Code would register it as
# a bogus second agent.
#
# Repointed at the fixed default glob (spec 0183 R7, PLAN step 10): the
# per-extension `claude.agents` override this test used to exercise is
# retired — it was read only as an override whose own default was this same
# glob, and both committed manifests already carried `[]`, so the override
# case (formerly Case 3) is dropped rather than repointed at a capability
# that no longer exists.
#
# Cases:
#   1. AGENT.md + sibling PROMPT.md → AGENT.md copied, PROMPT.md NOT copied.
#   2. AGENT.md only, no sibling → still copied (no regression on the
#      normal case).
#
# Usage:
#   bash scripts/tests/test-build-claude-plugin-agents-glob.sh
#
# -e is intentionally omitted: exit codes / file presence are asserted via
# explicit pass/fail counters.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT_UNDER_TEST="$SCRIPT_DIR/build-claude-plugin.sh"

if [ ! -f "$SCRIPT_UNDER_TEST" ]; then
  echo "FATAL: cannot find $SCRIPT_UNDER_TEST" >&2
  exit 2
fi

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

pass=0
fail=0

new_dir() {
  local dir
  dir="$(mktemp -d "$TMP_ROOT/ext.XXXXXX")"
  echo "$dir"
}

# write_manifest <ext_dir> — current-shape manifest (spec 0183): the generic
# top-level `agents` section, no `components` block, no retired per-CLI keys.
write_manifest() {
  local ext_dir="$1"
  mkdir -p "$ext_dir"
  cat > "$ext_dir/extension.json" <<EOF
{
  "name": "demo-agents-glob",
  "version": "0.1.0",
  "description": "Fixture extension for agents-glob regression test.",
  "agents": {
    "location": "agents/"
  },
  "claude": {
    "author": { "name": "test" },
    "defaultAllowedTools": [],
    "settings": {},
    "lsp": {},
    "bin": null
  }
}
EOF
}

write_agent_md() {
  local path="$1"
  mkdir -p "$(dirname "$path")"
  cat > "$path" <<'EOF'
---
name: demo-agent
description: "A pivot agent"
type: agent
---

System prompt.
EOF
}

write_prompt_md() {
  local path="$1"
  mkdir -p "$(dirname "$path")"
  cat > "$path" <<'EOF'
Gemini-only pivot prompt, must not leak into the Claude plugin.
EOF
}

assert_exists() {
  local name="$1" path="$2"
  if [ -f "$path" ]; then
    echo "PASS  $name (found $path)"
    pass=$((pass + 1))
  else
    echo "FAIL  $name (expected $path to exist)"
    fail=$((fail + 1))
  fi
}

assert_absent() {
  local name="$1" path="$2"
  if [ -f "$path" ]; then
    echo "FAIL  $name (expected $path to be absent, but it was copied)"
    fail=$((fail + 1))
  else
    echo "PASS  $name ($path correctly absent)"
    pass=$((pass + 1))
  fi
}

# --- Case 1: AGENT.md + sibling PROMPT.md, default glob ---
t1="$(new_dir)"
write_manifest "$t1"
write_agent_md "$t1/agents/demo-agent/AGENT.md"
write_prompt_md "$t1/agents/demo-agent/PROMPT.md"
out1="$t1/dist-claude-plugin/demo-agents-glob"
bash "$SCRIPT_UNDER_TEST" "$t1" "$out1" >/dev/null 2>&1
assert_exists "Case 1 — AGENT.md copied" "$out1/agents/demo-agent/AGENT.md"
assert_absent "Case 1 — sibling PROMPT.md NOT copied" "$out1/agents/demo-agent/PROMPT.md"

# --- Case 2: AGENT.md only, no sibling (no regression on normal case) ---
t2="$(new_dir)"
write_manifest "$t2"
write_agent_md "$t2/agents/demo-agent/AGENT.md"
out2="$t2/dist-claude-plugin/demo-agents-glob"
bash "$SCRIPT_UNDER_TEST" "$t2" "$out2" >/dev/null 2>&1
assert_exists "Case 2 — AGENT.md copied (no sibling)" "$out2/agents/demo-agent/AGENT.md"

echo ""
echo "Results: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
