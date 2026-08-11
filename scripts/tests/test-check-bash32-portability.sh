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
#   f. Every construct in the declared set is named in Rule 5 of
#      docs/scripting-conventions.md (R2's "one place both the enforcement and
#      the documentation refer to"). This is the doc-to-data link that no other
#      gate covers. Per spec 0120 it no longer parses ci/bash32-forbidden.txt
#      itself: it consumes the report the enforcement returns for the set it
#      actually read (`--list-constructs`), through the `sync_status` helper,
#      which echoes one of `ok:<n>` / `missing:<list>` / `vacuous` / `unaskable`.
#      Three call sites assert that discrimination — the repository (`ok:<n>`
#      with n > 0, cross-checked against the verdict run's own count), a
#      comment-only declared set (`unaskable`), and a set holding a construct
#      absent from Rule 5 (`missing:<list>`).
#   g. A declared set with no usable entry fails closed rather than passing
#      vacuously (docs/scripting-conventions.md Rule 4).
#   h. No array expansion in the six suites corrected under R6 is unguarded —
#      the standing half of scenario 5 (R8). See `bare_expansions_in`.
#   i. That detector is itself probed on 13 fixtures in both directions, so a
#      future narrowing of it fails here rather than silently going quiet.
#   j. Asking the guard what it read neither scans the governed tree nor renders
#      a verdict, and an unrecognised argument is refused rather than falling
#      through to a verdict run (spec 0120 R3).
#   k. Both requests refuse the same declared sets and accept the same ones —
#      case g's five malformed shapes replayed against each, plus a sixth whose
#      malformed row follows two valid ones, plus the converse on a well-formed
#      set (spec 0120 R5). Each refusal is asserted on exit status, stderr AND
#      empty stdout, the last being the scenario's "it reports no construct".
#   l. The comment stripper is probed on 8 fixtures covering quote state, so a
#      regression in comment handling fails here rather than widening or
#      narrowing the phase-2 scan's view of a line (spec 0124 R6).
#
# Cases h, i, and l all pull their fixture rows from .tsv files under
# scripts/tests/fixtures/. Those files live outside the phase-2 scan's tree,
# so they can hold example unguarded expansions without the enforcement
# flagging them.
#
# Scenario 5 — a corrected suite reports the same verdicts on both shells — is
# only partly scriptable here: comparing two shells needs two Bash binaries, and
# that half is discharged by the recorded two-shell evidence run on issue #697.
# The half that CAN be re-proved every run is case h's invariant: a guarded
# expansion cannot abort under `set -u`, so guarding all of them removes the
# class the two-shell run merely samples.
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

# The detector and the comment stripper live in the shared lib, used by both
# this suite and the enforcement's phase-2 scan. Source it here so a single
# definition serves both consumers.
# shellcheck source=../lib/bash32-array-guard.sh
. "$SCRIPT_DIR/lib/bash32-array-guard.sh"

TAB="$(printf '\t')"

# The row shape the guard publishes for `--list-constructs` in its header
# contract: <kind><TAB><token>, both fields drawn from alphabets the guard
# itself validates. Cases j and k assert this shape rather than the rows'
# contents or their order — the contract promises the shape and the row set, and
# explicitly declines to promise order, so an assertion pinned to a literal
# block would consume a guarantee that was never given and would turn red on the
# next legitimate growth of ci/bash32-forbidden.txt (spec 0111 R2's floor).
ROW_SHAPE='^(command|declare-flag)'"$TAB"'[A-Za-z0-9_-]+$'

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

