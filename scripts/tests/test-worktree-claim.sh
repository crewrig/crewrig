#!/bin/bash
# test-worktree-claim.sh — Regression tests for worktree-claim.sh (spec 0114,
# issue #736).
#
# Every case runs against a self-contained fixture repository under `mktemp -d`,
# with its own main checkout and its own linked worktree. Nothing here reads or
# writes the repository the suite ships in. That is not politeness: cases 9 and
# 13 run `git clean -fdx` and `git reset --hard`, which are the exact operations
# spec 0114 exists to contain, and a suite that ran them against its own checkout
# would be the incident it tests for.
#
# ---------------------------------------------------------------------------
# Fixture layout is load-bearing, not incidental
# ---------------------------------------------------------------------------
#   $TMP_ROOT/<case>/real/repo                     main checkout
#   $TMP_ROOT/<case>/real/repo/.worktrees/736      linked worktree (the subject)
#   $TMP_ROOT/<case>/link -> $TMP_ROOT/<case>/real symlink, for case 12 only
#
# The worktree MUST sit under a `.worktrees/` path component. The four mutating
# subcommands (`run`, `take`, `release`, `takeover`) refuse with exit 1 when the
# toplevel is not under one, so a fixture that puts the worktree anywhere else
# fails every case for a reason that has nothing to do with the behaviour under
# test.
#
# The fixture commits a `.gitignore` carrying `.worktrees/`, so its main checkout
# stays clean while holding the worktree inside itself.
#
# That is a FIXTURE-LOCAL choice and NOT a mirror of this repository — an earlier
# revision of this header claimed it was, and the resemblance runs the opposite
# way. Measured at 4bb8221, in the repository's MAIN checkout: `git check-ignore
# .worktrees/` exits 1, the pattern appears nowhere in the repository's
# `.gitignore`, and `git status` there reports `?? .worktrees/`. The main checkout
# is named rather than "here" because the last of the three is vacuous read from
# inside a linked worktree — no `.worktrees/` directory exists under one — so a
# reader running the command from the wrong place would find the claim false for a
# reason that has nothing to do with the ignore. On the one property the claim
# cited — a main checkout that stays clean while holding its worktrees — this
# repository behaves the other way round.
#
# No assertion in this suite rests on the ignore either way. Verified rather than
# assumed: swapping the fixture's pattern for an unrelated one and re-running left
# the suite at 21 passed, 0 failed at 4bb8221 — a full pass, every case — because
# nothing here reads the MAIN checkout's status; the clean-tree gate runs against
# the worktree's own toplevel. The figure is pinned to a commit because it counts
# CASES and the suite grows: an earlier revision of this header carried `15/15`
# from a run six cases earlier, and a stale full-pass figure still reads as a full
# pass, so nothing about it looked wrong. The ignore is fixture hygiene, kept so a
# human debugging a fixture by hand is not met with phantom dirt. Anyone adding a
# case that DOES read the main checkout's status must re-derive this rather than
# inherit it.
#
# ---------------------------------------------------------------------------
# Case 12 and the symlink: why the fixture builds one by hand
# ---------------------------------------------------------------------------
# Case 12 asserts the claim root is byte-identical across four invocation cwds.
# It discriminates only because `git rev-parse --git-common-dir` answers in two
# different shapes, measured on git 2.55.0:
#
#   cwd = main checkout root      -> `.git`            (RELATIVE)
#   cwd = main checkout subdir    -> `../.git`         (RELATIVE)
#   cwd = worktree root or subdir -> `/abs/…/repo/.git` (ABSOLUTE, physical)
#
# The script absolutizes the relative form with `cd … && pwd -P`. Bash's `pwd` is
# LOGICAL — it echoes `$PWD` — so with a bare `pwd` the main-checkout arms inherit
# whatever spelling the caller's cwd had, while the worktree arms get the physical
# path git recorded. Two strings for one directory.
#
# On macOS that difference appears by accident: `mktemp -d` returns a path under
# `/var/folders/…` and `/var` is a symlink to `/private/var`, so the two arms
# already disagree. On `ubuntu-latest` `mktemp -d` returns `/tmp/tmp.XXXX` with no
# symlink anywhere in it, logical and physical `pwd` return the same string, and
# the case would pass whether or not the defect is present — green on the runner
# that matters, for a reason that has nothing to do with the assertion.
#
# So the fixture creates its OWN symlink and drives the two main-checkout arms
# through it. The discrimination is then a property of the fixture, identical on
# every platform, rather than a property of the platform's temp directory.
#
# Falsification recipe — re-run it after ANY edit to this case or to the script's
# claim-root resolution:
#
#   d="$(mktemp -d)"; mkdir -p "$d/scripts/tests"
#   sed 's/pwd -P/pwd/g' scripts/worktree-claim.sh > "$d/scripts/worktree-claim.sh"
#   cp scripts/tests/test-worktree-claim.sh "$d/scripts/tests/"
#   bash "$d/scripts/tests/test-worktree-claim.sh"; echo "rc=$?"
#
# Case 12 MUST fail there. If it passes, the case has stopped discriminating and
# is decoration — fix the fixture before trusting the green.
#
# ---------------------------------------------------------------------------
# Cases 17-20 and the two values this script consumes as arithmetic
# ---------------------------------------------------------------------------
# `--stale-after` (from the caller) and `since_epoch` (off disk) both reach a
# `$(( … ))`. Both were once validated as DIGITS, which is a weaker property than
# "evaluates as arithmetic", and the gap between the two admitted exactly two
# shapes:
#
#   LEADING ZERO. `$(( 08 ))` is a base error, not eight. Bash aborts with a raw
#   diagnostic naming the script's path and line, so the caller is handed the
#   script's internals instead of the script's own message.
#
#   TOO WIDE. `$(( … ))` is 64-bit and WRAPS SILENTLY. `--stale-after
#   200000000000000000` multiplies to a NEGATIVE threshold, every claim then
#   compares as stale, and the flag hands out the claim its caller asked it to
#   protect — measured against 5022270, the last revision carrying the defect:
#   rc=0, `Took over '736' from 'alice'`. The same wrap on
#   `since_epoch` runs the other way: a negative age compares as "not stale"
#   forever, and no agent can ever take the claim over. Requirement 8 inverted.
#
# WHY VALIDATION MUST PRECEDE EVALUATION, AND NOT MERELY ACCOMPANY IT. A base
# error in `$(( … ))` is a FATAL EXPANSION ERROR: a non-interactive bash exits on
# the spot, and `|| fallback` does NOT catch it — measured on bash 5.3.15 and on
# stock 3.2.57. So there is no "evaluate, then recover" design available at all;
# the only place a bad value can be caught is before the expansion. The overflow
# side reaches the same conclusion from the other direction: a numeric bound is
# itself arithmetic, so it inherits the very limits it is trying to police. `[
# "$STALE_AFTER" -gt 999999999 ]` cannot parse a 21-digit operand — bash reports
# "integer expression expected", the condition reads FALSE, and the value it was
# meant to stop sails through. `${#…}` is the only test that is not arithmetic.
# That is why the fix bounds the width textually, and cases 17-20 are built to
# fail any design that discovers the problem later than that.
#
# THE MUTATION MATRIX. Each row is a plausible alternative fix, each must turn the
# named case red, and each was RUN — not reasoned about. Assertions marked
# "coupled" are reachable only together with the exit code on that path and are
# not claimed to be independently proven.
#
#   mutant                          turns red                     proves
#   ------------------------------  ----------------------------  ------------------
#   the whole fix reverted          17, 18, 19, 20 (all at rc)    the defect itself
#   leading zero -> default (30)    17 at `…-seconds: 480`        the VALUE, not rc
#   abort contained in a subshell   17 at want_no_shell_error     the caller never
#     and retried in base 10                                      sees bash's guts
#   claim state written before      17 at `holder: alice`         a refusal mutates
#     the staleness verdict           (and case 8, same rule)     nothing
#   numeric bound AFTER the multiply 18 at 307445734561825861     ordering
#   numeric bound avoiding the      18 at 999999999999999999999   a comparison is
#     multiply (`[ … -gt … ]`)                                    arithmetic too
#   since_epoch fails closed        19, 20, 21 at rc              R8's disposition
#     — at ALL THREE `AGE_SECONDS=""`                             (three sites: see
#     sites, not the zero arm alone                               the note below)
#   since_epoch abort tolerated     19 at want_no_shell_error     ditto, quietly
#   since_epoch width guard dropped 20 at rc                      the plausible wrap
#   since_epoch zero arm dropped    19 at rc                      the base error
#   skew band reverted              21 at the skew arm's VALUE    the R8 deadlock
#                                     AND the now+900 and
#                                     18-digit arms' rc
#   clamp dropped, band kept        21 at the skew arm's value,   the clamp alone
#                                     and there ALONE
#   ANY negative age -> corrupt     21 at the now+300 arm's rc    a skewed fresh
#                                                                 claim stays safe
#   tolerance from `--stale-after`  21 at the now+900 arm's rc    it is a constant
#   corrupt iff >1 year ahead       21 at the now+900 arm's rc    the band's size
#   absurd age floored to zero      21 at the 18-digit arm's rc   the extreme
#   value-flag guard dropped        22 at the DIAGNOSTIC,         the MESSAGE, not
#     (literally f8bd54b, the last     never at rc                the code — rc is
#     revision without it)                                        1 on both sides
#
# Recipe: copy `scripts/worktree-claim.sh` and this file into a `mktemp -d` that
# mirrors `scripts/tests/`, apply one mutation to the COPY, run the copied suite.
# Nothing here mutates the checkout. Full verbatim output is recorded on the
# ticket; re-run the matrix after any edit to the validation block or to
# `cmd_takeover`'s `since_epoch` handling.
#
# A ROW CAN DIE WITHOUT ANYONE TOUCHING IT, AND A DEAD ROW IS GREEN. One row here
# — `since_epoch width guard dropped` — stopped reproducing at the VERY NEXT COMMIT
# after the one that introduced it. Written at 30fb24b, where it still reddened case
# 20; dead at bcc4e65, which added the clock-skew band, and dead at every commit
# since until case 20 was rewritten. The mutant's wrapped value began falling out
# through the band's CORRUPT arm, which grants the takeover just as the width guard
# does, so the mutation left the suite fully green while the row went on asserting
# the opposite. Nothing edited that row, or case 20, or the guard it covers. A LATER
# fix reached the same verdict by a second path, and the assertion could not tell
# the paths apart. Case 20 now uses a value that second path cannot reach (see the
# case, which carries the run at each of those three revisions). Every row above was
# re-run at c48aa6c, the commit that restored it, and every row OTHER than that one
# still turns its named case red at its named assertion.
#
# Two things follow for anyone re-running this. Re-running is not a formality — it
# is the only thing that detects this class of decay, because a row that has
# stopped discriminating reports as a pass, and passes are not read. And a row
# counts as re-run only if the MUTATION IS CONFIRMED TO HAVE APPLIED: a
# substitution that silently matched nothing produces exactly the same all-green
# output as a dead row. Diff the mutated copy against the original before believing
# what its run reports.
#
# A ROW CAN ALSO OVERSTATE WHAT THE RUN SEPARATES, WHICH IS THE SAME DEFECT WEARING
# THE OPPOSITE FACE. A row is checked by its COLOUR — the named case went red — but
# what it asserts sits in the `proves` column, and the two come apart without the
# row ever going green. Two rows here had. `skew band reverted` and `clamp dropped,
# band kept` both stopped case 21 at the same assertion, the skew arm's
# `held-for-seconds: 0`, because the case returned at its first failed assertion and
# the arms that tell the two mutants apart ran only after it. Reverting the band
# destroys the corrupt disposition as well as the clamp — the deadlock its `proves`
# column names — and the run never observed that half. The column was reporting a
# mechanism the suite had not checked. Measured at 4bb8221, the commit that made
# case 21 run every arm: before it, both mutants printed one identical failure;
# after, `skew band reverted` reddens all three arms and `clamp dropped, band kept`
# reddens the skew arm alone.
#
# SO A ROW'S FINGERPRINT IS (case, failing assertion) — AND A SHARED FINGERPRINT IS
# A QUESTION, NOT AUTOMATICALLY A DEFECT. `tolerance from --stale-after` and
# `corrupt iff >1 year ahead` share one too: both die at the now+900 arm's rc and
# nowhere else. Both are sound, because neither mutation's damage contains the
# other's and each dies for exactly the reason its column names. The defect is the
# SUBSET case — one mutant's damage strictly containing another's while both stop at
# the same assertion, so the containing row's extra claim goes unverified. The remedy
# is not to reword the column but to let the case run far enough to observe the
# difference, which is why case 21's arms are independent and all three execute.
#
# Two habits for a new row, then. Name the assertion, then ask what the mutant
# breaks BEYOND it: if that extra damage is what the `proves` column is really
# claiming, the case has to reach it. And when a mutation has more than one
# application SITE, the row names the count — `since_epoch fails closed` has three,
# and applying it to the zero arm alone reddens case 19 ALONE, leaving cases 20 and
# 21 green, which reads exactly like a full application of a narrower row. Measured
# at 4bb8221: all three sites, 18 passed and 3 failed; the zero arm alone, 20 passed
# and 1 failed.
#
# ---------------------------------------------------------------------------
# Three rules that are load-bearing
# ---------------------------------------------------------------------------
# 1. EXIT CODES ARE CAPTURED DIRECTLY, NEVER THROUGH A PIPE. `bash x.sh | tee`
#    yields `tee`'s status, not the script's, and this repository has shipped that
#    defect before. `run_claim` redirects to files and reads `$?` off the command
#    itself.
#
# 2. BYTE-IDENTITY IS ASSERTED WITH `cmp`, AGAINST A COPY HELD OUTSIDE THE
#    WORKTREE. Cases 8 and 13 claim an uncommitted file survives an operation; a
#    copy kept inside the worktree would be destroyed by the same operation, and
#    the comparison would then be of two equally-destroyed files.
#
# 3. EVERY MEASUREMENT BELOW NAMES THE COMMIT IT WAS TAKEN AT, AND NONE IS
#    LABELLED `head`. This rule is the residue of three consecutive review rounds
#    that each found the same defect in this file: a claim that was TRUE WHEN
#    WRITTEN, went false as later commits landed, and was touched by nobody in
#    between. Nothing in CI reads a comment, so there is no signal when one rots —
#    the only detector is a human re-deriving the figure, and a plausible figure
#    never prompts anyone to. A figure pinned to a commit cannot go false; it goes
#    HISTORICAL, and a reader who wants today's value can see that it has to be
#    taken rather than read. `head` is the opposite: it re-points on every commit,
#    so the label keeps asserting that a measurement taken at some earlier revision
#    describes the current one.
#
#    Where a number carried nothing an anchor could not — a case number, a
#    subcommand, an assertion string, an arm's name — it was replaced by the anchor
#    instead of pinned, because an anchor does not go stale at all. Counts of CASES
#    are the specific trap: the suite grows, `N/N` still reads as a full pass, and
#    a stale full pass looks exactly like a fresh one. A figure that DOES come from
#    a constant in `worktree-claim.sh` names it, so the derivation is re-runnable
#    rather than remembered: 1800 is `STALE_DEFAULT_MINUTES` (30) x 60, and the
#    nine-digit ceiling on `--stale-after` is `STALE_MAX_DIGITS`. 480 is NOT one of
#    them and cannot be made one — it is case 17's own flag input `08` times the
#    bare `60` in `STALE_SECONDS="$(( STALE_AFTER * 60 ))"`, and the script defines
#    no seconds-per-minute constant to name. A figure with no constant behind it
#    spells out its whole derivation instead, which is what case 17's block does.
#
#    A DERIVED DISTANCE IS WRITTEN AS THE COMMAND THAT DERIVES IT, NOT AS A WORD.
#    This clause is younger than the rest of the rule and was paid for: f8bd54b —
#    the commit whose whole purpose was pinning the measurements above — introduced
#    a fresh wrong one, labelling bb844ab "four commits on" in case 20's ledger
#    where `git rev-list --count bcc4e65..bb844ab` answers 1. The arithmetic was
#    not the failure. Four was a REAL measurement — `git rev-list --count
#    bb844ab..4bb8221` = 4, the distance to head as that commit was being written,
#    and its message says exactly that — written into a row whose anchor is the row
#    above it. A word carries its value but not its endpoints, so it survives being
#    moved somewhere the value is wrong; a command carries both and cannot. Writing
#    a new figure is precisely the act that produces rotted ones, so a pass that
#    removes them can add one.
#
#    AND A REFERENCE OUT OF THIS FILE NAMES THE ROUND THAT ISSUED IT. A finding
#    id is as anchorless as a distance: `[REVIEW F2]` carries WHICH finding but
#    not WHOSE round, and PR #773 ran five REVIEW rounds each numbering its own
#    findings from F1. Cases 17-20 answer iteration 1's F2 and case 22 answers
#    iteration 5's, so the bare form spelled two unrelated findings identically —
#    which is why every case label reads `[REVIEW iteration <N>, F<M>]`.
#
# Bash 3.2-portable per spec 0111: no associative arrays, no Bash 4 builtins.
#
# Usage:
#   bash scripts/tests/test-worktree-claim.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT_UNDER_TEST="$SCRIPT_DIR/worktree-claim.sh"

