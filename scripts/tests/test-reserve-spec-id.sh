#!/bin/bash
# test-reserve-spec-id.sh — Regression tests for reserve-spec-id.sh (spec 0112
# and its delta-01, issue #726).
#
# Every case runs against a LOCAL BARE REPOSITORY under a temporary directory.
# No network, no forge command-line tool, no reliance on crewrig/crewrig. Each
# fixture is self-contained and torn down with the temporary root.
#
# ---------------------------------------------------------------------------
# Invocation surface — settled by the coordinator, binding on this suite and on
# the implementation alike
# ---------------------------------------------------------------------------
# Spec 0112 and PLAN v9 pin the tool's BEHAVIOUR and its exit codes but not the
# spelling of its surface. That gap was closed by an explicit five-point ruling
# during DEV; what follows is that ruling, and this suite tests it rather than
# whatever the implementation happens to do.
#
#   scripts/reserve-spec-id.sh --issue <N>              allocate + secure, upstream
#                              --id <ID>                secure one identifier (R14)
#                              --corpus upstream|org    default upstream; org needs --id
#                              --offline                skip the remote, exit 3
#
#   Carrier setting  .crewrig/spec-id-carrier, format `carrier=<namespace>`,
#                    value constrained to the closed pair:
#                      refs/spec-ids/       (default, shipped)
#                      refs/tags/spec-id/   (alternative)
#                    Org siblings derived:  refs/spec-ids-org/ , refs/tags/spec-id-org/
#                    Absent file            → built-in default (PLAN step 3)
#                    CREWRIG_SPEC_ID_CARRIER  one-off override for a single
#                                           invocation, validated on the same
#                                           closed pair (PLAN step 4). The
#                                           CREWRIG_ prefix is this repository's
#                                           established convention —
#                                           CREWRIG_REPO_DIR, CREWRIG_GITLAB_HOSTS,
#                                           CREWRIG_TEST_*.
#
#   Reference remote Resolved by NAME, never by a flag and never hard-coded:
#                    the first remote matching `crewrig|origin`, else the first
#                    remote at all. This is the existing repository idiom
#                    (scripts/lib/spec-linter.js:114-131, aligned with
#                    scripts/check-skill-versions.sh:24-33 "so the repository has
#                    one idiom rather than two"). Fixtures carry both a `crewrig`
#                    and an `origin` remote; Case 23 covers the fallback arm.
#
#   Reservation      A parentless object whose message is, verbatim per PLAN
#                    step 1, `reserve <ID> for issue #<N>`.
#
# Exit contract under test (PLAN step 2, authoritative):
#   0  secured on the remote        stdout: the id
#   3  allocated, NOT secured       stdout: the id on line 1, then exactly
#                                   `unsecured-id: true` on line 2
#   1  genuine failure              stdout: nothing; reason on stderr
#
# `unsecured-id` is one name across two surfaces — this stdout marker and the
# optional frontmatter field docs/spec-format.md gains — and the colon form
# makes the two surfaces identical in syntax as well as in name: line 2 is
# already a valid frontmatter line, so `spec-author` transcribes it rather than
# reformatting it on the one code path that runs with no human present to catch
# a bad rewrite. Line 1 is a bare id with no key, so stdout was never uniformly
# `key=value` and nothing is lost by not being parseable as such.
#
# Asserted exactly, and by line number, rather than by a loose match on
# `unsecured`: the shape is a contract with a declared consumer, so a change to
# it must be a visible test failure rather than a silent drift.
#
# ---------------------------------------------------------------------------
# One harness rule that is load-bearing, not stylistic
# ---------------------------------------------------------------------------
# Namespace-separation assertions use `git ls-remote <bare> '<pattern>'`, never
# `git -C <bare> for-each-ref '<pattern>'`. The two do NOT agree, and the
# disagreement is precisely the defect PLAN v9 was revised to close. Measured on
# git 2.55.0 against one repository holding both refs:
#
#   git ls-remote    o 'refs/spec-ids/*'  → refs/spec-ids/0112
#                                           refs/spec-ids/org/ORG-0001   ← returned
#   git for-each-ref   'refs/spec-ids/*'  → refs/spec-ids/0112           ← NOT returned
#
# `ls-remote` is what the tool itself performs, and its `*` crosses `/`; a nested
# org namespace therefore lands inside the upstream read. `for-each-ref` matches
# path-wise and would hide exactly that. A future tidy-up of `remote_ls` into
# `for-each-ref` would leave Cases 6, 7, 14 and 16 green against an
# implementation that had reintroduced `refs/spec-ids/org/<ID>`. Use
# `server_refs` (full, unfiltered, immune to hideRefs) only for "nothing was
# pushed" assertions.
#
# ---------------------------------------------------------------------------
# What continuous integration proves about reserve-spec-id.sh: nothing
# ---------------------------------------------------------------------------
# No CI job runs the tool. It is invoked by a human or by `spec-author` at
# pickup time, before a branch exists, so no pipeline is in a position to
# exercise it and none tries. THIS SUITE is the only automated thing that does,
# and a green pipeline says only that the suite ran.
#
# The sibling guard has the sharper version of the same trap, recorded in
# scripts/tests/test-check-spec-id-reserved.sh: check-spec-id-reserved DOES run
# in CI, and exits early and successfully whenever the change adds no spec file
# — most pull requests, including the one that introduced it. A green badge
# there reports that the check ran, not that it discriminated.
#
# Both belong next to the two rules below. All three are the same hazard —
# something is green for a reason other than the one a reader will assume — and
# the badge version is the most dangerous, because a badge carries more
# authority than a comment.
#
# ---------------------------------------------------------------------------
# A green shellcheck is necessary and NOT sufficient for this file
# ---------------------------------------------------------------------------
# An editing pass once left seven argument lines orphaned in command position,
# where they executed on every run. shellcheck flagged TWO of them (SC2287) and
# could not see the other five, which differed only in their contents. Removing
# the two it named silenced the linter while five stray commands kept running —
# the detector went quiet and the behaviour did not change, which is worse than
# the original defect because it manufactures evidence of correctness.
#
# The suite reported 78/0 throughout: a stray command fails, nothing consumes
# its status, and execution continues.
#
# So the check that actually works here is execution, not analysis:
#
#   LC_ALL=C bash scripts/tests/test-reserve-spec-id.sh 2>&1 \
#     | grep -c "command not found"      # MUST be 0
#
# Run that after any edit to this file. It is the fourth member of the family
# above and the sharpest instance of it, because here the false evidence came
# from a tool whose whole purpose is to supply true evidence.
#
# Usage:
#   bash scripts/tests/test-reserve-spec-id.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT_UNDER_TEST="$SCRIPT_DIR/reserve-spec-id.sh"