# run_check <dir> [arg…] — run the guard with CREWRIG_REPO_DIR set, capturing
# stdout, stderr and exit code into CHECK_EXIT / CHECK_STDOUT / CHECK_STDERR.
# Any argument after <dir> is forwarded to the guard, which is how the cases
# below reach its `--list-constructs` invocation. Verified on 3.2.57: `"$@"`
# with no remaining positional parameters expands to nothing under `set -u`
# rather than aborting, so every existing zero-argument caller is unaffected.
run_check() {
  local repo="$1" out_file err_file
  shift
  out_file="$(mktemp "$TMP_ROOT/out.XXXXXX")"
  err_file="$(mktemp "$TMP_ROOT/err.XXXXXX")"
  CHECK_EXIT=0
  ( CREWRIG_REPO_DIR="$repo" bash "$SCRIPT_UNDER_TEST" "$@" >"$out_file" 2>"$err_file" ) || CHECK_EXIT=$?
  CHECK_STDOUT="$(cat "$out_file")"
  CHECK_STDERR="$(cat "$err_file")"
  rm -f "$out_file" "$err_file"
}

# ok <message> / bad <message> — verdict recorders.
ok() { echo "PASS  $1"; pass=$((pass + 1)); }
bad() { echo "FAIL  $1"; fail=$((fail + 1)); }

# bare_expansions_in and strip_comments are provided by the shared lib
# (scripts/lib/bash32-array-guard.sh), sourced at the top of this file. The
# detector is defined in exactly one place — the lib — because it is now used
# by BOTH the enforcement scan (phase 2 of check-bash32-portability.sh) and
# this suite. Its design history is recorded at its definition site.

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
# sync_status <repo> — check a repository's declared set against Rule 5, and
# ECHO which of four outcomes it reached rather than calling ok/bad itself.
#
# Echoing a token instead of recording a verdict is what lets a call site assert
# a *failure* outcome — `unaskable`, `missing:` — without incrementing the
# suite's fail counter, so "this must fail" is expressible other than by turning
# the suite red.
#
# It obtains the declared set's contents from the enforcement (spec 0120 R1):
# this suite no longer interprets ci/bash32-forbidden.txt, it reads the rows the
# guard reports for the set it actually parsed. Reads the caller's `rule5`, which
# case f assigns before its first call site.
#
# The four outcomes, in this evaluation order:
sync_status() {
  local repo="$1" missing checked row kind token needle
  run_check "$repo" --list-constructs

  # `unaskable` FIRST, before anything reads the rows. The order is load-bearing
  # rather than stylistic: a guard that never ran leaves the same empty stdout as
  # a guard that ran and reported nothing, so testing the rows first would report
  # every "could not be asked" as "reported no construct" — the confusion R6
  # exists to remove, and the failure mode consuming a *program* has that reading
  # a *file* does not.
  if [ "$CHECK_EXIT" -ne 0 ]; then
    echo "unaskable"
    return 0
  fi

  missing=""
  checked=0
  # Fed by an unquoted here-document rather than `printf … | while read`: the
  # pipeline is a subshell, so `checked` and `missing` would die at the `done`
  # and this helper would report `vacuous` on a healthy declared set. And a
  # `while read` loop rather than the Bash 4 line-reading builtin, because this
  # file is governed by the very guard it tests (R10) and CI runs Bash 5, where
  # that mistake is invisible. Same idiom as cases h and i below.
  while IFS= read -r row || [ -n "$row" ]; do
    [ -n "$row" ] || continue
    kind=$(printf '%s' "$row" | cut -f1)
    token=$(printf '%s' "$row" | cut -f2)
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
  done <<SYNC_ROWS
$CHECK_STDOUT
SYNC_ROWS

  if [ "$checked" -eq 0 ]; then
    # `vacuous` — the anti-vacuity floor case f has carried since spec 0111,
    # preserved verbatim in meaning. It is unreachable through the shipped guard:
    # a declared set holding no construct is already refused with exit 2, which
    # arrives here as `unaskable`. Kept as defence against a future guard that
    # stops refusing it, which is why no fixture below reaches it.
    echo "vacuous"
  elif [ -n "$missing" ]; then
    echo "missing:$missing"
  else
    echo "ok:$checked"
  fi
}

