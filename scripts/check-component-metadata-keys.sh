#!/bin/bash
# check-component-metadata-keys.sh — Hermetic closed-key checker for the
# metadata: block of an upstream-owned component source (spec 0200 R8-R12).
#
# Decidable from the source file and the admitted key set alone (R11): no
# network access, no installed CLI, and no mapping is ever consulted. Binds
# artifacts/core/** and artifacts/library/** — the two tiers
# .crewrig/core-paths.txt governs — and reports clean for every path under
# artifacts/community/ or artifacts/org/ (R8's last clause), because policing
# an adopter's own metadata is not this framework's business.
#
# This is a script DISTINCT from scripts/check-agent-profiles.sh (spec 0198
# R38 forbids that script from rejecting a source for carrying
# metadata.claude.model, and requirement 10 of spec 0200 keeps that binding
# in force unamended). check-agent-profiles.sh answers "does this source's
# metadata.model: conform?"; this script answers "does this source's
# metadata: block carry only the admitted keys?" — profile conformance and
# migration completeness are different questions with different failure
# modes (spec 0200 Decision 5).
#
# Authoring-time only (R12): this check is never invoked from
# build-components.sh and never from resolve_agent. A source it rejects
# SHALL still compile and SHALL still be resolvable against.
#
# Usage:
#   bash scripts/check-component-metadata-keys.sh                    # conform
#                                                                     # mode,
#                                                                     # the 45
#                                                                     # sources
#   bash scripts/check-component-metadata-keys.sh <file> [<file> …]  # conform
#                                                                     # mode,
#                                                                     # named
#                                                                     # files
#                                                                     # only
#
# Conform mode prints, per rejection, one line to stderr:
#   <file>: <assertion-id> <message>
# and accumulates rather than stopping at the first rejection.
#
# Exit codes:
#   0  every named/default source's metadata: block (when present) admits
#      only provenance and model.
#   1  one or more rejections.
#   2  a prerequisite or input failure: yq absent, artifacts/ absent (in
#      default-glob mode), or a named file argument that does not exist.
#
# Override the repository root with CREWRIG_REPO_DIR (used by the self-test
# against temporary fixtures), mirroring the sibling check-*.sh guards.
#
# Prerequisites: yq (mikefarah v4).

set -euo pipefail

command -v yq >/dev/null 2>&1 || {
  echo "Error: yq is required. Install with: brew install yq" >&2
  exit 2
}

REPO_DIR="${CREWRIG_REPO_DIR:-"$(cd "$(dirname "$0")/.." && pwd)"}"

# --- Admitted keys (spec 0200 R8), pinned literally --------------------------
ADMITTED_KEYS="provenance model"

# --- Governed tier prefixes (spec 0200 R8), pinned literally ----------------
# The tier of a component source is decidable from its path alone; reading
# .crewrig/core-paths.txt at run time was rejected (spec 0200 PLAN v2,
# Decision 3) — a second input is a second failure mode for a check R11
# requires decidable "from the source file and the admitted key set alone".
# These two prefixes are the source of truth's own literal values and MUST be
# kept in step with `.crewrig/core-paths.txt` by hand: a tier renamed or added
# there without a matching edit here silently narrows or widens this check's
# domain.
GOVERNED_PREFIXES="artifacts/core/ artifacts/library/"

# --- Arg parsing -------------------------------------------------------------

FILES=()
if [ "$#" -gt 0 ]; then
  for a in "$@"; do
    if [ ! -f "$a" ]; then
      echo "Error: named argument does not exist: $a" >&2
      exit 2
    fi
    FILES+=("$a")
  done
else
  ARTIFACTS_DIR="$REPO_DIR/artifacts"
  if [ ! -d "$ARTIFACTS_DIR" ]; then
    echo "Error: artifacts/ not found: $ARTIFACTS_DIR" >&2
    exit 2
  fi
  for tier in core library; do
    for f in "$ARTIFACTS_DIR/$tier"/skills/*/SKILL.md \
             "$ARTIFACTS_DIR/$tier"/commands/*.md \
             "$ARTIFACTS_DIR/$tier"/agents/*/AGENT.md; do
      [ -f "$f" ] && FILES+=("$f")
    done
  done
  if [ "${#FILES[@]}" -eq 0 ]; then
    echo "Error: no component sources found under $ARTIFACTS_DIR/{core,library}" >&2
    exit 2
  fi
fi

# --- Small helpers -----------------------------------------------------------

extract_frontmatter() {
  awk 'NR==1 && /^---$/{inblk=1; next} inblk && /^---$/{exit} inblk{print}' "$1"
}

# is_governed <path> — true iff <path> carries one of GOVERNED_PREFIXES as a
# path component, whether given repo-relative or as an absolute path rooted
# in some other throwaway tree (the mutation suite's fixture pattern: a
# scratch root seeded with artifacts/community/... or artifacts/org/...).
# A named file outside both tiers is reported clean without being read at
# all (R8's last clause) — tier is decidable from the path string alone.
is_governed() {
  local path="$1" prefix
  for prefix in $GOVERNED_PREFIXES; do
    case "$path" in
      "$prefix"*|*"/$prefix"*) return 0 ;;
    esac
  done
  return 1
}

FAILURES=()
CURRENT_FILE=""
fail() {
  # $1 = assertion id, $2 = message. Uses CURRENT_FILE, set by check_file.
  echo "${CURRENT_FILE}: ${1} ${2}" >&2
  FAILURES+=("${CURRENT_FILE}: ${1} ${2}")
  return 0
}

# check_file <path> — K1: a key beneath metadata: outside {provenance, model}.
# Reports clean (no-op) for a source with no metadata: block at all, and
# never inspects a source's top-level claude: section (R9) — extract_frontmatter
# returns the whole frontmatter, but this function only ever queries the
# .metadata sub-tree, so a sibling top-level claude: key is never reached and
# never named.
check_file() {
  CURRENT_FILE="$1"
  local fm has_metadata
  fm=$(extract_frontmatter "$CURRENT_FILE")
  has_metadata=$(printf '%s\n' "$fm" | yq 'has("metadata")' 2>/dev/null || echo false)
  [ "$has_metadata" != true ] && return 0

  local keys k
  keys=$(printf '%s\n' "$fm" | yq -r '.metadata | keys | .[]' 2>/dev/null)
  while IFS= read -r k; do
    [ -z "$k" ] && continue
    case " $ADMITTED_KEYS " in
      *" $k "*) : ;;
      *) fail K1 "metadata.$k is not admitted — only metadata.provenance and metadata.model are, on artifacts/core/** and artifacts/library/** (spec 0200 R8)" ;;
    esac
  done <<< "$keys"
  return 0
}

# --- Main --------------------------------------------------------------------

for f in ${FILES[@]+"${FILES[@]}"}; do
  is_governed "$f" || continue
  check_file "$f"
done

if [ "${#FAILURES[@]}" -gt 0 ]; then
  echo "" >&2
  echo "FAILED: ${#FAILURES[@]} rejection(s) across ${#FILES[@]} source(s) (spec 0200 R8)." >&2
  exit 1
fi

echo "OK: ${#FILES[@]} source(s) checked; every governed metadata: block admits only provenance and model."
