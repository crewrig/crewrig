#!/bin/bash
# test-check-spec-id-reserved.sh — Regression tests for check-spec-id-reserved.sh
# (spec 0112 requirements 7, 10, 11 as amended by delta-01, issue #726).
#
# Every case runs against a LOCAL BARE REPOSITORY under a temporary directory.
# No network, no forge command-line tool, no reliance on crewrig/crewrig. Each
# fixture is self-contained and torn down with the temporary root.
#
# ---------------------------------------------------------------------------
# Invocation surface assumed by this suite
# ---------------------------------------------------------------------------
#   scripts/check-spec-id-reserved.sh          no arguments; a CI check
#
#   Base of the change    BASE_REF, the name spec 0109 established and that
#                         .github/workflows/build.yml already passes three times.
#   Pull-request origin   Two pairs, either of which determines the origin. The
#                         CrewRig pair is consulted first, the GitLab pair
#                         second; both unset is the undeterminable case.
#
#                           CREWRIG_PR_HEAD_REPO / CREWRIG_PR_BASE_REPO
#                             GitHub Actions. .github/workflows/build.yml maps
#                             github.event.pull_request.head.repo.full_name and
#                             github.repository into these. They are NOT named
#                             GITHUB_*: GitHub reserves that prefix, so such a
#                             name would be fragile in the very `env:` block
#                             that has to set it — and there is no native
#                             head-repo variable to mirror anyway, since
#                             GITHUB_HEAD_REF is the branch, not the repository.
#                             A name that reads as native while being something
#                             GitHub does not publish is a trap for whoever
#                             maintains this next.
#
#                           CI_MERGE_REQUEST_SOURCE_PROJECT_PATH / CI_PROJECT_PATH
#                             GitLab CI, where both are already ambient. These
#                             are the only origin variables PLAN v9 step 11 pins
#                             verbatim.
#   Reference remote      Fixtures carry BOTH a `crewrig` and an `origin` remote
#                         pointing at the same bare repository.
#
#   Reservation record    A parentless object at refs/spec-ids/<ID> or
#                         refs/tags/spec-id/<ID> whose message is, verbatim per
#                         PLAN step 1, `reserve <ID> for issue #<N>`.
#
# Verdicts: exit 0 = the pull request may proceed (including the cases the check
# reports on without blocking); non-zero = the check fails the pipeline. PLAN v9
# pins no particular non-zero value, so this suite asserts the distinction and
# not a numeral.
#
# ---------------------------------------------------------------------------
# One harness rule that is load-bearing, not stylistic
# ---------------------------------------------------------------------------
# Namespace reads use `git ls-remote <bare> '<pattern>'`, never
# `git -C <bare> for-each-ref '<pattern>'`. Measured on git 2.55.0, `ls-remote`
# returns `refs/spec-ids/org/ORG-0001` for the pattern `refs/spec-ids/*` while
# `for-each-ref` does not — the `*` of a refspec crosses `/`. Case 5 depends on
# that distinction to catch a nested org namespace; rewriting it with
# `for-each-ref` would leave it green against the defect it exists to find.
#
# ---------------------------------------------------------------------------
# What a green `check-spec-id-reserved` job in CI does and does not prove
# ---------------------------------------------------------------------------
# It does not prove the guard works. The check exits early, successfully, when
# the change under test adds or renames no spec file — which is most pull
# requests, including the one that introduced the guard itself. A green badge on
# such a run reports that the check RAN, not that it discriminated: it never
# reached a candidate, never read a reservation, and never took a branch this
# suite covers.
#
# That is the same green-for-the-wrong-reason hazard the two rules below guard
# against, arriving in the CI job rather than in a test, and it is the more
# dangerous of the three because a badge carries more authority than a comment.
# THIS SUITE is what exercises the guard, by constructing the repositories the
# early exit means CI will rarely present. Read a green job as "no spec entered
# the corpus here" and a green suite as "the guard discriminates".
#
# Usage:
#   bash scripts/tests/test-check-spec-id-reserved.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT_UNDER_TEST="$SCRIPT_DIR/check-spec-id-reserved.sh"

if [ ! -f "$SCRIPT_UNDER_TEST" ]; then
  echo "FATAL: cannot find $SCRIPT_UNDER_TEST" >&2
  exit 2
fi

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

EMPTY_TREE="4b825dc642cb6eb9a060e54bf8d69288fbee4904"
REFERENCE_REPO="crewrig/crewrig"

pass=0
fail=0

record_pass() {
  echo "PASS  $1"
  pass=$((pass + 1))
}

record_fail() {
  echo "FAIL  $1"
  echo "      $2"
  fail=$((fail + 1))
}