# ---------------------------------------------------------------------------
# Case f — Declared set and Rule 5 stay in sync (R2), with the declared set's
#          contents obtained from the enforcement (spec 0120 R1) and the
#          discrimination R6 demands asserted at three call sites.
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

  # --- Call site 1: the repository as it stands, which must be in sync.
  f_status="$(sync_status "$REPO_ROOT")"
  case "$f_status" in
    ok:[1-9]*)
      ok "case-f: all ${f_status#ok:} declared construct(s) are named in Rule 5 (R2)"
      ;;
    *)
      # `ok:0` lands here too, which is the point: it is what deleting the
      # helper's anti-vacuity floor would produce, and the declared set's size
      # is deliberately not pinned (spec 0111 R2 makes it a floor, not a
      # ceiling), so `n > 0` is the assertion that stays true as the set grows.
      bad "case-f: expected ok:<n> with n greater than 0 from the enforcement's report, got '$f_status' (R2/R6/R7)"
      ;;
  esac

  # --- Call site 1, second assertion: the row count the query reported equals
  # the count the verdict run reports on its own OK line. Both numbers come out
  # of the enforcement — one from its rows, one from its verdict — so this
  # compares the single parser against itself and pins nothing to the declared
  # set's current size. Depending on the OK line's wording is safe here: R4
  # freezes the verdict path byte-for-byte, and case b already greps its sibling
  # `file(s) scanned` field.
  run_check "$REPO_ROOT"
  f_verdict_n="$(printf '%s\n' "$CHECK_STDOUT" \
    | grep -oE '\([0-9]+ declared construct' | grep -oE '[0-9]+' | head -1)"
  f_rows_n="${f_status#ok:}"
  if [ "$f_rows_n" != "$f_status" ] && [ -n "$f_verdict_n" ] \
     && [ "$f_rows_n" = "$f_verdict_n" ]; then
    ok "case-f: the query's row count ($f_rows_n) is the count the verdict reports ($f_verdict_n)"
  else
    bad "case-f: row count '$f_rows_n' and verdict count '$f_verdict_n' disagree (status was '$f_status')"
  fi

  # --- Call site 2: a guard that cannot be asked at all is reported as
  # `unaskable`, not as an empty report (R6). A comment-only declared set is
  # refused by the shipped guard with exit 2 and empty stdout, so no stub is
  # involved: this is R6's reachable branch, reached with case g's own fixture
  # idiom. The fixture carries ci/ only — the query returns before the governed
  # tree is resolved, so there is nothing to scan.
  repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  mkdir -p "$repo/ci"
  printf '%s\n' '# every line here is a comment, so no construct is declared' \
    > "$repo/ci/bash32-forbidden.txt"

  f_status="$(sync_status "$repo")"
  if [ "$f_status" = "unaskable" ]; then
    ok "case-f: a guard that could not be asked is reported as unaskable, not as an empty report (R6)"
  else
    bad "case-f: expected 'unaskable' from a comment-only declared set, got '$f_status' (R6)"
  fi

  # --- Call site 3: a declared construct absent from Rule 5 still fails, and is
  # named in the form Rule 5 is expected to carry it (R7). `coproc` is a valid
  # token by the guard's own alphabet and is genuinely absent from Rule 5.
  repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  mk_fixture "$repo"
  printf '%s\t%s\t%s\n' 'command' 'coproc' 'a valid token deliberately absent from Rule 5' \
    >> "$repo/ci/bash32-forbidden.txt"

  f_status="$(sync_status "$repo")"
  if [ "$f_status" = "missing:coproc" ]; then
    ok "case-f: a declared construct absent from Rule 5 is named as missing (R7)"
  else
    bad "case-f: expected 'missing:coproc' from a set holding an undocumented construct, got '$f_status' (R7)"
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

  # The three shapes below all produced `OK` and exit 0 on a tree holding real
  # violations before iteration 6 — the guard's own authority file delivering the
  # false green the guard exists to eliminate. Each is asserted against a tree
  # that genuinely violates, so a regression cannot pass by finding nothing.
  printf '%s\n' '#!/bin/bash' 'mapfile -t x < f' > "$repo/scripts/offender.sh"
  printf '%s\n' '#!/bin/bash' 'declare -A m=( [a]=1 )' > "$repo/scripts/offender2.sh"

  # A token carrying a regex metacharacter. Tokens are interpolated into an ERE,
  # so `(` built an invalid pattern; grep exited 2 and the old pipeline discarded
  # it, making "could not look" indistinguishable from "found nothing".
  printf '%s\t%s\t%s\n' 'command' '(' 'a token with a metacharacter' \
    > "$repo/ci/bash32-forbidden.txt"
  run_check "$repo"
  if [ "$CHECK_EXIT" -eq 2 ]; then
    ok "case-g: a token with a regex metacharacter exits 2, never OK"
  else
    bad "case-g: metacharacter token gave $CHECK_EXIT, expected 2 (stdout: $CHECK_STDOUT)"
  fi

  # An empty token field. Splitting on generic whitespace slid the reason into the
  # token's place, so the guard scanned for the first word of the prose.
  printf '%s\t%s\t%s\n' 'command' '' 'a reason that used to slide into the token' \
    > "$repo/ci/bash32-forbidden.txt"
  run_check "$repo"
  if [ "$CHECK_EXIT" -eq 2 ]; then
    ok "case-g: an empty token field exits 2 rather than adopting the reason"
  else
    bad "case-g: empty token gave $CHECK_EXIT, expected 2 (stdout: $CHECK_STDOUT)"
  fi

  # A row with no tab at all: the format is tab-separated, and a space-separated
  # row is a malformed authority rather than something to interpret generously.
  printf '%s\n' 'command mapfile a space separated row' \
    > "$repo/ci/bash32-forbidden.txt"
  run_check "$repo"
  if [ "$CHECK_EXIT" -eq 2 ]; then
    ok "case-g: a row with no tab-separated fields exits 2"
  else
    bad "case-g: tabless row gave $CHECK_EXIT, expected 2 (stdout: $CHECK_STDOUT)"
  fi

  # Non-regression on the two tolerated shapes, so the stricter parsing above did
  # not buy its correctness by rejecting valid input.
  printf 'command\tmapfile\ttolerated CRLF\r\n' > "$repo/ci/bash32-forbidden.txt"
  run_check "$repo"
  if [ "$CHECK_EXIT" -eq 1 ]; then
    ok "case-g: a CRLF-terminated row is still accepted and still detects"
  else
    bad "case-g: CRLF row gave $CHECK_EXIT, expected 1 (stderr: $CHECK_STDERR)"
  fi

  printf 'command\tmapfile\tno trailing newline' > "$repo/ci/bash32-forbidden.txt"
  run_check "$repo"
  if [ "$CHECK_EXIT" -eq 1 ]; then
    ok "case-g: a final row without a trailing newline is still read"
  else
    bad "case-g: unterminated row gave $CHECK_EXIT, expected 1 (stderr: $CHECK_STDERR)"
  fi
}