if [ ! -f "$SCRIPT_UNDER_TEST" ]; then
  echo "FATAL: cannot find $SCRIPT_UNDER_TEST" >&2
  exit 2
fi

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

# The ticket id is the worktree directory's basename; the script derives it that
# way for the mutating subcommands.
TICKET="736"

pass=0
fail=0

# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------

record_pass() {
  echo "PASS  $1"
  pass=$((pass + 1))
}

# record_fail <case> <detail>
record_fail() {
  echo "FAIL  $1"
  echo "      $2"
  [ -n "${OUT:-}" ] && echo "      stdout: $OUT"
  [ -n "${ERR:-}" ] && echo "      stderr: $ERR"
  fail=$((fail + 1))
}

# ---------------------------------------------------------------------------
# Fixture construction
# ---------------------------------------------------------------------------

# new_fixture <name>
# Build $TMP_ROOT/<name>/real/repo with one seed commit, a `.gitignore` holding
# `.worktrees/`, a tracked `sub/` directory, and a linked worktree at
# real/repo/.worktrees/736. Also drop the `link -> real` symlink case 12 needs.
new_fixture() {
  local name="$1"
  local root="$TMP_ROOT/$name"
  local repo="$root/real/repo"

  mkdir -p "$root/real"
  ln -s "$root/real" "$root/link"

  git init -q "$repo"
  git -C "$repo" config user.email "test@example.com"
  git -C "$repo" config user.name "Test"
  git -C "$repo" config commit.gpgsign false
  git -C "$repo" symbolic-ref HEAD refs/heads/main

  printf '.worktrees/\n' > "$repo/.gitignore"
  printf 'seed\n' > "$repo/tracked.txt"
  mkdir -p "$repo/sub"
  printf 'x\n' > "$repo/sub/x.txt"
  git -C "$repo" add -A
  git -C "$repo" commit -q -m "fixture seed"

  git -C "$repo" worktree add -q -b "wt-$name" "$repo/.worktrees/$TICKET" >/dev/null 2>&1
}

