#!/bin/bash
# test-build-components.sh — Regression tests for canonical_repo URL validation.
#
# Covers the failure surfaced in friction #77: malformed `canonical_repo`
# values (file:// scheme, deeper paths such as /blob/main/...) used to flow
# silently into component frontmatter and break the harness-curator's
# canonical-URL handling downstream. `validate_canonical_repo` in
# build-components.sh now rejects them at build time; this script pins that
# contract.
#
# Each case rewrites a temporary crewrig.config.toml, invokes the bundler,
# and asserts exit code + stderr. The real config is preserved via trap so a
# crashing case never leaves the working tree in a broken state.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="$REPO_DIR/crewrig.config.toml"
BACKUP="$(mktemp -t crewrig.config.bak.XXXXXX)"
cp "$CONFIG" "$BACKUP"

cleanup() { cp "$BACKUP" "$CONFIG"; rm -f "$BACKUP"; }
trap cleanup EXIT

PASS=0
FAIL=0
EXIT=0
STDERR=""

write_config() {
  # Preserve every other config key by starting from the backup and
  # rewriting only the canonical_repo line. Keeps the test robust if
  # crewrig.config.toml gains new keys in the future.
  cp "$BACKUP" "$CONFIG"
  if grep -q '^canonical_repo' "$CONFIG"; then
    awk -v val="$1" '/^canonical_repo/ {print "canonical_repo = \"" val "\""; next} {print}' \
      "$BACKUP" > "$CONFIG"
  else
    printf 'canonical_repo = "%s"\n' "$1" >> "$CONFIG"
  fi
}

run_bundler() {
  # Sets globals EXIT, STDERR. Stdout is silenced — only failure signal matters.
  # The optional first arg lets case (a) use --check (drift-verify only, no
  # write) instead of running the full bundle; cases (b)/(c) want the regular
  # path so the validator's exit-1 short-circuits before any bundle work.
  local errfile
  errfile=$(mktemp)
  EXIT=0
  local extra_arg="${1:-}"
  if [ -n "$extra_arg" ]; then
    bash "$REPO_DIR/scripts/build-components.sh" --target all "$extra_arg" >/dev/null 2>"$errfile" || EXIT=$?
  else
    bash "$REPO_DIR/scripts/build-components.sh" --target all >/dev/null 2>"$errfile" || EXIT=$?
  fi
  STDERR=$(cat "$errfile")
  rm -f "$errfile"
}

report() {
  local name="$1" ok="$2"
  if [ "$ok" = "true" ]; then
    echo "PASS: $name"
    PASS=$((PASS + 1))
  else
    echo "FAIL: $name (exit=$EXIT)"
    printf '%s\n' "$STDERR" | sed 's/^/    stderr: /'
    FAIL=$((FAIL + 1))
  fi
}

# --- Case (a): valid canonical_repo → validator passes, bundler exits 0 ---
# Use --check so we only run the validator + drift verify (fast), not a full
# bundle rebuild. The validator path is exercised identically; --check is
# the closest hot path that doesn't write files.
write_config "https://github.com/crewrig/crewrig"
run_bundler "--check"
ok="true"
[ "$EXIT" -eq 0 ] || ok="false"
report "(a) valid canonical_repo accepted" "$ok"

# --- Case (b): file:// scheme → exit 1, stderr cites "malformed" + the URL ---
BAD_B="file:///tmp/foo"
write_config "$BAD_B"
run_bundler
ok="true"
[ "$EXIT" -eq 1 ] || ok="false"
grep -q "malformed" <<< "$STDERR" || ok="false"
grep -qF "$BAD_B" <<< "$STDERR" || ok="false"
report "(b) file:// scheme rejected" "$ok"

# --- Case (c): /blob/<branch>/<path> → exit 1, stderr cites "malformed" ---
# This is the literal failure surface of friction #77.
BAD_C="https://github.com/crewrig/crewrig/blob/main/foo.md"
write_config "$BAD_C"
run_bundler
ok="true"
[ "$EXIT" -eq 1 ] || ok="false"
grep -q "malformed" <<< "$STDERR" || ok="false"
report "(c) /blob/<branch>/<path> rejected" "$ok"

echo ""
echo "==========================================="
echo "  Result: $PASS passed, $FAIL failed"
echo "==========================================="
[ "$FAIL" -eq 0 ] || exit 1