# ---------------------------------------------------------------------------
# Case h — Every array expansion in the suites corrected under R6 stays guarded.
#
# This is the standing half of scenario 5. The two-shell evidence run proves the
# corrected suites report identical verdicts today; nothing re-proves it
# tomorrow, because CI runs Bash 5 where the defect is invisible. What CAN be
# re-proved cheaply is the invariant the correction established: in these six
# suites, no array is expanded without a guard.
#
# Why that invariant is the right proxy. Under `set -u` Bash 3.2 aborts on an
# empty-array expansion where Bash 5 does not. The abort is not reliably visible
# either: these suites run `set -uo pipefail` WITHOUT `-e`, so when the
# expansion sits in a command substitution or subshell only that child dies —
# the suite continues and can exit 0 with cases silently skipped. So neither a
# zero exit status nor a clean-looking summary is evidence the suite ran
# everything, which is exactly how the false green in issue #697 was produced.
# A guarded expansion cannot abort, so guarding every one of them removes the
# class rather than the symptom.
#
# This case also settles a judgement call recorded on the ticket: expansions on
# arrays that provably cannot be empty were guarded too. Uniform guarding is
# only worth its noise if something checks it — this is that something, and it
# is why the uniform choice is an invariant rather than cargo cult.
# ---------------------------------------------------------------------------
{
  # The suites corrected under R6. Scoped deliberately: other suites under
  # scripts/tests/ carry unguarded expansions and are outside spec 0111, whose
  # R8 constrains only the suites changed under R6.
  corrected_suites='test-e2e-runner test-e2e-report test-e2e-runner-delegation
test-setup-org-mcp test-e2e-defaults-toml test-setup-ensure-tier-built'

  # Accumulate into a string, never an array: an empty accumulator array is the
  # very abort this case exists to keep out of the corrected suites, and this
  # file is itself governed.
  unguarded=''
  scanned=0
  for suite in $corrected_suites; do
    suite_path="$REPO_ROOT/scripts/tests/$suite.sh"
    if [ ! -f "$suite_path" ]; then
      bad "case-h: corrected suite not found: scripts/tests/$suite.sh"
      continue
    fi
    scanned=$((scanned + 1))
    # Detection lives in `bare_expansions_in` — see its header for the model and
    # for the three tally designs that preceded it, each of which shipped a false
    # negative. Do not reimplement the decision here: it is probed directly by
    # case i, and a copy of the logic at this call site would drift out from under
    # those probes.
    #
    # Full-line comments are dropped before scanning, for the same reason the
    # guard itself drops them (check-bash32-portability.sh, requirement 4): a
    # comment that *names* an expansion is prose, not use. Without this the scan
    # contradicts the very doctrine this change establishes. Four of the six
    # suites document their own guarding convention in exactly that form — e.g.
    # "`${A[*]:-}` rather than `${A[*]}` because bash 3.2 …" — so a scan that
    # counted them would fail on the suites' own documentation.
    while IFS= read -r ln || [ -n "$ln" ]; do
      [ -n "$ln" ] || continue
      hit="$(bare_expansions_in "$ln")"
      if [ -n "$hit" ]; then
        unguarded="$unguarded  $suite.sh [$hit]: $ln
"
      fi
    done <<PORTABILITY_SCAN
$(grep -nE '\$\{[A-Za-z_][A-Za-z0-9_]*\[[@*]\]' "$suite_path" \
   | grep -vE '^[0-9]+:[[:space:]]*#' || true)
PORTABILITY_SCAN
  done

  # Fail closed: scanning nothing must not read as success (Rule 4).
  if [ "$scanned" -ne 6 ]; then
    bad "case-h: expected 6 corrected suites, scanned $scanned"
  else
    ok "case-h: all 6 suites corrected under R6 are present and scanned"
  fi

  if [ -z "$unguarded" ]; then
    ok "case-h: no unguarded array expansion remains in the corrected suites (R8)"
  else
    bad "case-h: unguarded array expansion(s) survive in the corrected suites:
$unguarded"
  fi
}