fx_main()  { echo "$TMP_ROOT/$1/real/repo"; }
fx_wt()    { echo "$TMP_ROOT/$1/real/repo/.worktrees/$TICKET"; }
fx_link()  { echo "$TMP_ROOT/$1/link/repo"; }

# The claim root, computed from the FIXTURE LAYOUT rather than read back out of
# the script. An assertion that asked the script where it put the claim and then
# checked it was there would hold for any answer the script gave.
fx_claim_root() { echo "$(cd "$TMP_ROOT/$1/real/repo/.git" && pwd -P)/crewrig/worktree-claims"; }
fx_claim_dir()  { echo "$(fx_claim_root "$1")/$TICKET"; }
fx_ledger()     { echo "$(fx_claim_root "$1")/$TICKET.log"; }

# ---------------------------------------------------------------------------
# Invocation
# ---------------------------------------------------------------------------

# run_claim <cwd> <args…>
# Run the script under test from <cwd>. Sets RC, OUT, ERR. The exit status is
# read off the command itself — never off a pipeline; see the header.
RC=0
OUT=""
ERR=""
run_claim() {
  local cwd="$1"
  shift
  RC=0
  ( cd "$cwd" && bash "$SCRIPT_UNDER_TEST" "$@" ) \
    > "$TMP_ROOT/.stdout" 2> "$TMP_ROOT/.stderr" || RC=$?
  OUT="$(cat "$TMP_ROOT/.stdout")"
  ERR="$(cat "$TMP_ROOT/.stderr")"
}

# run_claim_env <cwd> <repo-dir> <args…>
# As run_claim, with CREWRIG_REPO_DIR set — the documented override the suite
# would otherwise leave entirely unexercised.
run_claim_env() {
  local cwd="$1" repo="$2"
  shift 2
  RC=0
  ( cd "$cwd" && CREWRIG_REPO_DIR="$repo" bash "$SCRIPT_UNDER_TEST" "$@" ) \
    > "$TMP_ROOT/.stdout" 2> "$TMP_ROOT/.stderr" || RC=$?
  OUT="$(cat "$TMP_ROOT/.stdout")"
  ERR="$(cat "$TMP_ROOT/.stderr")"
}

# ---------------------------------------------------------------------------
# Assertions — each returns 0 on success, 1 on failure, and records nothing.
# A case records exactly one PASS or FAIL, so a partial failure cannot read as
# a partial pass.
# ---------------------------------------------------------------------------

WHY=""

want_rc() {
  if [ "$RC" != "$1" ]; then
    WHY="expected exit $1, got $RC"
    return 1
  fi
  return 0
}

# want_out <substring> — stdout must carry it
want_out() {
  case "$OUT" in
    *"$1"*) return 0 ;;
  esac
  WHY="stdout does not carry '$1'"
  return 1
}

# want_any <substring> — stdout or stderr must carry it
want_any() {
  case "$OUT$ERR" in
    *"$1"*) return 0 ;;
  esac
  WHY="neither stdout nor stderr carries '$1'"
  return 1
}

# want_no_line <exact line> — stdout must not carry that line exactly
want_no_line() {
  if printf '%s\n' "$OUT" | grep -qxF -- "$1"; then
    WHY="stdout carries the line '$1', which it must not"
    return 1
  fi
  return 0
}

# want_no_shell_error — stderr must carry no RAW shell diagnostic.
#
# Matched on the script's own file name rather than on the message, because bash
# prefixes a runtime error with `<path>: line <n>: ` and TRANSLATES the text after
# it. The same abort reads `value too great for base` under LC_ALL=C and `valeur
# trop grande pour la base` under the fr_FR locale a developer here may well have
# set; the path prefix is in both. The script's own diagnostics never name their
# own file (they open with `Error: `), so this cannot fire on a legitimate
# refusal — verified by grepping every `>&2` writer in the script.
want_no_shell_error() {
  case "$ERR" in
    *"worktree-claim.sh:"*)
      WHY="stderr carries a raw shell error naming the script: $ERR"
      return 1
      ;;
  esac
  return 0
}

want_dir() {
  if [ ! -d "$1" ]; then
    WHY="expected directory to exist: $1"
    return 1
  fi
  return 0
}

want_no_dir() {
  if [ -d "$1" ]; then
    WHY="expected directory NOT to exist: $1"
    return 1
  fi
  return 0
}

want_no_file() {
  if [ -e "$1" ]; then
    WHY="expected path NOT to exist: $1"
    return 1
  fi
  return 0
}

# want_same <file-a> <file-b>
want_same() {
  if ! cmp -s "$1" "$2"; then
    WHY="files differ (expected byte-identical): $1 vs $2"
    return 1
  fi
  return 0
}

# want_ledger <ledger> <extended-regex>
want_ledger() {
  if [ ! -f "$1" ]; then
    WHY="ledger absent: $1"
    return 1
  fi
  if ! grep -qE -- "$2" "$1"; then
    WHY="ledger has no line matching /$2/; ledger reads: $(tr '\t' '|' < "$1" | tr '\n' ';')"
    return 1
  fi
  return 0
}

# want_no_ledger <ledger> <extended-regex>
# The ledger must EXIST and carry no such line. A missing ledger fails rather
# than passes: "that falsehood is absent" is vacuous when read off a file that
# was never written, and a vacuous green is the failure mode this suite is built
# to refuse.
want_no_ledger() {
  if [ ! -f "$1" ]; then
    WHY="ledger absent: $1 — an absence assertion against a missing ledger proves nothing"
    return 1
  fi
  if grep -qE -- "$2" "$1"; then
    WHY="ledger carries a line matching /$2/, which it must not; ledger reads: $(tr '\t' '|' < "$1" | tr '\n' ';')"
    return 1
  fi
  return 0
}

# arm_fail <arm-name> — fold the arm's name AND the stdout it just saw into WHY.
#
# For a case built out of INDEPENDENT arms that all run (case 21). `record_fail`
# prints the OUT global, which by then belongs to whichever arm ran LAST — not to
# the one that failed. Snapshotting stdout here keeps the diagnostic attached to
# its own arm; case 21 then clears OUT/ERR so nothing misleading trails the WHY.
# Always returns 1, so `… || { arm_fail "…"; return 1; }` reads as one refusal.
arm_fail() {
  WHY="$1: $WHY [stdout: $(printf '%s' "$OUT" | tr '\n' ';')]"
  return 1
}

# ===========================================================================
# Case 1 — take on a clean worktree succeeds; status names the holder.
# Catches: a claim that is never created, or created somewhere other than the
# git common directory (the claim dir is computed from the fixture, not read
# back out of the script).
# ===========================================================================
case_1() {
  new_fixture c1
  run_claim "$(fx_wt c1)" take --agent alice --operation "git reset --hard"
  want_rc 0 || return 1
  want_out "Claimed '$TICKET' for 'alice'." || return 1
  want_dir "$(fx_claim_dir c1)" || return 1

  run_claim "$(fx_wt c1)" status
  want_rc 0 || return 1
  want_out "state: claimed" || return 1
  want_out "holder: alice" || return 1
  want_out "operation: git reset --hard" || return 1
  want_ledger "$(fx_ledger c1)" "$(printf 'take\talice\t%s' "$TICKET")" || return 1
  return 0
}

# ===========================================================================
# Case 2 — a second take by a different agent is refused with the SCRIPT's
# exit 4 and names the incumbent.
# Catches: exclusion silently degrading to last-writer-wins, and a refusal that
# forwards `mkdir`'s status instead of mapping it. `mkdir`'s create-or-EEXIST is
# a POSIX property; what this suite tests is the script's mapping of it.
# ===========================================================================
case_2() {
  new_fixture c2
  run_claim "$(fx_wt c2)" take --agent alice
  want_rc 0 || return 1

  run_claim "$(fx_wt c2)" take --agent bob
  want_rc 4 || return 1
  want_out "already claimed by another agent" || return 1
  want_out "holder: alice" || return 1

  # The refusal must not have overwritten the incumbent's state.
  run_claim "$(fx_wt c2)" status
  want_out "holder: alice" || return 1
  return 0
}

