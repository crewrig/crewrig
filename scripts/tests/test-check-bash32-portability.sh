#!/bin/bash
# test-check-bash32-portability.sh — Regression tests for
# check-bash32-portability.sh (spec 0111).
#
# check-bash32-portability.sh is the CI guard that fails when a governed script
# under scripts/ or hooks/ uses a shell construct the Bash shipped with macOS
# (3.2.57) does not have. This is the parity sibling mandated by the repo
# convention "every check-*.sh has a test-*.sh" (spec 0076 R6).
#
# Cases, one per spec 0111 scenario:
#   a. A reintroduced forbidden construct is rejected, naming file and line
#      (scenario 1, R1/R3).
#   b. The repository as it stands is accepted (scenario 2, R6). This case is
#      also what catches the guard flagging its own source or its own declared
#      set — both live inside or beside the tree it scans.
#   c. A comment naming a forbidden construct is accepted (scenario 3, R4), as
#      is `declare -a`, which is not `declare -A`.
#   d. A line carrying the acknowledged-exception marker is accepted
#      (scenario 4, R10).
#   e. A forbidden construct in a *test* script is rejected on the same terms as
#      in a shipped script (scenario 6, R5).
#   f. Every token in ci/bash32-forbidden.txt is named in Rule 5 of
#      docs/scripting-conventions.md (R2's "one place both the enforcement and
#      the documentation refer to"). This is the doc-to-data link that no other
#      gate covers.
#   g. A declared set with no usable entry fails closed rather than passing
#      vacuously (docs/scripting-conventions.md Rule 4).
#
# Scenario 5 — a corrected suite reports the same verdicts on both shells — is
# not scriptable here: it needs two different Bash binaries. It is discharged by
# the recorded two-shell evidence run on issue #697.
#
# Fixtures are written with `printf '%s\n' 'line' 'line'`, never a heredoc, and
# that is load-bearing rather than stylistic. This file lives under the tree the
# guard scans, and the guard flags a declared token in command position; in a
# heredoc body a fixture line would start with the token and be reported, turning
# case b red on the very change that introduces the gate. In the printf form
# every token sits immediately after a quote, so it is never in command position.
# Self-exempting this file with the acknowledged-exception marker is not the
# fallback: R5 governs test scripts "on the same terms", and R6 requires
# correction rather than exemption.
#
# Usage:
#   bash scripts/tests/test-check-bash32-portability.sh

# -e intentionally omitted: pass/fail counters drive the harness; adding -e
# would abort on the expected non-zero exits from the script under test.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT_UNDER_TEST="$SCRIPT_DIR/check-bash32-portability.sh"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DECLARED_SET="$REPO_ROOT/ci/bash32-forbidden.txt"
CONVENTIONS_DOC="$REPO_ROOT/docs/scripting-conventions.md"

if [ ! -f "$SCRIPT_UNDER_TEST" ]; then
  echo "FATAL: cannot find $SCRIPT_UNDER_TEST" >&2
  exit 2
fi
if [ ! -f "$DECLARED_SET" ]; then
  echo "FATAL: cannot find $DECLARED_SET" >&2
  exit 2
fi

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

pass=0
fail=0

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# mk_fixture <dir> — scaffold a fixture repo carrying the real declared set, so
# the cases below exercise the shipped construct list rather than a stand-in.
mk_fixture() {
  mkdir -p "$1/ci" "$1/scripts/tests"
  cp "$DECLARED_SET" "$1/ci/bash32-forbidden.txt"
}

# run_check <dir> — run the guard with CREWRIG_REPO_DIR set, capturing stdout,
# stderr and exit code into CHECK_EXIT / CHECK_STDOUT / CHECK_STDERR.
run_check() {
  local repo="$1" out_file err_file
  out_file="$(mktemp "$TMP_ROOT/out.XXXXXX")"
  err_file="$(mktemp "$TMP_ROOT/err.XXXXXX")"
  CHECK_EXIT=0
  ( CREWRIG_REPO_DIR="$repo" bash "$SCRIPT_UNDER_TEST" >"$out_file" 2>"$err_file" ) || CHECK_EXIT=$?
  CHECK_STDOUT="$(cat "$out_file")"
  CHECK_STDERR="$(cat "$err_file")"
  rm -f "$out_file" "$err_file"
}

# ok <message> / bad <message> — verdict recorders.
ok() { echo "PASS  $1"; pass=$((pass + 1)); }
bad() { echo "FAIL  $1"; fail=$((fail + 1)); }