# ---------------------------------------------------------------------------
# Case i — The detector case h relies on is itself probed, both directions.
#
# Case h is only as good as `bare_expansions_in`, and that function has been
# found defective three times: once by the author's own mutation test and twice
# by cold review, each time by a reviewer hand-building a line the current design
# missed. Every one of those was a false NEGATIVE — the detector reporting clean
# while a bare expansion sat there — which is the same failure mode as the defect
# this whole change removes.
#
# So the shapes that broke it are fixtures now. A fourth narrowing of the detector
# that reopens any of these holes fails here, in CI, instead of waiting for a
# fourth reviewer to think of the line again.
# ---------------------------------------------------------------------------
{
  # Each row: <expect> <TAB> <description> <TAB> <line>. `expect` is `bare` when
  # the detector must report something, `safe` when it must report nothing. The
  # rows live in the fixture .tsv (see the header), outside the phase-2 scan tree.
  fixture="$SCRIPT_DIR/tests/fixtures/detector-probes.tsv"
  if [ ! -f "$fixture" ]; then
    bad "case-i: fixture missing — $fixture"
  else
    i_fail=0
    i_total=0
    while IFS= read -r row || [ -n "$row" ]; do
      [ -n "$row" ] || continue
      expect=$(printf '%s' "$row" | cut -f1)
      what=$(printf '%s' "$row" | cut -f2)
      line=$(printf '%s' "$row" | cut -f3-)
      got="$(bare_expansions_in "$line")"
      i_total=$((i_total + 1))
      if [ "$expect" = bare ] && [ -z "$got" ]; then
        bad "case-i: detector missed a bare expansion — $what: $line"
        i_fail=$((i_fail + 1))
      elif [ "$expect" = safe ] && [ -n "$got" ]; then
        bad "case-i: detector flagged a safe line [$got] — $what: $line"
        i_fail=$((i_fail + 1))
      fi
    done < "$fixture"

    if [ "$i_total" -ne 13 ]; then
      bad "case-i: expected 13 detector probes, ran $i_total"
    elif [ "$i_fail" -eq 0 ]; then
      ok "case-i: the bare-expansion detector is correct on all 13 probes, both directions"
    fi
  fi
}

