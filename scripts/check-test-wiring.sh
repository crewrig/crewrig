#!/bin/bash
# check-test-wiring.sh — Fail CI when a test script runs in no CI workflow
# and is not exempted with a reason (spec 0076).
#
# Per spec 0076 (Requirements 1-5), continuous integration MUST fail whenever a
# `scripts/tests/test-*.sh` script is neither executed by any CI workflow nor
# listed in an explicit exemption allowlist with a recorded reason. A test that
# exists but runs nowhere is a silent false-negative — the class of regression
# that once hid undetected for months (issue #530 was found exactly this way).
# This guard makes the set of never-run tests a deliberate, auditable choice.
#
# Wiring detection:
#   A test is WIRED iff the full invocation token `scripts/tests/<name>` appears
#   in a command position of any .github/workflows/*.yml or ci/ci-capabilities.yml.
#   A `#`-commented occurrence (e.g. a disabled line inside a multi-line `run: |`
#   block) does NOT count as wired — the token must appear with no `#` before it
#   on the same line. The full path (never the bare basename) is matched, so a
#   filename mentioned only in prose or a comment is never a false "wired".
#
# Exemption allowlist (ci/test-wiring-exemptions.txt):
#   `<test-name.sh><TAB><human-readable reason>` per line; blank and `#` lines
#   are skipped. The parser mirrors the .crewrig/core-paths.txt style used by
#   check-core-paths.sh (first whitespace field = name, remainder = reason).
#   - An entry with an empty/whitespace-only reason FAILS the check (R3).
#   - An entry naming a test file absent under scripts/tests/ FAILS the check,
#     so stale exemptions cannot silently accumulate (R5).
#
# Usage:
#   bash scripts/check-test-wiring.sh
#
# Override the repository root with CREWRIG_REPO_DIR (used by the self-test
# against temporary fixtures), mirroring the sibling check-*.sh guards.
#
# Exits 0 when every test is wired or exempted-with-reason and the allowlist is
# honest; non-zero (with a per-offender list) otherwise.

set -euo pipefail

REPO_DIR="${CREWRIG_REPO_DIR:-"$(cd "$(dirname "$0")/.." && pwd)"}"
TESTS_DIR="$REPO_DIR/scripts/tests"
EXEMPTIONS="$REPO_DIR/ci/test-wiring-exemptions.txt"
WORKFLOWS_DIR="$REPO_DIR/.github/workflows"
CI_CAPS="$REPO_DIR/ci/ci-capabilities.yml"

if [ ! -d "$TESTS_DIR" ]; then
  echo "Error: tests directory not found: $TESTS_DIR" >&2
  exit 2
fi

# --- CI surfaces scanned for wiring -----------------------------------------
# Every workflow file plus the platform-neutral capability reference. Both are
# authoritative command positions; matching either counts a test as wired.
SURFACES=()
if [ -d "$WORKFLOWS_DIR" ]; then
  for f in "$WORKFLOWS_DIR"/*.yml "$WORKFLOWS_DIR"/*.yaml; do
    # An unmatched glob expands to the literal pattern, which is not a file.
    [ -f "$f" ] && SURFACES+=("$f")
  done
fi
[ -f "$CI_CAPS" ] && SURFACES+=("$CI_CAPS")

# is_wired <token>
# True iff the token appears in a command position (not a comment) of any CI
# surface. A '#' anywhere before the token on the line marks it commented-out;
# a name-character immediately after the token means the token is only a prefix
# of a longer filename (test-foo.sh vs test-foo.sh.bak) and does not count.
is_wired() {
  local token="$1" file line before after
  [ "${#SURFACES[@]}" -eq 0 ] && return 1
  for file in "${SURFACES[@]}"; do
    while IFS= read -r line; do
      before="${line%%"$token"*}"
      case "$before" in *"#"*) continue ;; esac
      after="${line#*"$token"}"
      case "$after" in [A-Za-z0-9._-]*) continue ;; esac
      return 0
    done < <(grep -F -- "$token" "$file" 2>/dev/null || true)
  done
  return 1
}

# --- Parse the exemption allowlist ------------------------------------------
# Parallel arrays of exempted test names and their reasons. `while read` rather
# than `mapfile` for bash 3.2 compat (macOS default), matching check-core-paths.sh.
EX_NAMES=()
EX_REASONS=()
reasonless=()   # R3 offenders — exemption line with no reason
stale=()        # R5 offenders — exemption naming an absent test file

if [ -f "$EXEMPTIONS" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"                       # tolerate CRLF
    [[ -z "$line" || "$line" == \#* ]] && continue
    name="${line%%[[:space:]]*}"               # first whitespace field
    rest="${line#"$name"}"
    reason="${rest#"${rest%%[![:space:]]*}"}"  # ltrim the reason
    reason="${reason%"${reason##*[![:space:]]}"}"  # rtrim the reason
    EX_NAMES+=("$name")
    EX_REASONS+=("$reason")
    if [ -z "$reason" ]; then
      reasonless+=("$name")
    fi
    if [ ! -f "$TESTS_DIR/$name" ]; then
      stale+=("$name")
    fi
  done < "$EXEMPTIONS"
fi

# is_exempt <name> — true iff the name is listed in the allowlist (reason
# validity is enforced separately so a reasonless entry still fails the run).
is_exempt() {
  local want="$1" n
  for n in ${EX_NAMES[@]+"${EX_NAMES[@]}"}; do
    [ "$n" = "$want" ] && return 0
  done
  return 1
}

# --- Classify every test ----------------------------------------------------
orphans=()
wired_count=0
exempt_count=0
for path in "$TESTS_DIR"/test-*.sh; do
  [ -f "$path" ] || continue          # no matches → literal glob, skip
  name="$(basename "$path")"
  if is_wired "scripts/tests/$name"; then
    wired_count=$((wired_count + 1))
  elif is_exempt "$name"; then
    exempt_count=$((exempt_count + 1))
  else
    orphans+=("$name")
  fi
done

# --- Verdict ----------------------------------------------------------------
failed=0

if [ "${#orphans[@]}" -gt 0 ]; then
  failed=1
  echo "FAILED: ${#orphans[@]} test script(s) run in no CI workflow and are not exempted:" >&2
  for n in "${orphans[@]}"; do
    echo "  - scripts/tests/$n" >&2
  done
  echo "" >&2
  echo "Wire each into a CI workflow (a step in the check-components job of" >&2
  echo ".github/workflows/build.yml and ci/ci-capabilities.yml), or add it to" >&2
  echo "ci/test-wiring-exemptions.txt with a reason (spec 0076)." >&2
fi

if [ "${#reasonless[@]}" -gt 0 ]; then
  failed=1
  echo "" >&2
  echo "FAILED: ${#reasonless[@]} exemption entr(y/ies) carry no reason:" >&2
  for n in "${reasonless[@]}"; do
    echo "  - $n" >&2
  done
  echo "Every line in ci/test-wiring-exemptions.txt must be '<name.sh><TAB><reason>' (spec 0076 R3)." >&2
fi

if [ "${#stale[@]}" -gt 0 ]; then
  failed=1
  echo "" >&2
  echo "FAILED: ${#stale[@]} exemption entr(y/ies) name a test that no longer exists:" >&2
  for n in "${stale[@]}"; do
    echo "  - $n" >&2
  done
  echo "Remove the stale exemption from ci/test-wiring-exemptions.txt (spec 0076 R5)." >&2
fi

if [ "$failed" -ne 0 ]; then
  exit 1
fi

echo "OK: all test scripts are wired ($wired_count) or exempted with a reason ($exempt_count); the exemption allowlist is honest."
