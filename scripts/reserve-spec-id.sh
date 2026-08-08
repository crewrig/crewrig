#!/bin/bash
# reserve-spec-id.sh — Secure a spec id on the reference repository before the
# spec file exists (spec 0112, and its delta-01 for the org corpus).
#
# The failure this removes is not a lint error but a misdirected one: two
# sessions picking up two tickets in the same second both compute
# `max(existing) + 1`, both get the same number, and the collision surfaces in
# an unrelated third pull request after both specs have merged — by which time
# the id is carried by an issue, a branch name, a PR title and a logbook.
#
# THE MECHANISM. A reservation is a PARENTLESS git object pushed to a ref under
# the configured namespace, with the id as the ref's last component and the
# ticket in the object's commit message. The guarantee is the remote's
# create-only compare-and-swap, requested with `--force-with-lease=<ref>:` (an
# empty expected value means "this ref must still not exist"): in a true race
# exactly one push lands and the loser is REFUSED. Parentlessness closes the
# distinct sequential path in which a latecomer's *descendant* object would
# satisfy the ordinary fast-forward rule and overwrite a live reservation —
# measured: a plain, leaseless push of a descendant to an occupied reservation
# ref succeeds.
#
# THE ALLOCATED SET, for the upstream corpus, is the union of three sources:
#   - the ids merged on `<remote>/main` outside `specs/org/`;
#   - `refs/spec-ids/*`;
#   - `refs/tags/spec-id/*`.
# Both upstream carriers are read on every run regardless of which one is
# configured for writing, so a repository that changes its carrier keeps a
# complete allocated set across the transition. Org reservations are NOT read
# into that union (spec 0112 delta-01, replaced requirement 3): they live in a
# SIBLING namespace, never a child, because an `ls-remote` pattern's `*` crosses
# `/` and a nested `refs/spec-ids/org/<ID>` would be returned by a read of
# `refs/spec-ids/*`.
#
# WHICH NAMESPACE IS WRITTEN is named by the tracked, repository-scoped setting
# `.crewrig/spec-id-carrier` — identical for every contributor by construction,
# never inferred at runtime, never persisted by this script, and never switched
# automatically under any circumstance. Two contributors writing into two
# different namespaces both succeed and both hold the same id, which is exactly
# what a per-contributor environment variable produces; hence the setting is a
# pull request, not an export.
#
# WHICH CORPUS an identifier belongs to is TOLD, never inferred from the
# identifier's shape. Inferring it would require upstream to recognise an org
# numbering convention, which spec 0112 delta-01 requirement 16 forbids and
# `specs/0071-org-specs-lint-exclusion.md` deliberately prevented.
#
# WHICH REMOTE is resolved from the reference branch, with the idiom this
# repository already has rather than a third one: `BASE_REF` when set, else the
# first remote matching `crewrig|origin` (falling back to the first remote at
# all) with `/main` appended — the derivation documented at
# `scripts/lib/spec-linter.js:114-131`, which aligns itself with
# `scripts/check-skill-versions.sh:24-33` for exactly this reason. The remote is
# the ref's first path component, so it is always a remote NAME: no repository
# path and no URL is hardcoded anywhere here, which is what lets the regression
# suites point the tool at a `file://` bare repository.
#
# Usage:
#   bash scripts/reserve-spec-id.sh --issue <N>
#   bash scripts/reserve-spec-id.sh --id <ID> --issue <N> [--corpus upstream|org]
#   bash scripts/reserve-spec-id.sh --help
#
# Exit contract — authoritative:
#
#   0   The id is secured on the remote.       stdout: the id.
#   3   The id is allocated LOCALLY and NOT secured — offline, unreachable
#       remote, no write access (the fork case), or a namespace the remote
#       refuses. stdout: the id, then `unsecured-id: true`.
#   1   Genuine failure — malformed `/specs/` state, an invalid carrier value,
#       a non-representable identifier, `--corpus org` without `--id`, an
#       identifier already held by a different ticket, or a retry budget
#       exhausted by lost races. stdout: nothing; the reason is on stderr.
#
# The first stdout line is ALWAYS the id, on exit 0 and exit 3 alike. The second
# line on exit 3 is the unsecured marker, emitted in the EXACT form the spec
# frontmatter takes — `unsecured-id: true`, the optional field
# `docs/spec-format.md` defines — so the caller pastes it rather than composing
# it. The exit code already carries the boolean, so nothing programmatic depends
# on this line's separator.
#
# This script EMITS; it never writes a spec file. Requirement 2 places
# allocation before the spec file exists, so `spec-author` consumes exit 3 and
# writes the mark at file-creation time.

