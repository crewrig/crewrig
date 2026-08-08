#!/bin/bash
# check-spec-id-reserved.sh — Fail a pull request whose new spec claims an id
# that was never secured, or was secured for a different ticket (spec 0112
# requirement 7, as replaced by delta-01).
#
# This is the BACKSTOP, not the mechanism. scripts/reserve-spec-id.sh secures an
# id at pickup time; this guard is what makes an unsecured id a pull-request
# failure instead of a surprise discovered by an unrelated third PR after both
# offending specs have merged.
#
# WHAT IS CHECKED. Every non-delta spec file the change ADDS or RENAMES, outside
# `specs/org/`. Delta-specs are exempt (requirement 11): a delta reuses its
# parent's id by construction and secures nothing. Specs under `specs/org/` are
# exempt (delta-01, replaced requirement 7), consistent with the exclusion
# `specs/0071-org-specs-lint-exclusion.md` establishes for upstream validation of
# org-owned content. `specs/org/` is an unconditional floor; the `excluded`
# entries under `specs/` in `.crewrig/core-paths.txt` are read ON TOP of it, so a
# future org-owned path is covered without editing this script while an absent
# manifest cannot silently turn the exemption off.
#
# WHERE THE RECORD IS READ. Both upstream carriers, on the remote:
# `refs/spec-ids/*` and `refs/tags/spec-id/*`. Always both, never the configured
# one alone — a repository mid-transition between carriers must not be reported
# as unsecured for the ids it holds in the other. The org sibling namespaces
# (`refs/spec-ids-org/*`, `refs/tags/spec-id-org/*`) are never read here: an
# upstream `0042` and an org `0042` are a conformant state, not a collision
# (delta-01, scenario 5).
#
# THE TWO-RECORDS RULE. One UPSTREAM id recorded in BOTH upstream carriers
# naming two different issues is a collision, failed loudly naming both tickets.
# This guard does not pick a winner: that state is the exact duplicate-holder
# outcome spec 0112 exists to prevent, and arbitrating it silently would hide it.
#
# TWO DISTINCT DEGRADATIONS, deliberately not symmetric:
#   - The reserved set is UNREADABLE (a credential gap on a private adopter
#     repository, an unreachable remote) → REPORT without failing. A credential
#     gap must never block an adopter's pipeline, and an unreadable namespace is
#     measurably indistinguishable from an empty one, so failing here would
#     accuse every id of being unsecured.
#   - The pull request's ORIGIN cannot be determined → FAIL LOUDLY, exit 2. That
#     is a wiring defect, and reporting-without-failing would green-light the
#     same-repository case this guard exists for.
#
# ORIGIN DISCRIMINATION (requirement 10). A pull request from a branch of the
# reference repository FAILS on an unsecured id; one from a FORK reports without
# blocking, because its author cannot write to the reference repository. A
# maintainer secures the id before merging and removes the requirement-9 mark in
# the same act. Origin comes from an explicit signal, never an inference:
#
#   CREWRIG_SPEC_ID_ORIGIN
#       'same' or 'fork' — the explicit override, for a local run.
#   CREWRIG_PR_HEAD_REPO / CREWRIG_PR_BASE_REPO
#       GitHub Actions: mapped from
#       `github.event.pull_request.head.repo.full_name` and
#       `github.repository` by an `env:` block in .github/workflows/build.yml,
#       because those are workflow CONTEXTS, not ambient environment. The
#       `CREWRIG_` prefix is this repository's own convention (CREWRIG_REPO_DIR,
#       CREWRIG_GITLAB_HOSTS) and it also avoids `GITHUB_`, which GitHub Actions
#       reserves — a `GITHUB_`-prefixed name would look native while being a
#       value GitHub does not in fact publish, and would collide with the
#       reserved prefix in the very `env:` block that has to set it.
#   CI_MERGE_REQUEST_SOURCE_PROJECT_PATH / CI_PROJECT_PATH
#       GitLab CI: already ambient in a merge-request pipeline.
#
# Usage:
#   bash scripts/check-spec-id-reserved.sh [<base-ref>]
#
# Environment:
#   BASE_REF           The change's target branch. Default: the first remote
#                      matching `crewrig|origin`, plus `/main`.
#   CREWRIG_REPO_DIR   Repository root override (used by the self-test).
#
# Exit codes:
#   0  every checked id is secured for its own ticket; or the pull request comes
#      from a fork and the conditions were reported; or the reserved set could
#      not be read and was reported.
#   1  at least one blocking finding on a same-repository pull request.
#   2  wiring fault — origin undeterminable, base ref unresolvable, or not a
#      git repository. Fail closed: a run that could not look must not read as a
#      run that found nothing.