# ---------------------------------------------------------------------------
# Fixture construction
# ---------------------------------------------------------------------------

# render_spec <id> <slug> <related-issue> [<extra-frontmatter-line>]
# The fourth argument carries an optional extra frontmatter line, which is how
# the `unsecured-id: true` mark is placed. Absent by default, matching
# docs/spec-format.md: the field carries meaning only when present and true.
render_spec() {
  local extra="${4:-}"
  cat <<EOF
---
id: "$1"
slug: "$2"
status: draft
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: $3
version: 1.0.0${extra:+
$extra}
---

# Title

## Intent

## Requirements

## Scenarios

## Out of scope

## Open questions
EOF
}

# new_fixture <name>
# Build $TMP_ROOT/<name>/{bare.git,work}. `work` is on a feature branch whose
# merge base with origin/main is the fixture commit, which is the shape the
# check reads: the change under test is everything since BASE_REF.
new_fixture() {
  local name="$1"
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
  # The sync manifest, in the shape the real repository carries it. The check
  # derives which spec paths are org-owned from the `excluded` entries here
  # rather than hardcoding `specs/org`, which is the spec 0071 R5 mechanism.
  printf 'specs\tstrict\nspecs/org\texcluded\n' > "$work/.crewrig/core-paths.txt"
  printf '# base\n' > "$work/README.md"
  git -C "$work" add -A
  git -C "$work" commit -q -m "base"
  git -C "$work" remote add crewrig "$bare"
  git -C "$work" remote add origin "$bare"
  git -C "$work" push -q crewrig main
  git -C "$work" fetch -q crewrig
  git -C "$work" fetch -q origin
  git -C "$work" checkout -q -b feature
}

fixture_bare() { echo "$TMP_ROOT/$1/bare.git"; }
fixture_work() { echo "$TMP_ROOT/$1/work"; }

# commit_on_base <name> <path> <content-command...>
# Add a file to main BEFORE the branch point, so it is not part of the change
# under test.
add_to_base() {
  local name="$1" path="$2" id="$3" slug="$4" issue="$5"
  local work; work="$(fixture_work "$name")"
  git -C "$work" checkout -q main
  mkdir -p "$work/$(dirname "$path")"
  render_spec "$id" "$slug" "$issue" > "$work/$path"
  git -C "$work" add -A
  git -C "$work" commit -q -m "base: $path"
  git -C "$work" push -q crewrig main
  git -C "$work" fetch -q crewrig
  git -C "$work" fetch -q origin
  git -C "$work" branch -q -f feature main
  git -C "$work" checkout -q feature
}

# add_spec <name> <path> <id> <slug> <issue> [<extra-frontmatter-line>]
# The pull request adds a spec file on the feature branch.
add_spec() {
  local name="$1" path="$2" id="$3" slug="$4" issue="$5" extra="${6:-}"
  local work; work="$(fixture_work "$name")"
  mkdir -p "$work/$(dirname "$path")"
  render_spec "$id" "$slug" "$issue" "$extra" > "$work/$path"
  git -C "$work" add -A
  git -C "$work" commit -q -m "add $path"
}

# The mark scripts/reserve-spec-id.sh emits on its exit-3 path, in the exact
# shape the author pastes into the frontmatter.
UNSECURED_MARK="unsecured-id: true"

# add_raw <name> <path> <body>
add_raw() {
  local name="$1" path="$2" body="$3"
  local work; work="$(fixture_work "$name")"
  mkdir -p "$work/$(dirname "$path")"
  printf '%s\n' "$body" > "$work/$path"
  git -C "$work" add -A
  git -C "$work" commit -q -m "add $path"
}

# rename_spec <name> <from> <to> <new-id> <new-slug> <issue>
# Rewrites the frontmatter alongside the path, so the filename id and the
# frontmatter id agree — docs/spec-format.md requires that, and a check
# resolving the id from either source must reach the same verdict.
rename_spec() {
  local name="$1" from="$2" to="$3" id="$4" slug="$5" issue="$6"
  local work; work="$(fixture_work "$name")"
  git -C "$work" mv "$from" "$to"
  render_spec "$id" "$slug" "$issue" > "$work/$to"
  git -C "$work" add -A
  git -C "$work" commit -q -m "rename $from -> $to"
}

# reserve <name> <ref> <id> <issue>
reserve() {
  local name="$1" ref="$2" id="$3" issue="$4"
  local work; work="$(fixture_work "$name")"
  local obj
  obj="$(git -C "$work" commit-tree -m "reserve $id for issue #$issue" "$EMPTY_TREE")"
  git -C "$work" push -q crewrig "${obj}:${ref}"
}