# ---------------------------------------------------------------------------
# Case j — Asking the guard what it read neither scans the tree nor renders a
#          verdict (spec 0120 R3).
#
# Every row assertion here is the published shape predicate, never a literal
# block: the guard's contract promises the row shape and the row set, and
# declines to promise row order, so pinning these cases to contents would consume
# a guarantee that was never given and would turn red on the next legitimate
# growth of ci/bash32-forbidden.txt — green at merge, red for a reason nobody
# would connect back to this case.
# ---------------------------------------------------------------------------
{
  # (a) A tree holding a real violation. The verdict would exit 1 here; the query
  # must return its rows and no verdict at all.
  repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  mk_fixture "$repo"
  printf '%s\n' '#!/bin/bash' 'mapfile -t x < f' > "$repo/scripts/offender.sh"

  run_check "$repo" --list-constructs
  j_ill="$(printf '%s\n' "$CHECK_STDOUT" | grep -cvE "$ROW_SHAPE")"
  j_rows="$(printf '%s\n' "$CHECK_STDOUT" | wc -l | tr -d '[:space:]')"

  if [ "$CHECK_EXIT" -eq 0 ] && [ "$j_ill" -eq 0 ] && [ "$j_rows" -gt 0 ]; then
    ok "case-j: the query exits 0 and returns well-shaped rows from a tree the verdict would fail (R3)"
  else
    bad "case-j: query on a violating tree gave exit $CHECK_EXIT, $j_ill ill-shaped of $j_rows row(s) (stdout: $CHECK_STDOUT)"
  fi

  if ! printf '%s\n' "$CHECK_STDOUT" | grep -qE '^(OK|FAILED):'; then
    ok "case-j: the query renders no verdict — neither an OK nor a FAILED line (R3)"
  else
    bad "case-j: the query emitted a verdict line (stdout: $CHECK_STDOUT)"
  fi

  # (b) A tree the verdict refuses to scan at all — ci/ only, no scripts/ and no
  # hooks/. The verdict exits 2 there while the query still answers, which is the
  # direct proof that the query returns before the governed tree is resolved.
  repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  mkdir -p "$repo/ci"
  cp "$DECLARED_SET" "$repo/ci/bash32-forbidden.txt"

  run_check "$repo"
  j_verdict_exit="$CHECK_EXIT"
  run_check "$repo" --list-constructs
  j_ill="$(printf '%s\n' "$CHECK_STDOUT" | grep -cvE "$ROW_SHAPE")"
  j_rows="$(printf '%s\n' "$CHECK_STDOUT" | wc -l | tr -d '[:space:]')"

  if [ "$j_verdict_exit" -eq 2 ] && [ "$CHECK_EXIT" -eq 0 ] \
     && [ "$j_ill" -eq 0 ] && [ "$j_rows" -gt 0 ]; then
    ok "case-j: the query answers on a tree the verdict refuses to scan (R3)"
  else
    bad "case-j: unscannable tree gave verdict exit $j_verdict_exit, query exit $CHECK_EXIT, $j_ill ill-shaped of $j_rows row(s)"
  fi

  # (c) An unrecognised argument is refused rather than falling through to a
  # verdict run, which would scan the tree and reach case f as empty stdout,
  # where it would be misdiagnosed.
  run_check "$repo" --bogus-argument
  if [ "$CHECK_EXIT" -eq 2 ] \
     && printf '%s\n' "$CHECK_STDERR" | grep -qF -- '--bogus-argument' \
     && ! printf '%s\n' "$CHECK_STDOUT" | grep -qE '^OK:'; then
    ok "case-j: an unrecognised argument exits 2 and names itself, with no verdict on stdout"
  else
    bad "case-j: unrecognised argument gave exit $CHECK_EXIT (stdout: $CHECK_STDOUT) (stderr: $CHECK_STDERR)"
  fi
}