set -euo pipefail

REPO_DIR="${CREWRIG_REPO_DIR:-"$(cd "$(dirname "$0")/.." && pwd)"}"
MANIFEST="$REPO_DIR/.crewrig/core-paths.txt"

CARRIER_PRIMARY="refs/spec-ids/"
CARRIER_TAGS="refs/tags/spec-id/"
PATTERN_PRIMARY="refs/spec-ids/*"
PATTERN_TAGS="refs/tags/spec-id/*"

note() { echo "$*" >&2; }

wiring_fault() {
  echo "" >&2
  echo "[ERROR] $*" >&2
  exit 2
}

if ! git -C "$REPO_DIR" rev-parse --git-dir >/dev/null 2>&1; then
  wiring_fault "not a git repository: $REPO_DIR. This guard reads the change under
        test from the repository, so it has no subject here."
fi

# --- Origin discrimination (requirement 10) ----------------------------------

# Determined from an explicit signal or not at all. Nothing here infers origin
# from a remote URL, a branch name, or the presence of a CI variable of the
# wrong engine: a signal that cannot distinguish its cases must not drive the
# decision, and getting this wrong in the permissive direction silently disables
# the guard for the exact case it exists for.
determine_origin() {
  case "${CREWRIG_SPEC_ID_ORIGIN:-}" in
    same|fork) printf '%s' "$CREWRIG_SPEC_ID_ORIGIN"; return 0 ;;
    "") ;;
    *) wiring_fault "CREWRIG_SPEC_ID_ORIGIN is '$CREWRIG_SPEC_ID_ORIGIN'; expected 'same' or 'fork'." ;;
  esac

  if [ -n "${CREWRIG_PR_HEAD_REPO:-}" ] && [ -n "${CREWRIG_PR_BASE_REPO:-}" ]; then
    if [ "$CREWRIG_PR_HEAD_REPO" = "$CREWRIG_PR_BASE_REPO" ]; then
      printf 'same'
    else
      printf 'fork'
    fi
    return 0
  fi

  if [ -n "${CI_MERGE_REQUEST_SOURCE_PROJECT_PATH:-}" ] && [ -n "${CI_PROJECT_PATH:-}" ]; then
    if [ "$CI_MERGE_REQUEST_SOURCE_PROJECT_PATH" = "$CI_PROJECT_PATH" ]; then
      printf 'same'
    else
      printf 'fork'
    fi
    return 0
  fi

  wiring_fault "cannot determine whether this pull request comes from the reference
        repository or from a fork, and requirement 10 makes the two outcomes
        different — a same-repository unsecured id FAILS, a fork's is only
        reported. Supply one of:
          - CREWRIG_PR_HEAD_REPO and CREWRIG_PR_BASE_REPO (GitHub Actions: map
            github.event.pull_request.head.repo.full_name and
            github.repository through an env: block — they are workflow
            contexts, not ambient environment);
          - CI_MERGE_REQUEST_SOURCE_PROJECT_PATH and CI_PROJECT_PATH (GitLab
            CI, already ambient in a merge-request pipeline);
          - CREWRIG_SPEC_ID_ORIGIN=same|fork, the explicit override for a local run.
        Refusing to guess: guessing 'fork' would disable this guard on every
        pull request."
}

ORIGIN="$(determine_origin)"
BLOCKING=true
if [ "$ORIGIN" = "fork" ]; then
  BLOCKING=false
fi

# --- Base ref ----------------------------------------------------------------

# Resolved exactly as scripts/check-skill-versions.sh does, so the repository
# has one idiom rather than two.
BASE_REF="${1:-${BASE_REF:-$(git -C "$REPO_DIR" remote | grep -E -m1 'crewrig|origin' || git -C "$REPO_DIR" remote | head -1)/main}}"