set -euo pipefail

REPO_DIR="${CREWRIG_REPO_DIR:-"$(cd "$(dirname "$0")/.." && pwd)"}"
CARRIER_FILE="$REPO_DIR/.crewrig/spec-id-carrier"

# The closed pair. A value outside it exits 1 rather than writing into a third
# namespace that neither the allocation union nor check-spec-id-reserved.sh
# reads — the `refs/spec-id/` typo path.
CARRIER_PRIMARY="refs/spec-ids/"
CARRIER_TAGS="refs/tags/spec-id/"
DEFAULT_CARRIER="$CARRIER_PRIMARY"

# The two upstream read patterns. Always both, never the active carrier alone:
# reading only the configured one truncates the allocated set across a carrier
# change. Deliberately siblings of the org namespaces derived below.
UPSTREAM_PATTERN_PRIMARY="refs/spec-ids/*"
UPSTREAM_PATTERN_TAGS="refs/tags/spec-id/*"

MAX_ATTEMPTS="${CREWRIG_SPEC_ID_MAX_ATTEMPTS:-10}"

# --- Diagnostics -------------------------------------------------------------

fail() {
  echo "Error: $*" >&2
  exit 1
}

note() { echo "$*" >&2; }

usage() {
  cat <<'USAGE'
reserve-spec-id.sh — secure a spec id before the spec file exists (spec 0112).

  bash scripts/reserve-spec-id.sh --issue <N>
      Allocate and secure the next free UPSTREAM id.

  bash scripts/reserve-spec-id.sh --id <ID> --issue <N> [--corpus upstream|org]
      Secure one specific identifier, treated as an opaque string. Both the
      maintainer path of requirement 10 (securing a fork contribution's id
      before merge) and, generalised from <NNNN> to any string, requirement 14
      of delta-01.

Options:
  --issue <N>   GitHub issue the id is reserved for. Required.
  --id <ID>     Secure this identifier instead of computing the next free one.
                Required with --corpus org.
  --corpus <c>  'upstream' (default) or 'org'. Explicit, never inferred from
                the identifier's shape.
  --offline     Skip the remote entirely and return exit 3.
  -h, --help    This block.

There is deliberately no --remote flag: the remote comes from the reference
branch, resolved with the repository's existing BASE_REF idiom below.

Environment:
  BASE_REF                       The reference branch. Default: the first
                                 remote matching 'crewrig|origin' (else the
                                 first remote) with /main appended. The remote
                                 is its first path component.
  CREWRIG_SPEC_ID_CARRIER        One-off carrier override for a single
                                 invocation, for debugging. NOT the normal
                                 configuration route — see
                                 .crewrig/spec-id-carrier.
  CREWRIG_SPEC_ID_MAX_ATTEMPTS   Retry budget for lost races (default 10).
  CREWRIG_REPO_DIR               Repository root override (used by the
                                 regression suite).

Exit codes: 0 secured (stdout: the id) | 3 allocated locally, NOT secured
(stdout: the id, then 'unsecured-id: true') | 1 genuine failure (stderr).
USAGE
}

# --- Argument parsing --------------------------------------------------------

ISSUE=""
WANT_ID=""
CORPUS="upstream"
OFFLINE=false

