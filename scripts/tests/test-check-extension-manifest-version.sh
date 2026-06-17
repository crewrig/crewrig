#!/bin/bash
# test-check-extension-manifest-version.sh — Regression test for
# check-extension-manifest-version.sh (spec 0044, R5/R6).
#
# Pins the contract: an extension's package.json version is authoritative;
# extension.json and gemini-extension.json siblings MUST declare the SAME
# version. The guard is STATIC (diff-free) and walks extensions/{core,library}
# from the CWD, so each case builds a temp tree and runs the guard inside it.
#
# Cases:
#   1. all three manifests agree (0.1.0)                       → exit 0
#   2. one sibling diverges (gemini-extension.json at 0.2.0)   → exit 1, offender named
#   3. sibling absent (only package.json + extension.json)     → exit 0 (no divergence)
#   4. package.json missing .version                           → exit 1
#
# Usage:
#   bash scripts/tests/test-check-extension-manifest-version.sh
#
# -e is intentionally omitted: exit codes are asserted via explicit counters.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT_UNDER_TEST="$SCRIPT_DIR/check-extension-manifest-version.sh"

if [ ! -f "$SCRIPT_UNDER_TEST" ]; then
  echo "FATAL: cannot find $SCRIPT_UNDER_TEST" >&2
  exit 2
fi

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

pass=0
fail=0

# build_ext <root-dir> <ext-name> <pkg-ver> <ext-ver|-> <gem-ver|->
#   "-" for a sibling version means: do NOT create that sibling.
build_ext() {
  local root="$1" name="$2" pkgver="$3" extver="$4" gemver="$5"
  local dir="$root/extensions/core/$name"
  mkdir -p "$dir"
  if [ "$pkgver" = "-" ]; then
    printf '{"name":"%s"}\n' "$name" > "$dir/package.json"
  else
    printf '{"name":"%s","version":"%s"}\n' "$name" "$pkgver" > "$dir/package.json"
  fi
  [ "$extver" != "-" ] && printf '{"name":"%s","version":"%s"}\n' "$name" "$extver" > "$dir/extension.json"
  [ "$gemver" != "-" ] && printf '{"name":"%s","version":"%s"}\n' "$name" "$gemver" > "$dir/gemini-extension.json"
}

# run_case <name> <tree-root> <expected-exit> [expected-offender-substring]
run_case() {
  local name="$1" root="$2" expected_exit="$3" offender="${4:-}"
  local out actual_exit=0
  out="$( cd "$root" && bash "$SCRIPT_UNDER_TEST" 2>&1 )" || actual_exit=$?

  local ok=1
  [ "$actual_exit" -eq "$expected_exit" ] || ok=0
  if [ -n "$offender" ] && ! printf '%s' "$out" | grep -q "$offender"; then
    ok=0
  fi

  if [ "$ok" -eq 1 ]; then
    echo "PASS  $name (exit $actual_exit)"
    pass=$((pass + 1))
  else
    echo "FAIL  $name (expected exit $expected_exit${offender:+, offender '$offender'}, got $actual_exit)"
    printf '%s\n' "$out" | sed 's/^/      /'
    fail=$((fail + 1))
  fi
}

# Case 1 — all three agree → exit 0
t1="$(mktemp -d "$TMP_ROOT/t.XXXXXX")"
build_ext "$t1" hello 0.1.0 0.1.0 0.1.0
run_case "Case 1 — all three manifests agree" "$t1" 0

# Case 2 — gemini sibling diverges → exit 1, naming the offender
t2="$(mktemp -d "$TMP_ROOT/t.XXXXXX")"
build_ext "$t2" hello 0.1.0 0.1.0 0.2.0
run_case "Case 2 — divergent gemini-extension.json fails" "$t2" 1 "gemini-extension.json"

# Case 3 — gemini sibling absent, package + extension agree → exit 0
t3="$(mktemp -d "$TMP_ROOT/t.XXXXXX")"
build_ext "$t3" hello 0.1.0 0.1.0 -
run_case "Case 3 — absent sibling is not a divergence" "$t3" 0

# Case 4 — package.json missing .version → exit 1
t4="$(mktemp -d "$TMP_ROOT/t.XXXXXX")"
build_ext "$t4" hello - 0.1.0 0.1.0
run_case "Case 4 — authoritative package.json without version fails" "$t4" 1 "package.json"

echo ""
echo "Results: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
