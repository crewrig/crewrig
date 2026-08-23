#!/bin/bash
# test-palace-path-propagation.sh — Hermetic tests for MEMPALACE_PALACE_PATH propagation (spec 0178)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# shellcheck source=../lib/common.sh
. "$REPO_DIR/scripts/lib/common.sh"
# shellcheck disable=SC2034
CREWRIG_REPO_DIR="$REPO_DIR"

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
  if echo "$haystack" | grep -Fq -e "$needle"; then
    echo "  PASS: $label"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    echo "  FAIL: $label"
    echo "    String did not contain: '$needle'"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  fi
}

assert_not_contains() {
  local haystack="$1" needle="$2" label="$3"
  TESTS_RUN=$((TESTS_RUN + 1))
  if ! echo "$haystack" | grep -Fq -e "$needle"; then
    echo "  PASS: $label"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    echo "  FAIL: $label"
    echo "    String unexpectedly contained: '$needle'"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  fi
}

echo "=== test-palace-path-propagation.sh ==="

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

FAKE_PYTHON="$TMP_DIR/bin/python3"
FAKE_CHROMA="$TMP_DIR/bin/chroma"
mkdir -p "$TMP_DIR/bin"
touch "$FAKE_PYTHON" "$FAKE_CHROMA"
chmod 755 "$FAKE_PYTHON" "$FAKE_CHROMA"
export MEMPALACE_PYTHON="$FAKE_PYTHON"
export CREWRIG_TEST_MOCK_CHROMA_BIN="true"

# ── Test 1 & 2: Launcher materialization without and with MEMPALACE_PALACE_PATH ──

# Test 1: Launcher materialization when MEMPALACE_PALACE_PATH is unset
LAUNCHER_OUT_1="$TMP_DIR/launcher1.sh"
mcp_launcher_installed_path() { echo "$LAUNCHER_OUT_1"; }

(
  unset MEMPALACE_PALACE_PATH
  install_mcp_launcher >/dev/null
)

content1="$(cat "$LAUNCHER_OUT_1")"
assert_contains "$content1" 'CONFIGURED_PALACE_PATH=""' "Launcher has empty CONFIGURED_PALACE_PATH when unset"
assert_not_contains "$content1" '__MEMPALACE_PALACE_PATH__' "Launcher has no residual __MEMPALACE_PALACE_PATH__ placeholder"

# Test 2: Launcher materialization when MEMPALACE_PALACE_PATH is set
LAUNCHER_OUT_2="$TMP_DIR/launcher2.sh"
mcp_launcher_installed_path() { echo "$LAUNCHER_OUT_2"; }

(
  export MEMPALACE_PALACE_PATH="/tmp/custom/palace/location"
  install_mcp_launcher >/dev/null
)

content2="$(cat "$LAUNCHER_OUT_2")"
assert_contains "$content2" 'CONFIGURED_PALACE_PATH="/tmp/custom/palace/location"' "Launcher has configured palace path"
assert_contains "$content2" 'export MEMPALACE_PALACE_PATH="${CONFIGURED_PALACE_PATH}"' "Launcher exports configured palace path"

# ── Test 3 & 4: ChromaDB launchd plist materialization ─────────────────────────

PLIST_SRC="$REPO_DIR/config/launchd/com.mempalace.chroma-server.plist"
PLIST_OUT_DEFAULT="$TMP_DIR/chroma-default.plist"
PLIST_OUT_CUSTOM="$TMP_DIR/chroma-custom.plist"

# Test 3: Default palace in plist
(
  unset MEMPALACE_PALACE_PATH
  _materialise_chroma_unit "$PLIST_SRC" "$PLIST_OUT_DEFAULT"
)
plist_def="$(cat "$PLIST_OUT_DEFAULT")"
assert_contains "$plist_def" "<string>$HOME/.mempalace/palace</string>" "Chroma plist defaults to ~/.mempalace/palace"
assert_not_contains "$plist_def" "__CHROMA_PALACE_PATH__" "Chroma plist has no residual placeholder"