if [ ! -f "$SCRIPT_UNDER_TEST" ]; then
  echo "FATAL: cannot find $SCRIPT_UNDER_TEST" >&2
  exit 2
fi

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

# The canonical empty tree. Reservation objects carry no content; only the
# message and the absence of a parent matter.
EMPTY_TREE="4b825dc642cb6eb9a060e54bf8d69288fbee4904"

pass=0
fail=0

# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------

record_pass() {
  echo "PASS  $1"
  pass=$((pass + 1))
}

# record_fail <name> <detail>
record_fail() {
  echo "FAIL  $1"
  echo "      $2"
  [ -n "${TOOL_OUT:-}" ] && echo "      stdout: $TOOL_OUT"
  [ -n "${TOOL_ERR:-}" ] && echo "      stderr: $TOOL_ERR"
  fail=$((fail + 1))
}

# ---------------------------------------------------------------------------
# Fixture construction
# ---------------------------------------------------------------------------

# new_fixture <name> [<spec-path> ...]
# Build $TMP_ROOT/<name>/{bare.git,work}. `work` gets a `main` branch carrying
# the given spec paths (each an empty placeholder file) plus a carrier setting
# holding the default namespace, and two remotes — `crewrig` and `origin` —
# both pointing at the bare repository. Echoes nothing; use fixture_bare and
# fixture_work to address the result.
new_fixture() {
  local name="$1"; shift
  local root="$TMP_ROOT/$name"
  local bare="$root/bare.git"
  local work="$root/work"

  mkdir -p "$root"
  git init -q --bare "$bare"
  git init -q "$work"
  git -C "$work" config user.email "test@example.com"
  git -C "$work" config user.name "Test"
  git -C "$work" config commit.gpgsign false
  git -C "$work" symbolic-ref HEAD refs/heads/main

  mkdir -p "$work/specs" "$work/.crewrig"
  printf '# fixture carrier setting\ncarrier=refs/spec-ids/\n' > "$work/.crewrig/spec-id-carrier"

  local spec
  for spec in "$@"; do
    mkdir -p "$work/$(dirname "$spec")"
    printf '# placeholder\n' > "$work/$spec"
  done

  git -C "$work" add -A
  git -C "$work" commit -q -m "fixture"
  git -C "$work" remote add crewrig "$bare"
  git -C "$work" remote add origin "$bare"
  git -C "$work" push -q crewrig main
  git -C "$work" fetch -q crewrig
  git -C "$work" fetch -q origin
}

fixture_bare() { echo "$TMP_ROOT/$1/bare.git"; }
fixture_work() { echo "$TMP_ROOT/$1/work"; }

# set_carrier <name> <value>
set_carrier() {
  printf '# fixture carrier setting\ncarrier=%s\n' "$2" > "$TMP_ROOT/$1/work/.crewrig/spec-id-carrier"
}

# drop_carrier <name>
drop_carrier() {
  rm -f "$TMP_ROOT/$1/work/.crewrig/spec-id-carrier"
}

# make_reservation <name> <ref> <id> <issue>
# Plant a reservation directly with git, exactly as the tool would: a parentless
# object whose message follows PLAN step 1 verbatim.
make_reservation() {
  local name="$1" ref="$2" id="$3" issue="$4"
  local work; work="$(fixture_work "$name")"
  local obj
  obj="$(git -C "$work" commit-tree -m "reserve $id for issue #$issue" "$EMPTY_TREE")"
  git -C "$work" push -q crewrig "${obj}:${ref}"
}