# ---------------------------------------------------------------------------
# Case a — A reintroduced forbidden construct is rejected, by file and line.
# ---------------------------------------------------------------------------
{
  repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  mk_fixture "$repo"
  printf '%s\n' \
    '#!/bin/bash' \
    'set -uo pipefail' \
    'dirs=()' \
    'mapfile -t dirs < <(find . -type d)' \
    > "$repo/scripts/offender.sh"

  run_check "$repo"

  if [ "$CHECK_EXIT" -eq 1 ]; then
    ok "case-a: a reintroduced forbidden construct fails the check (exit 1)"
  else
    bad "case-a: expected exit 1, got $CHECK_EXIT (stderr: $CHECK_STDERR)"
  fi

  # R3: the rejection names the offending location by file AND line, not merely
  # that a violation exists. The construct sits on line 4 of the fixture.
  if echo "$CHECK_STDERR" | grep -qF "scripts/offender.sh:4:"; then
    ok "case-a: the rejection names the offender by file and line (R3)"
  else
    bad "case-a: stderr did not name scripts/offender.sh:4 (stderr: $CHECK_STDERR)"
  fi
}

# ---------------------------------------------------------------------------
# Case b — The repository as it stands is accepted (R6), and the guard does not
#          flag its own source or its own declared set.
# ---------------------------------------------------------------------------
{
  run_check "$REPO_ROOT"

  if [ "$CHECK_EXIT" -eq 0 ]; then
    ok "case-b: the repository as it stands passes the check (exit 0)"
  else
    bad "case-b: expected exit 0, got $CHECK_EXIT (stderr: $CHECK_STDERR)"
  fi

  if echo "$CHECK_STDOUT" | grep -qF "no forbidden Bash 4+ construct"; then
    ok "case-b: OK line emitted on stdout"
  else
    bad "case-b: missing OK line (stdout: $CHECK_STDOUT)"
  fi

  # Rule 4: the OK line must surface how much input it actually saw, so a wedge
  # that makes the guard scan nothing cannot read as a pass.
  if echo "$CHECK_STDOUT" | grep -qE 'file\(s\) scanned'; then
    ok "case-b: the OK line surfaces the number of files scanned (Rule 4)"
  else
    bad "case-b: OK line does not report its input size (stdout: $CHECK_STDOUT)"
  fi
}

# ---------------------------------------------------------------------------
# Case c — Prose naming a forbidden construct is accepted (R4).
# ---------------------------------------------------------------------------
{
  repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  mk_fixture "$repo"
  printf '%s\n' \
    '#!/bin/bash' \
    '# `while read` rather than `mapfile` for bash 3.2 compat (macOS default).' \
    '  # an indented full-line comment naming readarray is prose too' \
    'collect_lines  # avoid mapfile here: it is a bash 4 builtin' \
    'declare -a IDX=()' \
    > "$repo/scripts/prose.sh"

  run_check "$repo"

  if [ "$CHECK_EXIT" -eq 0 ]; then
    ok "case-c: comments naming a forbidden construct are not violations (R4)"
  else
    bad "case-c: expected exit 0, got $CHECK_EXIT (stderr: $CHECK_STDERR)"
  fi
}

# ---------------------------------------------------------------------------
# Case d — The acknowledged-exception marker is honoured (R10).
# ---------------------------------------------------------------------------
{
  repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  mk_fixture "$repo"
  printf '%s\n' \
    '#!/bin/bash' \
    'mapfile -t k < f  # acknowledged-exception: this tool ships its own bash 5' \
    > "$repo/scripts/hatch.sh"

  run_check "$repo"

  if [ "$CHECK_EXIT" -eq 0 ]; then
    ok "case-d: an acknowledged-exception line is accepted (R10)"
  else
    bad "case-d: expected exit 0, got $CHECK_EXIT (stderr: $CHECK_STDERR)"
  fi

  # The hatch must be line-scoped, not file-scoped: a second, untagged use in
  # the same file still fails.
  printf '%s\n' \
    '#!/bin/bash' \
    'mapfile -t k < f  # acknowledged-exception: this tool ships its own bash 5' \
    'mapfile -t j < g' \
    > "$repo/scripts/hatch.sh"

  run_check "$repo"

  if [ "$CHECK_EXIT" -eq 1 ] && echo "$CHECK_STDERR" | grep -qF "scripts/hatch.sh:3:"; then
    ok "case-d: the hatch is line-scoped — an untagged use in the same file still fails"
  else
    bad "case-d: expected exit 1 naming line 3, got $CHECK_EXIT (stderr: $CHECK_STDERR)"
  fi
}

