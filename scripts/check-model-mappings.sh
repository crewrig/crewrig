#!/bin/bash
# check-model-mappings.sh — Hermetic checker for model-mappings/<target>.yml
# (spec 0197 R46-R51).
#
# Decidable from a mapping file and the domains of spec 0195 alone (R46): no
# network access, no installed CLI, no agent source is resolved. This check
# is an AUTHORING-TIME gate over a proposed change; its rejection SHALL NOT
# become a resolution failure (R51) — a mapping this check rejects is still
# resolvable against, degrading the cells it cannot read (seam (d)).
#
# The normative shape this script validates against is
# docs/model-mapping-format.md; the closed spec 0195 domains it pins
# literally are documented there too, alongside the update obligation on a
# future spec 0195 delta.
#
# Usage:
#   bash scripts/check-model-mappings.sh                    # conform mode,
#                                                            # model-mappings/*.yml
#   bash scripts/check-model-mappings.sh <file> [<file> …]  # conform mode,
#                                                            # named files only
#   bash scripts/check-model-mappings.sh --print-selection [<file> …]
#
# Conform mode prints, per rejection, one line to stderr:
#   <file>: <assertion-id> <message>
# and accumulates rather than stopping at the first rejection, so a fixture
# that trips two classes reports both ids (docs/model-mapping-format.md,
# "Node shapes and closed key sets" onward, is the assertion table's home;
# the id set is A1-A27, plus the synthetic A0 for a file that does not parse
# as YAML at all).
#
# --print-selection mode runs no assertion. For each file (default
# model-mappings/*.yml, or the named files), it simulates R17's
# floor-plus-ceiling candidate formation and R23's lowest-rank pick over the
# seven intelligence rungs, and prints one line per rung per mapping on
# stdout:
#   <file><TAB><rung><TAB><offering-id>
# <offering-id> is empty when no offering could be selected (a mapping
# declaring zero offerings, or none of whose offerings declares
# provides.intelligence). It exits 0 unless a prerequisite fails (see below);
# it never exits 1, because it renders no verdict.
#
# Exit codes:
#   0  conform mode: every named/default mapping file conforms.
#      print-selection mode: the requested lines were printed.
#   1  conform mode only: one or more rejections, including a file that does
#      not parse as YAML (a malformed file IS a rejected proposed change).
#   2  a prerequisite or input failure: yq absent, model-mappings/ absent (in
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
MAPPINGS_DIR="$REPO_DIR/model-mappings"

# --- Domains (spec 0195), pinned literally ----------------------------------
# See docs/model-mapping-format.md "Domains (spec 0195, pinned literally)"
# for the update obligation on a future spec 0195 delta.
INTELLIGENCE_RUNGS="minimal low medium high xhigh xxhigh max"
REASONING_RUNGS="none low medium high xhigh max"
SPEED_DOMAIN="standard fast"
LOCALITY_DOMAIN="any local-only"
MODALITY_DOMAIN="text vision image-out"
TARGET_VOCAB="claude gemini copilot antigravity"
ITEM_VOCAB="model reasoning temperature top-p top-k max-output-tokens max-turns"
CLOSED_ASPECTS="behavior"

# --- Arg parsing -------------------------------------------------------------

MODE=check
ARGS=()
for a in "$@"; do
  if [ "$a" = "--print-selection" ]; then
    MODE=print-selection
  else
    ARGS+=("$a")
  fi
done

FILES=()
if [ "${#ARGS[@]}" -gt 0 ]; then
  for a in ${ARGS[@]+"${ARGS[@]}"}; do
    if [ ! -f "$a" ]; then
      echo "Error: named argument does not exist: $a" >&2
      exit 2
    fi
    FILES+=("$a")
  done