# new_release_fixture <name>
# A repository with a live release line. `main` carries no specs; `release/1.x`
# branched from the same root and carries one spec of its own — a hotfix spec
# authored on the release line and never forward-ported, which is the ordinary
# way a release branch comes to hold something `main` does not. The feature
# branch then targets `release/1.x`.
#
# This shape is what makes a wrong base ref observable. Resolved against
# `release/1.x` the change under test is one spec; resolved against `main` it is
# two, and the extra one belongs to another ticket.
new_release_fixture() {
  local name="$1"
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
  printf 'specs\tstrict\nspecs/org\texcluded\n' > "$work/.crewrig/core-paths.txt"
  printf '# base\n' > "$work/README.md"
  git -C "$work" add -A
  git -C "$work" commit -q -m "root"
  git -C "$work" remote add crewrig "$bare"
  git -C "$work" remote add origin "$bare"
  git -C "$work" push -q crewrig main

  # The release line, carrying a third party's hotfix spec that main never got.
  git -C "$work" checkout -q -b release/1.x
  render_spec "0300" "someone-elses-hotfix" "700" > "$work/specs/0300-someone-elses-hotfix.md"
  git -C "$work" add -A
  git -C "$work" commit -q -m "release: a hotfix spec belonging to issue #700"
  git -C "$work" push -q crewrig release/1.x

  git -C "$work" fetch -q crewrig
  git -C "$work" fetch -q origin
  git -C "$work" checkout -q -b feature
}

# break_remote <name>
break_remote() {
  local work; work="$(fixture_work "$1")"
  git -C "$work" remote set-url crewrig "$TMP_ROOT/$1/absent.git"
  git -C "$work" remote set-url origin "$TMP_ROOT/$1/absent.git"
}

# ---------------------------------------------------------------------------
# Invocation
# ---------------------------------------------------------------------------

CHECK_RC=0
CHECK_LOG=""

# run_check <name> [<VAR=value> ...]
# A caller supplies whichever origin signal the case is about. Every variable
# the check consults for origin is cleared first — and exactly those, so the
# unset list does not document a contract that does not exist.
#
# The clearing is not defensive housekeeping; two of these leak for real.
# `CREWRIG_SPEC_ID_ORIGIN` is honoured outside CI, so a maintainer who exported
# it in order to run the check by hand — the very workflow it exists for — would
# otherwise turn Case 11 green on their machine and red in CI, or the reverse.
# The three CI markers select which branch of determine_origin runs, so leaving
# them ambient would mean this suite exercises a different code path on a laptop
# than on a runner. Cleared here and set explicitly by the cases that are about
# them, so every case pins one defined behaviour everywhere it runs.
run_check() {
  local name="$1"; shift
  run_check_based "$name" "origin/main" "$@"
}

# run_check_based <name> <base-ref-or-empty> [<VAR=value> ...]
# As run_check, but the base ref is explicit, and an EMPTY value means BASE_REF
# is not set at all — the shape a GitLab merge-request pipeline presents, and
# the only shape in which the base-resolution fallbacks are reachable.
# CI_MERGE_REQUEST_TARGET_BRANCH_NAME is cleared for the same reason as the
# origin variables: it is a base signal the check consults, so leaving it
# ambient would let a real merge-request runner decide what these cases pin.
run_check_based() {
  local name="$1" base="$2"; shift 2
  local work; work="$(fixture_work "$name")"

  # BASE_REF is always cleared by flag and re-supplied as an assignment when the
  # case wants it. `env` stops parsing options at the first VAR=value argument,
  # so every -u must precede every assignment; a -u placed after one is taken as
  # the command name and the run dies with 127 — which a case expecting failure
  # scores as a pass. That is not hypothetical: it happened here once.
  if [ -n "$base" ]; then
    set -- "BASE_REF=$base" "$@"
  fi

  CHECK_RC=0
  ( cd "$work" && env \
      -u BASE_REF \
      -u CREWRIG_PR_HEAD_REPO \
      -u CREWRIG_PR_BASE_REPO \
      -u CI_MERGE_REQUEST_SOURCE_PROJECT_PATH \
      -u CI_PROJECT_PATH \
      -u CI_MERGE_REQUEST_TARGET_BRANCH_NAME \
      -u CREWRIG_SPEC_ID_ORIGIN \
      -u CI \
      -u GITHUB_ACTIONS \
      -u GITLAB_CI \
      CREWRIG_REPO_DIR="$work" \
      "$@" \
      bash "$SCRIPT_UNDER_TEST" > "$TMP_ROOT/.check.log" 2>&1 ) || CHECK_RC=$?
  CHECK_LOG="$(cat "$TMP_ROOT/.check.log")"
}