# Test 4: Custom palace in plist
(
  export MEMPALACE_PALACE_PATH="/var/data/custom-palace"
  _materialise_chroma_unit "$PLIST_SRC" "$PLIST_OUT_CUSTOM"
)
plist_cust="$(cat "$PLIST_OUT_CUSTOM")"
assert_contains "$plist_cust" "<string>/var/data/custom-palace</string>" "Chroma plist uses MEMPALACE_PALACE_PATH"
assert_not_contains "$plist_cust" "__CHROMA_PALACE_PATH__" "Chroma custom plist has no residual placeholder"

# ── Test 5 & 6: ChromaDB systemd service materialization ───────────────────────

SERVICE_SRC="$REPO_DIR/config/systemd/mempalace-chroma-server.service"
SERVICE_OUT_DEFAULT="$TMP_DIR/chroma-default.service"
SERVICE_OUT_CUSTOM="$TMP_DIR/chroma-custom.service"

# Test 5: Default palace in systemd service (under simulated Linux)
(
  unset MEMPALACE_PALACE_PATH
  # On Linux uname -s returns Linux, test default fallback logic
  _materialise_chroma_unit "$SERVICE_SRC" "$SERVICE_OUT_DEFAULT"
)
service_def="$(cat "$SERVICE_OUT_DEFAULT")"
assert_not_contains "$service_def" "__CHROMA_PALACE_PATH__" "Chroma systemd service has no residual placeholder"

# Test 6: Custom palace in systemd service
(
  export MEMPALACE_PALACE_PATH="/var/data/custom-palace"
  _materialise_chroma_unit "$SERVICE_SRC" "$SERVICE_OUT_CUSTOM"
)
service_cust="$(cat "$SERVICE_OUT_CUSTOM")"
assert_contains "$service_cust" "--path /var/data/custom-palace" "Chroma systemd service uses MEMPALACE_PALACE_PATH"
assert_not_contains "$service_cust" "__CHROMA_PALACE_PATH__" "Chroma custom systemd service has no residual placeholder"

# ── Test 7: Standalone start-chroma-server.sh palace fallback ─────────────────

start_chroma_content="$(cat "$REPO_DIR/scripts/start-chroma-server.sh")"
assert_contains "$start_chroma_content" 'PALACE_DIR="${MEMPALACE_PALACE_PATH:-${MEMPALACE_DIR}/palace}"' "start-chroma-server.sh respects MEMPALACE_PALACE_PATH"

# ── Test 8: Token derivation equivalence between shell and launcher ───────────

CUSTOM_PALACE_DIR="$TMP_DIR/my_custom_palace"
mkdir -p "$CUSTOM_PALACE_DIR"

token_path_from_shell="$(MEMPALACE_PALACE_PATH="$CUSTOM_PALACE_DIR" mcp_token_path)"

# Run launcher's token computation in isolated subshell
token_path_from_launcher="$(
  export MEMPALACE_PALACE_PATH="$CUSTOM_PALACE_DIR"
  palace="${MEMPALACE_PALACE_PATH:-${HOME}/.mempalace/palace}"
  resolved="$(cd -P "${palace}" && pwd -P)"
  if command -v shasum >/dev/null 2>&1; then
    key="$(printf '%s' "${resolved}" | shasum -a 256 | cut -c1-24)"
  else
    key="$(printf '%s' "${resolved}" | sha256sum | cut -c1-24)"
  fi
  echo "${HOME}/.mempalace/server/${key}/token"
)"

assert_eq "$token_path_from_shell" "$token_path_from_launcher" "Token path matches between mcp_token_path and launcher"

echo "=== Results: $TESTS_PASSED/$TESTS_RUN passed, $TESTS_FAILED failed ==="
if [ "$TESTS_FAILED" -gt 0 ]; then
  exit 1
fi
exit 0