# install_sleeping_hook <name> <seconds>
# Widen the window between a client's read and the server's ref update, so that
# two concurrent clients both observe the reservation ref absent before either
# push lands. Measured to produce exactly one winner and one
# `cannot lock ref …: reference already exists`.
install_sleeping_hook() {
  local bare; bare="$(fixture_bare "$1")"
  printf '#!/bin/bash\nsleep %s\nexit 0\n' "$2" > "$bare/hooks/pre-receive"
  chmod +x "$bare/hooks/pre-receive"
}

# ---------------------------------------------------------------------------
# Observation
# ---------------------------------------------------------------------------

# remote_ls <name> <pattern>
# The read the tool itself performs. `*` crosses `/`; see the header note.
remote_ls() {
  git ls-remote "$(fixture_bare "$1")" "$2" 2>/dev/null
}

# remote_count <name> <pattern>
remote_count() {
  remote_ls "$1" "$2" | grep -c . | tr -d ' '
}

# server_refs <name>
# Every ref the bare repository holds, unfiltered — authoritative even when
# `transfer.hideRefs` blinds `ls-remote`.
server_refs() {
  git -C "$(fixture_bare "$1")" for-each-ref --format='%(refname)'
}

# reservation_message <name> <ref>
reservation_message() {
  git -C "$(fixture_bare "$1")" log -1 --format='%s' "$2" 2>/dev/null
}

# ---------------------------------------------------------------------------
# Invocation
# ---------------------------------------------------------------------------

TOOL_RC=0
TOOL_OUT=""
TOOL_ERR=""

# run_tool <name> [args...]
run_tool() {
  local name="$1"; shift
  local work; work="$(fixture_work "$name")"
  local outfile="$TMP_ROOT/.stdout" errfile="$TMP_ROOT/.stderr"

  TOOL_RC=0
  ( cd "$work" && CREWRIG_REPO_DIR="$work" bash "$SCRIPT_UNDER_TEST" "$@" \
      > "$outfile" 2> "$errfile" ) || TOOL_RC=$?
  TOOL_OUT="$(cat "$outfile")"
  TOOL_ERR="$(cat "$errfile")"
}

# run_tool_env_carrier <name> <CREWRIG_SPEC_ID_CARRIER value> [args...]
# The documented one-off override. PLAN step 4 keeps it as a single-invocation
# escape hatch, never the normal configuration route — so it must be subject to
# the same closed-pair validation as the tracked setting.
run_tool_env_carrier() {
  local name="$1" carrier="$2"; shift 2
  local work; work="$(fixture_work "$name")"
  local outfile="$TMP_ROOT/.stdout" errfile="$TMP_ROOT/.stderr"

  TOOL_RC=0
  ( cd "$work" && CREWRIG_REPO_DIR="$work" CREWRIG_SPEC_ID_CARRIER="$carrier" \
      bash "$SCRIPT_UNDER_TEST" "$@" > "$outfile" 2> "$errfile" ) || TOOL_RC=$?
  TOOL_OUT="$(cat "$outfile")"
  TOOL_ERR="$(cat "$errfile")"
}

# use_single_remote <name> <remote-name>
# Replace both fixture remotes with one bearing an arbitrary name, to exercise
# the last arm of the resolution idiom.
use_single_remote() {
  local work; work="$(fixture_work "$1")"
  git -C "$work" remote remove crewrig
  git -C "$work" remote remove origin
  git -C "$work" remote add "$2" "$(fixture_bare "$1")"
  git -C "$work" fetch -q "$2"
}

# run_tool_bg <name> <tag> [args...]
# Same, but detached, recording the exit code and stdout under <tag> so two
# invocations can genuinely overlap.
run_tool_bg() {
  local name="$1" tag="$2"; shift 2
  local work; work="$(fixture_work "$name")"
  (
    rc=0
    ( cd "$work" && CREWRIG_REPO_DIR="$work" bash "$SCRIPT_UNDER_TEST" "$@" \
        > "$TMP_ROOT/$tag.out" 2> "$TMP_ROOT/$tag.err" ) || rc=$?
    echo "$rc" > "$TMP_ROOT/$tag.rc"
  ) &
}

bg_rc()  { cat "$TMP_ROOT/$1.rc"; }
bg_out() { tr -d '[:space:]' < "$TMP_ROOT/$1.out"; }

# ---------------------------------------------------------------------------
# Assertions
# ---------------------------------------------------------------------------

# expect_rc <name> <expected>
expect_rc() {
  if [ "$TOOL_RC" -eq "$2" ]; then
    record_pass "$1"
  else
    record_fail "$1" "expected exit $2, got $TOOL_RC"
  fi
}

# expect <name> <condition-description> <actual> <expected>
expect() {
  if [ "$3" = "$4" ]; then
    record_pass "$1"
  else
    record_fail "$1" "$2: expected [$4], got [$3]"
  fi
}