# run_check_same_repo <name>
# The GitLab pair, same-repository. The default for cases that are about
# something other than origin detection.
run_check_same_repo() {
  run_check "$1" \
    "CI_MERGE_REQUEST_SOURCE_PROJECT_PATH=$REFERENCE_REPO" \
    "CI_PROJECT_PATH=$REFERENCE_REPO"
}

# ---------------------------------------------------------------------------
# Assertions
# ---------------------------------------------------------------------------

expect_pass_verdict() {
  if [ "$CHECK_RC" -eq 0 ]; then
    record_pass "$1"
  else
    record_fail "$1" "expected exit 0, got $CHECK_RC"$'\n      '"$CHECK_LOG"
  fi
}

expect_fail_verdict() {
  if [ "$CHECK_RC" -ne 0 ]; then
    record_pass "$1"
  else
    record_fail "$1" "expected a non-zero exit, got 0"$'\n      '"$CHECK_LOG"
  fi
}

# expect_wiring_fault <name>
# A wiring fault is exit 2 specifically, which is what separates a deliberate
# refusal from the script falling over. Both are non-zero and both print the
# offending variable's name, so a `-ne 0` assertion cannot tell "refused to
# guess, here is how to wire it" from an unbound-variable crash that happens to
# mention the same identifier.
expect_wiring_fault() {
  if [ "$CHECK_RC" -eq 2 ]; then
    record_pass "$1"
  else
    record_fail "$1" "expected exit 2 (wiring fault), got $CHECK_RC"$'\n      '"$CHECK_LOG"
  fi
}

# expect_log_not_matching <name> <ere>
# For the findings that must NOT appear. A verdict alone cannot express "the
# right file was blamed": a run can reach the right exit code while having drawn
# the wrong specs into the change under test.
expect_log_not_matching() {
  if printf '%s' "$CHECK_LOG" | grep -Eq "$2"; then
    record_fail "$1" "output matches /$2/ and should not"$'\n      '"$CHECK_LOG"
  else
    record_pass "$1"
  fi
}

# expect_log_matches <name> <ere>
expect_log_matches() {
  if printf '%s' "$CHECK_LOG" | grep -Eq "$2"; then
    record_pass "$1"
  else
    record_fail "$1" "output does not match /$2/"$'\n      '"$CHECK_LOG"
  fi
}

echo "=== check-spec-id-reserved.sh ==="

# ---------------------------------------------------------------------------
# Requirement 7 — the blocking check
# ---------------------------------------------------------------------------

# Case 1 — the golden path. The id was secured for this very ticket, so the
# pull request proceeds.
new_fixture c1
reserve c1 refs/spec-ids/0200 0200 800
add_spec c1 specs/0200-a-thing.md 0200 a-thing 800
run_check_same_repo c1
expect_pass_verdict "Case 1 — a spec whose id was secured for its own ticket passes"

# Case 2 — the spec 0112 failure path: a branch of the reference repository
# adding a spec whose id was never secured. The message must name the file, the
# id, and how to secure one, because that is what the author needs to act.
new_fixture c2
add_spec c2 specs/0201-unsecured.md 0201 unsecured 801
run_check_same_repo c2
expect_fail_verdict "Case 2 — an unsecured id from the reference repository fails"
expect_log_matches "Case 2 — the offending file is named" 'specs/0201-unsecured\.md'
expect_log_matches "Case 2 — the command that secures an id is named" 'reserve-spec-id'

# Case 3 — the collision the check exists to attribute before merge rather than
# after. Both tickets must appear, or the author of the pull request cannot tell
# whose id they took.
new_fixture c3
reserve c3 refs/spec-ids/0202 0202 800
add_spec c3 specs/0202-taken.md 0202 taken 801
run_check_same_repo c3
expect_fail_verdict "Case 3 — an id secured by another ticket fails"
expect_log_matches "Case 3 — the ticket holding the id is named" '#?800'
expect_log_matches "Case 3 — the ticket attempting to use it is named" '#?801'

# Case 4 — the two-records rule of PLAN step 9. One upstream id recorded in BOTH
# upstream carriers, naming two different tickets, is the duplicate-holder state
# this spec exists to prevent. The check reports it as a collision naming both;
# it does not arbitrate a winner, because there is no correct winner to pick.
new_fixture c4
reserve c4 refs/spec-ids/0203 0203 810
reserve c4 refs/tags/spec-id/0203 0203 811
add_spec c4 specs/0203-two-records.md 0203 two-records 810
run_check_same_repo c4
expect_fail_verdict "Case 4 — one upstream id recorded in both carriers for two tickets fails"
expect_log_matches "Case 4 — the first holder is named" '#?810'
expect_log_matches "Case 4 — the second holder is named" '#?811'