while [ "$#" -gt 0 ]; do
  case "$1" in
    --issue)   ISSUE="${2:-}"; shift 2 ;;
    --id)      WANT_ID="${2:-}"; shift 2 ;;
    --corpus)  CORPUS="${2:-}"; shift 2 ;;
    --offline) OFFLINE=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *)         fail "unknown argument '$1'. Run with --help for the usage block." ;;
  esac
done

case "$CORPUS" in
  upstream|org) ;;
  *) fail "unknown corpus '$CORPUS'. Expected 'upstream' or 'org'." ;;
esac

if [ -z "$ISSUE" ]; then
  fail "--issue <N> is required: a reservation records the ticket it is held for."
fi
case "$ISSUE" in
  *[!0-9]*) fail "--issue must be a positive integer, got '$ISSUE'." ;;
esac

case "$MAX_ATTEMPTS" in
  ""|*[!0-9]*) fail "CREWRIG_SPEC_ID_MAX_ATTEMPTS must be a positive integer, got '$MAX_ATTEMPTS'." ;;
esac
if [ "$MAX_ATTEMPTS" -lt 1 ]; then
  fail "CREWRIG_SPEC_ID_MAX_ATTEMPTS must be at least 1, got '$MAX_ATTEMPTS'."
fi

# `--corpus org` requires `--id`. Computing the next free ORG identifier is out
# of scope by delta-01 requirement 16 — upstream does not know the org numbering
# convention. Refusing loudly beats silently falling back to an upstream
# computation and handing the caller a number from the wrong corpus.
if [ "$CORPUS" = "org" ] && [ -z "$WANT_ID" ]; then
  fail "--corpus org requires --id <ID>. Computing the next free org identifier is
       out of scope (spec 0112 delta-01, requirement 16): the org numbering
       convention is deliberately unknown to upstream, per
       specs/0071-org-specs-lint-exclusion.md. Choose the identifier and pass it."
fi

# --- Carrier resolution ------------------------------------------------------

# Read the tracked setting. An ABSENT file resolves to the built-in default
# rather than an error: the entry is `excluded` in .crewrig/core-paths.txt, so
# the synchroniser never restores it and a fork that deletes it must still work.
# Resolves into CARRIER_FILE_VALUE / CARRIER_FILE_STATE, set in the parent shell
# rather than printed, because the caller needs to tell THREE states apart and a
# command substitution collapses two of them into the empty string:
#
#   absent      No file. No intent was expressed, so the built-in default is the
#               right answer — and it has to be, since the entry is `excluded` in
#               .crewrig/core-paths.txt and the synchroniser will never restore a
#               file a fork deleted.
#   parsed      The adopter stated which namespace their remote accepts.
#   malformed   A file exists but names no namespace. The adopter MEANT
#               something and this script cannot tell what, so it refuses.
#
# The absent/malformed asymmetry is the whole point and is a judgement about
# INTENT, not about parsing. Falling back to the default on a malformed file
# would leave an adopter whose remote refuses that default writing to it
# forever, seeing exit 3 on every allocation with nothing anywhere pointing at
# the cause — the silent degradation this mechanism exists to eliminate,
# arriving through its own configuration surface.
CARRIER_FILE_VALUE=""
CARRIER_FILE_STATE="absent"

read_carrier_setting() {
  local line value
  if [ ! -f "$CARRIER_FILE" ]; then
    CARRIER_FILE_STATE="absent"
    return 0
  fi
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    case "$line" in
      carrier=*)
        value="${line#carrier=}"
        value="${value#"${value%%[![:space:]]*}"}"     # ltrim
        value="${value%"${value##*[![:space:]]}"}"     # rtrim
        if [ -n "$value" ]; then
          CARRIER_FILE_VALUE="$value"
          CARRIER_FILE_STATE="parsed"
        else
          # A bare `carrier=` states a key and no value: malformed, not absent.
          CARRIER_FILE_STATE="malformed"
        fi
        return 0
        ;;
    esac
  done < "$CARRIER_FILE"
  CARRIER_FILE_STATE="malformed"
  return 0
}

