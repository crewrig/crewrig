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
#   Pull-request origin   CI_MERGE_REQUEST_SOURCE_PROJECT_PATH and CI_PROJECT_PATH.
#                         These are the only origin variables PLAN v9 step 11
#                         pins verbatim; the GitHub workflow maps its own
#                         contexts into process environment, and whatever names
#                         it chooses, these two must work.
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

# render_spec <id> <slug> <related-issue>
render_spec() {
  cat <<EOF
---
id: "$1"
slug: "$2"
status: draft
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: $3
version: 1.0.0
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

# add_spec <name> <path> <id> <slug> <issue>
# The pull request adds a spec file on the feature branch.
add_spec() {
  local name="$1" path="$2" id="$3" slug="$4" issue="$5"
  local work; work="$(fixture_work "$name")"
  mkdir -p "$work/$(dirname "$path")"
  render_spec "$id" "$slug" "$issue" > "$work/$path"
  git -C "$work" add -A
  git -C "$work" commit -q -m "add $path"
}

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
# The origin pair defaults to a same-repository pull request; a caller passing
# its own assignments overrides that. Every origin variable this suite knows of
# is cleared first, so a case that asserts "origin undeterminable" cannot be
# rescued by a variable inherited from a real CI runner.
run_check() {
  local name="$1"; shift
  local work; work="$(fixture_work "$name")"

  CHECK_RC=0
  ( cd "$work" && env \
      -u CI_MERGE_REQUEST_SOURCE_PROJECT_PATH \
      -u CI_PROJECT_PATH \
      -u GITHUB_REPOSITORY \
      -u GITHUB_HEAD_REPOSITORY \
      CREWRIG_REPO_DIR="$work" \
      BASE_REF="origin/main" \
      "$@" \
      bash "$SCRIPT_UNDER_TEST" > "$TMP_ROOT/.check.log" 2>&1 ) || CHECK_RC=$?
  CHECK_LOG="$(cat "$TMP_ROOT/.check.log")"
}

# run_check_same_repo <name>
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

# Case 11 — PLAN step 10's loud half. This fixture is otherwise entirely
# correct: the id is secured for its own ticket and would pass Case 1. Only the
# origin is undeterminable. Failing here is the deliberate choice — silence
# would green-light the same-repository case the check exists for, and an
# origin that cannot be resolved is a wiring defect in the workflow, not a
# property of the change.
new_fixture c11
reserve c11 refs/spec-ids/0211 0211 880
add_spec c11 specs/0211-good-spec.md 0211 good-spec 880
run_check c11
expect_fail_verdict "Case 11 — an undeterminable origin fails even when the id is properly secured"

# Case 12 — PLAN step 10's quiet half. A credential gap or an unreachable
# reference repository must never block an adopter's pipeline: the check cannot
# tell an empty namespace from an unreadable one, so it reports and yields.
new_fixture c12
add_spec c12 specs/0212-unreadable.md 0212 unreadable 890
break_remote c12
run_check_same_repo c12
expect_pass_verdict "Case 12 — an unreadable reserved set reports without failing"

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "Results: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