# Case 5 — the same rule's explicit exception. An upstream 0204 and an org 0204
# live in sibling namespaces holding different things; the delta's second
# scenario requires both to succeed, so this must NOT be read as a collision.
# The case bites a nested org namespace: at refs/spec-ids/org/0204 the org
# record lands inside the upstream read and the check reports a collision that
# does not exist.
new_fixture c5
reserve c5 refs/spec-ids/0204 0204 820
reserve c5 refs/spec-ids-org/0204 0204 821
add_spec c5 specs/0204-coincidence.md 0204 coincidence 820
run_check_same_repo c5
expect_pass_verdict "Case 5 — an upstream id and an org id whose strings coincide are not a collision"

# Case 6 — requirement 7 as replaced: specs/org/ is org-owned content and
# upstream does not extend its enforcement over it. This spec has no reservation
# of any kind and must still pass. Consistent with the exclusion spec 0071
# establishes; a REVIEW pass should not read this as missing coverage.
new_fixture c6
add_spec c6 specs/org/0205-org-owned.md 0205 org-owned 830
run_check_same_repo c6
expect_pass_verdict "Case 6 — a spec under specs/org/ does not fail the check"

# Case 6b — the same requirement with the sync manifest out of the picture. The
# replaced requirement 7 is unconditional: "A specification under `specs/org/`
# SHALL NOT fail this check." It names the literal path and attaches no
# precondition, so an implementation that derives the exemption from
# .crewrig/core-paths.txt must still hold the line when that file cannot be
# read. The safe degradation is to exempt; treating an unreadable manifest as
# "nothing is org-owned" silently extends upstream enforcement over org-owned
# content, which is the layer breach spec 0071 and this delta both forbid, and
# it fails in the direction that blocks an adopter rather than the direction
# that merely under-checks upstream.
new_fixture c6b
rm -f "$(fixture_work c6b)/.crewrig/core-paths.txt"
add_spec c6b specs/org/0213-org-owned.md 0213 org-owned 831
run_check_same_repo c6b
expect_pass_verdict "Case 6b — specs/org/ stays exempt when the sync manifest is unreadable"

# Case 7 — requirement 11. A delta-spec reuses its parent's id by construction
# and secures nothing, so it is exempt. Note the id 0206 is deliberately
# unsecured: an implementation that resolved the id and checked it anyway would
# fail here.
new_fixture c7
add_spec c7 specs/0206-parent.delta-01.md 0206 parent 840
run_check_same_repo c7
expect_pass_verdict "Case 7 — a delta-spec is exempt"

# Case 8 — the check reads the change under test, not the tree. Spec 0112 puts
# retroactively securing 0001-0111 out of scope, so the 111 unsecured specs
# already merged must not be re-examined by every pull request. Without this,
# the check fails on every pull request forever and the feature is unusable.
new_fixture c8
add_to_base c8 specs/0100-legacy.md 0100 legacy 700
reserve c8 refs/spec-ids/0207 0207 850
add_spec c8 specs/0207-new.md 0207 new 850
run_check_same_repo c8
expect_pass_verdict "Case 8 — an unsecured spec already merged on the base is not re-checked"

# Case 9 — requirement 7 says "adds or renames". A rename that carries a spec to
# an id nobody secured is an unsecured id arriving by the back door; an
# implementation looking only at additions lets it through.
new_fixture c9
add_to_base c9 specs/0208-old-slug.md 0208 old-slug 860
reserve c9 refs/spec-ids/0208 0208 860
rename_spec c9 specs/0208-old-slug.md specs/0209-new-id.md 0209 new-id 860
run_check_same_repo c9
expect_fail_verdict "Case 9 — a rename onto an unsecured id fails"

