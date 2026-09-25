# shellcheck shell=bash
# base-ref-resolve.sh — Shared BASE_REF normalization and dynamic-trunk
# fallback for scripts/check-extension-version-bump.sh,
# scripts/check-skill-versions.sh, and scripts/check-spec-id-reserved.sh
# (issue #1214). scripts/lib/spec-linter.js mirrors the same two behaviours
# in JavaScript rather than sourcing this file, so the semantics below MUST
# stay in lockstep with resolveBaseRef() there.
#
# Two independent problems, one shared fix:
#   1. A BASE_REF ending in `/` (e.g. "origin/") is an unexpanded CI variable
#      — a push event, or a merge-request target-branch variable that failed
#      to interpolate — not a real ref. Handed to `git rev-parse`/`git diff`
#      verbatim it fails closed (git rejects a slash-terminated ref). It must
#      be treated as UNSET so the caller's own default-derivation runs
#      instead.
#   2. The bare `<remote>/main` default silently assumes `main` is the trunk.
#      An adopter whose trunk is `develop` (or a fork with no local `main`)
#      fails closed. `main` remains the PREFERRED default — the nominal case
#      for this framework's own CI — and the fallback to `develop` fires
#      ONLY when `main` does not verify.
#
# Usage:
#   SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
#   source "$SCRIPT_DIR/lib/base-ref-resolve.sh"
#   BASE_REF="$(normalize_base_ref "${1:-${BASE_REF:-}}")"
#   if [ -z "$BASE_REF" ]; then
#     BASE_REF="$(default_base_ref "$remote_name")"
#   fi
#
# Both functions are pure (stdout only, no mutation of caller state) so each
# call site keeps its own precedence order around them. In particular,
# check-spec-id-reserved.sh's CI-aware derivation (explicit BASE_REF → CI
# target-branch variable → default) is UNCHANGED by this file: it calls
# default_base_ref() only for its own third branch, the one that already
# hardcoded `<remote>/main`.

# normalize_base_ref <value> — echoes <value> unchanged, UNLESS it ends in
# `/`, in which case it echoes the empty string so the caller's "is BASE_REF
# set" check treats it as unset rather than handing a slash-terminated ref to
# git.
normalize_base_ref() {
  case "$1" in
    */) printf '%s' "" ;;
    *) printf '%s' "$1" ;;
  esac
}

# default_base_ref <remote> [<repo-dir>] — the trunk ref to default to when
# BASE_REF is unset, given the already-resolved remote name. Prefers
# `<remote>/main` (the nominal case); falls back to `<remote>/develop` ONLY
# when `main` does not verify. <repo-dir>, when given, is passed to `git -C`
# so a caller that resolves paths relative to a directory other than the
# current one (check-spec-id-reserved.sh's CREWRIG_REPO_DIR override) probes
# the right worktree; it defaults to the current directory.
#
# Neither verifying is not an error here — it echoes `<remote>/main`
# regardless, preserving the CURRENT error behaviour: the caller's existing
# "not resolvable -> fetch -> still not resolvable -> hard error" path runs
# unchanged and produces the same message it always has. This is deliberate:
# in a shallow CI clone, neither ref may be fetched yet, and re-guessing here
# would only replace one silent guess with another.
default_base_ref() {
  local remote="$1" repo_dir="${2:-.}"
  local main_ref="${remote}/main" develop_ref="${remote}/develop"
  if git -C "$repo_dir" rev-parse --verify "$main_ref" >/dev/null 2>&1; then
    printf '%s' "$main_ref"
  elif git -C "$repo_dir" rev-parse --verify "$develop_ref" >/dev/null 2>&1; then
    printf '%s' "$develop_ref"
  else
    printf '%s' "$main_ref"
  fi
}
