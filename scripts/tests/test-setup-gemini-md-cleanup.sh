#!/bin/bash
# test-setup-gemini-md-cleanup.sh — Regression tests for cleanup of superseded
# ~/.gemini/GEMINI.md context file (spec 0061 delta-02, issue #1082).
#
# Hermetic unit tests asserting:
#   (1) Declaration: the antigravity and gemini setup declarations both name
#       ~/.gemini/GEMINI.md as the legacy file and <!-- crewrig-section: as its marker.
#   (2) Functional behavior:
#       - A crewrig-generated GEMINI.md containing `<!-- crewrig-section:` is removed.
#       - A custom user GEMINI.md lacking `<!-- crewrig-section:` is preserved.
#       - Absent GEMINI.md behaves idempotently.
#
# Usage:
#   bash scripts/tests/test-setup-gemini-md-cleanup.sh

set -uo pipefail

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

pass=0
fail=0
ok()  { echo "  ok: $1"; pass=$((pass + 1)); }
bad() { echo "  FAIL: $1" >&2; fail=$((fail + 1)); }

echo "1. Declaration assertions (spec 0256 requirement 9, PR D1)"

# Retargeted from a grep of the two setup scripts' text to a read of the TypeScript setup
# DECLARATION (scripts/tests/lib/print-setup-declarations.ts): the setup declares the legacy
# context file it removes (`legacy.gemini-md`) and the marker that identifies a CrewRig-generated
# one (`legacy.marker`). Pin against the unchanged shell while it exists: the setup-golden cells
# gemini/legacy-gemini-md-marker and gemini/legacy-gemini-md-no-marker (same for antigravity's
# cleanup behaviour: antigravity/legacy-gemini-md-with-marker and -without-marker, which drive the
# real script end to end). Vacuity guard: an empty or unreadable
# declaration, or an absent fact, fails the case.
PRINT_DECL="$REPO_DIR/scripts/tests/lib/print-setup-declarations.ts"

for cli in antigravity gemini; do
  decl="$(node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON "$PRINT_DECL" "$cli" 2>/dev/null)"
  if [ -z "$decl" ]; then
    bad "$cli: the setup declaration printed nothing (vacuity guard)"
    continue
  fi
  legacy_file="$(printf '%s\n' "$decl" | grep '^legacy\.gemini-md=' | cut -d= -f2-)"
  legacy_marker="$(printf '%s\n' "$decl" | grep '^legacy\.marker=' | cut -d= -f2-)"
  if [ "$legacy_file" = "<HOME>/.gemini/GEMINI.md" ] && [ "$legacy_marker" = "<!-- crewrig-section:" ]; then
    ok "$cli declares the legacy GEMINI.md crewrig-section check and removal"
  else
    bad "$cli declaration lacks the legacy GEMINI.md cleanup (file='$legacy_file' marker='$legacy_marker')"
  fi
done

echo ""
echo "2. Functional cleanup assertions (the real TypeScript entries, spec 0256 requirement 9, PR D2)"

# Retargeted from a re-implemented `run_cleanup_snippet` (a copy of the scripts' two-line cleanup,
# which could drift from the scripts without this suite noticing) to RUNNING the real step: the
# TypeScript entries of the Gemini and Antigravity setups run in a sandboxed HOME with a seeded
# ~/.gemini/GEMINI.md, and the file is asserted after the run (scripts/tests/
# setup-retarget-entry-behaviour.test.ts, group "legacy GEMINI.md cleanup": case A marker -> deleted,
# case B no marker -> kept, case C absent -> clean run and none created, for both CLIs; each case
# first asserts status 0 and that the setup's own context file landed, the vacuity guard).
# Pin against the unchanged shell while it exists: the setup-golden cells gemini/legacy-gemini-md-marker,
# gemini/legacy-gemini-md-no-marker, antigravity/legacy-gemini-md-with-marker and
# antigravity/legacy-gemini-md-without-marker, which run the real shell script and the TypeScript
# entry against the same fixtures. The sandbox stubs target Linux (pipx layout, systemd): elsewhere
# the group is skipped here and runs in CI and in the Linux container.
TS_TEST="$REPO_DIR/scripts/tests/setup-retarget-entry-behaviour.test.ts"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# run_ts_group <group name> — run one describe group and report each subtest by name.
run_ts_group() {
  local group="$1" log="$TMP_DIR/group.log" line n=0
  if [ "$(uname -s)" != "Linux" ] || ! command -v jq >/dev/null 2>&1; then
    echo "  skip: '$group' needs the Linux setup sandbox and jq (runs in CI)"
    return 0
  fi
  node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --test-name-pattern="$group" "$TS_TEST" >"$log" 2>&1
  while IFS= read -r line; do
    case "$line" in
      "  ✔ "*) line="${line#  ✔ }"; ok "${line% (*ms)}"; n=$((n + 1)) ;;
      "  ✖ "*) line="${line#  ✖ }"; bad "${line% (*ms)}"; n=$((n + 1)) ;;
    esac
  done < "$log"
  [ "$n" -gt 0 ] || bad "'$group' ran no case (vacuity guard): $(tail -3 "$log")"
}

run_ts_group "legacy GEMINI.md cleanup"

echo ""
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