# ---------------------------------------------------------------------------
# The unsecured-id mark (requirement 9) and its removal (requirement 10)
# ---------------------------------------------------------------------------
# The mark is the reservation tool's OUTPUT and this check's INPUT, and nothing
# in PLAN v9 drew the line between them — which is how the invariant at
# docs/spec-format.md:34, "a merged spec never carries it", reached `main`
# enforced by nothing. The linter type-checks the boolean; this check compared
# holder against ticket and logged OK without ever reading the mark.
#
# One case is not enough here, and the reason is structural rather than
# rhetorical. Each of the three below was checked against the wrong fix it is
# supposed to catch, and one of them does NOT catch what it first appeared to:
#
#   Case 13  the headline. Removing the stale-mark enforcement fails this and
#            nothing else.
#   Case 14  catches a mark enforced OUTSIDE the blocking gate — a bare `exit`
#            or `wiring_fault` on the mark's presence, which is the natural way
#            to write "this must never merge" and which bypasses origin
#            discrimination entirely, blocking the fork path the mark exists to
#            serve. It does NOT catch a mark merely routed to `add_finding`
#            unconditionally: that respects the BLOCKING flag, so a fork still
#            exits 0 and this case stays green. Routing through `add_finding`
#            rather than around it is the property being pinned.
#   Case 15  catches the opposite over-correction, where the mark is read as
#            "the author already knows" and a blocking condition is downgraded
#            to a report — which would let a same-repository author opt out of
#            the guard by pasting one line.

# Case 13 — the stale mark. The id IS secured, for this spec's own ticket, so
# the run would otherwise be the golden path of Case 1. Requirement 10 says the
# mark is removed in the same act that secures the id; a spec that keeps it has
# a frontmatter field asserting the opposite of the reservation record, and
# merging it puts a permanent falsehood in the corpus.
new_fixture c13
reserve c13 refs/spec-ids/0219 0219 900
add_spec c13 specs/0219-stale-mark.md 0219 stale-mark 900 "$UNSECURED_MARK"
run_check_same_repo c13
expect_fail_verdict "Case 13 — a secured id still carrying the unsecured mark fails"
expect_log_matches "Case 13 — the offending file is named" 'specs/0219-stale-mark\.md'

# Case 14 — the honest mark on the path it exists for. A fork contributor cannot
# secure anything by construction, so their spec carries the mark legitimately
# and the pull request stays mergeable pending a maintainer. What this pins is
# that mark handling stays INSIDE the blocking gate: enforcing the mark with its
# own refusal — the natural shape for "a merged spec never carries this" — skips
# origin discrimination and blocks the contributor who had no way to secure
# anything. Verified: a hard `exit 1` on the mark's presence turns this red and
# nothing else in the suite notices.
new_fixture c14
add_spec c14 specs/0220-honest-mark.md 0220 honest-mark 901 "$UNSECURED_MARK"
run_check c14 \
  "CI_MERGE_REQUEST_SOURCE_PROJECT_PATH=contributor/crewrig" \
  "CI_PROJECT_PATH=$REFERENCE_REPO"
expect_pass_verdict "Case 14 — an unsecured id from a fork carrying the mark reports without failing"

# Case 15 — the opposite over-correction. Same honest mark, same unsecured id,
# but from the reference repository, where the author CAN secure it and
# requirement 10 says an unsecured id blocks. The mark must not buy an exemption:
# reading it as "already acknowledged" would let a same-repo author opt out of
# the guard by pasting one line, which is the whole guard.
new_fixture c15
add_spec c15 specs/0221-marked-but-blocking.md 0221 marked-but-blocking 902 "$UNSECURED_MARK"
run_check_same_repo c15
expect_fail_verdict "Case 15 — the mark buys no exemption from the reference repository"

# ---------------------------------------------------------------------------
# Requirement 10 and PLAN step 10 — origin discrimination and degradations
# ---------------------------------------------------------------------------

# Case 10 — a contributor from a forked repository holds no write access to the
# reference repository by construction and cannot secure anything. Blocking them
# would raise the barrier to outside contribution, which is the reason this
# branch exists. The condition is reported; the pipeline is not failed.
new_fixture c10
add_spec c10 specs/0210-from-a-fork.md 0210 from-a-fork 870
run_check c10 \
  "CI_MERGE_REQUEST_SOURCE_PROJECT_PATH=contributor/crewrig" \
  "CI_PROJECT_PATH=$REFERENCE_REPO"
expect_pass_verdict "Case 10 — an unsecured id from a fork reports without failing"
expect_log_matches "Case 10 — the condition is still reported" '0210'

# Case 10b — the same discrimination driven by the GitHub pair, which is the
# arm that actually runs on this repository's own continuous integration. Equal
# head and base repositories mean a branch of the reference repository, where an
# unsecured id blocks. Without this case the GitHub arm is exercised by nothing:
# every other case here drives the GitLab pair, so a typo in the workflow's
# `env:` block or in the variable names would surface only in production, and
# would surface as the check silently failing every pull request open.
new_fixture c10b
add_spec c10b specs/0214-github-same-repo.md 0214 github-same-repo 871
run_check c10b \
  "CREWRIG_PR_HEAD_REPO=$REFERENCE_REPO" \
  "CREWRIG_PR_BASE_REPO=$REFERENCE_REPO"
