#!/bin/bash
# check-agent-profiles.sh — Hermetic checker for an agent source's
# metadata.model: capability profile (spec 0195 R23-R25, spec 0198 R36-R39).
#
# Decidable from the agent source and the domains of spec 0195 alone (R36):
# no network access, no installed CLI, and no mapping is ever consulted —
# it binds the metadata.model: mapping alone, so a source carrying no such
# mapping is reported clean, and a source carrying metadata.claude.model
# (every core agent source today; seam (f) removes it) is never rejected on
# that ground (R38). This check is an AUTHORING-TIME gate over a proposed
# change; its rejection SHALL NOT become a resolution failure (R39) — a
# profile this check rejects is still resolvable against, degrading the
# keys it cannot read (seam (d), scripts/lib/model-resolve.sh, spec 0198
# R17).
#
# The normative shape this script validates against is the eight admitted
# metadata.model: keys, the five tuning: knobs and their closed domains, all
# defined by specs/0195-agent-capability-profile.md requirements 6, 10-17
# and 19, and documented in artifacts/FORMAT.md's metadata.model: section.
#
# Usage:
#   bash scripts/check-agent-profiles.sh                    # conform mode,
#                                                            # artifacts/*/agents/*/AGENT.md
#   bash scripts/check-agent-profiles.sh <file> [<file> …]  # conform mode,
#                                                            # named files only
#
# Conform mode prints, per rejection, one line to stderr:
#   <file>: <assertion-id> <message>
# and accumulates rather than stopping at the first rejection, so a fixture
# that trips two classes reports both ids. The assertion id set is
# P1-P11 (P11 added for a shape check `modalities` needs beyond a per-member
# domain test — see docs/model-mapping-format.md's sibling A8/A10 precedent
# in scripts/check-model-mappings.sh for the same list-vs-scalar hazard).
#
# Exit codes:
#   0  every named/default source's metadata.model: (when present) conforms.
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

# --- Domains (spec 0195), pinned literally ----------------------------------
# See docs/model-mapping-format.md "Domains (spec 0195, pinned literally)"
# and artifacts/FORMAT.md's metadata.model: section for the update
# obligation on a future spec 0195 delta: both that document's block and
# this one must change together.
INTELLIGENCE_RUNGS="minimal low medium high xhigh xxhigh max"
REASONING_RUNGS="none low medium high xhigh max"
SPEED_DOMAIN="standard fast"
LOCALITY_DOMAIN="any local-only"
MODALITY_DOMAIN="text vision image-out"
PROFILE_KEYS="intelligence reasoning specialization context speed modalities locality tuning"
TUNING_KEYS="temperature top-p top-k max-output-tokens max-turns"

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
  for f in "$ARTIFACTS_DIR"/*/agents/*/AGENT.md; do
    [ -f "$f" ] && FILES+=("$f")
  done
  if [ "${#FILES[@]}" -eq 0 ]; then
    echo "Error: no */agents/*/AGENT.md files under $ARTIFACTS_DIR" >&2
    exit 2
  fi
fi

# --- Small helpers -----------------------------------------------------------

extract_frontmatter() {
  awk 'NR==1 && /^---$/{inblk=1; next} inblk && /^---$/{exit} inblk{print}' "$1"
}

FAILURES=()
CURRENT_FILE=""
fail() {
  # $1 = assertion id, $2 = message. Uses CURRENT_FILE, set by check_file.
  echo "${CURRENT_FILE}: ${1} ${2}" >&2
  FAILURES+=("${CURRENT_FILE}: ${1} ${2}")
  return 0
}

