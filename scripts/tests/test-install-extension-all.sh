#!/bin/bash
# test-install-extension-all.sh — Hermetic tests for cross-CLI umbrella extension installer (spec 0177)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

assert_eq() {
  local expected="$1" actual="$2" label="$3"
  TESTS_RUN=$((TESTS_RUN + 1))
  if [ "$expected" = "$actual" ]; then
    echo "  PASS: $label"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    echo "  FAIL: $label"
    echo "    Expected: '$expected'"
    echo "    Actual:   '$actual'"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  fi
}

assert_contains() {
  local haystack="$1" needle="$2" label="$3"
  TESTS_RUN=$((TESTS_RUN + 1))
  if echo "$haystack" | grep -Fq "$needle"; then
    echo "  PASS: $label"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    echo "  FAIL: $label"
    echo "    String did not contain: '$needle'"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  fi
}

echo "=== test-install-extension-all.sh ==="

# Test 1: Usage and Help
help_out="$(bash "$REPO_DIR/scripts/install-extension-all.sh" --help 2>&1)"
assert_contains "$help_out" "Usage: install-extension-all.sh" "Shows usage on --help"

# Test 2: Missing argument fails
set +e
no_arg_out="$(bash "$REPO_DIR/scripts/install-extension-all.sh" 2>&1)"
no_arg_code=$?
set -e
assert_eq 1 "$no_arg_code" "Exits 1 when no extension name is provided"
assert_contains "$no_arg_out" "Usage:" "Prints usage when no argument given"

# Test 3: Non-existent extension fails
set +e
missing_ext_out="$(bash "$REPO_DIR/scripts/install-extension-all.sh" non-existent-extension-xyz 2>&1)"
missing_ext_code=$?
set -e
assert_eq 1 "$missing_ext_code" "Exits 1 when extension is not found"
assert_contains "$missing_ext_out" "not found in extensions/" "Reports extension not found"

# Setup isolated sandbox for mock CLI testing
SANDBOX="$(mktemp -d)"
trap 'rm -rf "$SANDBOX"' EXIT

FAKE_BIN="$SANDBOX/bin"
mkdir -p "$FAKE_BIN"
FAKE_GEMINI_HOME="$SANDBOX/gemini_home"
mkdir -p "$FAKE_GEMINI_HOME"

# Test 4: Universal skip when all CLIs are absent
set +e
all_skip_out="$(PATH="/usr/bin:/bin" GEMINI_HOME="$SANDBOX/nonexistent_gemini" bash "$REPO_DIR/scripts/install-extension-all.sh" hello-world 2>&1)"
all_skip_code=$?
set -e
assert_eq 1 "$all_skip_code" "Exits 1 when all CLI targets are skipped"
assert_contains "$all_skip_out" "[SKIPPED]" "Reports SKIPPED for targets"
assert_contains "$all_skip_out" "all 4 target(s) were skipped" "Summarizes all targets skipped"

# Test 5: Partial install with mock Gemini only
set +e
gemini_only_out="$(PATH="/usr/bin:/bin" GEMINI_HOME="$FAKE_GEMINI_HOME" bash "$REPO_DIR/scripts/install-extension-all.sh" hello-world 2>&1)"
gemini_only_code=$?
set -e
assert_eq 0 "$gemini_only_code" "Exits 0 when at least one CLI is present and installed"
assert_contains "$gemini_only_out" "[INSTALLED] Gemini CLI" "Reports Gemini installed"
assert_contains "$gemini_only_out" "[SKIPPED]   Claude Code" "Reports Claude skipped"
assert_contains "$gemini_only_out" "[SKIPPED]   GitHub Copilot CLI" "Reports Copilot skipped"
assert_contains "$gemini_only_out" "[SKIPPED]   Antigravity CLI" "Reports Antigravity skipped"

# Test 6: Taskfile declarations and descriptions
taskfile_content="$(cat "$REPO_DIR/Taskfile.yml")"
assert_contains "$taskfile_content" "install-gemini-extension:" "Taskfile defines install-gemini-extension"
assert_contains "$taskfile_content" "install-gemini-extensions:" "Taskfile defines install-gemini-extensions"
assert_contains "$taskfile_content" "link-gemini-extensions:" "Taskfile defines link-gemini-extensions"
assert_contains "$taskfile_content" "unlink-gemini-extensions:" "Taskfile defines unlink-gemini-extensions"
assert_contains "$taskfile_content" "install-extension-all:" "Taskfile defines install-extension-all"

# Test 7: Deprecation notices in legacy Taskfile aliases
assert_contains "$taskfile_content" "[DEPRECATION] 'task install-extension' is deprecated" "Deprecation notice for install-extension"
assert_contains "$taskfile_content" "[DEPRECATION] 'task install-extensions' is deprecated" "Deprecation notice for install-extensions"
assert_contains "$taskfile_content" "[DEPRECATION] 'task link-extensions' is deprecated" "Deprecation notice for link-extensions"
assert_contains "$taskfile_content" "[DEPRECATION] 'task unlink-extensions' is deprecated" "Deprecation notice for unlink-extensions"

echo "=== Results: $TESTS_PASSED/$TESTS_RUN passed ($TESTS_FAILED failed) ==="
if [ "$TESTS_FAILED" -gt 0 ]; then
  exit 1
fi
exit 0