expect_fail_verdict "Case 10b — GitHub pair, same repository: an unsecured id blocks"

# Case 10c — and its other half. Differing head and base repositories mean a
# fork, whose author cannot secure anything by construction, so the condition is
# reported and the pipeline proceeds. Together with Case 10b this pins that the
# GitHub arm discriminates rather than merely being read: a implementation that
# consulted the variables but compared them wrongly passes one of these two and
# fails the other.
new_fixture c10c
add_spec c10c specs/0215-github-fork.md 0215 github-fork 872
run_check c10c \
  "CREWRIG_PR_HEAD_REPO=contributor/crewrig" \
  "CREWRIG_PR_BASE_REPO=$REFERENCE_REPO"
expect_pass_verdict "Case 10c — GitHub pair, forked repository: an unsecured id reports without failing"
expect_log_matches "Case 10c — the condition is still reported" '0215'

# Case 11 — PLAN step 10's loud half, with BOTH pairs unset. This fixture is
# otherwise entirely correct: the id is secured for its own ticket and would
# pass Case 1. Only the origin is undeterminable. Failing here is the deliberate
# choice — silence would green-light the same-repository case the check exists
# for, and an origin that cannot be resolved is a wiring defect in the workflow,
# not a property of the change.
new_fixture c11
reserve c11 refs/spec-ids/0211 0211 880
add_spec c11 specs/0211-good-spec.md 0211 good-spec 880
run_check c11
expect_fail_verdict "Case 11 — an undeterminable origin fails even when the id is properly secured"

# Case 11b — the load-bearing one. Inside a CI context with no platform pair
# resolved, the explicit override does NOT rescue the run. A CI job whose pair
# failed to map is exactly where a stray `CREWRIG_SPEC_ID_ORIGIN=fork` would do
# its damage: it would turn the blocking branch into report-only for every pull
# request, silently, and requirement 10's whole point is that those two outcomes
# differ. A guard an environment variable can switch off is not a guard, so the
# override's standing is gated on the CI marker even though the pairs' is not.
new_fixture c11b
add_spec c11b specs/0216-override-in-ci.md 0216 override-in-ci 881
run_check c11b "CI=true" "CREWRIG_SPEC_ID_ORIGIN=fork"
expect_fail_verdict "Case 11b — inside CI the origin override does not rescue an unresolvable pair"

# Case 11c — and the reason the override exists at all. Outside CI it is the
# only admissible signal, so a maintainer can run this check by hand instead of
# meeting an unsatisfiable failure. That was a real gap: without this path the
# check is a CI-only artefact that cannot be reproduced locally by the person
# asked to fix what it reports.
new_fixture c11c
add_spec c11c specs/0217-override-locally.md 0217 override-locally 882
run_check c11c "CREWRIG_SPEC_ID_ORIGIN=fork"
expect_pass_verdict "Case 11c — outside CI the override resolves the origin and the run proceeds"
expect_log_matches "Case 11c — the unsecured id is still reported" '0217'

# Case 11d — precedence, which the implementation calls part of the guarantee
# rather than a detail, and it is right to. The platform pair says
# same-repository; the override says fork. The pair must win, or the override
# becomes an off switch for the guard on any pull request that sets it. Reading
# the override first is a defect the implementation records having had, which is
# exactly the kind that returns during a later tidy-up.
new_fixture c11d
add_spec c11d specs/0218-precedence.md 0218 precedence 883
run_check c11d \
  "CREWRIG_PR_HEAD_REPO=$REFERENCE_REPO" \
  "CREWRIG_PR_BASE_REPO=$REFERENCE_REPO" \
  "CREWRIG_SPEC_ID_ORIGIN=fork"
expect_fail_verdict "Case 11d — a present platform pair outranks the origin override"

# Case 12 — PLAN step 10's quiet half. A credential gap or an unreachable
# reference repository must never block an adopter's pipeline: the check cannot
# tell an empty namespace from an unreadable one, so it reports and yields.
new_fixture c12
add_spec c12 specs/0212-unreadable.md 0212 unreadable 890
break_remote c12
run_check_same_repo c12
expect_pass_verdict "Case 12 — an unreadable reserved set reports without failing"

# ---------------------------------------------------------------------------
# Base-ref resolution
# ---------------------------------------------------------------------------
# The base ref decides WHICH specs are the change under test, so guessing it
# wrong does not merely under-check — it blames a third party. The resolution is
# the mirror of determine_origin's ladder, and for the same reason: an explicit
# base wins; inside CI with none, the platform's own target-branch variable is
# read; with neither, it REFUSES rather than guessing; outside CI it keeps
# `<remote>/main`, because a maintainer running by hand against main is the
# nominal case and should not have to declare it.
#
# The defect these were written for: the GitLab job set no base, the script fell
# through to `<remote>/main`, and that job's rule fires on merge requests
# targeting `release/**` as well.

