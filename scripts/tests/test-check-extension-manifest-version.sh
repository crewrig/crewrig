#!/bin/bash
# test-check-extension-manifest-version.sh — Regression test for
# check-extension-manifest-version.sh (spec 0044, R5/R6, as amended by
# specs/0044-extension-versioning-manifest.delta-01.md).
#
# Pins the contract: an extension's package.json version is authoritative;
# its committed extension.json sibling MUST declare the SAME version.
# gemini-extension.json is NO LONGER an arm of this guard — it is a build
# output, and a committed instance of it is asserted by
# `bash scripts/build-extension.sh --check` instead (0044 delta-01 R8/R9).
# The guard is STATIC (diff-free) and walks extensions/{core,library} from
# the CWD, so each case builds a temp tree and runs the guard inside it.
#
# Cases:
#   1. package.json and extension.json agree (0.1.0)            → exit 0
#   2. extension.json diverges (0.2.0)                          → exit 1, offender named
#   2b. gemini-extension.json diverges, extension.json agrees    → exit 0 (the arm is gone;
#       `bash scripts/build-extension.sh --check` is what catches the committed file)
#   3. extension.json absent, package.json alone                → exit 0 (no divergence)
#   4. package.json missing .version                             → exit 1
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

# Case 1 — package.json and extension.json agree → exit 0
t1="$(mktemp -d "$TMP_ROOT/t.XXXXXX")"
build_ext "$t1" hello 0.1.0 0.1.0 0.1.0
run_case "Case 1 — package.json and extension.json agree" "$t1" 0

# Case 2 — extension.json diverges → exit 1, naming the offender (0044 delta-01
# "A divergent committed extension.json still fails" scenario)
t2="$(mktemp -d "$TMP_ROOT/t.XXXXXX")"
build_ext "$t2" hello 0.1.0 0.2.0 0.1.0
run_case "Case 2 — divergent extension.json fails" "$t2" 1 "extension.json"

# Case 2b — gemini-extension.json diverges, extension.json still agrees → exit 0.
# The arm is gone (0044 delta-01 R8): a divergent gemini-extension.json is no
# longer this guard's concern. `bash scripts/build-extension.sh --check`
# fails the SAME fixture as COMMITTED, because the file may not be committed
# at all — that pairing is what makes this exit-0 safe rather than silent.
t2b="$(mktemp -d "$TMP_ROOT/t.XXXXXX")"
build_ext "$t2b" hello 0.1.0 0.1.0 0.2.0
run_case "Case 2b — divergent gemini-extension.json no longer fails this guard" "$t2b" 0

# Case 3 — extension.json absent, package.json alone → exit 0
t3="$(mktemp -d "$TMP_ROOT/t.XXXXXX")"
build_ext "$t3" hello 0.1.0 - -
run_case "Case 3 — absent extension.json is not a divergence" "$t3" 0

# Case 4 — package.json missing .version → exit 1
t4="$(mktemp -d "$TMP_ROOT/t.XXXXXX")"
build_ext "$t4" hello - 0.1.0 0.1.0
run_case "Case 4 — authoritative package.json without version fails" "$t4" 1 "package.json"

echo ""
echo "Results: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