# ===========================================================================
# Case 3 — take over a modified TRACKED file is refused with 5, and NO claim
# and NO ledger entry are left behind.
# Catches: a gate evaluated after the mkdir. The exit code alone would not; a
# script that claimed, then refused, then forgot to clean up would still exit 5.
# ===========================================================================
case_3() {
  new_fixture c3
  printf 'modified by a sibling agent\n' >> "$(fx_wt c3)/tracked.txt"

  run_claim "$(fx_wt c3)" take --agent alice
  want_rc 5 || return 1
  want_out "carries uncommitted changes" || return 1
  want_out "M tracked.txt" || return 1
  want_no_dir "$(fx_claim_dir c3)" || return 1
  want_no_file "$(fx_ledger c3)" || return 1
  return 0
}

# ===========================================================================
# Case 4 — dirt that is an untracked file inside an untracked DIRECTORY is
# refused, and the refusal names the FILE, not the directory.
# Catches: `--untracked-files=all` being "optimised" away. A bare --porcelain
# reports `?? newdir/`, which still refuses — so the exit code cannot see the
# regression. But `git clean -fd` deletes the file inside that directory, and an
# agent told only `newdir/` cannot see what it is about to lose. The assertion
# on the exact `?? newdir/` line is what makes the difference visible.
# ===========================================================================
case_4() {
  new_fixture c4
  mkdir -p "$(fx_wt c4)/newdir/nested"
  printf 'work nobody can attribute\n' > "$(fx_wt c4)/newdir/nested/f.txt"

  run_claim "$(fx_wt c4)" take --agent alice
  want_rc 5 || return 1
  want_out "?? newdir/nested/f.txt" || return 1
  want_no_line "?? newdir/" || return 1
  want_no_dir "$(fx_claim_dir c4)" || return 1
  return 0
}

# ===========================================================================
# Case 5 — release by the holder succeeds, and the worktree is then takeable by
# a different agent.
# Catches: a release that reports success without removing the claim; the
# follow-on take would be refused with 4.
# ===========================================================================
case_5() {
  new_fixture c5
  run_claim "$(fx_wt c5)" take --agent alice
  want_rc 0 || return 1

  run_claim "$(fx_wt c5)" release --agent alice
  want_rc 0 || return 1
  want_no_dir "$(fx_claim_dir c5)" || return 1

  run_claim "$(fx_wt c5)" take --agent bob
  want_rc 0 || return 1
  want_out "holder: bob" || return 1
  return 0
}

# ===========================================================================
# Case 6 — release by a non-holder is refused with 4 and the claim survives.
# Catches: an unowned release, which would hand the worktree to whoever asked
# last and defeat requirement 6.
# ===========================================================================
case_6() {
  new_fixture c6
  run_claim "$(fx_wt c6)" take --agent alice
  want_rc 0 || return 1

  run_claim "$(fx_wt c6)" release --agent bob
  want_rc 4 || return 1
  want_out "held by 'alice', not by 'bob'" || return 1
  want_dir "$(fx_claim_dir c6)" || return 1
  return 0
}

# ===========================================================================
# Case 7 — history names the released holder AFTER the claim directory is gone.
# Catches: a ledger stored INSIDE the claim directory, which `release` would
# delete along with it. That design passes every other case in this suite and
# answers requirement 7 with nothing.
# ===========================================================================
case_7() {
  new_fixture c7
  run_claim "$(fx_wt c7)" take --agent alice --operation "verification run"
  want_rc 0 || return 1
  run_claim "$(fx_wt c7)" release --agent alice
  want_rc 0 || return 1
  want_no_dir "$(fx_claim_dir c7)" || return 1

  run_claim "$(fx_wt c7)" history
  want_rc 0 || return 1
  want_out "alice" || return 1
  want_out "release" || return 1
  want_out "entries: 2" || return 1
  # The release must carry a timestamp, not just a name: an investigation asks
  # when as well as who.
  if ! printf '%s\n' "$OUT" | grep -qE '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z	release	alice'; then
    WHY="history has no timestamped release line for alice"
    return 1
  fi
  return 0
}

# ===========================================================================
# Case 8 — takeover refuses a fresh claim (4), succeeds with --stale-after 0,
# records BOTH agents, and destroys nothing.
# Catches: a takeover that "tidies" the worktree it takes over. The byte-identity
# check compares against a copy held OUTSIDE the worktree, so a takeover that
# wiped the tree could not also wipe the reference.
#
# THE RESIDUE IS BOTH KINDS OF DIRT, AND THAT IS NOT DECORATION. An earlier draft
# of this case left only an UNTRACKED file behind, and a mutation pass caught it:
# a takeover mutated to run `git checkout -- .` destroyed a tracked modification
# and this case stayed green, because `git checkout -- .` does not touch untracked
# files. One residue kind covers one destruction class. The tracked modification
# catches `checkout -- .`, `reset --hard` and `stash`; the untracked file catches
# `clean -fd`. Both, or the case is blind to half the operations spec 0114 names.
# ===========================================================================
case_8() {
  new_fixture c8
  run_claim "$(fx_wt c8)" take --agent alice
  want_rc 0 || return 1

  # The residue the ended holder left behind — the reason a takeover is needed.
  printf 'ninety lines of uncommitted work\n' >> "$(fx_wt c8)/tracked.txt"
  printf 'and a file git never knew about\n' > "$(fx_wt c8)/residue.txt"
  cp "$(fx_wt c8)/tracked.txt"  "$TMP_ROOT/c8/tracked.expected"
  cp "$(fx_wt c8)/residue.txt" "$TMP_ROOT/c8/residue.expected"

  run_claim "$(fx_wt c8)" takeover --agent bob
  want_rc 4 || return 1
  want_out "not stale" || return 1
  want_out "holder: alice" || return 1

  run_claim "$(fx_wt c8)" takeover --agent bob --stale-after 0
  want_rc 0 || return 1
  want_out "Took over '$TICKET' from 'alice'" || return 1
  want_out "holder: bob" || return 1
  want_ledger "$(fx_ledger c8)" "takeover	bob	$TICKET	displaced=alice" || return 1
  want_same "$(fx_wt c8)/tracked.txt"  "$TMP_ROOT/c8/tracked.expected" || return 1
  want_same "$(fx_wt c8)/residue.txt" "$TMP_ROOT/c8/residue.expected" || return 1
  return 0
}

# ===========================================================================
# Case 9 — the claim survives `git clean -fdx` run inside the worktree.
# THE discriminating case for the carrier choice: every in-worktree design
# (a dotfile, a marker directory) dies to one of the four operations the claim
# exists to guard. The case also asserts the clean actually had teeth — an
# untracked file it was pointed at is gone afterwards — because a `git clean`
# that removed nothing would leave the claim standing for no reason at all.
# ===========================================================================
case_9() {
  new_fixture c9
  run_claim "$(fx_wt c9)" take --agent alice
  want_rc 0 || return 1

  printf 'about to be destroyed\n' > "$(fx_wt c9)/doomed.txt"
  ( cd "$(fx_wt c9)" && git clean -fdxq ) || {
    WHY="git clean -fdx failed in the fixture worktree"
    return 1
  }

  if [ -e "$(fx_wt c9)/doomed.txt" ]; then
    WHY="git clean removed nothing, so the case proves nothing about the claim"
    return 1
  fi
  want_dir "$(fx_claim_dir c9)" || return 1

  run_claim "$(fx_wt c9)" status
  want_rc 0 || return 1
  want_out "state: claimed" || return 1
  want_out "holder: alice" || return 1
  return 0
}

# ===========================================================================
# Case 10 — run releases the claim on BOTH arms and propagates the wrapped
# command's exit code.
# Catches: a release path hung off the success arm only, which is the shape a
# hand-written take/…/release sequence degrades into — and which strands the
# claim precisely when the operation failed.
# ===========================================================================
case_10() {
  new_fixture c10

  run_claim "$(fx_wt c10)" run --agent alice -- true
  want_rc 0 || return 1
  want_no_dir "$(fx_claim_dir c10)" || return 1

  run_claim "$(fx_wt c10)" run --agent alice -- sh -c 'exit 42'
  want_rc 42 || return 1
  want_no_dir "$(fx_claim_dir c10)" || return 1
  want_ledger "$(fx_ledger c10)" "release	alice	$TICKET	run" || return 1

  # A subsequent take must succeed: a stranded claim would refuse with 4.
  run_claim "$(fx_wt c10)" take --agent bob
  want_rc 0 || return 1
  return 0
}