CARRIER="${CREWRIG_SPEC_ID_CARRIER:-}"
CARRIER_SOURCE="the CREWRIG_SPEC_ID_CARRIER environment override"
if [ -z "$CARRIER" ]; then
  read_carrier_setting
  case "$CARRIER_FILE_STATE" in
    parsed)
      CARRIER="$CARRIER_FILE_VALUE"
      CARRIER_SOURCE="$CARRIER_FILE"
      ;;
    malformed)
      fail "the carrier setting '$CARRIER_FILE' exists but names no namespace: no
       line of the form 'carrier=<namespace>' with a non-empty value was found.
       Refusing to fall back to the built-in default '$DEFAULT_CARRIER'. A file
       that exists is a statement of intent, and if this repository's remote is
       one that refuses the default, silently using it would make every
       allocation report an unsecured id with nothing pointing at the cause.
       Write one of:
         carrier=$CARRIER_PRIMARY
         carrier=$CARRIER_TAGS
       (An ABSENT file is different and is not an error: it means no intent was
       expressed, and the built-in default applies.)"
      ;;
    *)
      CARRIER="$DEFAULT_CARRIER"
      CARRIER_SOURCE="the built-in default (no $CARRIER_FILE)"
      ;;
  esac
fi

# Validate against the closed pair BEFORE any push.
case "$CARRIER" in
  "$CARRIER_PRIMARY") ORG_NAMESPACE="refs/spec-ids-org/" ;;
  "$CARRIER_TAGS")    ORG_NAMESPACE="refs/tags/spec-id-org/" ;;
  *)
    fail "invalid carrier '$CARRIER' (from $CARRIER_SOURCE).
       Allowed values are exactly '$CARRIER_PRIMARY' and '$CARRIER_TAGS'.
       A third namespace would be written by the push and read by neither the
       allocation union nor scripts/check-spec-id-reserved.sh, so every id
       secured under it would be invisible to both."
    ;;
esac

if [ "$CORPUS" = "org" ]; then
  TARGET_NAMESPACE="$ORG_NAMESPACE"
else
  TARGET_NAMESPACE="$CARRIER"
fi

# --- Representability (delta-01 requirement 14, stated in full) --------------

# The identifier stays opaque to this script's LOGIC — nothing here parses or
# interprets it — but the carrier is a git ref and cannot hold every string. An
# organization free to choose any convention may choose one containing a space,
# a `~`, a `..`, or a trailing `.lock`. Surfacing that here costs one call;
# discovering it through a raw git diagnostic costs an adopter an afternoon.
assert_representable() {
  local id="$1"
  if [ -z "$id" ]; then
    fail "the identifier is empty."
  fi
  if ! git check-ref-format "${TARGET_NAMESPACE}${id}" 2>/dev/null; then
    fail "identifier '$id' cannot be represented as a git ref
       ('${TARGET_NAMESPACE}${id}' is rejected by 'git check-ref-format').
       A reservation IS a git ref, so an identifier may not contain a space, a
       control character, '~', '^', ':', '?', '*', '[', a backslash, a '..'
       sequence, a leading or trailing '/', or a trailing '.lock'. Choose an
       identifier git can name; this script does not encode one it cannot,
       because an encoding would make the stored identifier differ from the
       written one."
  fi
}

if [ -n "$WANT_ID" ]; then
  assert_representable "$WANT_ID"
fi

# --- Reference branch and remote ---------------------------------------------

# One idiom, not a third one. `BASE_REF` when set, else the first remote
# matching `crewrig|origin` (falling back to the first remote at all) with
# `/main` appended — the derivation documented at
# `scripts/lib/spec-linter.js:114-131` and aligned there with
# `scripts/check-skill-versions.sh:24-33`. There is deliberately no `--remote`
# flag: the remote is the reference ref's first path component, so it is always
# a remote NAME. Nothing here names a repository path or a URL, which is what
# lets the regression suites aim the tool at a `file://` bare repository.
REFERENCE_REF="${BASE_REF:-$(git -C "$REPO_DIR" remote | grep -E -m1 'crewrig|origin' || git -C "$REPO_DIR" remote | head -1)/main}"
REMOTE="${REFERENCE_REF%%/*}"