if [ "$BASE_REF" = "/main" ]; then
  wiring_fault "no git remote is configured, so no default base ref could be derived.
        Pass a resolvable ref as the first argument or via BASE_REF."
fi

if ! git -C "$REPO_DIR" rev-parse --verify "$BASE_REF" >/dev/null 2>&1; then
  base_remote="${BASE_REF%%/*}"
  base_branch="${BASE_REF#*/}"
  git -C "$REPO_DIR" fetch --depth=50 "$base_remote" "$base_branch" >/dev/null 2>&1 || true
  if ! git -C "$REPO_DIR" rev-parse --verify "$BASE_REF" >/dev/null 2>&1; then
    wiring_fault "cannot resolve base ref '$BASE_REF' and 'git fetch' did not recover
        it. On GitHub Actions this is usually a missing 'fetch-depth: 0' on
        actions/checkout; the capability declares 'history-depth: full' for
        exactly this reason."
  fi
fi

REMOTE="${BASE_REF%%/*}"

# --- Which spec paths are org-owned ------------------------------------------

# `specs/org/` is the FLOOR, not a manifest lookup. Delta-01's replaced
# requirement 7 names it literally — "a specification under `specs/org/` SHALL
# NOT fail this check" — so the exemption cannot be contingent on a file this
# script happens to be able to read. Seeding it here is what makes the failure
# mode of an absent or unreadable manifest *inert* instead of inverted: derive
# the list from the manifest alone and a missing manifest silently turns this
# guard into upstream enforcement over org-owned content, which is the precise
# layer breach `specs/0071-org-specs-lint-exclusion.md` exists to prevent, and
# it would arrive on the adopter's pipeline rather than in CI.
EXCLUDED_SPEC_PREFIXES="specs/org/
"

# The manifest read LAYERS ON TOP of that floor: it is the spec 0071 R5
# mechanism, so any FUTURE org-owned path declared `excluded` under `specs/` is
# covered without editing this script. Floor, not ceiling — same posture as
# ci/bash32-forbidden.txt. A missing manifest adds nothing rather than erroring.
if [ -f "$MANIFEST" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    case "$line" in
      ""|\#*) continue ;;
    esac
    mpath="${line%%[[:space:]]*}"
    mrest="${line#"$mpath"}"
    mpolicy="${mrest#"${mrest%%[![:space:]]*}"}"
    mpolicy="${mpolicy%%[[:space:]]*}"
    if [ -z "$mpolicy" ]; then
      mpolicy="strict"
    fi
    if [ "$mpolicy" != "excluded" ]; then
      continue
    fi
    case "$mpath" in
      specs/*) EXCLUDED_SPEC_PREFIXES="${EXCLUDED_SPEC_PREFIXES}${mpath}/
" ;;
    esac
  done < "$MANIFEST"
fi

is_org_owned() {
  local p="$1" prefix
  while IFS= read -r prefix; do
    if [ -z "$prefix" ]; then
      continue
    fi
    case "$p" in
      "$prefix"*) return 0 ;;
    esac
  done <<EOF
$EXCLUDED_SPEC_PREFIXES
EOF
  return 1
}

# --- The specs under test ----------------------------------------------------

# Added (A) or renamed (R) paths only. A modified spec keeps the id it already
# had; requirement 7 governs the moment an id enters the corpus.
CANDIDATES=""
candidate_count=0
skipped_delta=0
skipped_org=0

while IFS= read -r line; do
  if [ -z "$line" ]; then
    continue
  fi
  # `A<TAB>path` or `R<score><TAB>old<TAB>new` — the new path is the last field.
  path="${line##*$'\t'}"
  case "$path" in
    specs/*.md) ;;
    *) continue ;;
  esac
  base="${path##*/}"
  case "$base" in
    _template.md|README.md) continue ;;
    *.delta-*)
      skipped_delta=$((skipped_delta + 1))
      continue
      ;;
  esac
  if is_org_owned "$path"; then
    skipped_org=$((skipped_org + 1))
    continue
  fi
  CANDIDATES="${CANDIDATES}${path}