# ===========================================================================
# Case 11 — status and history answer from the MAIN CHECKOUT after the worktree
# has been removed, and refuse to guess a ticket id.
# Catches: the blanket `.worktrees/` guard. Requirement 7 is only ever exercised
# after the per-ticket cleanup has removed the worktree — a guard applied to the
# read-only subcommands makes the ledger unreachable exactly there. Case 7 does
# not catch this: it removes the claim, not the worktree.
# ===========================================================================
case_11() {
  new_fixture c11
  run_claim "$(fx_wt c11)" take --agent alice
  want_rc 0 || return 1
  run_claim "$(fx_wt c11)" release --agent alice
  want_rc 0 || return 1

  git -C "$(fx_main c11)" worktree remove "$(fx_wt c11)" >/dev/null 2>&1 || {
    WHY="git worktree remove failed; the case never reached its subject"
    return 1
  }
  if [ -d "$(fx_wt c11)" ]; then
    WHY="the worktree is still present, so the case proves nothing about R7"
    return 1
  fi

  run_claim "$(fx_main c11)" history --ticket "$TICKET"
  want_rc 0 || return 1
  want_out "alice" || return 1
  want_out "entries: 2" || return 1

  run_claim "$(fx_main c11)" status --ticket "$TICKET"
  want_rc 0 || return 1
  want_out "state: unclaimed" || return 1
  want_out "last-holder: alice" || return 1
  want_out "last-action: release" || return 1
  if ! printf '%s\n' "$OUT" | grep -qE '^last-at: [0-9]{4}-[0-9]{2}-[0-9]{2}T'; then
    WHY="status carries no last-at timestamp for the departed holder"
    return 1
  fi

  # No --ticket and none derivable: refuse rather than answer an investigation
  # with the repository's own directory name.
  run_claim "$(fx_main c11)" history
  want_rc 1 || return 1
  want_any "--ticket" || return 1

  # The documented CREWRIG_REPO_DIR override, from outside any repository.
  run_claim_env "$TMP_ROOT" "$(fx_main c11)" status --ticket "$TICKET"
  want_rc 0 || return 1
  want_out "last-holder: alice" || return 1
  return 0
}

# ===========================================================================
# Case 12 — the claim root is byte-identical across four invocation cwds.
# See the header: the two main-checkout arms are driven THROUGH THE FIXTURE'S OWN
# SYMLINK on purpose. Without it this case passes on ubuntu-latest whether or not
# the defect is present, because there is no symlink in a `mktemp -d` path there
# and logical `pwd` equals physical `pwd -P`.
# Catches: `pwd` where `pwd -P` is required, and the bare relative common-dir
# string; both yield two spellings of one directory in the paths the script
# prints for a human to paste.
# ===========================================================================
case_12() {
  new_fixture c12
  local expected seen n cwd
  expected="$(fx_claim_root c12)"

  n=0
  for cwd in \
    "$(fx_link c12)" \
    "$(fx_link c12)/sub" \
    "$(fx_wt c12)" \
    "$(fx_wt c12)/sub"
  do
    n=$((n + 1))
    run_claim "$cwd" status --ticket "$TICKET"
    want_rc 0 || return 1
    seen="$(printf '%s\n' "$OUT" | sed -n 's/^claim-root: //p')"
    if [ -z "$seen" ]; then
      WHY="arm $n ($cwd) printed no claim-root line"
      return 1
    fi
    if [ "$seen" != "$expected" ]; then
      WHY="arm $n ($cwd) resolved claim-root to '$seen', expected '$expected'"
      return 1
    fi
  done
  return 0
}

# ===========================================================================
# Case 13 — a takeover grants NO clean-tree waiver.
# After bob takes the claim over from an ended alice, `run … -- git reset --hard`
# is refused with 5 and the residue is byte-identical. The wrapped command is a
# real `git reset --hard` executed with the fixture worktree as cwd, so if the
# gate ever stopped firing this case would actually destroy the file and fail on
# the comparison — which is the only reason it is worth writing.
# Catches: the back-door reading in which holding a claim implies permission.
# ===========================================================================
case_13() {
  new_fixture c13
  run_claim "$(fx_wt c13)" take --agent alice
  want_rc 0 || return 1

  printf 'uncommitted work alice never got to commit\n' >> "$(fx_wt c13)/tracked.txt"
  cp "$(fx_wt c13)/tracked.txt" "$TMP_ROOT/c13/tracked.expected"

  run_claim "$(fx_wt c13)" takeover --agent bob --stale-after 0
  want_rc 0 || return 1
  want_out "holder: bob" || return 1

  run_claim "$(fx_wt c13)" run --agent bob -- git reset --hard
  want_rc 5 || return 1
  want_out "carries uncommitted changes" || return 1
  want_same "$(fx_wt c13)/tracked.txt" "$TMP_ROOT/c13/tracked.expected" || return 1

  # And the claim bob holds is untouched by the refusal.
  run_claim "$(fx_wt c13)" status
  want_out "holder: bob" || return 1
  return 0
}

# ===========================================================================
# Case 14 [DEV decision 1] — run is RE-ENTRANT for a caller that already holds
# the claim: it proceeds without acquiring and does NOT release at exit.
# Catches: an unconditional release in the exit trap, which would silently drop
# a hold the invocation never acquired — the caller's own claim, dropped by its
# own command, with no diagnostic. The surviving claim directory is the whole
# assertion; the exit code is identical either way.
# ===========================================================================
case_14() {
  new_fixture c14
  run_claim "$(fx_wt c14)" take --agent alice
  want_rc 0 || return 1

  run_claim "$(fx_wt c14)" run --agent alice -- true
  want_rc 0 || return 1
  want_dir "$(fx_claim_dir c14)" || return 1
  want_ledger "$(fx_ledger c14)" "run-reentrant	alice	$TICKET" || return 1

  # The hold is still alice's and still excludes bob.
  run_claim "$(fx_wt c14)" take --agent bob
  want_rc 4 || return 1
  want_out "holder: alice" || return 1

  # A re-entrant run must not have written a release line either.
  if grep -qE "release	alice	$TICKET" "$(fx_ledger c14)"; then
    WHY="a re-entrant run wrote a release line; the caller's hold was dropped"
    return 1
  fi
  return 0
}

# ===========================================================================
# Case 15 [DEV decision 2] — takeover on an UNCLAIMED worktree exits 4 and
# points the caller at `take`.
# Catches: a takeover that quietly manufactures a claim on an unclaimed
# worktree. That would be a route to a held claim that never passed the
# clean-tree gate — takeover does not evaluate it — which is exactly the
# waiver case 13 exists to deny, reached from the other side.
# ===========================================================================
case_15() {
  new_fixture c15
  printf 'dirt that take would refuse\n' >> "$(fx_wt c15)/tracked.txt"

  run_claim "$(fx_wt c15)" takeover --agent bob --stale-after 0
  want_rc 4 || return 1
  want_out "not claimed" || return 1
  want_out "take" || return 1
  want_no_dir "$(fx_claim_dir c15)" || return 1
  return 0
}

# ===========================================================================
# Case 16 — a takeover that lands INSIDE an in-flight `run` survives that run's
# exit.
# Catches: an EXIT trap that releases on the sole ground that THIS invocation
# created the claim, without re-checking it is still the holder. alice `run`s,
# bob takes over while the wrapped command is still executing, alice exits and
# deletes the claim bob now holds. R5 mutual exclusion is defeated — carol then
# takes a worktree bob believes he holds — and R7 attribution is not merely
# missing but actively wrong: the ledger's last line reads `release alice`,
# recording an event that never happened, while nothing records that bob's claim
# ended.
#
# No case above sees this. Case 10 releases from a run nobody contested, and
# case 14 covers the mirror image — a run that must NOT release a claim it never
# acquired. This is the third combination: a claim the run DID acquire and has
# since lost. The exit code is 0 on both sides of the fix, so the surviving claim
# directory and the ledger are the whole assertion.
#
# WHY THE CLAIM IS AGED INSTEAD OF `--stale-after 0`. The interloper rewrites
# `since_epoch` an hour into the past and then takes over with NO flags, at the
# default 30-minute threshold. That is the reproduction as reported, and it costs
# nothing to keep it faithful: the defect is reachable through the documented
# default path, not only through a flag that exists for tests. The edit lands on
# the claim's own state file under `.git/` and touches no working-tree file, so
# it cannot perturb the clean-tree gate `run` evaluates around it. It stands in
# for wall-clock, and for nothing else.
#
# The interloper is held OUTSIDE the worktree for the same reason case 8's
# reference copies are: a helper script written inside it would dirty the tree,
# and `run` would refuse with 5 before the case ever reached its subject.
# ===========================================================================
case_16() {
  new_fixture c16
  local aged
  aged="$(( $(date -u +%s) - 3600 ))"

  cat > "$TMP_ROOT/c16/interloper.sh" <<INTERLOPER
#!/bin/bash
set -eu
printf '%s\n' "$aged" > "$(fx_claim_dir c16)/since_epoch"
bash "$SCRIPT_UNDER_TEST" takeover --agent bob
INTERLOPER

  run_claim "$(fx_wt c16)" run --agent alice -- bash "$TMP_ROOT/c16/interloper.sh"
  # Assert the displacement FIRST: a takeover refused for any reason would leave
  # every assertion below trivially satisfiable, and this is the more direct
  # diagnostic when the fixture rather than the script is at fault.
  want_out "Took over '$TICKET' from 'alice'" || return 1
  want_rc 0 || return 1

  # R5 — bob's claim outlives the run it landed inside.
  want_dir "$(fx_claim_dir c16)" || return 1
  run_claim "$(fx_wt c16)" status
  want_rc 0 || return 1
  want_out "state: claimed" || return 1
  want_out "holder: bob" || return 1

  # …and still excludes a third agent. This is the consequence that bites: with
  # the claim deleted, carol acquires a worktree bob is actively working in.
  run_claim "$(fx_wt c16)" take --agent carol
  want_rc 4 || return 1
  want_out "holder: bob" || return 1

  # R7 — the ledger must not record a release that never occurred. Asserted as
  # the ABSENCE of the falsehood rather than the presence of one particular
  # truth: a fix that logs its declined release under some other action name is
  # equally honest, and this case must not legislate which.
  want_no_ledger "$(fx_ledger c16)" "$(printf 'release\talice\t%s' "$TICKET")" || return 1
  # The record of what did happen has to survive alongside.
  want_ledger "$(fx_ledger c16)" "$(printf 'takeover\tbob\t%s\tdisplaced=alice' "$TICKET")" || return 1
  return 0
}