# expect_stderr_matches <name> <ere>
# Requirement 12 has two clauses — print the id on success, and THE REASON ON
# FAILURE — and the second one lives entirely on stderr. Asserting it needs a
# rule about what to match, because a message is prose and prose gets reworded
# legitimately. The rule these assertions follow is the one the reviewer drew
# for the sibling suite: match the IDENTIFYING content a caller must act on —
# the offending value, the missing flag, the command to run — never the
# sentence around it. Every pattern below survives any rewording that keeps the
# message useful, and fails any change that drops what the user needs.
expect_stderr_matches() {
  if printf '%s' "$TOOL_ERR" | grep -Eq "$2"; then
    record_pass "$1"
  else
    record_fail "$1" "stderr does not match /$2/"
  fi
}

# expect_stdout_matches <name> <ere>
expect_stdout_matches() {
  if printf '%s' "$TOOL_OUT" | grep -Eqi "$2"; then
    record_pass "$1"
  else
    record_fail "$1" "stdout does not match /$2/"
  fi
}

# expect_stdout_line <name> <line-number> <exact-content>
# The exit-3 payload is positional and machine-read, so its shape is asserted
# line by line rather than by a substring search anywhere in the output.
expect_stdout_line() {
  local actual
  actual="$(printf '%s\n' "$TOOL_OUT" | sed -n "$2p")"
  if [ "$actual" = "$3" ]; then
    record_pass "$1"
  else
    record_fail "$1" "stdout line $2: expected [$3], got [$actual]"
  fi
}

# expect_no_ref_matching <name> <fixture> <ere>
expect_no_ref_matching() {
  local hits
  hits="$(server_refs "$2" | grep -Ec "$3" | tr -d ' ')"
  if [ "$hits" = "0" ]; then
    record_pass "$1"
  else
    record_fail "$1" "expected no ref matching /$3/, found $hits: $(server_refs "$2" | grep -E "$3" | tr '\n' ' ')"
  fi
}

echo "=== reserve-spec-id.sh ==="

# ---------------------------------------------------------------------------
# Group A — the exit contract (PLAN step 2)
# ---------------------------------------------------------------------------

# Case 1 — the golden path, and simultaneously requirement 12: this is the exact
# command a human runs with no agent involved, and the id it secured is what it
# prints.
new_fixture c1 specs/0001-a.md specs/0002-b.md specs/0003-c.md
run_tool c1 --issue 900
expect_rc "Case 1 — allocation on a clean remote exits 0" 0
expect "Case 1 — the id is printed on stdout" "stdout" "$(printf '%s' "$TOOL_OUT" | tr -d '[:space:]')" "0004"
expect "Case 1 — the reservation is on the remote" "ref" \
  "$(remote_count c1 'refs/spec-ids/*')" "1"
expect "Case 1 — the reservation names the requesting issue" "message" \
  "$(reservation_message c1 refs/spec-ids/0004)" "reserve 0004 for issue #900"

# Case 2 — offline: the id is allocated and the caller is told, in a form a
# machine can act on, that it is not secured. Nothing reaches the remote.
new_fixture c2 specs/0001-a.md
run_tool c2 --issue 901 --offline
expect_rc "Case 2 — --offline exits 3" 3
expect_stdout_line "Case 2 — the id is on stdout line 1" 1 "0002"
expect_stdout_line "Case 2 — the unsecured marker is exactly line 2" 2 "unsecured-id: true"
# Exit 3 has a machine half and a human half, and only the machine half was
# pinned — four times over, which is what made the gap invisible. Stripping the
# explanation while keeping both payload lines left the suite at 61/0: an author
# on the offline path would get a bare id and a marker with no statement that
# anything was wrong. These two pin the human half, matching what makes it
# actionable rather than the sentences carrying it — that the REASON argument is
# rendered at all, and that the remediation names the id it applies to.
expect_stderr_matches "Case 2 — stderr states why the id is unsecured" '[-][-]offline'
expect_stderr_matches "Case 2 — and gives the command that secures it, for this id" 'reserve-spec-id[.]sh --id 0002'
expect_no_ref_matching "Case 2 — --offline pushes nothing" c2 '^refs/(spec-ids|tags/spec-id)'

# Case 3 — an unreachable remote is the same outcome as offline, not a failure.
# This is the fork/no-credential horn of exit 3 and the reason a contributor is
# never blocked by the reference repository being out of reach.
new_fixture c3 specs/0001-a.md
git -C "$(fixture_work c3)" remote set-url crewrig "$TMP_ROOT/c3/absent.git"
git -C "$(fixture_work c3)" remote set-url origin "$TMP_ROOT/c3/absent.git"
run_tool c3 --issue 902
expect_rc "Case 3 — an unreachable remote exits 3" 3
# Exit 3 is half the contract; the payload is the other half, and this branch is
# exercised by no other case. Cases 2 and 21 pin the payload on the offline and
# hidden-namespace paths, which is what made this one look covered — it is not.
# Measured: replacing this branch with a bare `exit 3`, emitting no id and no
# marker, survived the whole suite at 59/0 while these two assertions were
# missing. The caller cannot proceed on an exit code alone: `spec-author` needs
# the id in order to name the file, and the marker in order to write the
# frontmatter, so a silent 3 is indistinguishable to it from a crash.
expect_stdout_line "Case 3 — the allocated id is still emitted" 1 "0002"
expect_stdout_line "Case 3 — and the unsecured marker with it" 2 "unsecured-id: true"