if ! $OFFLINE && [ -z "$REMOTE" ]; then
  # `REFERENCE_REF` is bare `/main`: the remote list was empty.
  note "Notice: no git remote is configured, so no id can be secured."
  OFFLINE=true
fi

# --- The allocated set (upstream corpus only) --------------------------------

# Extract the four-digit prefix of every non-delta spec path outside
# `specs/org/`. A path this filter does not recognise is not an id — it is
# `README.md`, `_template.md`, a delta, or an org spec — and is dropped rather
# than guessed at.
ids_from_spec_paths() {
  local p base
  while IFS= read -r p; do
    case "$p" in
      ""|specs/org/*) continue ;;
      specs/*) ;;
      *) continue ;;
    esac
    base="${p##*/}"
    case "$base" in
      *.delta-*|_template.md|README.md) continue ;;
      [0-9][0-9][0-9][0-9]-*.md) printf '%s\n' "${base%%-*}" ;;
    esac
  done
}

# Repo-relative spec paths merged on the reference branch. Falls back to the
# local working tree when the remote branch does not resolve — that is the
# offline path, and it is precisely why such a run exits 3 rather than 0.
merged_spec_paths() {
  local listing="" p branch
  if ! $OFFLINE; then
    if ! git -C "$REPO_DIR" rev-parse --verify --quiet "$REFERENCE_REF" >/dev/null 2>&1; then
      branch="${REFERENCE_REF#*/}"
      if [ -n "$branch" ] && [ "$branch" != "$REFERENCE_REF" ]; then
        git -C "$REPO_DIR" fetch --depth=50 "$REMOTE" "$branch" >/dev/null 2>&1 || true
      fi
    fi
    if git -C "$REPO_DIR" rev-parse --verify --quiet "$REFERENCE_REF" >/dev/null 2>&1; then
      listing="$(git -C "$REPO_DIR" ls-tree -r --name-only "$REFERENCE_REF" -- specs/ 2>/dev/null || true)"
      if [ -n "$listing" ]; then
        printf '%s\n' "$listing"
        return 0
      fi
    fi
  fi
  for p in "$REPO_DIR"/specs/*.md; do
    if [ -f "$p" ]; then
      printf 'specs/%s\n' "${p##*/}"
    fi
  done
}

# Ids secured in ONE namespace, parsed from an `ls-remote` listing. The id is
# everything after the namespace prefix — NOT the ref's last component — so an
# identifier legitimately containing `/` round-trips intact instead of being
# silently truncated to its tail.
ids_from_ls_remote() {
  local prefix="$1" line ref
  while IFS= read -r line; do
    if [ -z "$line" ]; then
      continue
    fi
    ref="${line#*$'\t'}"
    case "$ref" in
      *'^{}') continue ;;          # peeled annotated-tag line; the real ref is its own line
    esac
    case "$ref" in
      "$prefix"*) printf '%s\n' "${ref#"$prefix"}" ;;
    esac
  done
}

# Parent-shell state, deliberately not computed inside a pipeline or process
# substitution: REMOTE_READABLE must survive the call. An unreadable namespace
# is indistinguishable from an empty one (measured), so recording which of the
# two happened is the only way to avoid reporting "no reservations exist" when
# the truth is "could not look".
ALLOCATED_IDS=""
REMOTE_READABLE=false