# ---------------------------------------------------------------------------
# Case k — Both requests refuse the same declared sets, and accept the same ones
#          (spec 0120 R5), and a refused set leaves no construct reported.
#
# This case asserts the guard's refusal parity only — the *input* side. What the
# synchronisation check does with each outcome is case f's three call sites, not
# this case's business; conflating the two is how "the guard refuses" gets
# written up as "the consumer discriminates".
#
# A refusal is asserted on three observables, not two: the exit status, non-empty
# stderr, and **empty stdout**. The third is spec 0120's own second clause — "a
# malformed row is refused on both requests → And it reports no construct" — and
# it is the only assertion anywhere that a per-row emission would fail. Checking
# it needs a fixture that can leak, which is why the sixth shape below exists;
# on a single-row set the clause is true whatever the guard does.
# ---------------------------------------------------------------------------
{
  repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  mk_fixture "$repo"
  # A genuinely violating tree, so the well-formed leg below cannot pass by
  # finding nothing.
  printf '%s\n' '#!/bin/bash' 'mapfile -t x < f' > "$repo/scripts/offender.sh"

  # Case g's five malformed shapes, written once each and replayed against both
  # requests. Same shapes, same file, deliberately: a set case g proves the
  # verdict refuses is the set this case proves the query refuses too.
  k_sets="$(mktemp -d "$TMP_ROOT/ksets.XXXXXX")"
  printf '%s\n' '# every line here is a comment, so no construct is declared' \
    > "$k_sets/comment-only"
  printf '%s\t%s\t%s\n' 'bogus-kind' 'mapfile' 'a kind the guard does not know' \
    > "$k_sets/unknown-kind"
  printf '%s\t%s\t%s\n' 'command' '(' 'a token with a metacharacter' \
    > "$k_sets/metacharacter-token"
  printf '%s\t%s\t%s\n' 'command' '' 'a reason that used to slide into the token' \
    > "$k_sets/empty-token"
  printf '%s\n' 'command mapfile a space separated row' \
    > "$k_sets/tabless-row"

  # A sixth shape, and the only one of the six that can fail the "reports no
  # construct" clause below: two well-formed rows the parse loop accepts BEFORE
  # it reaches the malformed one. Every other fixture here and in case g is
  # single-row or comment-only, so the guard has nothing accepted to leak and the
  # clause would hold on them however the report were emitted — vacuously.
  # A guard that emitted each row as it validated would leave two rows on stdout
  # here and still exit 2, which satisfies every other assertion in this case.
  printf '%s\t%s\t%s\n' \
    'command' 'mapfile'   'a valid row, accepted before the malformed one is reached' \
    'command' 'readarray' 'a second valid row, so a leak would be two rows deep' \
    'command' ''          'the malformed row: an empty token field, arriving third' \
    > "$k_sets/valid-rows-then-malformed"

  k_fail=0
  k_total=0
  for k_name in comment-only unknown-kind metacharacter-token empty-token \
                tabless-row valid-rows-then-malformed; do
    cp "$k_sets/$k_name" "$repo/ci/bash32-forbidden.txt"
    k_total=$((k_total + 1))
    run_check "$repo"
    k_verdict_exit="$CHECK_EXIT"
    run_check "$repo" --list-constructs
    # `[ -z "$CHECK_STDOUT" ]` is the scenario's second clause — "And it reports
    # no construct" — and it is what makes the guard's accumulate-then-emit
    # placement load-bearing rather than incidental: a report written row by row
    # would leave the rows it had already accepted on stdout ahead of a late
    # refusal. Asserted on the query, which is the request the scenario names.
    if [ "$k_verdict_exit" -ne 2 ] || [ "$CHECK_EXIT" -ne 2 ] \
       || [ -z "$CHECK_STDERR" ] || [ -n "$CHECK_STDOUT" ]; then
      bad "case-k: $k_name — verdict exit $k_verdict_exit, query exit $CHECK_EXIT, query stderr '$CHECK_STDERR', query stdout '$CHECK_STDOUT' (expected 2, 2, non-empty, empty)"
      k_fail=$((k_fail + 1))
    fi
  done

  if [ "$k_total" -ne 6 ]; then
    bad "case-k: expected 6 malformed declared sets, ran $k_total"
  elif [ "$k_fail" -eq 0 ]; then
    ok "case-k: all 6 malformed declared sets are refused with exit 2 by both requests, reporting no construct (R5)"
  fi

  # The converse: a declared set neither request refuses. The verdict renders its
  # verdict — exit 1 on this violating tree — while the query answers with rows,
  # asserted by shape and not by count. Three is the declared set's size today,
  # and pinning to it would couple this case to a file spec 0120 requires to stay
  # independently growable.
  cp "$DECLARED_SET" "$repo/ci/bash32-forbidden.txt"
  run_check "$repo"
  k_verdict_exit="$CHECK_EXIT"
  run_check "$repo" --list-constructs
  k_ill="$(printf '%s\n' "$CHECK_STDOUT" | grep -cvE "$ROW_SHAPE")"
  k_rows="$(printf '%s\n' "$CHECK_STDOUT" | wc -l | tr -d '[:space:]')"

  if [ "$k_verdict_exit" -eq 1 ] && [ "$CHECK_EXIT" -eq 0 ] \
     && [ "$k_ill" -eq 0 ] && [ "$k_rows" -gt 0 ]; then
    ok "case-k: a well-formed declared set is accepted by both requests (R5)"
  else
    bad "case-k: well-formed set gave verdict exit $k_verdict_exit, query exit $CHECK_EXIT, $k_ill ill-shaped of $k_rows row(s)"
  fi
}