# Case 4 — a carrier value outside the closed pair is a genuine failure, refused
# before any push. PLAN step 4: this closes the typo path in which
# `refs/spec-id/` would write into a third namespace that neither the allocation
# union nor the pull-request check ever reads.
new_fixture c4 specs/0001-a.md
set_carrier c4 'refs/spec-id/'
run_tool c4 --issue 903
expect_rc "Case 4 — a carrier outside the closed pair exits 1" 1
# Requirement 12's second clause: the reason on failure. The offending VALUE is
# what the adopter must act on — they have to find it in their settings file —
# so that is what is pinned, not the sentence around it.
expect_stderr_matches "Case 4 — and stderr names the offending carrier value" 'refs/spec-id/'
expect_no_ref_matching "Case 4 — an invalid carrier pushes nothing" c4 '^refs/spec-id'
expect "Case 4 — an invalid carrier prints nothing on stdout" "stdout" "$TOOL_OUT" ""

# ---------------------------------------------------------------------------
# Group B — the allocated set (requirement 3 as replaced, PLAN step 1)
# ---------------------------------------------------------------------------

# Case 5 — one number pins three properties at once. With 0001-0005 merged,
# 0006 reserved under the primary carrier, 0007 under the tag carrier and 0008
# under the ORG namespace, the only correct answer is 0008:
#   0006  → the union reads refs/spec-ids/*
#   0007  → the union also reads refs/tags/spec-id/*  (mid-transition safety)
#   0009  → would mean the org reservation had leaked into the upstream union,
#           which the replaced requirement 3 forbids.
new_fixture c5 specs/0001-a.md specs/0002-b.md specs/0003-c.md specs/0004-d.md specs/0005-e.md
make_reservation c5 refs/spec-ids/0006 0006 700
make_reservation c5 refs/tags/spec-id/0007 0007 701
make_reservation c5 refs/spec-ids-org/0008 0008 702
run_tool c5 --issue 904
expect_rc "Case 5 — allocation over a mixed remote exits 0" 0
expect "Case 5 — the union spans both upstream carriers and excludes the org namespace" \
  "allocated id" "$(printf '%s' "$TOOL_OUT" | tr -d '[:space:]')" "0008"

# Case 6 — a spec merged under specs/org/ is org-owned content and is not an
# upstream id. An implementation globbing specs/ without the exclusion returns
# 0005 here and fails.
new_fixture c6 specs/0001-a.md specs/0002-b.md specs/0003-c.md specs/org/0004-org-thing.md
run_tool c6 --issue 905
expect "Case 6 — a merged specs/org/ spec does not consume an upstream id" \
  "allocated id" "$(printf '%s' "$TOOL_OUT" | tr -d '[:space:]')" "0004"

# ---------------------------------------------------------------------------
# Group C — atomicity (requirement 1)
# ---------------------------------------------------------------------------

# Case 7 — two sessions allocating at the same instant obtain distinct ids and
# both proceed. This is requirement 1 stated as a whole: no interval in which
# both observe success on one id, and the loser retries with no human involved.
new_fixture c7 specs/0001-a.md
run_tool_bg c7 c7a --issue 910
run_tool_bg c7 c7b --issue 911
wait
expect "Case 7 — first concurrent session exits 0" "exit" "$(bg_rc c7a)" "0"
expect "Case 7 — second concurrent session exits 0" "exit" "$(bg_rc c7b)" "0"
if [ "$(bg_out c7a)" != "$(bg_out c7b)" ]; then
  record_pass "Case 7 — two concurrent sessions obtain distinct ids"
else
  record_fail "Case 7 — two concurrent sessions obtain distinct ids" \
    "both received [$(bg_out c7a)]"
fi
expect "Case 7 — the remote holds one reservation per session" "count" \
  "$(remote_count c7 'refs/spec-ids/*')" "2"

# Case 8 — a TRUE race on one identifier: the sleeping pre-receive hook holds
# the winner's ref update long enough that both clients have already read the
# reservation absent. Exactly one is allowed to win. Without the server-side
# create-only compare-and-swap both would exit 0 and one id would have two
# holders — the single outcome spec 0112 exists to prevent.
new_fixture c8 specs/0001-a.md
install_sleeping_hook c8 2
run_tool_bg c8 c8a --id 0500 --issue 920
run_tool_bg c8 c8b --id 0500 --issue 921
wait
winners=0
[ "$(bg_rc c8a)" = "0" ] && winners=$((winners + 1))
[ "$(bg_rc c8b)" = "0" ] && winners=$((winners + 1))
expect "Case 8 — a true race on one identifier leaves exactly one winner" \
  "sessions exiting 0" "$winners" "1"
expect "Case 8 — the identifier has exactly one holder on the remote" "count" \
  "$(remote_count c8 'refs/spec-ids/*')" "1"
holder="$(reservation_message c8 refs/spec-ids/0500)"
if [ "$holder" = "reserve 0500 for issue #920" ] || [ "$holder" = "reserve 0500 for issue #921" ]; then
  record_pass "Case 8 — the surviving reservation names exactly one of the two tickets"