"
  candidate_count=$((candidate_count + 1))
done < <(git -C "$REPO_DIR" diff --name-status --diff-filter=AR "$BASE_REF" -- 'specs/*.md' 2>/dev/null || true)

# Rule 4 of docs/scripting-conventions.md — say what was actually inspected, so
# a wedge that makes this guard see nothing cannot read as a pass.
note "Base ref: $BASE_REF | remote: $REMOTE | origin: $ORIGIN (blocking: $BLOCKING)"
note "Specs added or renamed by this change: $candidate_count (delta-specs exempt: $skipped_delta; org-owned exempt: $skipped_org)"

if [ "$candidate_count" -eq 0 ]; then
  echo "OK: this change adds or renames no non-delta upstream spec, so no id needs securing."
  exit 0
fi

# --- The reserved set --------------------------------------------------------

if ! LS_PRIMARY="$(git -C "$REPO_DIR" ls-remote "$REMOTE" "$PATTERN_PRIMARY" 2>/dev/null)"; then
  echo "" >&2
  echo "[REPORT] The reservation namespace on '$REMOTE' could not be read, so no id" >&2
  echo "         could be verified. This is a credential or connectivity gap, not a" >&2
  echo "         finding: an unreadable namespace is indistinguishable from an empty" >&2
  echo "         one, so failing here would accuse every id of being unsecured." >&2
  echo "         Not failing the pipeline (spec 0112 PLAN step 10)." >&2
  exit 0
fi
LS_TAGS="$(git -C "$REPO_DIR" ls-remote "$REMOTE" "$PATTERN_TAGS" 2>/dev/null || true)"

# The object id recorded at an exact ref in an ls-remote listing, or empty.
oid_at_ref() {
  printf '%s\n' "$1" | awk -F'\t' -v want="$2" '$2 == want { print $1; exit }'
}

# The ticket recorded in a reservation object, or empty when the record cannot
# be read. Fetches the ref into a scratch local ref, reads the subject, removes
# the scratch ref.
recorded_issue() {
  local ref="$1" probe="refs/spec-id-check/current" msg
  if ! git -C "$REPO_DIR" fetch --no-tags --quiet --force "$REMOTE" "+${ref}:${probe}" 2>/dev/null; then
    return 0
  fi
  msg="$(git -C "$REPO_DIR" log -1 --format=%s "$probe" 2>/dev/null || true)"
  git -C "$REPO_DIR" update-ref -d "$probe" 2>/dev/null || true
  case "$msg" in
    *"issue #"*) printf '%s' "${msg##*issue #}" ;;
  esac
}

# The `related-issue` value from a spec's frontmatter block, or empty.
related_issue_of() {
  local file="$1"
  awk '
    NR == 1 { if ($0 != "---") exit; next }
    $0 == "---" { exit }
    /^related-issue:[[:space:]]*[0-9]+[[:space:]]*$/ {
      sub(/^related-issue:[[:space:]]*/, "")
      gsub(/[[:space:]]/, "")
      print
      exit
    }
  ' "$file"
}

# --- Verdict -----------------------------------------------------------------

findings=""
finding_count=0
reports=""
report_count=0

add_finding() {
  findings="${findings}$1
"
  finding_count=$((finding_count + 1))
}

add_report() {
  reports="${reports}$1
"
  report_count=$((report_count + 1))
}

