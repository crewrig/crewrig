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
#   h. No array expansion in the six suites corrected under R6 is unguarded —
#      the standing half of scenario 5 (R8). See `bare_expansions_in`.
#   i. That detector is itself probed on 13 fixtures in both directions, so a
#      future narrowing of it fails here rather than silently going quiet.
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

# bare_expansions_in <line> — echo the `name[subscript]` of every array expansion
# on the line that would abort under `set -u` when the array is empty, or nothing
# when the line is safe. Used by case h against the corrected suites, and probed
# directly by case i.
#
# It works by CONSUMPTION, not by tallying, and that distinction is the whole
# history of this function. Three successive tally designs each left a hole:
#
#   1. Per line, guarded-vs-bare counts: a guard anywhere on the line hid a bare
#      expansion elsewhere on it.
#   2. Per line with comment lines dropped: fixed a false positive, not the tally.
#   3. Per array name: narrowed *who* could spend the slack without removing it.
#
# The slack is a property of the guard SPELLING. `${A[@]+"${A[@]}"}` contains one
# closed `${A[@]}` and is worth one; `${A[*]:-}` contains no closed form and is
# worth zero — so on `"${A[*]:-} ${A[@]}"` any tally balances while `A` is bare.
# That shape reproduces the very false green this ticket exists to remove:
# `A=(); s="${A[*]:-}"; out=$(printf '%s' "${A[@]}")` prints
# `A[@]: unbound variable` to stderr and still exits 0.
#
# So: count the closed forms `${name[@]}` / `${name[*]}`, then subtract only the
# ones a complete canonical guard `${name[@]+"${name[@]}"}` accounts for. Anything
# left is genuinely bare. `${name[*]:-…}` contributes no closed form, so it needs
# no special case. Matching is done with `grep -oF` on literals built per name, so
# there is no regex to escape and no BSD-versus-GNU divergence to reason about.
#
# Deliberately not matched, all verified safe on an empty array under `set -u` on
# 3.2.57: `${#name[@]}` (length), `${name[@]:1}` (slice), `${!name[@]}` (keys).
bare_expansions_in() {
  _bx_line="$1"
  _bx_out=''
  # Array names on the line, deduplicated. `tr -d` rather than a sed capture:
  # BSD sed reads `\{` as an interval and errors "braces not balanced".
  _bx_names=$(printf '%s\n' "$_bx_line" \
    | grep -oE '\$\{[A-Za-z_][A-Za-z0-9_]*\[' | tr -d '${[' | sort -u)
  for _bx_nm in $_bx_names; do
    for _bx_sub in '@' '*'; do
      # Braced interpolation (`${var}[`) rather than `$var[`: the latter is a
      # literal string being built for `grep -oF`, but shellcheck reads it as an
      # array expansion and raises SC1087 at error level.
      _bx_closed=$(printf '%s\n' "$_bx_line" \
        | grep -oF "\${${_bx_nm}[${_bx_sub}]}" | wc -l | tr -d ' ')
      _bx_wrapped=$(printf '%s\n' "$_bx_line" \
        | grep -oF "\${${_bx_nm}[${_bx_sub}]+\"\${${_bx_nm}[${_bx_sub}]}\"}" \
        | wc -l | tr -d ' ')
      if [ "$_bx_closed" -gt "$_bx_wrapped" ]; then
        _bx_out="${_bx_out}${_bx_nm}[${_bx_sub}] "
      fi
    done
  done
  # Trailing space trimmed without a bashism, so the caller can test -n cleanly.
  printf '%s' "$_bx_out" | sed -e 's/[[:space:]]*$//'
}

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
  # the detector must report something, `safe` when it must report nothing.
  # Written with printf, never a heredoc, for the reason recorded in the header.
  i_rows=$(printf '%s\n' \
    'safe	a complete canonical guard is safe	for p in ${D[@]+"${D[@]}"}; do' \
    'safe	two canonical guards on one line	for p in ${D[@]+"${D[@]}"} ${C[@]+"${C[@]}"}; do' \
    'bare	bare expansion alone	printf "%s" "${D[@]}"' \
    'bare	bare behind a guard on another name	for p in "${D[@]}" ${C[@]+"${C[@]}"}; do' \
    'safe	a default-valued guard is safe	s="${D[*]:-}"' \
    'safe	a default with a literal is safe	s="${D[*]:-(none)}"' \
    'bare	bare masked by :- on ANOTHER name	s="${C[*]:-} ${D[@]}"' \
    'bare	bare masked by :- on the SAME name	s="${D[*]:-} ${D[@]}"' \
    'bare	bare masked by :- on SAME name AND subscript	s="${D[@]:-} ${D[@]}"' \
    'bare	prefix names do not bleed	s="${D[*]:-}" t="${DE[@]}"' \
    'safe	length form is safe	if [ ${#D[@]} -eq 0 ]; then' \
    'safe	slice form is safe	echo "${D[@]:1}"' \
    'safe	key form is safe	echo "${!D[@]}"')

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
  done <<DETECTOR_PROBE
$i_rows
DETECTOR_PROBE

  if [ "$i_total" -ne 13 ]; then
    bad "case-i: expected 13 detector probes, ran $i_total"
  elif [ "$i_fail" -eq 0 ]; then
    ok "case-i: the bare-expansion detector is correct on all 13 probes, both directions"
  fi
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
total=$((pass + fail))
echo ""
echo "Results: $pass/$total passed"
[ "$fail" -eq 0 ] && exit 0 || exit 1