else
  record_fail "Case 8 — the surviving reservation names exactly one of the two tickets" \
    "holder message is [$holder]"
fi
rm -f "$(fixture_bare c8)/hooks/pre-receive"

# Case 9 — the same guard on the sequential path: an identifier already held is
# refused, and the incumbent is left untouched. A second holder must not be able
# to overwrite the first by asking again.
new_fixture c9 specs/0001-a.md
make_reservation c9 refs/spec-ids/0600 0600 930
run_tool c9 --id 0600 --issue 931
if [ "$TOOL_RC" -ne 0 ]; then
  record_pass "Case 9 — securing an identifier another ticket holds is refused"
  expect_stderr_matches "Case 9 — and stderr names the ticket already holding it" '#930'
else
  record_fail "Case 9 — securing an identifier another ticket holds is refused" \
    "expected a non-zero exit, got 0"
fi
expect "Case 9 — the incumbent reservation is unchanged" "message" \
  "$(reservation_message c9 refs/spec-ids/0600)" "reserve 0600 for issue #930"

# Case 10 — the distinct sequential path the parentless object closes. The
# server's create-only lock does NOT protect an occupied ref against a
# DESCENDANT of the object it holds: that push is an ordinary fast-forward and
# is accepted. The arrange step below reproduces exactly that, on a scratch ref,
# so the case fails loudly if git's behaviour ever changes. What keeps the
# guarantee is therefore a property of the object the tool builds — it has no
# parent, so no later object can descend from it — and that is what the
# assertion pins.
new_fixture c10 specs/0001-a.md
run_tool c10 --issue 940
scratch_work="$(fixture_work c10)"
git -C "$scratch_work" fetch -q crewrig 'refs/spec-ids/*:refs/observed/*'
held="$(git -C "$scratch_work" rev-parse refs/observed/0002 2>/dev/null)"
descendant="$(git -C "$scratch_work" commit-tree -p "$held" -m "reserve 0002 for issue #666" "$EMPTY_TREE")"
# Occupy a scratch ref with the reservation itself, then push a descendant of it
# at that same ref: an ordinary fast-forward, which the server accepts.
if git -C "$scratch_work" push -q crewrig "${held}:refs/scratch/0002" 2>/dev/null &&
   git -C "$scratch_work" push -q crewrig "${descendant}:refs/scratch/0002" 2>/dev/null; then
  record_pass "Case 10 — a descendant IS accepted at an occupied ref (the hazard is real)"
else
  record_fail "Case 10 — a descendant IS accepted at an occupied ref (the hazard is real)" \
    "the fast-forward push was refused; the premise of the parentless design no longer holds"
fi
parents="$(git -C "$scratch_work" cat-file -p "$held" | grep -c '^parent' | tr -d ' ')"
expect "Case 10 — the reservation object is parentless, so nothing can descend from it" \
  "parent count" "$parents" "0"

# ---------------------------------------------------------------------------
# Group D — maintainer mode and the two corpora (R14, R15, R16)
# ---------------------------------------------------------------------------

# Case 11 — the maintainer obligation of requirement 10: secure one specific id
# for one specific ticket, typically a fork contribution's id before merge.
new_fixture c11 specs/0001-a.md
run_tool c11 --id 0700 --issue 950
expect_rc "Case 11 — --id/--issue secures the named identifier" 0
expect "Case 11 — the reservation lands under the upstream namespace" "message" \
  "$(reservation_message c11 refs/spec-ids/0700)" "reserve 0700 for issue #950"

# Case 12 — the delta's first scenario. `RFC_2026_07` is deliberately of a form
# upstream has never seen: not four digits, not the `ORG-` example of spec 0071.
# The tool must secure it while asserting nothing about its shape (R14), and a
# second attempt on it must be refused.
new_fixture c12 specs/0001-a.md
run_tool c12 --corpus org --id RFC_2026_07 --issue 960
expect_rc "Case 12 — an org identifier of an unseen form is secured" 0
expect "Case 12 — it lands in the org namespace" "count" \
  "$(remote_count c12 'refs/spec-ids-org/*')" "1"
expect "Case 12 — no upstream identifier is affected" "count" \
  "$(remote_count c12 'refs/spec-ids/*')" "0"
run_tool c12 --corpus org --id RFC_2026_07 --issue 961
if [ "$TOOL_RC" -ne 0 ]; then
  record_pass "Case 12 — a second attempt on the same org identifier is refused"
  expect_stderr_matches "Case 12 — and stderr names the ticket already holding it" '#960'
else
  record_fail "Case 12 — a second attempt on the same org identifier is refused" \
    "expected a non-zero exit, got 0"
fi
expect "Case 12 — the org identifier still has exactly one holder" "message" \
  "$(reservation_message c12 refs/spec-ids-org/RFC_2026_07)" "reserve RFC_2026_07 for issue #960"