# check_tuning_value <knob> <min> <max-or-empty> <integer|number|number-open-floor>
# Reads $fm (set by check_file; visible here via bash's dynamic scoping).
# P8: a tuning value of the wrong type, or outside its declared range.
check_tuning_value() {
  local knob="$1" min="$2" max="$3" kind="$4" has v ok
  has=$(printf '%s\n' "$fm" | yq "(.metadata.model.tuning | has(\"$knob\"))" 2>/dev/null || echo false)
  [ "$has" != true ] && return 0
  v=$(printf '%s\n' "$fm" | yq -r ".metadata.model.tuning.\"$knob\"" 2>/dev/null)
  case "$kind" in
    integer)
      case "$v" in
        ''|*[!0-9]*) fail P8 "tuning.$knob '$v' is not an integer"; return 0 ;;
      esac
      [ "$v" -lt "$min" ] && fail P8 "tuning.$knob '$v' is below the minimum $min"
      ;;
    number)
      case "$v" in ''|*[!0-9.]*) fail P8 "tuning.$knob '$v' is not a number"; return 0 ;; esac
      ok=$(awk -v x="$v" -v lo="$min" -v hi="$max" 'BEGIN{ print (x+0 >= lo+0 && x+0 <= hi+0) ? "yes" : "no" }' 2>/dev/null || echo no)
      [ "$ok" != yes ] && fail P8 "tuning.$knob '$v' is outside ${min}..${max} inclusive"
      ;;
    number-open-floor)
      case "$v" in ''|*[!0-9.]*) fail P8 "tuning.$knob '$v' is not a number"; return 0 ;; esac
      ok=$(awk -v x="$v" -v lo="$min" -v hi="$max" 'BEGIN{ print (x+0 > lo+0 && x+0 <= hi+0) ? "yes" : "no" }' 2>/dev/null || echo no)
      [ "$ok" != yes ] && fail P8 "tuning.$knob '$v' is outside (${min}, ${max}] — open at the floor"
      ;;
  esac
  return 0
}

# --- Orchestration for one file ----------------------------------------------