# ===========================================================================
# Case 17 [REVIEW iteration 1, F2] — `--stale-after 08` means EIGHT MINUTES, not
# a base error.
# Catches: a `--stale-after` validated as digits and then evaluated as arithmetic.
# `08` and `09` are the only two-character values that pass a digit test and abort
# `$(( … ))`, and the abort happened INSIDE `cmd_takeover`, so the caller got the
# script's path and line number where the usage block should have been.
#
# THE ASSERTION IS THE NUMBER, NOT THE EXIT CODE. `rc=4` alone is satisfied by any
# fix that merely stops the crash — including one that swallows the base error and
# falls back to the 30-minute default, answering "how long until stale?" with a
# figure the caller never asked for. `stale-after-seconds: 480` pins the value at
# eight decimal minutes: a default fallback yields 1800 (`STALE_DEFAULT_MINUTES`,
# 30, times 60), a parse-to-zero yields 0 and grants the takeover outright, and a
# fix that rejects leading zeros instead of reading them yields rc=1.
# `want_no_shell_error` is separately load-bearing — the cheapest fix of all is to
# retry the arithmetic in base 10 after it fails, which reaches 480 with the raw
# bash abort still on stderr.
#
# NO `09` ARM, DELIBERATELY. `08` and `09` are the whole two-character family and
# the review names both, but an arm is kept here only if some mutant fails it while
# passing `08` — and no fix distinguishes them. Everything that reads `08` as eight
# (strip the zero, `10#`, retry-in-base-10) reads `09` as nine, and everything that
# does not (base-8 conversion, `printf %d`, outright rejection) fails both. The arm
# was written, found undemonstrable, and removed; do not restore it without the
# mutant that justifies it.
# ===========================================================================
case_17() {
  new_fixture c17
  run_claim "$(fx_wt c17)" take --agent alice
  want_rc 0 || return 1

  run_claim "$(fx_wt c17)" takeover --agent bob --stale-after 08
  want_rc 4 || return 1
  want_out "not stale" || return 1
  want_out "stale-after-seconds: 480" || return 1
  want_no_shell_error || return 1

  # The claim the flag was pointed at is still alice's, and nothing recorded a
  # transfer that did not happen.
  run_claim "$(fx_wt c17)" status
  want_rc 0 || return 1
  want_out "holder: alice" || return 1
  want_no_ledger "$(fx_ledger c17)" "$(printf 'takeover\tbob\t%s' "$TICKET")" || return 1
  return 0
}

# ===========================================================================
# Case 18 [REVIEW iteration 1, F2] — an over-wide `--stale-after` is refused
# BEFORE the arithmetic it would overflow, not judged after it.
# Catches: the silent 64-bit wrap. `--stale-after 200000000000000000` asks for
# "essentially never stale"; unfixed, `* 60` wrapped to -6446744073709551616, the
# comparison inverted, and a claim taken one second earlier was handed to bob at
# rc=0 with `Took over '736' from 'alice'`. A flag whose entire purpose is to
# PROTECT a fresh claim was the fastest way to lose one.
#
# EACH OF THE THREE VALUES DEFEATS A DIFFERENT HALF-FIX; none is a wider spelling
# of another, and each was kept only after a mutant was found that it alone fails.
#
#   200000000000000000  — the measured harm. Refused by every candidate fix, so it
#                         proves nothing on its own; it is here because it is the
#                         value that actually gave a live claim away at rc=0.
#   999999999999999999999
#                       — defeats a numeric bound that AVOIDS the multiply:
#                         `[ "$STALE_AFTER" -gt 999999999 ]` refuses the other two,
#                         but bash's own `[` cannot parse 21 digits ("integer
#                         expression expected", rc=2), the condition reads false,
#                         and the value sails through to the arithmetic. A
#                         comparison is arithmetic too. Only `${#…}` is not.
#   307445734561825861  — defeats a numeric bound applied AFTER the multiply:
#                         60 * this wraps past 2^64 to `44`, positive and small, so
#                         a "refuse a negative threshold" check waves it through to
#                         `stale-after-seconds: 44` — a flag asking for "never
#                         stale" delivering "stale in three quarters of a minute".
#
# The loop asserts the value is echoed back verbatim as well: the diagnostic must
# name what the caller typed, not the zero-stripped form the script works with,
# or the caller cannot match the error to their own command line.
# ===========================================================================
case_18() {
  new_fixture c18
  local v
  run_claim "$(fx_wt c18)" take --agent alice
  want_rc 0 || return 1

  for v in 200000000000000000 999999999999999999999 307445734561825861; do
    run_claim "$(fx_wt c18)" takeover --agent bob --stale-after "$v"
    want_rc 1        || { WHY="--stale-after $v: $WHY"; return 1; }
    want_any "is out of range" || { WHY="--stale-after $v: $WHY"; return 1; }
    want_any "$v"    || { WHY="--stale-after $v: $WHY"; return 1; }
  done

  # Refused before the subcommand ran at all: alice's claim is untouched and the
  # ledger records no transfer.
  want_dir "$(fx_claim_dir c18)" || return 1
  run_claim "$(fx_wt c18)" status
  want_rc 0 || return 1
  want_out "holder: alice" || return 1
  want_no_ledger "$(fx_ledger c18)" "$(printf 'takeover\tbob\t%s' "$TICKET")" || return 1
  return 0
}

# ===========================================================================
# Case 19 [REVIEW iteration 1, F2] — a leading-zero `since_epoch` keeps
# requirement 8's takeover path OPEN.
# Catches: the same base error as case 17, on the value that comes off DISK, and
# therefore on the one path that must never fail closed. `since_epoch` is read
# from a claim written by a holder that has since ended; a corrupt or truncated
# one is not an exotic input but the literal dead-holder case R8 exists for.
# Unfixed, `08` there aborted `takeover` at rc=1 with a raw base error — the
# recovery route sealed shut by the state file of the very holder it recovers
# from.
#
# THE DISPOSITION IS THE ASSERTION, AND IT IS THE OPPOSITE OF CASE 18's. An
# unreadable `--stale-after` is a caller error and must fail closed; an unreadable
# `since_epoch` must be read as infinitely old and let the takeover through. A fix
# that treats both alike is symmetric, tempting, and wrong in one direction or the
# other — so this case asserts rc=0 AND the displacement, not merely "no crash".
# The takeover runs with NO flags, at the documented default, because R8's path is
# the one a stranded agent reaches without knowing anything is wrong.
# ===========================================================================
case_19() {
  new_fixture c19
  run_claim "$(fx_wt c19)" take --agent alice
  want_rc 0 || return 1

  printf '08\n' > "$(fx_claim_dir c19)/since_epoch"

  run_claim "$(fx_wt c19)" takeover --agent bob
  want_rc 0 || return 1
  want_out "Took over '$TICKET' from 'alice'" || return 1
  want_out "holder: bob" || return 1
  want_no_shell_error || return 1
  want_ledger "$(fx_ledger c19)" "$(printf 'takeover\tbob\t%s\tdisplaced=alice' "$TICKET")" || return 1
  return 0
}