# ---------------------------------------------------------------------------
# Case e — A test script is governed on the same terms (R5, scenario 6).
# ---------------------------------------------------------------------------
{
  repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  mk_fixture "$repo"
  printf '%s\n' \
    '#!/bin/bash' \
    'declare -A M=( [k]=v )' \
    > "$repo/scripts/tests/test-offender.sh"

  run_check "$repo"

  if [ "$CHECK_EXIT" -eq 1 ]; then
    ok "case-e: a forbidden construct in a test script fails the check (R5)"
  else
    bad "case-e: expected exit 1, got $CHECK_EXIT (stderr: $CHECK_STDERR)"
  fi

  if echo "$CHECK_STDERR" | grep -qF "scripts/tests/test-offender.sh:2:"; then
    ok "case-e: the rejection names the test script by file and line"
  else
    bad "case-e: stderr did not name scripts/tests/test-offender.sh:2 (stderr: $CHECK_STDERR)"
  fi
}

# ---------------------------------------------------------------------------
# Case f — Declared set and Rule 5 stay in sync (R2).
# ---------------------------------------------------------------------------
{
  # The Rule 5 section only, so a token named under some other rule does not
  # satisfy the requirement by accident.
  rule5="$(awk '/^## Rule 5 /{f=1; next} f && /^## /{exit} f' "$CONVENTIONS_DOC")"

  if [ -n "$rule5" ]; then
    ok "case-f: docs/scripting-conventions.md carries a Rule 5 section (R11)"
  else
    bad "case-f: no '## Rule 5 ' section found in $CONVENTIONS_DOC (R11)"
  fi

  # Walk the declared set with `while read` — no array, so this loop cannot
  # abort on an empty accumulator under bash 3.2 `set -u`.
  missing=""
  checked=0
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    [[ -z "$line" || "$line" == \#* ]] && continue
    kind="${line%%[[:space:]]*}"
    rest="${line#"$kind"}"
    rest="${rest#"${rest%%[![:space:]]*}"}"
    token="${rest%%[[:space:]]*}"
    [ -n "$token" ] || continue
    # A bare flag letter would match almost any prose, so a declare-flag entry
    # is required to appear in its usable form.
    needle="$token"
    if [ "$kind" = "declare-flag" ]; then
      needle="declare -$token"
    fi
    checked=$((checked + 1))
    if ! printf '%s\n' "$rule5" | grep -qF -- "$needle"; then
      missing="${missing:+$missing, }$needle"
    fi
  done < "$DECLARED_SET"

  if [ "$checked" -eq 0 ]; then
    bad "case-f: parsed 0 entries from $DECLARED_SET — the sync case would pass vacuously"
  elif [ -z "$missing" ]; then
    ok "case-f: all $checked declared construct(s) are named in Rule 5 (R2)"
  else
    bad "case-f: declared construct(s) missing from Rule 5 (R2): $missing"
  fi
}

# ---------------------------------------------------------------------------
# Case g — An empty declared set fails closed, not vacuously open (Rule 4).
# ---------------------------------------------------------------------------
{
  repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  mk_fixture "$repo"
  printf '%s\n' '# every line here is a comment, so no construct is declared' \
    > "$repo/ci/bash32-forbidden.txt"
  printf '%s\n' '#!/bin/bash' 'mapfile -t x < f' > "$repo/scripts/offender.sh"

  run_check "$repo"

  if [ "$CHECK_EXIT" -eq 2 ]; then
    ok "case-g: an empty declared set exits 2 rather than passing vacuously"
  else
    bad "case-g: expected exit 2, got $CHECK_EXIT (stderr: $CHECK_STDERR)"
  fi

  # An unrecognised kind is a malformed authority, not something to skip.
  printf '%s\n' 'bogus-kind	mapfile	a kind the guard does not know' \
    > "$repo/ci/bash32-forbidden.txt"

  run_check "$repo"

  if [ "$CHECK_EXIT" -eq 2 ]; then
    ok "case-g: an unknown declared-set kind exits 2"
  else
    bad "case-g: expected exit 2 for an unknown kind, got $CHECK_EXIT (stderr: $CHECK_STDERR)"
  fi
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
total=$((pass + fail))
echo ""
echo "Results: $pass/$total passed"
[ "$fail" -eq 0 ] && exit 0 || exit 1