# Case 16 — the defect itself. A merge request onto `release/1.x`, in a GitLab
# pipeline, with no explicit base. Resolved correctly the change under test is
# one spec, this ticket's, and it is secured. Resolved against `main` it is two,
# and the second belongs to issue #700 — a contributor is then blocked by a
# finding naming a file they never touched, which is the least legible failure
# this tool can produce.
new_release_fixture c16
reserve c16 refs/spec-ids/0301 0301 701
add_spec c16 specs/0301-mine.md 0301 mine 701
run_check_based c16 "" \
  "GITLAB_CI=true" \
  "CI_MERGE_REQUEST_TARGET_BRANCH_NAME=release/1.x" \
  "CI_MERGE_REQUEST_SOURCE_PROJECT_PATH=$REFERENCE_REPO" \
  "CI_PROJECT_PATH=$REFERENCE_REPO"
expect_pass_verdict "Case 16 — a merge request onto release/1.x resolves its base from the target branch"
expect_log_not_matching "Case 16 — no third party's spec is drawn into the change under test" \
  '0300-someone-elses-hotfix'

# Case 17 — the refusal rung. Inside CI with no explicit base and no
# target-branch variable, the base is unknown and the script must say so rather
# than assume `main`. Same judgement determine_origin already makes about
# origin: a signal that cannot distinguish its cases must not drive a decision
# whose outcomes differ.
#
# The verdict alone cannot pin this. Under the defect — falling through to
# `<remote>/main` — this fixture ALSO exits non-zero, because the wrong base
# drags issue #700's spec into the change and blocks on it: same verdict,
# opposite meaning. And a `-ne 0` assertion cannot separate a deliberate refusal
# from the script falling over, since an unbound-variable crash prints the same
# identifier a grep for the remediation text would look for. Hence exit 2
# specifically, plus the negative assertion that no spec was blamed.
new_release_fixture c17
reserve c17 refs/spec-ids/0302 0302 702
add_spec c17 specs/0302-mine.md 0302 mine 702
run_check_based c17 "" \
  "GITLAB_CI=true" \
  "CI_MERGE_REQUEST_SOURCE_PROJECT_PATH=$REFERENCE_REPO" \
  "CI_PROJECT_PATH=$REFERENCE_REPO"
expect_wiring_fault "Case 17 — inside CI with no base and no target branch, the check refuses to guess"
expect_log_matches "Case 17 — and says which signal is missing" \
  'CI_MERGE_REQUEST_TARGET_BRANCH_NAME'
expect_log_not_matching "Case 17 — no spec is blamed for a wiring fault" \
  '0300-someone-elses-hotfix'

# Case 18 — the nominal case kept nominal. Outside CI, no explicit base, and
# `<remote>/main` is the right default: a maintainer running this by hand
# against main should not have to declare what is already true. The assertion is
# on the RESOLVED base rather than on the verdict alone, because a verdict can
# be right for the wrong reason and the resolved base is the thing under test.
new_fixture c18
reserve c18 refs/spec-ids/0303 0303 703
add_spec c18 specs/0303-mine.md 0303 mine 703
run_check_based c18 "" "CREWRIG_SPEC_ID_ORIGIN=same"
expect_pass_verdict "Case 18 — outside CI the base defaults to <remote>/main"
expect_log_matches "Case 18 — and the resolved base is reported as such" \
  'Base ref: (crewrig|origin)/main'

# Case 19 — precedence, the rung that makes the ladder a ladder. An explicit
# base outranks the target-branch variable, so a caller that knows the answer is
# never overridden by the platform's guess at it. Same defect shape as reading
# the origin override before the platform pair, which this ticket has already
# had to repair once.
new_release_fixture c19
reserve c19 refs/spec-ids/0304 0304 704
add_spec c19 specs/0304-mine.md 0304 mine 704
run_check_based c19 "origin/release/1.x" \
  "GITLAB_CI=true" \
  "CI_MERGE_REQUEST_TARGET_BRANCH_NAME=main" \
  "CI_MERGE_REQUEST_SOURCE_PROJECT_PATH=$REFERENCE_REPO" \
  "CI_PROJECT_PATH=$REFERENCE_REPO"
expect_log_matches "Case 19 — an explicit base outranks the target-branch variable" \
  'Base ref: origin/release/1\.x'

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "Results: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