load_allocated_ids() {
  local primary_out tags_out
  ALLOCATED_IDS="$(merged_spec_paths | ids_from_spec_paths)"
  REMOTE_READABLE=false
  if $OFFLINE; then
    return 0
  fi
  if ! primary_out="$(git -C "$REPO_DIR" ls-remote "$REMOTE" "$UPSTREAM_PATTERN_PRIMARY" 2>/dev/null)"; then
    note "Notice: cannot read '$UPSTREAM_PATTERN_PRIMARY' on '$REMOTE' — no access, or the remote is unreachable."
    return 0
  fi
  REMOTE_READABLE=true
  tags_out="$(git -C "$REPO_DIR" ls-remote "$REMOTE" "$UPSTREAM_PATTERN_TAGS" 2>/dev/null || true)"
  ALLOCATED_IDS="$ALLOCATED_IDS
$(printf '%s\n' "$primary_out" | ids_from_ls_remote "$CARRIER_PRIMARY")
$(printf '%s\n' "$tags_out" | ids_from_ls_remote "$CARRIER_TAGS")"
}

# The next free four-digit id above everything allocated. Requirement 5 accepts
# gaps, so this is a high-water mark, not a hole-filler.
next_free_id() {
  local id highest=0 numeric
  while IFS= read -r id; do
    case "$id" in
      # Only a bare four-digit id participates. Anything else found in an
      # upstream namespace is not an upstream id and is deliberately ignored
      # rather than parsed — recognising a foreign convention is what
      # requirement 16 forbids.
      [0-9][0-9][0-9][0-9]) numeric="$((10#$id))" ;;
      *) continue ;;
    esac
    if [ "$numeric" -gt "$highest" ]; then
      highest="$numeric"
    fi
  done <<EOF
$ALLOCATED_IDS
EOF
  printf '%04d' "$((highest + 1))"
}

# --- Reservation object ------------------------------------------------------

# A parentless commit over the empty tree — no `-p`, by design. `commit-tree`
# needs a committer identity; a hermetic checkout or a bare CI runner may have
# none configured, so supply a fallback rather than aborting on `empty ident`.
reservation_object() {
  local id="$1" empty_tree
  empty_tree="$(git -C "$REPO_DIR" hash-object -w -t tree /dev/null)"
  GIT_AUTHOR_NAME="${GIT_AUTHOR_NAME:-crewrig spec-id reservation}" \
  GIT_AUTHOR_EMAIL="${GIT_AUTHOR_EMAIL:-reserve-spec-id@crewrig.invalid}" \
  GIT_COMMITTER_NAME="${GIT_COMMITTER_NAME:-crewrig spec-id reservation}" \
  GIT_COMMITTER_EMAIL="${GIT_COMMITTER_EMAIL:-reserve-spec-id@crewrig.invalid}" \
    git -C "$REPO_DIR" commit-tree "$empty_tree" -m "reserve $id for issue #$ISSUE"
}

# The ticket recorded in an existing reservation, or empty when the record
# cannot be read. Fetches the reservation ref into a scratch local ref, reads
# the subject line, and removes the scratch ref.
recorded_issue() {
  local ref="$1" probe="refs/spec-id-probe/current" msg
  if ! git -C "$REPO_DIR" fetch --no-tags --quiet --force "$REMOTE" "+${ref}:${probe}" 2>/dev/null; then
    return 0
  fi
  msg="$(git -C "$REPO_DIR" log -1 --format=%s "$probe" 2>/dev/null || true)"
  git -C "$REPO_DIR" update-ref -d "$probe" 2>/dev/null || true
  case "$msg" in
    *"issue #"*) printf '%s' "${msg##*issue #}" ;;
  esac
}

# True iff the exact reservation ref exists on the remote.
ref_exists() {
  local out
  out="$(git -C "$REPO_DIR" ls-remote "$REMOTE" "$1" 2>/dev/null || true)"
  [ -n "$out" ]
}

# --- Emission ----------------------------------------------------------------

