#!/bin/bash
# test-pr-logbook-label-scope.sh — Regression test for spec 0190 (issue #1063).
#
# Verifies that pr-logbook skill instructions:
#   1. Do not instruct adding the `logbook` label to pre-existing feature issues.
#   2. Instruct creating dedicated logbook issues with the `logbook` label.
#   3. Carry version 1.3.1 in source and across all compiled CLI outputs.
#   4. Have zero compilation drift across .claude, .gemini, .github, .agents.
#
# Usage:
#   bash scripts/tests/test-pr-logbook-label-scope.sh

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

pass=0
fail=0

assert_eq() {
  local desc="$1"
  local expected="$2"
  local actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "PASS  $desc"
    pass=$((pass + 1))
  else
    echo "FAIL  $desc"
    echo "      expected: '$expected'"
    echo "      actual:   '$actual'"
    fail=$((fail + 1))
  fi
}

assert_contains() {
  local desc="$1"
  local needle="$2"
  local haystack="$3"
  if echo "$haystack" | grep -Fq -- "$needle"; then
    echo "PASS  $desc"
    pass=$((pass + 1))
  else
    echo "FAIL  $desc"
    echo "      expected to contain: '$needle'"
    fail=$((fail + 1))
  fi
}

assert_not_contains() {
  local desc="$1"
  local needle="$2"
  local haystack="$3"
  if echo "$haystack" | grep -Fq -- "$needle"; then
    echo "FAIL  $desc"
    echo "      expected NOT to contain: '$needle'"
    fail=$((fail + 1))
  else
    echo "PASS  $desc"
    pass=$((pass + 1))
  fi
}

echo "=== Testing Spec 0190: pr-logbook label scope ==="

# 1. Source skill checks
SOURCE_SKILL="$REPO_ROOT/artifacts/core/skills/pr-logbook/SKILL.md"
if [ ! -f "$SOURCE_SKILL" ]; then
  echo "FATAL: cannot find $SOURCE_SKILL" >&2
  exit 2
fi

SOURCE_CONTENT="$(cat "$SOURCE_SKILL")"

assert_not_contains "Source skill does not instruct unconditional add-label logbook" \
  "--add-label logbook" "$SOURCE_CONTENT"

assert_contains "Source skill explicitly forbids adding logbook label to feature issues" \
  "Do not add the \`logbook\` label to a pre-existing feature issue." "$SOURCE_CONTENT"

assert_contains "Source skill specifies --label logbook for dedicated logbook issues" \
  "--label logbook" "$SOURCE_CONTENT"

assert_contains "Source skill version bumped to 1.3.1" \
  'version: "1.3.1"' "$SOURCE_CONTENT"

# 2. Check compiled files across all 4 CLIs
for cli_dir in .claude .gemini .github .agents; do
  cli_path="$REPO_ROOT/$cli_dir/skills/pr-logbook/SKILL.md"
  cli_name="$cli_dir"
  if [ ! -f "$cli_path" ]; then
    echo "FAIL  Compiled skill for $cli_name exists at $cli_path"
    fail=$((fail + 1))
    continue
  fi

  content="$(cat "$cli_path")"
  assert_not_contains "Compiled skill ($cli_name) does not instruct add-label logbook" \
    "--add-label logbook" "$content"

  assert_contains "Compiled skill ($cli_name) forbids logbook label on feature issues" \
    "Do not add the \`logbook\` label to a pre-existing feature issue." "$content"

  assert_contains "Compiled skill ($cli_name) carries version 1.3.1" \
    'version: "1.3.1"' "$content"
done

# 3. Check build components check (zero drift)
if (cd "$REPO_ROOT" && bash scripts/build-components.sh --check >/dev/null 2>&1); then
  echo "PASS  build-components --check reports zero drift"
  pass=$((pass + 1))
else
  echo "FAIL  build-components --check reported drift"
  fail=$((fail + 1))
fi

echo
echo "Results: $pass passed, $fail failed."

if [ "$fail" -gt 0 ]; then
  exit 1
fi
exit 0