check_file() {
  CURRENT_FILE="$1"
  local fm has_model
  fm=$(extract_frontmatter "$CURRENT_FILE")
  has_model=$(printf '%s\n' "$fm" | yq '.metadata // {} | has("model")' 2>/dev/null || echo false)
  [ "$has_model" != true ] && return 0

  # P1 — metadata.model is present but is not a mapping.
  local model_tag
  model_tag=$(printf '%s\n' "$fm" | yq '.metadata.model | tag' 2>/dev/null || echo "")
  if [ "$model_tag" != "!!map" ]; then
    fail P1 "metadata.model is present but is not a mapping (tag: ${model_tag:-unknown})"
    return 0
  fi

  # P2 — a key under metadata.model: outside the eight spec 0195 R19 admits.
  local keys k
  keys=$(printf '%s\n' "$fm" | yq -r '.metadata.model | keys | .[]' 2>/dev/null)
  while IFS= read -r k; do
    [ -z "$k" ] && continue
    case " $PROFILE_KEYS " in
      *" $k "*) : ;;
      *) fail P2 "metadata.model carries key '$k', outside the eight spec 0195 R19 admits" ;;
    esac
  done <<< "$keys"

  local has_v v
  # P4 — intelligence outside the seven spec 0195 rungs.
  has_v=$(printf '%s\n' "$fm" | yq '.metadata.model | has("intelligence")' 2>/dev/null || echo false)
  if [ "$has_v" = true ]; then
    v=$(printf '%s\n' "$fm" | yq -r '.metadata.model.intelligence' 2>/dev/null)
    case " $INTELLIGENCE_RUNGS " in *" $v "*) : ;; *) fail P4 "intelligence '$v' is outside the seven spec 0195 rungs" ;; esac
  fi

  # P5 — reasoning outside the six spec 0195 rungs.
  has_v=$(printf '%s\n' "$fm" | yq '.metadata.model | has("reasoning")' 2>/dev/null || echo false)
  if [ "$has_v" = true ]; then
    v=$(printf '%s\n' "$fm" | yq -r '.metadata.model.reasoning' 2>/dev/null)
    case " $REASONING_RUNGS " in *" $v "*) : ;; *) fail P5 "reasoning '$v' is outside the six spec 0195 rungs" ;; esac
  fi

  # P6 — speed / locality outside their closed domains, or a modalities
  # MEMBER outside text|vision|image-out (P11 below is the LIST-shape half).
  has_v=$(printf '%s\n' "$fm" | yq '.metadata.model | has("speed")' 2>/dev/null || echo false)
  if [ "$has_v" = true ]; then
    v=$(printf '%s\n' "$fm" | yq -r '.metadata.model.speed' 2>/dev/null)
    case " $SPEED_DOMAIN " in *" $v "*) : ;; *) fail P6 "speed '$v' is outside standard|fast" ;; esac
  fi
  has_v=$(printf '%s\n' "$fm" | yq '.metadata.model | has("locality")' 2>/dev/null || echo false)
  if [ "$has_v" = true ]; then
    v=$(printf '%s\n' "$fm" | yq -r '.metadata.model.locality' 2>/dev/null)
    case " $LOCALITY_DOMAIN " in *" $v "*) : ;; *) fail P6 "locality '$v' is outside any|local-only" ;; esac
  fi
  has_v=$(printf '%s\n' "$fm" | yq '.metadata.model | has("modalities")' 2>/dev/null || echo false)
  if [ "$has_v" = true ]; then
    # P11 — modalities must itself be a list (spec 0195 R15): a bare scalar
    # yields no members under `[]` and passes silently, and a mapping's
    # VALUES stream out of `[]` the same way an offering's would (the same
    # list-vs-scalar hazard scripts/check-model-mappings.sh's A9/A10 close
    # for a mapping cell) — named as v3-F4's P11 in PLAN v3.
    local modalities_tag
    modalities_tag=$(printf '%s\n' "$fm" | yq '.metadata.model.modalities | tag' 2>/dev/null || echo "")
    if [ "$modalities_tag" != "!!seq" ]; then
      fail P11 "modalities is present but is not a list (tag: ${modalities_tag:-unknown})"
    else
      local mv
      while IFS= read -r mv; do
        [ -z "$mv" ] && continue
        case " $MODALITY_DOMAIN " in *" $mv "*) : ;; *) fail P6 "modalities member '$mv' is outside text|vision|image-out" ;; esac
      done < <(printf '%s\n' "$fm" | yq -r '.metadata.model.modalities[]' 2>/dev/null)
    fi
  fi

  # P7 — context not a positive integer.
  has_v=$(printf '%s\n' "$fm" | yq '.metadata.model | has("context")' 2>/dev/null || echo false)
  if [ "$has_v" = true ]; then
    v=$(printf '%s\n' "$fm" | yq -r '.metadata.model.context' 2>/dev/null)
    case "$v" in
      ''|*[!0-9]*|0) fail P7 "context '$v' is not a positive integer" ;;
      *) : ;;
    esac
  fi

  # P9 — specialization: kebab-case SHAPE only, never membership (D10):
  # requirement 25 forbids rejecting an unenumerated open-enum value.
  has_v=$(printf '%s\n' "$fm" | yq '.metadata.model | has("specialization")' 2>/dev/null || echo false)
  if [ "$has_v" = true ]; then
    v=$(printf '%s\n' "$fm" | yq -r '.metadata.model.specialization' 2>/dev/null)
    printf '%s' "$v" | grep -qE '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' || fail P9 "specialization '$v' is not a kebab-case token"
  fi

  # P10 — tuning: present but not a mapping. Ground corrected per v3-F4: a
  # LIST has keys (its integer indices), so P3's key-iteration below would
  # silently pass one; only a bare SCALAR has no keys at all. P10 catches
  # both shapes directly via `tag`, ahead of P3.
  local has_tuning tuning_tag
  has_tuning=$(printf '%s\n' "$fm" | yq '.metadata.model | has("tuning")' 2>/dev/null || echo false)
  if [ "$has_tuning" = true ]; then
    tuning_tag=$(printf '%s\n' "$fm" | yq '.metadata.model.tuning | tag' 2>/dev/null || echo "")
    if [ "$tuning_tag" != "!!map" ]; then
      fail P10 "tuning is present but is not a mapping (tag: ${tuning_tag:-unknown})"
    else
      # P3 — a key under tuning: outside the five spec 0195 R17 knobs.
      local tkeys tk
      tkeys=$(printf '%s\n' "$fm" | yq -r '.metadata.model.tuning | keys | .[]' 2>/dev/null)
      while IFS= read -r tk; do
        [ -z "$tk" ] && continue
        case " $TUNING_KEYS " in
          *" $tk "*) : ;;
          *) fail P3 "tuning carries key '$tk', outside the five spec 0195 R17 knobs" ;;
        esac
      done <<< "$tkeys"

      # P8, one knob boundary at a time (v3-F4: one mutation per knob, not
      # one per assertion id — R17's five predicates are genuinely
      # different: temperature closed both ends, top-p open at the floor,
      # the other three integer minima).
      check_tuning_value temperature 0.0 2.0 number
      check_tuning_value top-p 0.0 1.0 number-open-floor
      check_tuning_value top-k 1 "" integer
      check_tuning_value max-output-tokens 1 "" integer
      check_tuning_value max-turns 1 "" integer
    fi
  fi
  return 0
}

# --- Main --------------------------------------------------------------------

for f in ${FILES[@]+"${FILES[@]}"}; do
  check_file "$f"
done

if [ "${#FAILURES[@]}" -gt 0 ]; then
  echo "" >&2
  echo "FAILED: ${#FAILURES[@]} rejection(s) across ${#FILES[@]} agent source(s) (spec 0195 R23-R25)." >&2
  exit 1
fi

echo "OK: ${#FILES[@]} agent source(s) checked; every declared metadata.model: profile conforms."