# ===========================================================================
# Case 20 [REVIEW iteration 1, F2] — an over-wide `since_epoch` does not wrap
# into a plausible-looking FRESH claim and stand in front of R8's recovery.
# Catches: the 64-bit wrap on the disk-side value, which fails in the mirror
# direction of case 18's. `$(( … ))` truncates a digit string wider than 64 bits
# SILENTLY, so an over-wide `since_epoch` does not announce itself — it evaluates,
# and what it evaluates to is unrelated to anything a clock ever produced.
# `takeover` then reports that number as the claim's age and decides on it.
#
# THE VALUE IS `2^64 + now`, AND IT IS NOT INTERCHANGEABLE WITH THE OBVIOUS ONE.
# This case was written with `99999999999999999999`, the reported reproduction, and
# that value stopped discriminating. One mutation — `since_epoch width guard
# dropped` — run at each revision named below, measured rather than inferred:
#
#   30fb24b  introduced this case, before the skew band
#              -> FAIL Case 20 at `expected exit 0, got 4`; 19 passed, 1 failed.
#                 True when written.
#   bcc4e65  adds the skew band; `git rev-list --count 30fb24b..bcc4e65` = 1
#              -> 20 passed, 0 failed. Dead already, one commit later.
#   bb844ab  `git rev-list --count bcc4e65..bb844ab` = 1 — the next commit again;
#            still on `99999999999999999999`
#              -> 21 passed, 0 failed. Still dead, still reading as a pass.
#   c48aa6c  this case rewritten onto `2^64 + now`
#              -> FAIL Case 20 at `expected exit 0, got 4`, stdout carrying
#                 `held-for-seconds: 0`; 20 passed, 1 failed. Alive again.
#
# THE LAST ROW IS THE ONE THAT CERTIFIES THE FIX, and an earlier revision of this
# block did not carry it: it stopped at `bb844ab, head`, so the only measurement on
# the page was the DEAD one, under a label asserting that state was current. When
# bb844ab stopped being head the label did not stop claiming it was. That is why
# every row above names a commit and none names `head` — a ledger of revisions can
# only go out of date by being INCOMPLETE, which a reader can see; `head` goes out
# of date by being WRONG, which a reader cannot.
#
# The mechanism is the clock-skew band added in bcc4e65. `99999999999999999999`
# never reaches the comparison as itself: `$(( … ))` wraps it to
# 7766279631452241919, a timestamp some 246 billion years ahead, so the age it
# yields is negative by that same order — far past the band's tolerance
# (`CLOCK_SKEW_TOLERANCE_SECONDS`, 300) — and it leaves through the CORRUPT arm.
# Takeable, which is the same verdict the width guard gives, reached by a different
# path. The assertion cannot tell the two
# apart, so it went on reading as a test of the guard while testing nothing.
#
# (An earlier revision quoted the resulting AGE here rather than the wrapped value.
# An age is `now` minus that constant, so it moves once a second: it could not be
# pinned to any commit, and the figure printed on the page was already hours stale
# by the time anyone read it. The wrapped value is a constant, and `$(( … ))` in
# any bash re-derives it in one line.)
#
# `2^64 + now` is the value that second path cannot reach. It wraps to `now`
# exactly, so the age is d — the seconds between the fixture stamping the file and
# the script reading its own clock, measured 0 in the c48aa6c row above — which is
# not negative, never reaches the band, and sits below the 1800-second default
# threshold (`STALE_DEFAULT_MINUTES` x 60). Without the guard the script answers
# `Refused: … is not stale` with
# `held-for-seconds: 0`: a fabricated age, indistinguishable in the output from a
# claim taken this second. The slack is one-sided and large — d ≥ 0 holds by
# construction for any clock, and the refusal this case defeats holds for any
# d < 1800 — so no arm of it depends on which way a clock drifts.
#
# WHAT THE GUARD IS WORTH, STATED HONESTLY. Since the skew band, the wrap is no
# longer a deadlock for most over-wide values: one that lands far in the future
# leaves through the corrupt arm, one that lands far in the past exceeds every
# threshold, and both grant the takeover — correctly, but by luck rather than by
# decision. What is left is the window where the wrap lands near `now`, and there
# the stall is bounded by `--stale-after`: 30 minutes at the default, and up to the
# maximum the flag accepts (`STALE_MAX_DIGITS`, 9 digits of minutes) — roughly 1900
# years — for a caller who asked for a long protection window. Bounded is not
# benign. The stranded agent R8 exists for is told the claim is fresh and is given
# nothing in the output to
# suggest otherwise, which is the same wrong answer the original 20-digit value
# produced, minus the arithmetic that made it obvious.
#
# Kept apart from case 19 rather than folded in as a second arm, because the two
# corrupt shapes fail differently on the unfixed script — rc=1 with a shell abort
# there, rc=4 with a plausible-looking refusal here. A refusal that looks like a
# considered decision is the more dangerous of the two, and it deserves a PASS/FAIL
# line that names it. No `want_no_shell_error` here: this path never aborted, and
# an assertion that cannot fail is the decoration this suite refuses.
# ===========================================================================
case_20() {
  new_fixture c20
  local wide
  run_claim "$(fx_wt c20)" take --agent alice
  want_rc 0 || return 1

  # 2^64 + now, concatenated rather than added, because the addition cannot be
  # done in `$(( … ))` — that is the arithmetic being defeated. 2^64 is
  # 18446744073709551616; its low ten digits absorb `now` without carrying into
  # the high ten for every clock below 6290448384, i.e. until the year 2169.
  wide="$(printf '1844674407%s' "$(( 3709551616 + $(date -u +%s) ))")"
  if [ "${#wide}" -ne 20 ]; then
    WHY="fixture built a ${#wide}-digit value, not the 20-digit 2^64+now ('$wide');
       the carry bound above has been crossed or a constant edited, and the case
       is no longer testing the wrap it names"
    return 1
  fi
  printf '%s\n' "$wide" > "$(fx_claim_dir c20)/since_epoch"

  run_claim "$(fx_wt c20)" takeover --agent bob
  want_rc 0 || return 1
  want_out "Took over '$TICKET' from 'alice'" || return 1
  want_out "holder: bob" || return 1
  want_ledger "$(fx_ledger c20)" "$(printf 'takeover\tbob\t%s\tdisplaced=alice' "$TICKET")" || return 1
  return 0
}

# ===========================================================================
# Case 21 [REVIEW iteration 1, out of F2's fix] — a `since_epoch` in the FUTURE
# is sorted into clock skew, which still protects the claim, and corruption,
# which does not. No reviewer numbered this one: it surfaced while F2 was being
# fixed and `team-lead` ruled it in scope rather than deferring it, so the label
# names F2's fix rather than a finding id. Recorded in the iteration-1 closeout
# on issue #736.
# Catches: the R8 violation that survived the first fix. `since_epoch` was made
# safe against values that could not be EVALUATED, and a future timestamp
# evaluates perfectly — it just evaluates to a negative age, which is below every
# threshold, so `takeover` answered `Refused: … is not stale` and would answer
# that until wall-clock caught up. At 18 digits that is roughly three billion
# years: a claim no agent can ever take over, which is precisely the state R8
# exists to dissolve.
#
# THE TWO DISPOSITIONS HAVE TO BE TESTED TOGETHER, and that is the whole design of
# this case. Granting the takeover on any negative age would satisfy the R8 half
# of it while making every fresh claim in the system stealable by a peer whose
# clock runs a few seconds fast — R5's simultaneous-belief state, reintroduced
# silently to fix R8. So the case asserts a refusal AND a grant, and neither arm
# alone would be worth writing.
#
#   now+300  -> REFUSED, `held-for-seconds: 0`   skew: read as "taken just now"
#   now+900  -> GRANTED                          past the 300s tolerance: corrupt
#   18 digits-> GRANTED                          the reported reproduction
#
# `held-for-seconds: 0` is load-bearing and is not a restatement of the refusal.
# It asserts the age was CLAMPED, not merely found negative-and-refused, which is
# what the unfixed script also did — there the same arm prints a NEGATIVE age, and
# the exact figure is d-300, so it reads -300 when d is 0 and -299 when d is 1. The
# assertion is on the clamped 0, never on the negative value, for
# that reason. It is the only assertion in this case that separates the fix from
# the defect on the skew side, because on that side both refuse.
#
# EVERY ARM RUNS, AND THE CASE STILL RECORDS ONE PASS OR FAIL. The three arms are
# independent — three fixtures, sharing only the clock read at the top — so the case
# runs all of them and accumulates, rather than returning at the first failure. That
# is not tidiness: two matrix rows differ ONLY in the arms after the skew one, and
# while the case short-circuited they produced byte-identical output and the matrix
# could not tell them apart. See the fingerprint note in the header. Because each
# arm's stdout is folded into WHY by `arm_fail` at the point of failure, the OUT/ERR
# globals are cleared before returning: by then they hold the LAST arm's output,
# which would attach the wrong evidence to the right complaint.
#
# WHY THE EXACT 300/301 EDGE IS NOT PINNED. It cannot be, without freezing the
# clock. Let d be the seconds between the fixture stamping the file and the script
# reading its own clock; a value written as now+N presents an age of d-N. So
# now+301 classifies as corrupt only while d-301 < -300, i.e. only while d == 0. A
# case pinned there would be asserting that a `git init`, a commit, a `worktree
# add` and two script invocations all land inside one wall-clock second — a
# property of the machine's load, not of the script, and one that fails outright on
# a loaded runner where d grows. Stated as a bound rather than as a flake RATE on
# purpose: a rate is measured on one machine and does not transfer to the runner
# that matters. The values above were chosen for the opposite
# property: now+300 stays skew for any d < 300, and now+900 stays corrupt for any
# d < 600. Both hold with minutes of slack against a d measured in single seconds.
# An off-by-one in a five-minute heuristic safety band has no consequence worth an
# intermittently red suite; a flaky case would cost more than the bound it guards.
#
# THE 18-DIGIT ARM WAS KEPT ON SUSPICION AND THEN EARNED IT. It was written as the
# reported reproduction, and as the only corrupt-side value that rests on no clock
# assumption at all; on the mutants built for the other two arms it never failed,
# which is this suite's definition of decoration, and it was nearly dropped for
# the reason the `09` arm of case 17 was. A mutant found afterwards separates it:
# flooring an "absurd" age to zero instead of reading it as infinitely old — the
# tempting extra guard against a very large negative — leaves now+300 and now+900
# both correct and refuses the 18-digit claim forever. The arm goes red alone
# there. Do not drop it on the grounds that it duplicates now+900; it does not.
#
# It earns its place a second way now that the arms all run: it is one of the two
# arms that separate `skew band reverted` from `clamp dropped, band kept`, which
# were indistinguishable while the case stopped at the skew arm.
# ===========================================================================
# --- Skew: inside the tolerance, the claim is still protected ----------------
case_21_skew() {
  new_fixture c21a
  run_claim "$(fx_wt c21a)" take --agent alice
  want_rc 0 || { arm_fail "skew (now+300) setup"; return 1; }
  printf '%s\n' "$(( $1 + 300 ))" > "$(fx_claim_dir c21a)/since_epoch"

  run_claim "$(fx_wt c21a)" takeover --agent bob
  want_rc 4 || { arm_fail "skew (now+300)"; return 1; }
  want_out "not stale" || { arm_fail "skew (now+300)"; return 1; }
  # Clamped, not merely negative — the unfixed script prints a negative age here.
  want_out "held-for-seconds: 0" || { arm_fail "skew (now+300)"; return 1; }
  run_claim "$(fx_wt c21a)" status
  want_out "holder: alice" || { arm_fail "skew (now+300)"; return 1; }
  want_no_ledger "$(fx_ledger c21a)" "$(printf 'takeover\tbob\t%s' "$TICKET")" \
    || { arm_fail "skew (now+300)"; return 1; }
  return 0
}