# Case 13 — the delta's second scenario. An upstream 0042 and an org 0042 are a
# conformant state, not a collision: they live in different namespaces and hold
# different things. Both must succeed.
new_fixture c13 specs/0001-a.md
run_tool c13 --id 0042 --issue 970
expect_rc "Case 13 — the upstream 0042 is secured" 0
run_tool c13 --corpus org --id 0042 --issue 971
expect_rc "Case 13 — the org 0042 is secured alongside it" 0

# Case 14 — the other half of that scenario, and the assertion the nested
# namespace would defeat. This reads the upstream namespace exactly as the tool
# does; if org reservations were placed at refs/spec-ids/org/<ID> the count
# would be 2 and this fails. See the header note on ls-remote versus
# for-each-ref before touching this.
expect "Case 14 — a read of the upstream namespace does not return the org reservation" \
  "upstream refs" "$(remote_count c13 'refs/spec-ids/*')" "1"
expect "Case 14 — the org reservation is where it belongs" "org refs" \
  "$(remote_count c13 'refs/spec-ids-org/*')" "1"

# Case 15 — requirement 16: upstream computes no org identifier, and says so
# rather than silently falling back to an upstream computation, which would
# hand the caller a four-digit id for an org spec.
new_fixture c15 specs/0001-a.md
run_tool c15 --corpus org --issue 980
expect_rc "Case 15 — --corpus org without --id exits 1" 1
expect_stderr_matches "Case 15 — and stderr names the flag that would make it work" '[-][-]id'
expect_no_ref_matching "Case 15 — no reservation is created" c15 '^refs/(spec-ids|tags/spec-id)'

# Case 16 — R14 calls the identifier opaque, but the carrier is a git ref and a
# ref name cannot contain a space. The refusal must come before any push, so an
# organization learns the constraint at qualification time rather than from a
# raw git diagnostic.
new_fixture c16 specs/0001-a.md
run_tool c16 --corpus org --id 'ORG 0001' --issue 981
expect_rc "Case 16 — an identifier containing a space exits 1" 1
expect_stderr_matches "Case 16 — and stderr names the rejected identifier" 'ORG 0001'
expect_no_ref_matching "Case 16 — nothing is pushed before the refusal" c16 '^refs/(spec-ids|tags/spec-id)'

# Case 17 — the same rule at its least obvious boundary. A trailing `.lock` is
# rejected by git for reasons no naive character-class check anticipates, which
# is why the tool is expected to delegate to `git check-ref-format` rather than
# reimplement the rule.
new_fixture c17 specs/0001-a.md
run_tool c17 --corpus org --id 'ORG-0001.lock' --issue 982
expect_rc "Case 17 — an identifier ending in .lock exits 1" 1
expect_stderr_matches "Case 17 — and stderr names the rejected identifier" 'ORG-0001[.]lock'
expect_no_ref_matching "Case 17 — nothing is pushed before the refusal" c17 '^refs/(spec-ids|tags/spec-id)'

# ---------------------------------------------------------------------------
# Group E — the carrier setting (PLAN steps 3, 4, 5)
# ---------------------------------------------------------------------------

# Case 18 — an adopter whose remote refuses the default namespace changes one
# tracked setting, and every contributor in that repository writes to the tag
# namespace by construction.
new_fixture c18 specs/0001-a.md
set_carrier c18 'refs/tags/spec-id/'
run_tool c18 --issue 990
expect_rc "Case 18 — the tag carrier secures an id" 0
expect "Case 18 — the reservation lands under the tag carrier" "count" \
  "$(remote_count c18 'refs/tags/spec-id/*')" "1"
expect "Case 18 — the default namespace stays empty" "count" \
  "$(remote_count c18 'refs/spec-ids/*')" "0"

# Case 19 — the sibling rule holds on the alternative carrier too. An org
# reservation under the tag carrier belongs at refs/tags/spec-id-org/<ID>;
# nesting it at refs/tags/spec-id/org/<ID> reintroduces the same defect one
# namespace over, where the upstream tag read would return it.
new_fixture c19 specs/0001-a.md
set_carrier c19 'refs/tags/spec-id/'
run_tool c19 --corpus org --id ORG-0009 --issue 991
expect_rc "Case 19 — the tag carrier secures an org identifier" 0
expect "Case 19 — it lands in the org tag namespace" "count" \
  "$(remote_count c19 'refs/tags/spec-id-org/*')" "1"
expect "Case 19 — the upstream tag read does not return it" "count" \
  "$(remote_count c19 'refs/tags/spec-id/*')" "0"

# Case 20 — the setting is registered `excluded`, so the synchroniser never
# restores it and a fork that deletes the file must still work. Absent is the
# built-in default, never an error.
new_fixture c20 specs/0001-a.md
drop_carrier c20
run_tool c20 --issue 992
expect_rc "Case 20 — an absent carrier setting falls back to the built-in default" 0
expect "Case 20 — the fallback is the shipped namespace" "count" \
  "$(remote_count c20 'refs/spec-ids/*')" "1"