# Exit 3: allocated locally, not secured. The marker is emitted in the exact
# shape `spec-author` pastes into the frontmatter, so nothing has to reformat it.
emit_unsecured() {
  local id="$1" reason="$2"
  note ""
  note "The id '$id' is allocated LOCALLY but NOT secured: $reason"
  note "Another session may still take it, so the spec must carry the mark below."
  note "scripts/check-spec-id-reserved.sh reports it at pull-request time, and a"
  note "maintainer secures the id before merge with:"
  note "  bash scripts/reserve-spec-id.sh --id $id --issue $ISSUE"
  printf '%s\n' "$id"
  # Emitted in the EXACT frontmatter form, not `key=value`. The exit code
  # already carries the boolean completely, so a shell caller needs nothing
  # from this line; its whole value is being the line spec-author pastes into
  # the YAML frontmatter. A `key=value` spelling would optimise for a consumer
  # that does not exist at the cost of the one that does.
  printf 'unsecured-id: true\n'
  exit 3
}

# --- Main --------------------------------------------------------------------

if $OFFLINE; then
  if [ -n "$WANT_ID" ]; then
    emit_unsecured "$WANT_ID" "the remote was skipped (--offline), or no remote is configured"
  fi
  load_allocated_ids
  emit_unsecured "$(next_free_id)" "the remote was skipped (--offline), or no remote is configured"
fi

ID="$WANT_ID"
attempt=1
while :; do
  if [ "$attempt" -gt "$MAX_ATTEMPTS" ]; then
    fail "gave up after $MAX_ATTEMPTS attempts: every candidate id was taken by a
       concurrent session between the read and the push. That is contention, not
       a defect — re-run. Raise CREWRIG_SPEC_ID_MAX_ATTEMPTS if the repository is
       routinely this busy."
  fi

  if [ -z "$ID" ]; then
    load_allocated_ids
    if ! $REMOTE_READABLE; then
      emit_unsecured "$(next_free_id)" \
        "the reservation namespace on '$REMOTE' could not be read, so the allocated set is incomplete"
    fi
    ID="$(next_free_id)"
  fi

  assert_representable "$ID"
  REF="${TARGET_NAMESPACE}${ID}"
  OBJ="$(reservation_object "$ID")"

  # The create-only compare-and-swap. An empty expected value in
  # `--force-with-lease=<ref>:` means "this ref must still not exist", so the
  # loser of a race is refused rather than fast-forwarded over.
  push_rc=0
  push_out="$(git -C "$REPO_DIR" push --force-with-lease="${REF}:" \
                  "$REMOTE" "${OBJ}:${REF}" 2>&1)" || push_rc=$?

  if [ "$push_rc" -eq 0 ]; then
    note "Secured $REF for issue #$ISSUE."
    printf '%s\n' "$ID"
    exit 0
  fi

  # Refused. Re-read the id: present means we lost a race; absent means the
  # remote refused the write itself — no access, or a namespace it hides or
  # rejects. NEVER switch carrier here: under `transfer.hideRefs` the re-read
  # reports absent, and a fallback would let the same id be held twice.
  if ref_exists "$REF"; then
    if [ -n "$WANT_ID" ]; then
      holder="$(recorded_issue "$REF")"
      if [ "$holder" = "$ISSUE" ]; then
        note "Notice: $REF was already secured for issue #$ISSUE. Nothing to do."
        printf '%s\n' "$ID"
        exit 0
      fi
      if [ -n "$holder" ]; then
        fail "identifier '$ID' is already secured for issue #$holder, and issue
       #$ISSUE is asking for it. That is the collision this mechanism exists to
       surface: two tickets cannot hold one id. Resolve the attribution between
       #$holder and #$ISSUE, then re-run."
      fi
      fail "identifier '$ID' is already secured on '$REMOTE' ($REF exists) and the
       recording ticket could not be read. Refusing to overwrite a live
       reservation. Inspect it with:
         git ls-remote $REMOTE '$REF'"
    fi
    note "Lost the race for $ID; advancing to the next free id (attempt $attempt of $MAX_ATTEMPTS)."
    ID=""
    attempt="$((attempt + 1))"
    continue
  fi

  note "The push to $REF was refused and the id is still absent from the remote."
  note "git said:"
  printf '%s\n' "$push_out" | sed -e 's/^/  /' >&2
  emit_unsecured "$ID" \
    "the remote refused the write and no reservation appeared — no write access, or a namespace this remote hides or rejects"
done