else
  if [ ! -d "$MAPPINGS_DIR" ]; then
    echo "Error: model-mappings/ not found: $MAPPINGS_DIR" >&2
    exit 2
  fi
  for f in "$MAPPINGS_DIR"/*.yml; do
    [ -f "$f" ] && FILES+=("$f")
  done
  if [ "${#FILES[@]}" -eq 0 ]; then
    echo "Error: no *.yml files under $MAPPINGS_DIR" >&2
    exit 2
  fi
fi

# --- Small helpers -----------------------------------------------------------

in_list() { grep -qxF "$1" <<< "$2"; }

# tag_at <file> <yq-expr> — the yq `tag` of an expression, or empty when the
# expression indexes into a scalar (the hazard: yq returns an EMPTY node,
# never `!!null`, when a path descends through a non-map value).
tag_at() {
  yq "$2 | tag" "$1" 2>/dev/null
  return 0
}

# resolves_path <file> <node-path> <dotted-field-path> — true iff the dotted
# path resolves as an actual chain of declared keys under node-path (a real
# value: any tag other than empty or `!!null`).
resolves_path() {
  local file="$1" node="$2" path="$3" t
  [ -z "$path" ] && return 1
  t=$(tag_at "$file" "${node}.${path}")
  [ -n "$t" ] && [ "$t" != "!!null" ]
}

# resolves_declares <file> <node-path> <declares> — the A25 resolution rule:
# the full dotted path resolves, OR its last segment is a closed-vocabulary
# aspect token and the remaining prefix resolves on its own.
resolves_declares() {
  local file="$1" node="$2" declares="$3" last prefix
  if resolves_path "$file" "$node" "$declares"; then
    return 0
  fi
  case "$declares" in
    *.*) : ;;
    *) return 1 ;;
  esac
  last="${declares##*.}"
  prefix="${declares%.*}"
  case " $CLOSED_ASPECTS " in
    *" $last "*) : ;;
    *) return 1 ;;
  esac
  resolves_path "$file" "$node" "$prefix"
}

# domain_has_member <characteristic> <token> — true iff <token> is a member
# of <characteristic>'s CLOSED spec 0195 domain. specialization/context/
# modalities are not closed in the sense A10 clause (iii) needs, so they
# never match here (clause iii is vacuous for them, deliberately).
domain_has_member() {
  local c="$1" tok="$2"
  case "$c" in
    intelligence) case " $INTELLIGENCE_RUNGS " in *" $tok "*) return 0 ;; *) return 1 ;; esac ;;
    reasoning)    case " $REASONING_RUNGS "    in *" $tok "*) return 0 ;; *) return 1 ;; esac ;;
    speed)        case " $SPEED_DOMAIN "       in *" $tok "*) return 0 ;; *) return 1 ;; esac ;;
    locality)     case " $LOCALITY_DOMAIN "    in *" $tok "*) return 0 ;; *) return 1 ;; esac ;;
    *) return 1 ;;
  esac
}

# is_hyphen_segment <token> <native-value> — true iff <token> is one of the
# '-'-delimited segments of <native-value>.
is_hyphen_segment() {
  local token="$1" native="$2" seg
  local parts=()
  IFS='-' read -ra parts <<< "$native"
  for seg in ${parts[@]+"${parts[@]}"}; do
    [ "$seg" = "$token" ] && return 0
  done
  return 1
}

find_surface_index_by_kind() {
  local file="$1" kind="$2" n i k
  n=$(yq '.surfaces // [] | length' "$file")
  for ((i = 0; i < n; i++)); do
    k=$(yq -r ".surfaces[$i].kind // \"\"" "$file")
    [ "$k" = "$kind" ] && { echo "$i"; return; }
  done
  echo ""
  return 0
}

find_item_index() {
  local file="$1" sidx="$2" want="$3" n i it
  n=$(yq ".surfaces[$sidx].items // [] | length" "$file")
  for ((i = 0; i < n; i++)); do
    it=$(yq -r ".surfaces[$sidx].items[$i].item // \"\"" "$file")
    [ "$it" = "$want" ] && { echo "$i"; return; }
  done
  echo ""
  return 0
}

# grounds_kind_for <file> <node-path> <declares-target> — the mark kind
# ("citation"/"assumption") of the FIRST grounds entry of <node-path> whose
# `declares` equals <declares-target> exactly, or empty if none.
grounds_kind_for() {
  local file="$1" path="$2" target="$3" n i d hc ha
  n=$(yq "${path}.grounds // [] | length" "$file")
  for ((i = 0; i < n; i++)); do
    d=$(yq -r "${path}.grounds[$i].declares // \"\"" "$file")
    [ "$d" != "$target" ] && continue
    hc=$(yq "${path}.grounds[$i] | has(\"citation\")" "$file")
    ha=$(yq "${path}.grounds[$i] | has(\"assumption\")" "$file")
    [ "$hc" = "true" ] && { echo citation; return; }
    [ "$ha" = "true" ] && { echo assumption; return; }
    echo ""
    return
  done
  echo ""
  return 0
}

# --- Failure accumulator -----------------------------------------------------

FAILURES=()
CURRENT_FILE=""
fail() {
  # $1 = assertion id, $2 = message. Uses CURRENT_FILE, set by check_file.
  echo "${CURRENT_FILE}: ${1} ${2}" >&2
  FAILURES+=("${CURRENT_FILE}: ${1} ${2}")
  return 0
}

# --- Generic closed-key-set / required-key checks (A3, A15) -----------------

check_closed_keys() {
  # $1 yq-path, $2 space-separated allowed keys, $3 label
  local path="$1" allowed="$2" label="$3" keys k
  keys=$(yq -r "${path} | keys | .[]" "$CURRENT_FILE" 2>/dev/null)
  while IFS= read -r k; do
    [ -z "$k" ] && continue
    case " $allowed " in
      *" $k "*) : ;;
      *) fail A3 "$label carries key '$k', outside its closed key set" ;;
    esac
  done <<< "$keys"
  return 0
}

check_required_keys() {
  # $1 yq-path, $2 space-separated required keys, $3 label
  local path="$1" required="$2" label="$3" r has
  for r in $required; do
    has=$(yq "${path} | has(\"$r\")" "$CURRENT_FILE" 2>/dev/null)
    [ "$has" != "true" ] && fail A15 "$label is missing required key '$r'"
  done
  return 0
}

# --- Generic R5 grounds-list check (A4, A5, A16, A24, A25) ------------------

check_grounds() {
  # $1 yq-path (the R5 node), $2 label
  local path="$1" label="$2" n has_g
  has_g=$(yq "${path} | has(\"grounds\")" "$CURRENT_FILE")
  n=$(yq "${path}.grounds // [] | length" "$CURRENT_FILE")
  if [ "$has_g" != "true" ] || [ "$n" -eq 0 ]; then
    fail A4 "$label carries no grounds (or an empty grounds list)"
    return
  fi
  local i d hc ha kind txt
  local seen_targets=()
  local seen_kinds=()
  for ((i = 0; i < n; i++)); do
    d=$(yq -r "${path}.grounds[$i].declares // \"\"" "$CURRENT_FILE")
    hc=$(yq "${path}.grounds[$i] | has(\"citation\")" "$CURRENT_FILE")
    ha=$(yq "${path}.grounds[$i] | has(\"assumption\")" "$CURRENT_FILE")
    kind=""
    if [ "$hc" = "true" ] && [ "$ha" = "true" ]; then
      fail A5 "$label grounds[$i] (declares '$d') carries both citation and assumption"
    elif [ "$hc" != "true" ] && [ "$ha" != "true" ]; then
      fail A5 "$label grounds[$i] (declares '$d') carries neither citation nor assumption"
    elif [ "$hc" = "true" ]; then
      kind=citation
      txt=$(yq -r "${path}.grounds[$i].citation" "$CURRENT_FILE")
      [ -z "$(printf '%s' "$txt" | tr -d '[:space:]')" ] && fail A16 "$label grounds[$i] (declares '$d') citation text is empty or whitespace-only"
    else
      kind=assumption
      txt=$(yq -r "${path}.grounds[$i].assumption" "$CURRENT_FILE")
      [ -z "$(printf '%s' "$txt" | tr -d '[:space:]')" ] && fail A16 "$label grounds[$i] (declares '$d') assumption text is empty or whitespace-only"
    fi

    if [ -z "$d" ]; then
      fail A25 "$label grounds[$i] declares an empty target"
    elif ! resolves_declares "$CURRENT_FILE" "$path" "$d"; then
      fail A25 "$label grounds[$i] declares '$d', which does not resolve to a declared field (or a closed-vocabulary aspect of one)"
    fi

    if [ -n "$kind" ] && [ -n "$d" ]; then
      local j prior=""
      for ((j = 0; j < ${#seen_targets[@]}; j++)); do
        if [ "${seen_targets[$j]}" = "$d" ]; then
          prior="${seen_kinds[$j]}"
          break
        fi
      done
      if [ -n "$prior" ] && [ "$prior" != "$kind" ]; then
        fail A24 "$label carries two grounds entries for '$d' with different mark kinds ($prior vs $kind)"
      fi
      seen_targets+=("$d")
      seen_kinds+=("$kind")
    fi
  done
  return 0
}

# --- Selection simulation (R17 floor+ceiling, R23 lowest-rank) --------------

intel_index() {
  local name="$1" i=1 r
  for r in $INTELLIGENCE_RUNGS; do
    [ "$r" = "$name" ] && { echo "$i"; return; }
    i=$((i + 1))
  done
  echo ""
  return 0
}

intel_name_at() {
  local idx="$1" i=1 r
  for r in $INTELLIGENCE_RUNGS; do
    [ "$i" -eq "$idx" ] && { echo "$r"; return; }
    i=$((i + 1))
  done
  echo ""
  return 0
}

OFF_IDS=()
OFF_RANKS=()
OFF_INTEL=()

load_offerings() {
  local file="$1" n i
  OFF_IDS=()
  OFF_RANKS=()
  OFF_INTEL=()
  n=$(yq '.offerings // [] | length' "$file")
  for ((i = 0; i < n; i++)); do
    OFF_IDS+=("$(yq -r ".offerings[$i].id // \"\"" "$file")")
    OFF_RANKS+=("$(yq -r ".offerings[$i].rank // \"\"" "$file")")
    OFF_INTEL+=("$(yq -r ".offerings[$i].provides.intelligence // \"\"" "$file")")
  done
  return 0
}

# select_for_rung <declared-rung-index> — echoes the selected offering id, or
# empty when the candidate set is empty at every stage (R17/R23).
select_for_rung() {
  local declared="$1" n=${#OFF_IDS[@]} i idx
  local best_rank="" best_id="" found=0
  for ((i = 0; i < n; i++)); do
    idx=$(intel_index "${OFF_INTEL[$i]}")
    [ -z "$idx" ] && continue
    if [ "$idx" -ge "$declared" ]; then
      found=1
      if [ -z "$best_rank" ] || [ "${OFF_RANKS[$i]}" -lt "$best_rank" ]; then
        best_rank="${OFF_RANKS[$i]}"
        best_id="${OFF_IDS[$i]}"
      fi
    fi
  done
  if [ "$found" -eq 1 ]; then
    echo "$best_id"
    return
  fi
  local max_idx=0
  for ((i = 0; i < n; i++)); do
    idx=$(intel_index "${OFF_INTEL[$i]}")
    [ -z "$idx" ] && continue
    [ "$idx" -gt "$max_idx" ] && max_idx="$idx"
  done
  if [ "$max_idx" -eq 0 ]; then
    echo ""
    return
  fi
  best_rank=""
  best_id=""
  for ((i = 0; i < n; i++)); do
    idx=$(intel_index "${OFF_INTEL[$i]}")
    [ -z "$idx" ] && continue
    if [ "$idx" -eq "$max_idx" ]; then
      if [ -z "$best_rank" ] || [ "${OFF_RANKS[$i]}" -lt "$best_rank" ]; then
        best_rank="${OFF_RANKS[$i]}"
        best_id="${OFF_IDS[$i]}"
      fi
    fi
  done
  echo "$best_id"
  return 0
}

# --- Per-node assertion passes -----------------------------------------------

check_target() {
  local target stem
  target=$(yq -r '.target // ""' "$CURRENT_FILE")
  stem=$(basename "$CURRENT_FILE" .yml)
  case " $TARGET_VOCAB " in
    *" $target "*) : ;;
    *) fail A1 "target '$target' is not one of {$TARGET_VOCAB}" ;;
  esac
  [ "$target" != "$stem" ] && fail A2 "target '$target' disagrees with filename stem '$stem'"
  return 0
}

check_toplevel_shape() {
  check_required_keys "." "target surfaces offerings" "the top-level document"
  check_closed_keys "." "target surfaces offerings guard zero-offerings observed-not-declared" "the top-level document"
  return 0
}

check_duplicate_ids_and_ranks() {
  local ids seen="" id
  ids=$(yq -r '.offerings[].id // ""' "$CURRENT_FILE" 2>/dev/null)
  while IFS= read -r id; do
    [ -z "$id" ] && continue
    in_list "$id" "$seen" && fail A6 "duplicate offering id '$id'"
    seen="${seen}${id}"$'\n'
  done <<< "$ids"

  seen=""
  ids=$(yq -r '.surfaces[].id // ""' "$CURRENT_FILE" 2>/dev/null)
  while IFS= read -r id; do
    [ -z "$id" ] && continue
    in_list "$id" "$seen" && fail A6 "duplicate surface id '$id'"
    seen="${seen}${id}"$'\n'
  done <<< "$ids"

  seen=""
  ids=$(yq -r '.guard.terms[].id // ""' "$CURRENT_FILE" 2>/dev/null)
  while IFS= read -r id; do
    [ -z "$id" ] && continue
    in_list "$id" "$seen" && fail A6 "duplicate guard term id '$id'"
    seen="${seen}${id}"$'\n'
  done <<< "$ids"

  local ranks rank
  seen=""
  ranks=$(yq -r '.offerings[].rank // ""' "$CURRENT_FILE" 2>/dev/null)
  while IFS= read -r rank; do
    [ -z "$rank" ] && continue
    in_list "$rank" "$seen" && fail A7 "duplicate offering rank '$rank'"
    seen="${seen}${rank}"$'\n'
  done <<< "$ranks"
  return 0
}

check_surfaces() {
  local n i kind path label required allowed
  n=$(yq '.surfaces // [] | length' "$CURRENT_FILE")
  local fcount=0 gcount=0
  for ((i = 0; i < n; i++)); do
    path=".surfaces[$i]"
    kind=$(yq -r "${path}.kind // \"\"" "$CURRENT_FILE")
    case " frontmatter guidance out-of-band " in
      *" $kind "*) : ;;
      *) fail A19 "surfaces[$i] kind '$kind' is outside frontmatter|guidance|out-of-band" ;;
    esac
    [ "$kind" = "frontmatter" ] && fcount=$((fcount + 1))
    [ "$kind" = "guidance" ] && gcount=$((gcount + 1))

    case "$kind" in
      frontmatter) required="id kind items"; allowed="id kind items" ;;
      guidance)    required="id kind carries template items"; allowed="id kind carries template items" ;;
      out-of-band) required="id kind location items"; allowed="id kind location items" ;;
      *)           required="id kind"; allowed="id kind items carries template location" ;;
    esac
    label="surfaces[$i]"
    check_required_keys "$path" "$required" "$label"
    check_closed_keys "$path" "$allowed" "$label"

    if [ "$kind" = "out-of-band" ]; then
      local has_tmpl
      has_tmpl=$(yq "${path} | has(\"template\")" "$CURRENT_FILE")
      [ "$has_tmpl" = "true" ] && fail A18 "$label (out-of-band) declares template, which only a guidance surface may carry"
    fi

    local nit=0 j itpath itreq itallowed itlabel hk hd hp it
    nit=$(yq "${path}.items // [] | length" "$CURRENT_FILE")
    for ((j = 0; j < nit; j++)); do
      itpath="${path}.items[$j]"
      itlabel="${label}.items[$j]"
      it=$(yq -r "${itpath}.item // \"\"" "$CURRENT_FILE")
      case " $ITEM_VOCAB " in
        *" $it "*) : ;;
        *) fail A27 "$itlabel item '$it' is outside the closed item vocabulary" ;;
      esac
      if [ "$kind" = "frontmatter" ]; then
        itreq="item key domain grounds"
        itallowed="item key domain grounds projection"
        check_required_keys "$itpath" "$itreq" "$itlabel"
        check_closed_keys "$itpath" "$itallowed" "$itlabel"
      else
        itreq="item grounds"
        itallowed="item grounds"
        check_required_keys "$itpath" "$itreq" "$itlabel"
        check_closed_keys "$itpath" "$itallowed" "$itlabel"
        hk=$(yq "${itpath} | has(\"key\")" "$CURRENT_FILE")
        hd=$(yq "${itpath} | has(\"domain\")" "$CURRENT_FILE")
        hp=$(yq "${itpath} | has(\"projection\")" "$CURRENT_FILE")
        if [ "$hk" = "true" ] || [ "$hd" = "true" ] || [ "$hp" = "true" ]; then
          fail A18 "$itlabel ($kind) declares key, domain or projection, forbidden outside a frontmatter surface"
        fi
      fi
      check_grounds "$itpath" "$itlabel"
    done

    if [ "$kind" = "guidance" ]; then
      check_guidance_template "$path" "$i"
    fi
  done

  [ "$fcount" -gt 1 ] && fail A21 "declares $fcount frontmatter surfaces; at most one is admitted"
  [ "$gcount" -gt 1 ] && fail A21 "declares $gcount guidance surfaces; at most one is admitted"
  return 0
}

check_guidance_template() {
  local path="$1" sidx="$2" carries_count template
  carries_count=$(yq "${path}.carries // [] | length" "$CURRENT_FILE")
  template=$(yq -r "${path}.template // \"\"" "$CURRENT_FILE")

  local placeholders carries_items
  placeholders=$(printf '%s' "$template" | grep -oE '\{\{[a-zA-Z0-9_-]+\}\}' | sed -E 's/[{}]//g' | sort -u)
  carries_items=$(yq -r "${path}.carries[] // \"\"" "$CURRENT_FILE" 2>/dev/null | sort -u)
  if [ "$placeholders" != "$carries_items" ]; then
    fail A20a "surfaces[$sidx] guidance template placeholder set differs from its carries list"
  fi

  if [ "$carries_count" -gt 1 ]; then
    local hit
    hit=$(printf '%s\n' "$template" | awk '
      {
        line = $0
        gsub(/[.!?][ \t]/, "&\x01", line)
        gsub(/[.!?]$/, "&\x01", line)
        n = split(line, parts, "\x01")
        for (i = 1; i <= n; i++) {
          seg = parts[i]
          cnt = gsub(/\{\{/, "{{", seg)
          if (cnt > 1) print cnt
        }
      }
    ')
    [ -n "$hit" ] && fail A20b "surfaces[$sidx] guidance template places more than one placeholder in one sentence while carries holds $carries_count items"
  fi
  return 0
}

check_offerings() {
  local n i path label
  n=$(yq '.offerings // [] | length' "$CURRENT_FILE")
  for ((i = 0; i < n; i++)); do
    path=".offerings[$i]"
    label="offerings/$(yq -r "${path}.id // \"[$i]\"" "$CURRENT_FILE")"
    check_required_keys "$path" "id rank native-value provides supports-reasoning-surface grounds" "$label"
    check_closed_keys "$path" "id rank native-value provides encodes supports-reasoning-surface grounds" "$label"
    check_grounds "$path" "$label"

    local has_intel
    has_intel=$(yq "${path}.provides | has(\"intelligence\")" "$CURRENT_FILE")
    [ "$has_intel" != "true" ] && fail A26 "$label declares no provides.intelligence — unselectable at any rung"

    check_closed_keys "${path}.provides" "intelligence reasoning specialization context speed modalities locality" "$label.provides"
    local pk keys
    keys=$(yq -r "${path}.provides // {} | keys | .[]" "$CURRENT_FILE" 2>/dev/null)
    while IFS= read -r pk; do
      [ -z "$pk" ] && continue
      check_provides_value "$path" "$label" "$pk"
    done <<< "$keys"

    local has_encodes
    has_encodes=$(yq "${path} | has(\"encodes\")" "$CURRENT_FILE")
    if [ "$has_encodes" = "true" ]; then
      check_closed_keys "${path}.encodes" "intelligence reasoning specialization context speed modalities locality" "$label.encodes"
      check_encodes "$path" "$label"
    fi

    local srs
    srs=$(yq -r "${path}.\"supports-reasoning-surface\" // \"\"" "$CURRENT_FILE")
    if [ "$srs" = "true" ]; then
      local fidx ridx
      fidx=$(find_surface_index_by_kind "$CURRENT_FILE" frontmatter)
      ridx=""
      [ -n "$fidx" ] && ridx=$(find_item_index "$CURRENT_FILE" "$fidx" reasoning)
      [ -z "$ridx" ] && fail A17 "$label declares supports-reasoning-surface: true but the mapping declares no frontmatter reasoning item"
    fi

    local nv domvals
    nv=$(yq -r "${path}.\"native-value\" // \"\"" "$CURRENT_FILE")
    domvals=$(frontmatter_model_domain)
    if [ -n "$domvals" ] && ! printf '%s\n' "$domvals" | grep -qxF "$nv"; then
      fail A9 "$label native-value '$nv' is outside the frontmatter model item's declared domain"
    fi
  done
  return 0
}

check_provides_value() {
  local path="$1" label="$2" key="$3" v
  case "$key" in
    intelligence)
      v=$(yq -r "${path}.provides.intelligence" "$CURRENT_FILE")
      case " $INTELLIGENCE_RUNGS " in *" $v "*) : ;; *) fail A8 "$label provides.intelligence '$v' is outside the seven spec 0195 rungs" ;; esac
      ;;
    reasoning)
      v=$(yq -r "${path}.provides.reasoning" "$CURRENT_FILE")
      case " $REASONING_RUNGS " in *" $v "*) : ;; *) fail A8 "$label provides.reasoning '$v' is outside the six spec 0195 rungs" ;; esac
      ;;
    speed)
      v=$(yq -r "${path}.provides.speed" "$CURRENT_FILE")
      case " $SPEED_DOMAIN " in *" $v "*) : ;; *) fail A8 "$label provides.speed '$v' is outside standard|fast" ;; esac
      ;;
    locality)
      v=$(yq -r "${path}.provides.locality" "$CURRENT_FILE")
      case " $LOCALITY_DOMAIN " in *" $v "*) : ;; *) fail A8 "$label provides.locality '$v' is outside any|local-only" ;; esac
      ;;
    modalities)
      local mv
      while IFS= read -r mv; do
        [ -z "$mv" ] && continue
        case " $MODALITY_DOMAIN " in *" $mv "*) : ;; *) fail A8 "$label provides.modalities '$mv' is outside text|vision|image-out" ;; esac
      done < <(yq -r "${path}.provides.modalities[] // \"\"" "$CURRENT_FILE" 2>/dev/null)
      ;;
    context)
      v=$(yq -r "${path}.provides.context" "$CURRENT_FILE")
      case "$v" in
        ''|*[!0-9]*|0) fail A8 "$label provides.context '$v' is not a positive integer" ;;
        *) : ;;
      esac
      ;;
    specialization)
      v=$(yq -r "${path}.provides.specialization" "$CURRENT_FILE")
      printf '%s' "$v" | grep -qE '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' || fail A8 "$label provides.specialization '$v' is not a kebab-case token"
      ;;
  esac
  return 0
}

check_encodes() {
  local path="$1" label="$2" chars c token has_provides pval
  chars=$(yq -r "${path}.encodes // {} | keys | .[]" "$CURRENT_FILE" 2>/dev/null)
  while IFS= read -r c; do
    [ -z "$c" ] && continue
    token=$(yq -r "${path}.encodes.\"$c\"" "$CURRENT_FILE")
    has_provides=$(yq "${path}.provides | has(\"$c\")" "$CURRENT_FILE")
    if [ "$has_provides" != "true" ]; then
      fail A10 "$label encodes '$c' which is not a key of provides"
      continue
    fi
    local native
    native=$(yq -r "${path}.\"native-value\" // \"\"" "$CURRENT_FILE")
    if ! is_hyphen_segment "$token" "$native"; then
      fail A10 "$label encodes '$c' as '$token', not a '-'-delimited segment of native-value '$native'"
      continue
    fi
    if domain_has_member "$c" "$token"; then
      pval=$(yq -r "${path}.provides.\"$c\"" "$CURRENT_FILE")
      [ "$token" != "$pval" ] && fail A10 "$label encodes '$c' as '$token', which disagrees with provides.$c '$pval'"
    fi
  done <<< "$chars"
  return 0
}

frontmatter_model_domain() {
  local fidx midx
  fidx=$(find_surface_index_by_kind "$CURRENT_FILE" frontmatter)
  [ -z "$fidx" ] && return
  midx=$(find_item_index "$CURRENT_FILE" "$fidx" model)
  [ -z "$midx" ] && return
  yq -r ".surfaces[$fidx].items[$midx].domain.values[] // \"\"" "$CURRENT_FILE" 2>/dev/null
  return 0
}

check_frontmatter_reasoning_projection() {
  local fidx ridx
  fidx=$(find_surface_index_by_kind "$CURRENT_FILE" frontmatter)
  [ -z "$fidx" ] && return
  ridx=$(find_item_index "$CURRENT_FILE" "$fidx" reasoning)
  [ -z "$ridx" ] && return
  local rpath=".surfaces[$fidx].items[$ridx]"
  local has_proj
  has_proj=$(yq "${rpath} | has(\"projection\")" "$CURRENT_FILE")
  if [ "$has_proj" != "true" ]; then
    fail A12 "the frontmatter reasoning item declares no projection"
    return
  fi
  local dom_values rung has_rung img
  dom_values=$(yq -r "${rpath}.domain.values[] // \"\"" "$CURRENT_FILE" 2>/dev/null)
  for rung in $REASONING_RUNGS; do
    has_rung=$(yq "${rpath}.projection | has(\"$rung\")" "$CURRENT_FILE")
    if [ "$has_rung" != "true" ]; then
      fail A12 "the frontmatter reasoning item's projection is missing rung '$rung'"
      continue
    fi
    img=$(yq -r "${rpath}.projection.\"$rung\"" "$CURRENT_FILE")
    if [ "$img" != "unmapped" ] && ! printf '%s\n' "$dom_values" | grep -qxF "$img"; then
      fail A9 "the frontmatter reasoning item's projection for rung '$rung' directs '$img', outside the declared domain"
    fi
  done
  return 0
}

check_guard() {
  local target has_guard
  target=$(yq -r '.target // ""' "$CURRENT_FILE")
  has_guard=$(yq '. | has("guard")' "$CURRENT_FILE")
  if [ "$target" = "claude" ] && [ "$has_guard" != "true" ]; then
    fail A13 "target is claude but declares no guard block"
  fi
  [ "$has_guard" != "true" ] && return

  check_required_keys ".guard" "id spec state terms" "guard"
  check_closed_keys ".guard" "id spec state terms" "guard"

  local state
  state=$(yq -r '.guard.state // ""' "$CURRENT_FILE")
  case " withheld directed " in
    *" $state "*) : ;;
    *) fail A22 "guard.state '$state' is outside withheld|directed" ;;
  esac

  local nterms
  nterms=$(yq '.guard.terms // [] | length' "$CURRENT_FILE")
  [ "$nterms" -ne 2 ] && fail A22 "guard.terms has $nterms entries; exactly two are required"

  local i tid h any_holds=0
  for ((i = 0; i < nterms; i++)); do
    tid=$(yq -r ".guard.terms[$i].id // \"[$i]\"" "$CURRENT_FILE")
    check_required_keys ".guard.terms[$i]" "id statement holds evidence grounds" "guard/terms/$tid"
    check_closed_keys ".guard.terms[$i]" "id statement holds evidence grounds" "guard/terms/$tid"
    check_grounds ".guard.terms[$i]" "guard/terms/$tid"
    h=$(yq -r ".guard.terms[$i].holds // \"\"" "$CURRENT_FILE")
    [ "$h" = "true" ] && any_holds=1
  done

  if [ "$state" = "withheld" ] && [ "$nterms" -gt 0 ] && [ "$any_holds" -eq 0 ]; then
    fail A23 "guard.state is withheld but no term holds"
  fi
  if [ "$state" = "directed" ] && [ "$any_holds" -eq 1 ]; then
    fail A23 "guard.state is directed but at least one term holds"
  fi

  if [ "$state" = "directed" ]; then
    local ev kind
    for ((i = 0; i < nterms; i++)); do
      tid=$(yq -r ".guard.terms[$i].id // \"[$i]\"" "$CURRENT_FILE")
      ev=$(yq -r ".guard.terms[$i].evidence // \"\"" "$CURRENT_FILE")
      [ -z "$(printf '%s' "$ev" | tr -d '[:space:]')" ] && fail A14a "guard/terms/$tid evidence is absent or empty while guard.state is directed"
      kind=$(grounds_kind_for "$CURRENT_FILE" ".guard.terms[$i]" "holds")
      [ "$kind" != "citation" ] && fail A14b "guard/terms/$tid holds ground is '${kind:-absent}', not a citation, while guard.state is directed"
    done
  fi
  return 0
}

check_selection_totality() {
  load_offerings "$CURRENT_FILE"
  [ "${#OFF_IDS[@]}" -eq 0 ] && return
  local rung sel name
  for rung in 1 2 3 4 5 6 7; do
    sel=$(select_for_rung "$rung")
    if [ -z "$sel" ]; then
      name=$(intel_name_at "$rung")
      fail A11 "no offering is selected at intelligence rung '$name'"
    fi
  done
  return 0
}

check_zero_offerings_and_observed() {
  local has
  has=$(yq '. | has("zero-offerings")' "$CURRENT_FILE")
  if [ "$has" = "true" ]; then
    check_required_keys ".zero-offerings" "ground condition grounds" "zero-offerings"
    check_closed_keys ".zero-offerings" "ground condition grounds" "zero-offerings"
  fi
  has=$(yq '. | has("observed-not-declared")' "$CURRENT_FILE")
  if [ "$has" = "true" ]; then
    local n i path label
    n=$(yq '."observed-not-declared" // [] | length' "$CURRENT_FILE")
    for ((i = 0; i < n; i++)); do
      path=".\"observed-not-declared\"[$i]"
      label="observed-not-declared[$i]"
      check_required_keys "$path" "native-value ground grounds" "$label"
      check_closed_keys "$path" "native-value ground grounds" "$label"
    done
  fi
  return 0
}

# --- Orchestration for one file ---------------------------------------------

check_file() {
  CURRENT_FILE="$1"
  local perr
  if ! perr=$(yq e '.' "$CURRENT_FILE" 2>&1 >/dev/null); then
    fail A0 "does not parse as YAML: $perr"
    return
  fi
  check_target
  check_toplevel_shape
  check_duplicate_ids_and_ranks
  check_surfaces
  check_offerings
  check_frontmatter_reasoning_projection
  check_guard
  check_selection_totality
  check_zero_offerings_and_observed
  return 0
}

# --- print-selection mode ----------------------------------------------------

print_selection() {
  local file rung name sel
  for file in ${FILES[@]+"${FILES[@]}"}; do
    load_offerings "$file"
    for rung in 1 2 3 4 5 6 7; do
      name=$(intel_name_at "$rung")
      sel=$(select_for_rung "$rung")
      printf '%s\t%s\t%s\n' "$file" "$name" "$sel"
    done
  done
  return 0
}

# --- Main --------------------------------------------------------------------

if [ "$MODE" = "print-selection" ]; then
  print_selection
  exit 0
fi

for f in ${FILES[@]+"${FILES[@]}"}; do
  check_file "$f"
done

if [ "${#FAILURES[@]}" -gt 0 ]; then
  echo "" >&2
  echo "FAILED: ${#FAILURES[@]} rejection(s) across ${#FILES[@]} mapping file(s) (spec 0197 R47-R50)." >&2
  exit 1
fi

echo "OK: ${#FILES[@]} mapping file(s) conform."