# --- Past the tolerance: corrupt, so infinitely old, so takeable -------------
case_21_corrupt() {
  new_fixture c21b
  run_claim "$(fx_wt c21b)" take --agent alice
  want_rc 0 || { arm_fail "corrupt (now+900) setup"; return 1; }
  printf '%s\n' "$(( $1 + 900 ))" > "$(fx_claim_dir c21b)/since_epoch"

  run_claim "$(fx_wt c21b)" takeover --agent bob
  want_rc 0 || { arm_fail "corrupt (now+900)"; return 1; }
  want_out "Took over '$TICKET' from 'alice'" || { arm_fail "corrupt (now+900)"; return 1; }
  want_out "holder: bob" || { arm_fail "corrupt (now+900)"; return 1; }
  want_ledger "$(fx_ledger c21b)" "$(printf 'takeover\tbob\t%s\tdisplaced=alice' "$TICKET")" \
    || { arm_fail "corrupt (now+900)"; return 1; }
  return 0
}

# --- The reported reproduction, with no clock dependence at all --------------
case_21_wide() {
  new_fixture c21c
  run_claim "$(fx_wt c21c)" take --agent alice
  want_rc 0 || { arm_fail "18-digit setup"; return 1; }
  printf '100000000000000000\n' > "$(fx_claim_dir c21c)/since_epoch"

  run_claim "$(fx_wt c21c)" takeover --agent bob
  want_rc 0 || { arm_fail "18-digit"; return 1; }
  want_out "Took over '$TICKET' from 'alice'" || { arm_fail "18-digit"; return 1; }
  want_out "holder: bob" || { arm_fail "18-digit"; return 1; }
  return 0
}

case_21() {
  local failed=0 acc="" now
  now="$(date -u +%s)"

  # EVERY ARM RUNS, EVEN AFTER ONE FAILS — see the fingerprint note in the header.
  # The three arms are independent by construction (three fixtures, no shared
  # state but the clock read above), so running all three costs nothing and is
  # what makes `skew band reverted` and `clamp dropped, band kept` distinguishable:
  # the first breaks all three arms, the second breaks the skew arm alone. Returned
  # at the first failure, both mutants printed the SAME single failure and the
  # matrix could not have told them apart.
  case_21_skew    "$now" || { acc="$WHY"; failed=1; }
  case_21_corrupt "$now" || { acc="${acc:+$acc
      }$WHY"; failed=1; }
  case_21_wide           || { acc="${acc:+$acc
      }$WHY"; failed=1; }

  if [ "$failed" -ne 0 ]; then
    # Each arm already folded its own stdout into WHY via `arm_fail`; the OUT/ERR
    # globals now hold the LAST arm's output, which would misattribute.
    WHY="$acc"
    OUT=""
    ERR=""
    return 1
  fi
  return 0
}

# ===========================================================================
# Case 22 [REVIEW iteration 5, F2] — a value-taking flag in FINAL position is
# refused BY NAME, not by exiting 1 with both streams empty.
# Catches: the one refusal in this script that said nothing at all. `--agent` last
# on the line leaves `shift 2` asking for more parameters than remain; `shift`
# then fails, and under `set -euo pipefail` (line 191) the script exits 1 having
# printed nothing to either stream.
#
# THE EXIT CODE IS THE SAME ON BOTH SIDES OF THE FIX, SO THE CODE CANNOT BE THE
# ASSERTION. Measured, both scripts extracted with `git show` into a `mktemp -d`,
# invoked as `status --agent`:
#
#   f8bd54b (before)  -> rc=1, stdout empty, stderr empty
#   44d0c9b (after)   -> rc=1, stderr `Error: '--agent' requires a value: …`
#
# A case asserting `want_rc 1` alone is therefore GREEN AGAINST THE UNFIXED
# SCRIPT. It would sit here looking exactly like coverage while certifying
# nothing — the same false-green this file's header exists to argue against, and
# the reason this case asserts the DIAGNOSTIC and treats the code as incidental.
#
# ONE FLAG, DELIBERATELY — the same rule case 17 states for its absent `09` arm.
# All four value-taking flags (`--agent`, `--ticket`, `--operation`,
# `--stale-after`) reach `require_value` through one call each, so no mutant can
# fail one arm while passing another: dropping the guard silences all four, and
# restoring it fixes all four. Three more arms would be three more things to
# maintain and nothing more proven. `--stale-after` is the one worth a note: its
# empty value never reaches the digit validation cases 17-18 cover, because the
# failing `shift` aborts first — so that path too is this case's, not theirs.
#
# TWO ASSERTIONS, AND THE OTHERS WERE WRITTEN THEN REMOVED — the rule case 17
# states for its absent `09` arm, applied here to arms this case's own author had
# already drafted. Both removals were measured, not reasoned:
#
#   * `want_no_shell_error` — kept in the first draft against a bare-`$2` mutant,
#     which under `set -u` does abort with `worktree-claim.sh: line 323: $2:
#     unbound variable` (measured; it printed in French on the authoring machine,
#     which is exactly why that helper matches the script's PATH and not the
#     message). But that mutant fails the diagnostic assertion FIRST, so the arm
#     is never reached. No mutant fails it while passing what precedes it.
#   * a `take --agent alice` / `holder: alice` tail, asserting the refusal left
#     the worktree claimable. It cannot fail: this fix lives in the parse loop,
#     which runs before any claim is touched, and `take` with an empty agent is
#     independently refused by the `--agent <name> is required` guard that
#     predates this fix. The arm re-tested a neighbouring guarantee and would
#     have reported that as coverage of this one.
#
# `want_rc 1` earns its place on a different mutant than the message does: a
# "warn and carry on" fix prints the diagnostic and proceeds, passing the message
# assertion and failing this one.
# ===========================================================================
case_22() {
  new_fixture c22

  # `take` rather than `status`: a silent exit 1 is worst on a MUTATING
  # subcommand, where the caller cannot tell "your flag was malformed and
  # nothing happened" from "the claim machinery is broken".
  run_claim "$(fx_wt c22)" take --agent
  want_rc 1 || return 1
  want_any "'--agent' requires a value" || return 1

  return 0
}

# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------

# describe <n> -> the case's one-line name
describe() {
  case "$1" in
    1)  echo "Case 1 — take on a clean worktree claims it; status names the holder" ;;
    2)  echo "Case 2 — a second take by another agent is refused with the script's exit 4" ;;
    3)  echo "Case 3 — take over a modified tracked file is refused (5), leaving no claim" ;;
    4)  echo "Case 4 — nested untracked dirt is refused and named to the file (-uall)" ;;
    5)  echo "Case 5 — release by the holder frees the worktree for another agent" ;;
    6)  echo "Case 6 — release by a non-holder is refused (4) and the claim survives" ;;
    7)  echo "Case 7 — history names the released holder after the claim is gone" ;;
    8)  echo "Case 8 — takeover: refused fresh (4), stale succeeds, destroys nothing" ;;
    9)  echo "Case 9 — the claim survives git clean -fdx inside the worktree" ;;
    10) echo "Case 10 — run releases on both arms and propagates the exit code" ;;
    11) echo "Case 11 — status/history answer from the main checkout after removal" ;;
    12) echo "Case 12 — the claim root is byte-identical across four invocation cwds" ;;
    13) echo "Case 13 — a takeover grants no clean-tree waiver" ;;
    14) echo "Case 14 — run is re-entrant and does not release a hold it did not take" ;;
    15) echo "Case 15 — takeover on an unclaimed worktree is refused (4)" ;;
    16) echo "Case 16 — a takeover landing inside an in-flight run survives its exit" ;;
    17) echo "Case 17 — --stale-after 08 means eight minutes, not a base error" ;;
    18) echo "Case 18 — an over-wide --stale-after is refused before the arithmetic" ;;
    19) echo "Case 19 — a leading-zero since_epoch keeps R8's takeover path open" ;;
    20) echo "Case 20 — an over-wide since_epoch does not pass as a fresh claim" ;;
    21) echo "Case 21 — a future since_epoch: skew protects the claim, corruption does not" ;;
    22) echo "Case 22 — a flag with no value is refused by name, not by silent exit 1" ;;
  esac
}

for n in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22; do
  WHY=""
  OUT=""
  ERR=""
  if "case_$n"; then
    record_pass "$(describe "$n")"
  else
    record_fail "$(describe "$n")" "$WHY"
  fi
done

echo ""
echo "Results: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