# ---------------------------------------------------------------------------
# Case l — The comment stripper is probed on quote-state fixtures (spec 0124 R6).
#
# The phase-2 scan strips comments before it runs the detector, so a wrong call
# on where a comment starts — an unquoted `#` inside quotes, an escaped quote,
# a mid-word `#` — shifts the view of a line and can either hide a bare
# expansion or manufacture one. Case l pins that boundary down.
# ---------------------------------------------------------------------------
{
  fixture="$SCRIPT_DIR/tests/fixtures/strip-comments.tsv"
  if [ ! -f "$fixture" ]; then
    bad "case-l: fixture missing — $fixture"
  else
    l_fail=0
    l_total=0
    while IFS= read -r row || [ -n "$row" ]; do
      [ -n "$row" ] || continue
      expected=$(printf '%s' "$row" | cut -f1)
      what=$(printf '%s' "$row" | cut -f2)
      input=$(printf '%s' "$row" | cut -f3-)
      got="$(strip_comments "$input")"
      # The stripper is pure substring arithmetic and keeps the whitespace that
      # preceded the `#`. That whitespace is irrelevant to the detector's grep,
      # so drop it here to keep the fixture expectations readable.
      got="$(printf '%s' "$got" | sed 's/[[:space:]]*$//')"
      l_total=$((l_total + 1))
      if [ "$got" != "$expected" ]; then
        bad "case-l: strip_comments mismatch — $what: got [$got], want [$expected]"
        l_fail=$((l_fail + 1))
      fi
    done < "$fixture"

    if [ "$l_total" -ne 8 ]; then
      bad "case-l: expected 8 strip-comments probes, ran $l_total"
    elif [ "$l_fail" -eq 0 ]; then
      ok "case-l: the comment stripper is correct on all 8 quote-state probes"
    fi
  fi
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
total=$((pass + fail))
echo ""
echo "Results: $pass/$total passed"
[ "$fail" -eq 0 ] && exit 0 || exit 1