while IFS= read -r spec; do
  if [ -z "$spec" ]; then
    continue
  fi
  base="${spec##*/}"
  id="${base%%-*}"
  case "$id" in
    [0-9][0-9][0-9][0-9]) ;;
    *)
      add_finding "$spec — filename does not begin with a four-digit id, so no reservation can be resolved for it. Rename it to specs/<NNNN>-<slug>.md (docs/spec-format.md → Naming convention)."
      continue
      ;;
  esac

  ticket=""
  if [ -f "$REPO_DIR/$spec" ]; then
    ticket="$(related_issue_of "$REPO_DIR/$spec")"
  fi
  if [ -z "$ticket" ]; then
    add_finding "$spec — no integer 'related-issue' in the frontmatter, so the reservation cannot be attributed to a ticket. 'related-issue' is mandatory (docs/spec-format.md → Frontmatter schema)."
    continue
  fi

  ref_primary="${CARRIER_PRIMARY}${id}"
  ref_tags="${CARRIER_TAGS}${id}"
  oid_primary="$(oid_at_ref "$LS_PRIMARY" "$ref_primary")"
  oid_tags="$(oid_at_ref "$LS_TAGS" "$ref_tags")"

  if [ -z "$oid_primary" ] && [ -z "$oid_tags" ]; then
    add_finding "$spec — id '$id' was never secured (neither $ref_primary nor $ref_tags exists on '$REMOTE'). Secure it with:
      bash scripts/reserve-spec-id.sh --id $id --issue $ticket"
    continue
  fi

  holder_primary=""
  holder_tags=""
  unreadable=false
  if [ -n "$oid_primary" ]; then
    holder_primary="$(recorded_issue "$ref_primary")"
    if [ -z "$holder_primary" ]; then
      unreadable=true
    fi
  fi
  if [ -n "$oid_tags" ]; then
    holder_tags="$(recorded_issue "$ref_tags")"
    if [ -z "$holder_tags" ]; then
      unreadable=true
    fi
  fi

  # THE TWO-RECORDS RULE, scoped to the two UPSTREAM carriers. Two different
  # tickets recorded for one upstream id is the duplicate-holder outcome this
  # spec exists to prevent. It is reported as a collision naming both, never
  # arbitrated in favour of one.
  if [ -n "$holder_primary" ] && [ -n "$holder_tags" ] && [ "$holder_primary" != "$holder_tags" ]; then
    add_finding "$spec — id '$id' is recorded in BOTH upstream carriers for two different tickets: $ref_primary holds it for issue #$holder_primary and $ref_tags holds it for issue #$holder_tags. Two tickets cannot hold one id; this guard does not pick a winner. Resolve the attribution between #$holder_primary and #$holder_tags, then re-run."
    continue
  fi

  if $unreadable; then
    add_report "$spec — id '$id' has a reservation ref on '$REMOTE' but its recording ticket could not be read (the reservation object could not be fetched). Not treated as a finding: an unreadable record is a connectivity or credential gap, not an unsecured id."
    continue
  fi

  holder="$holder_primary"
  held_at="$ref_primary"
  if [ -z "$holder" ]; then
    holder="$holder_tags"
    held_at="$ref_tags"
  fi

  if [ "$holder" != "$ticket" ]; then
    add_finding "$spec — id '$id' is secured for issue #$holder (at $held_at) but this spec declares 'related-issue: $ticket'. The id belongs to #$holder; #$ticket must allocate its own with:
      bash scripts/reserve-spec-id.sh --issue $ticket"
    continue
  fi

  note "  OK $spec — id '$id' secured for issue #$ticket at $held_at"
done <<EOF
$CANDIDATES
EOF

if [ "$report_count" -gt 0 ]; then
  echo "" >&2
  echo "[REPORT] $report_count condition(s) reported without failing:" >&2
  printf '%s' "$reports" | sed -e 's/^/  - /' >&2
fi

if [ "$finding_count" -eq 0 ]; then
  echo "OK: every spec added or renamed by this change ($candidate_count) carries an id secured for its own ticket."
  exit 0
fi

echo "" >&2
if $BLOCKING; then
  echo "FAILED: $finding_count spec-id reservation finding(s):" >&2
else
  echo "REPORTED (not blocking — this pull request comes from a fork): $finding_count finding(s):" >&2
fi
printf '%s' "$findings" | sed -e 's/^/  - /' >&2

if $BLOCKING; then
  echo "" >&2
  echo "An id is secured before the spec file is written (spec 0112 requirement 2)," >&2
  echo "so that the branch name, the filename and the frontmatter 'id' agree from the" >&2
  echo "first commit. See docs/spec-pr-workflow.md → Reserving the spec id." >&2
  exit 1
fi

echo "" >&2
echo "A fork's author cannot write to the reference repository, so this is reported" >&2
echo "rather than blocked (spec 0112 requirement 10). A maintainer SHALL secure the" >&2
echo "id before merging and remove the 'unsecured-id: true' mark in the same act." >&2
exit 0