# Case 21 — the failure mode that motivated making the carrier a repository
# setting instead of a runtime inference. Inside a hidden namespace the read
# reports the id absent and the push is refused, which is indistinguishable
# from an empty namespace. The tool must degrade to exit 3 and stop: switching
# carrier here would secure the id a second time in the tag namespace and mint
# the duplicate holder this spec exists to prevent.
new_fixture c21 specs/0001-a.md
git -C "$(fixture_bare c21)" config transfer.hideRefs refs/spec-ids
run_tool c21 --issue 993
expect_rc "Case 21 — a hidden namespace yields exit 3" 3
expect_stdout_line "Case 21 — the id is reported unsecured in the contracted shape" 2 "unsecured-id: true"
expect_no_ref_matching "Case 21 — no carrier switch: the tag namespace is untouched" \
  c21 '^refs/tags/spec-id'
expect_no_ref_matching "Case 21 — no second holder of the id anywhere" \
  c21 '^refs/(spec-ids|spec-ids-org|tags/spec-id)'

# Case 22 — the closed-pair validation covers the one-off environment override
# too, not only the tracked file. The override exists so a contributor can try
# the other carrier once without opening a pull request; if it were trusted
# where the file is validated, the typo path PLAN step 4 closes would simply
# move from the file to the environment — and a namespace neither the union nor
# the pull-request check reads is exactly as invisible either way.
new_fixture c22 specs/0001-a.md
run_tool_env_carrier c22 'refs/spec-id/' --issue 994
expect_rc "Case 22 — an invalid CREWRIG_SPEC_ID_CARRIER override exits 1" 1
expect_stderr_matches "Case 22 — and stderr names the offending override value" 'refs/spec-id/'
expect_no_ref_matching "Case 22 — an invalid override pushes nothing" c22 '^refs/spec-id'

# Case 23 — the last arm of the remote-resolution idiom. A contributor whose
# only remote is named neither `crewrig` nor `origin` — a fork clone named
# `upstream`, or any personal convention — must still be able to secure an id;
# requirement 4 grants no licence to require a particular remote name. This also
# pins that the remote is resolved by NAME rather than by a hard-coded URL,
# which is what makes the whole suite hermetic in the first place.
new_fixture c23 specs/0001-a.md
use_single_remote c23 upstream
run_tool c23 --issue 995
expect_rc "Case 23 — a remote named neither crewrig nor origin still secures an id" 0
expect "Case 23 — the reservation reached that remote" "count" \
  "$(remote_count c23 'refs/spec-ids/*')" "1"

# ---------------------------------------------------------------------------
# Requirement 12 across the argument and configuration refusals
# ---------------------------------------------------------------------------
# R12 exists because the tool is invocable directly by a human with no agent
# involved, so its failure paths are read by a person deciding what to type
# next. There are fourteen `fail` sites; the cases above reach three of them.
# The four below cover the refusals a human actually hits — a mistyped flag, a
# forgotten argument, a bad value, a misconfigured setting — and each asserts
# the identifying content that makes the message actionable rather than the
# sentence carrying it.
#
# Deliberately not covered, and this is a judgement rather than an oversight:
# the CREWRIG_SPEC_ID_MAX_ATTEMPTS validations and the empty-identifier guard,
# which need an env var a user rarely sets or an argument they cannot easily
# type; and the retry-exhaustion refusal, which is not reachable hermetically
# at all — it needs a real competitor winning every round, and every substitute
# collapses into a different branch. Covering the first two would be assertions
# for their own sake; the third is a known gap, reported rather than faked.

# Case 24 — the most common invocation error there is: the flag is required and
# was not supplied. The message must name it, because the user's next action is
# to type it.
new_fixture c24 specs/0001-a.md
run_tool c24
expect_rc "Case 24 — a missing --issue exits 1" 1
expect_stderr_matches "Case 24 — and stderr names the missing flag" '[-][-]issue'

# Case 25 — a mistyped flag. Naming the offending token is what separates "you
# typed something I do not know" from a usage dump the reader has to diff
# against what they typed.
new_fixture c25 specs/0001-a.md
run_tool c25 --isue 900
expect_rc "Case 25 — an unknown argument exits 1" 1
expect_stderr_matches "Case 25 — and stderr names the offending argument" '[-][-]isue'

# Case 26 — a well-formed flag with a value the tool cannot use. The value is
# the actionable content: the user has to find it in what they typed.
new_fixture c26 specs/0001-a.md
run_tool c26 --issue not-a-number
expect_rc "Case 26 — a non-integer --issue exits 1" 1
expect_stderr_matches "Case 26 — and stderr names the offending value" 'not-a-number'

# Case 27 — the carrier setting present but naming no namespace. This is the
# silent-fallback path: before it was made a hard refusal, a file an adopter had
# edited into an unparseable state resolved quietly to the built-in default, so
# an adopter whose remote refuses that default would have gone on writing to it
# and seen exit 3 forever with nothing pointing at the file they had just
# changed. The refusal is only useful if it names the file.
new_fixture c27 specs/0001-a.md
printf '# a carrier setting with every line commented out\n# carrier=refs/tags/spec-id/\n' \
  > "$(fixture_work c27)/.crewrig/spec-id-carrier"
run_tool c27 --issue 900
expect_rc "Case 27 — a carrier setting naming no namespace exits 1" 1
expect_stderr_matches "Case 27 — and stderr names the file to fix" 'spec-id-carrier'

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "Results: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
