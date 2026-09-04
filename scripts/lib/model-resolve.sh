#!/usr/bin/env bash
# scripts/lib/model-resolve.sh — spec 0198 requirements 2-18: the single
# mapping-access point (R2), its addressing-grammar accessors, the profile
# reader, and the pure resolution rule engine (resolve_agent). Do NOT execute
# directly; source it (mirrors scripts/lib/render-command.sh).
#
# Sourced by scripts/build-components.sh beside render-command.sh and
# component-resolve.sh. REPO_DIR and yq must already be available to the
# caller; extract_frontmatter must already be defined (build-components.sh
# defines its own, ahead of this source, per the guard convention
# render-command.sh established).
#
# Every accessor below degrades an unreadable mapping cell to an empty
# result rather than raising an error (spec 0198 R17): each yq invocation
# used in an assignment is followed by `|| true` INSIDE the command
# substitution, so a non-zero yq exit can never propagate through `set -e`
# to abort the build. `resolve_agent` itself always returns 0 (R4).
#
# R2's addressing-grammar constraint is reviewable mechanically: the literal
# path segment naming the per-target mapping directory appears exactly once
# in this file, inside `mapping_in_force`, and `mapping_surface_of_kind` is
# the library's only reader of the surface-classifying YAML field, confining
# D15's one documented deviation from the published grammar to a single
# function.

# --- Rung ladders (spec 0195 R6, R10) ----------------------------------------
INTELLIGENCE_RUNGS="minimal low medium high xhigh xxhigh max"
REASONING_RUNGS="none low medium high xhigh max"
# The seven-token item vocabulary, in the library's canonical fallback order
# (docs/model-mapping-format.md -> "Item vocabulary"). Used only as the tail
# of mapping_item_order()'s traversal, for an item neither surface names.
ITEM_VOCAB_ORDER="model reasoning temperature top-p top-k max-output-tokens max-turns"

_rung_index() {
  # _rung_index <ladder> <rung> — 1-based index of <rung> in the space-
  # separated <ladder>, or empty if <rung> is not a member.
  local ladder="$1" want="$2" i=1 r
  for r in $ladder; do
    if [ "$r" = "$want" ]; then
      printf '%s' "$i"
      return 0
    fi
    i=$((i + 1))
  done
  return 0
}

_rung_name() {
  # _rung_name <ladder> <1-based-index> — the rung name at that index.
  local ladder="$1" want="$2" i=1 r
  for r in $ladder; do
    if [ "$i" -eq "$want" ]; then
      printf '%s' "$r"
      return 0
    fi
    i=$((i + 1))
  done
  return 0
}

_int_or_zero() {
  case "$1" in
    ''|*[!0-9]*) printf '0' ;;
    *) printf '%s' "$1" ;;
  esac
  return 0
}

# --- R2: the single named point ----------------------------------------------
# mapping_in_force <target> — echoes an opaque handle (today: the path to
# the per-target mapping file, one file per target under the top-level
# mapping directory) when the file exists, empty otherwise. No other
# function re-derives this path; the path literal appears exactly once in
# this file, on the assignment line immediately below.
mapping_in_force() {
  local target="$1" f
  f="$REPO_DIR/model-mappings/${target}.yml"
  [ -f "$f" ] && printf '%s' "$f"
  return 0
}

# _addr_surface_id <address> — "surfaces/<id>" or "surfaces/<id>/template"
# -> "<id>". Internal to this library; not itself a mapping accessor.
_addr_surface_id() {
  local addr="${1#surfaces/}"
  printf '%s' "${addr%%/*}"
  return 0
}

mapping_surface_of_kind() {
  # mapping_surface_of_kind <handle> <frontmatter|guidance|out-of-band> — the
  # ONLY function in this library that reads a surface's classifying YAML
  # field (D15). Echoes the first "surfaces/<id>" address whose classifier
  # equals the second argument, or empty.
  local handle="$1" want="$2" n i k id
  [ -z "$handle" ] && return 0
  n=$(_int_or_zero "$(yq '.surfaces // [] | length' "$handle" 2>/dev/null || true)")
  for ((i = 0; i < n; i++)); do
    k=$(yq -r ".surfaces[$i].kind // \"\"" "$handle" 2>/dev/null || true)
    if [ "$k" = "$want" ]; then
      id=$(yq -r ".surfaces[$i].id // \"\"" "$handle" 2>/dev/null || true)
      if [ -n "$id" ]; then
        printf 'surfaces/%s' "$id"
        return 0
      fi
    fi
  done
  return 0
}

# mapping_expresses_item <handle> <frontmatter|guidance> <item> — echoes
# true/false: does that named surface declare <item>? Delegates to
# mapping_surface_of_kind rather than reading the classifying field itself.
mapping_expresses_item() {
  local handle="$1" surface_sel="$2" item="$3" addr sid n i it
  [ -z "$handle" ] && { printf 'false'; return 0; }
  addr=$(mapping_surface_of_kind "$handle" "$surface_sel")
  [ -z "$addr" ] && { printf 'false'; return 0; }
  sid=$(_addr_surface_id "$addr")
  n=$(_int_or_zero "$(yq "(.surfaces[] | select(.id == \"$sid\") | .items // []) | length" "$handle" 2>/dev/null || true)")
  for ((i = 0; i < n; i++)); do
    it=$(yq -r "(.surfaces[] | select(.id == \"$sid\") | .items[$i].item) // \"\"" "$handle" 2>/dev/null || true)
    if [ "$it" = "$item" ]; then
      printf 'true'
      return 0
    fi
  done
  printf 'false'
  return 0
}

# mapping_item_key <handle> <surfaces/id address> <item> — the frontmatter
# native key declared for <item> on that surface, or empty.
mapping_item_key() {
  local handle="$1" addr="$2" item="$3" sid
  sid=$(_addr_surface_id "$addr")
  yq -r "(.surfaces[] | select(.id == \"$sid\") | .items[] | select(.item == \"$item\") | .key) // \"\"" "$handle" 2>/dev/null || true
  return 0
}

# mapping_item_domain_values <handle> <surfaces/id address> <item> — a
# space-joined list of the closed values that item's domain admits, or
# empty when the domain is not a values-list domain (or the item is absent).
mapping_item_domain_values() {
  local handle="$1" addr="$2" item="$3" sid
  sid=$(_addr_surface_id "$addr")
  yq -r "(.surfaces[] | select(.id == \"$sid\") | .items[] | select(.item == \"$item\") | .domain.values[]?)" "$handle" 2>/dev/null | tr '\n' ' ' | sed 's/ $//' || true
  return 0
}

# mapping_item_domain_range <handle> <surfaces/id address> <item> — echoes
# "<type> <min> <max>" (max may be empty) for a numeric/integer domain, or
# empty when the item has no such domain (or is absent).
mapping_item_domain_range() {
  local handle="$1" addr="$2" item="$3" sid type min max
  sid=$(_addr_surface_id "$addr")
  type=$(yq -r "(.surfaces[] | select(.id == \"$sid\") | .items[] | select(.item == \"$item\") | .domain.type) // \"\"" "$handle" 2>/dev/null || true)
  [ -z "$type" ] && return 0
  min=$(yq -r "(.surfaces[] | select(.id == \"$sid\") | .items[] | select(.item == \"$item\") | .domain.min) // \"\"" "$handle" 2>/dev/null || true)
  max=$(yq -r "(.surfaces[] | select(.id == \"$sid\") | .items[] | select(.item == \"$item\") | .domain.max) // \"\"" "$handle" 2>/dev/null || true)
  printf '%s %s %s' "$type" "$min" "$max"
  return 0
}

# mapping_reasoning_projection <handle> <surfaces/id address> <rung> — the
# native value the frontmatter reasoning item's projection directs for
# <rung>, "unmapped", or empty when unreadable (no projection, no such rung).
mapping_reasoning_projection() {
  local handle="$1" addr="$2" rung="$3" sid has
  sid=$(_addr_surface_id "$addr")
  has=$(yq "(.surfaces[] | select(.id == \"$sid\") | .items[] | select(.item == \"reasoning\") | .projection // {}) | has(\"$rung\")" "$handle" 2>/dev/null || true)
  [ "$has" != true ] && return 0
  yq -r "(.surfaces[] | select(.id == \"$sid\") | .items[] | select(.item == \"reasoning\") | .projection.\"$rung\") // \"\"" "$handle" 2>/dev/null || true
  return 0
}

# mapping_guidance_template <handle> <surfaces/id address> — the raw
# template text of that guidance surface, or empty.
mapping_guidance_template() {
  local handle="$1" addr="$2" sid
  sid=$(_addr_surface_id "$addr")
  yq -r "(.surfaces[] | select(.id == \"$sid\") | .template) // \"\"" "$handle" 2>/dev/null || true
  return 0
}

# mapping_guard_state <handle> — "withheld"/"directed", or empty when the
# mapping declares no guard block (every non-Claude target today).
mapping_guard_state() {
  local handle="$1" has
  [ -z "$handle" ] && return 0
  has=$(yq '. | has("guard")' "$handle" 2>/dev/null || true)
  [ "$has" != true ] && return 0
  yq -r '.guard.state // ""' "$handle" 2>/dev/null || true
  return 0
}

# mapping_guard_holding_terms <handle> — comma-separated ids of every guard
# term recorded `holds: true`, in file order (D3). Empty when there is no
# guard, or no term holds.
mapping_guard_holding_terms() {
  local handle="$1" has n i h id out=""
  [ -z "$handle" ] && return 0
  has=$(yq '. | has("guard")' "$handle" 2>/dev/null || true)
  [ "$has" != true ] && return 0
  n=$(_int_or_zero "$(yq '.guard.terms // [] | length' "$handle" 2>/dev/null || true)")
  for ((i = 0; i < n; i++)); do
    h=$(yq -r ".guard.terms[$i].holds // \"\"" "$handle" 2>/dev/null || true)
    if [ "$h" = true ]; then
      id=$(yq -r ".guard.terms[$i].id // \"\"" "$handle" 2>/dev/null || true)
      if [ -z "$out" ]; then out="$id"; else out="${out},${id}"; fi
    fi
  done
  printf '%s' "$out"
  return 0
}

# mapping_offerings_load <handle> — populates the parallel indexed arrays
# below (the load_offerings idiom scripts/check-model-mappings.sh already
# uses), one entry per offering, in file order.
OFF_IDS=(); OFF_RANKS=(); OFF_NATIVE=(); OFF_INTEL=(); OFF_SPEC=()
OFF_CONTEXT=(); OFF_SPEED=(); OFF_LOCALITY=(); OFF_MODALITIES=()
OFF_ENC_REASONING=(); OFF_SRS=()

mapping_offerings_load() {
  local handle="$1" n i
  OFF_IDS=(); OFF_RANKS=(); OFF_NATIVE=(); OFF_INTEL=(); OFF_SPEC=()
  OFF_CONTEXT=(); OFF_SPEED=(); OFF_LOCALITY=(); OFF_MODALITIES=()
  OFF_ENC_REASONING=(); OFF_SRS=()
  [ -z "$handle" ] && return 0
  n=$(_int_or_zero "$(yq '.offerings // [] | length' "$handle" 2>/dev/null || true)")
  for ((i = 0; i < n; i++)); do
    OFF_IDS+=("$(yq -r ".offerings[$i].id // \"\"" "$handle" 2>/dev/null || true)")
    OFF_RANKS+=("$(yq -r ".offerings[$i].rank // \"\"" "$handle" 2>/dev/null || true)")
    OFF_NATIVE+=("$(yq -r ".offerings[$i].\"native-value\" // \"\"" "$handle" 2>/dev/null || true)")
    OFF_INTEL+=("$(yq -r ".offerings[$i].provides.intelligence // \"\"" "$handle" 2>/dev/null || true)")
    OFF_SPEC+=("$(yq -r ".offerings[$i].provides.specialization // \"\"" "$handle" 2>/dev/null || true)")
    OFF_CONTEXT+=("$(yq -r ".offerings[$i].provides.context // \"\"" "$handle" 2>/dev/null || true)")
    OFF_SPEED+=("$(yq -r ".offerings[$i].provides.speed // \"standard\"" "$handle" 2>/dev/null || true)")
    OFF_LOCALITY+=("$(yq -r ".offerings[$i].provides.locality // \"any\"" "$handle" 2>/dev/null || true)")
    OFF_MODALITIES+=("$(yq -r ".offerings[$i].provides.modalities[]?" "$handle" 2>/dev/null | tr '\n' ' ' | sed 's/ $//' || true)")
    OFF_ENC_REASONING+=("$(yq -r ".offerings[$i].encodes.reasoning // \"\"" "$handle" 2>/dev/null || true)")
    OFF_SRS+=("$(yq -r ".offerings[$i].\"supports-reasoning-surface\" // \"false\"" "$handle" 2>/dev/null || true)")
  done
  return 0
}

# _frontmatter_item_order <handle> <fm_addr-or-empty> — the frontmatter
# surface's items, space-separated, in declared order. Empty if <fm_addr>
# is empty.
_frontmatter_item_order() {
  local handle="$1" fm_addr="$2" sid n i it
  [ -z "$fm_addr" ] && return 0
  sid=$(_addr_surface_id "$fm_addr")
  n=$(_int_or_zero "$(yq "(.surfaces[] | select(.id == \"$sid\") | .items // []) | length" "$handle" 2>/dev/null || true)")
  for ((i = 0; i < n; i++)); do
    it=$(yq -r "(.surfaces[] | select(.id == \"$sid\") | .items[$i].item) // \"\"" "$handle" 2>/dev/null || true)
    [ -n "$it" ] && printf '%s ' "$it"
  done
  return 0
}

# mapping_item_order <handle> — space-separated traversal order over the
# seven-token item vocabulary: the frontmatter surface's declared item
# order, then any guidance-declared item not already listed, then the
# library's canonical fallback order for anything neither surface names
# (spec 0198 step 3: "in the order the mapping declares its items").
mapping_item_order() {
  local handle="$1" fm_addr gd_addr order item
  order=""
  fm_addr=$(mapping_surface_of_kind "$handle" frontmatter)
  order="$(_frontmatter_item_order "$handle" "$fm_addr")"
  gd_addr=$(mapping_surface_of_kind "$handle" guidance)
  if [ -n "$gd_addr" ]; then
    local sid n i it
    sid=$(_addr_surface_id "$gd_addr")
    n=$(_int_or_zero "$(yq "(.surfaces[] | select(.id == \"$sid\") | .items // []) | length" "$handle" 2>/dev/null || true)")
    for ((i = 0; i < n; i++)); do
      it=$(yq -r "(.surfaces[] | select(.id == \"$sid\") | .items[$i].item) // \"\"" "$handle" 2>/dev/null || true)
      [ -z "$it" ] && continue
      case " $order " in *" $it "*) : ;; *) order="$order $it" ;; esac
    done
  fi
  for item in $ITEM_VOCAB_ORDER; do
    case " $order " in *" $item "*) : ;; *) order="$order $item" ;; esac
  done
  printf '%s' "${order# }"
  return 0
}

# --- Profile read (R1's declaration half) ------------------------------------
PROFILE_PRESENT=false
PROF_HAS_INTELLIGENCE=false; PROF_INTELLIGENCE=""
PROF_HAS_REASONING=false; PROF_REASONING=""
PROF_HAS_SPECIALIZATION=false; PROF_SPECIALIZATION=""
PROF_HAS_CONTEXT=false; PROF_CONTEXT=""
PROF_HAS_SPEED=false; PROF_SPEED=""
PROF_HAS_MODALITIES=false; PROF_MODALITIES=""
PROF_HAS_LOCALITY=false; PROF_LOCALITY=""
PROF_TUNING_KEYS=(); PROF_TUNING_VALS=()

# profile_read <source> — reads metadata.model from an agent source's
# frontmatter. PROFILE_PRESENT=false and every PROF_* global reset is the
# fast path requirement 26 (byte-identical for a profile-less source) rests
# on: nothing past this function runs another accessor when it is false.
profile_read() {
  local source="$1" fm has
  PROFILE_PRESENT=false
  PROF_HAS_INTELLIGENCE=false; PROF_INTELLIGENCE=""
  PROF_HAS_REASONING=false; PROF_REASONING=""
  PROF_HAS_SPECIALIZATION=false; PROF_SPECIALIZATION=""
  PROF_HAS_CONTEXT=false; PROF_CONTEXT=""
  PROF_HAS_SPEED=false; PROF_SPEED=""
  PROF_HAS_MODALITIES=false; PROF_MODALITIES=""
  PROF_HAS_LOCALITY=false; PROF_LOCALITY=""
  PROF_TUNING_KEYS=(); PROF_TUNING_VALS=()

  fm=$(extract_frontmatter "$source")
  has=$(printf '%s\n' "$fm" | yq '.metadata // {} | has("model")' 2>/dev/null || echo false)
  [ "$has" != true ] && return 0
  PROFILE_PRESENT=true

  has=$(printf '%s\n' "$fm" | yq '.metadata.model // {} | has("intelligence")' 2>/dev/null || echo false)
  if [ "$has" = true ]; then
    PROF_HAS_INTELLIGENCE=true
    PROF_INTELLIGENCE=$(printf '%s\n' "$fm" | yq -r '.metadata.model.intelligence' 2>/dev/null || true)
  fi
  has=$(printf '%s\n' "$fm" | yq '.metadata.model // {} | has("reasoning")' 2>/dev/null || echo false)
  if [ "$has" = true ]; then
    PROF_HAS_REASONING=true
    PROF_REASONING=$(printf '%s\n' "$fm" | yq -r '.metadata.model.reasoning' 2>/dev/null || true)
  fi
  has=$(printf '%s\n' "$fm" | yq '.metadata.model // {} | has("specialization")' 2>/dev/null || echo false)
  if [ "$has" = true ]; then
    PROF_HAS_SPECIALIZATION=true
    PROF_SPECIALIZATION=$(printf '%s\n' "$fm" | yq -r '.metadata.model.specialization' 2>/dev/null || true)
  fi
  has=$(printf '%s\n' "$fm" | yq '.metadata.model // {} | has("context")' 2>/dev/null || echo false)
  if [ "$has" = true ]; then
    PROF_HAS_CONTEXT=true
    PROF_CONTEXT=$(printf '%s\n' "$fm" | yq -r '.metadata.model.context' 2>/dev/null || true)
  fi
  has=$(printf '%s\n' "$fm" | yq '.metadata.model // {} | has("speed")' 2>/dev/null || echo false)
  if [ "$has" = true ]; then
    PROF_HAS_SPEED=true
    PROF_SPEED=$(printf '%s\n' "$fm" | yq -r '.metadata.model.speed' 2>/dev/null || true)
  fi
  has=$(printf '%s\n' "$fm" | yq '.metadata.model // {} | has("modalities")' 2>/dev/null || echo false)
  if [ "$has" = true ]; then
    PROF_HAS_MODALITIES=true
    PROF_MODALITIES=$(printf '%s\n' "$fm" | yq -r '.metadata.model.modalities[]?' 2>/dev/null | tr '\n' ' ' | sed 's/ $//' || true)
  fi
  has=$(printf '%s\n' "$fm" | yq '.metadata.model // {} | has("locality")' 2>/dev/null || echo false)
  if [ "$has" = true ]; then
    PROF_HAS_LOCALITY=true
    PROF_LOCALITY=$(printf '%s\n' "$fm" | yq -r '.metadata.model.locality' 2>/dev/null || true)
  fi

  has=$(printf '%s\n' "$fm" | yq '.metadata.model // {} | has("tuning")' 2>/dev/null || echo false)
  if [ "$has" = true ]; then
    local keys k v
    keys=$(printf '%s\n' "$fm" | yq -r '.metadata.model.tuning // {} | keys | .[]' 2>/dev/null || true)
    while IFS= read -r k; do
      [ -z "$k" ] && continue
      v=$(printf '%s\n' "$fm" | yq -r ".metadata.model.tuning.\"$k\"" 2>/dev/null || true)
      PROF_TUNING_KEYS+=("$k")
      PROF_TUNING_VALS+=("$v")
    done <<< "$keys"
  fi
  return 0
}

# profile_declares_item <item> — echoes true/false. Reads the PROFILE alone
# (no mapping accessor), which is what lets (g)(0) run before any mapping
# property is touched. `model` corresponds to the `intelligence` axis
# (D14's dotted-path correspondence), `reasoning` to the `reasoning` axis,
# and every tuning knob to its own key under `tuning:`.
profile_declares_item() {
  local item="$1" k
  case "$item" in
    model)
      [ "$PROF_HAS_INTELLIGENCE" = true ] && printf true || printf false
      ;;
    reasoning)
      [ "$PROF_HAS_REASONING" = true ] && printf true || printf false
      ;;
    *)
      for k in ${PROF_TUNING_KEYS[@]+"${PROF_TUNING_KEYS[@]}"}; do
        if [ "$k" = "$item" ]; then
          printf true
          return 0
        fi
      done
      printf false
      ;;
  esac
  return 0
}

# profile_declares_axis <axis> — echoes true/false for one of the six
# selection axes other than intelligence (rule (b) needs this to record one
# unserved-value drop per declared axis).
profile_declares_axis() {
  case "$1" in
    reasoning) printf '%s' "$PROF_HAS_REASONING" ;;
    specialization) printf '%s' "$PROF_HAS_SPECIALIZATION" ;;
    context) printf '%s' "$PROF_HAS_CONTEXT" ;;
    speed) printf '%s' "$PROF_HAS_SPEED" ;;
    modalities) printf '%s' "$PROF_HAS_MODALITIES" ;;
    locality) printf '%s' "$PROF_HAS_LOCALITY" ;;
    *) printf false ;;
  esac
  return 0
}

_axis_declared_value() {
  case "$1" in
    reasoning) printf '%s' "$PROF_REASONING" ;;
    specialization) printf '%s' "$PROF_SPECIALIZATION" ;;
    context) printf '%s' "$PROF_CONTEXT" ;;
    speed) printf '%s' "$PROF_SPEED" ;;
    modalities) printf '[%s]' "$(printf '%s' "$PROF_MODALITIES" | sed 's/ /,/g')" ;;
    locality) printf '%s' "$PROF_LOCALITY" ;;
  esac
  return 0
}

_dotted_path() {
  case "$1" in
    model) printf 'metadata.model.intelligence' ;;
    reasoning) printf 'metadata.model.reasoning' ;;
    *) printf 'metadata.model.tuning.%s' "$1" ;;
  esac
  return 0
}

_declared_value_of() {
  local item="$1" i n
  case "$item" in
    model) printf '%s' "$PROF_INTELLIGENCE"; return 0 ;;
    reasoning) printf '%s' "$PROF_REASONING"; return 0 ;;
  esac
  n=${#PROF_TUNING_KEYS[@]}
  for ((i = 0; i < n; i++)); do
    if [ "${PROF_TUNING_KEYS[$i]}" = "$item" ]; then
      printf '%s' "${PROF_TUNING_VALS[$i]}"
      return 0
    fi
  done
  return 0
}

_item_idx() {
  local want="$1" i=0 it
  for it in $ITEM_VOCAB_ORDER; do
    if [ "$it" = "$want" ]; then
      printf '%s' "$i"
      return 0
    fi
    i=$((i + 1))
  done
  printf -- '-1'
  return 0
}

_value_in_domain() {
  # _value_in_domain <handle> <fm_addr> <item> <value> — 0 (in-domain) / 1
  # (out-of-domain). No domain declared at all -> nothing to violate (0).
  local handle="$1" addr="$2" item="$3" val="$4" range type min max dom ok
  range=$(mapping_item_domain_range "$handle" "$addr" "$item")
  if [ -n "$range" ]; then
    type=$(printf '%s' "$range" | awk '{print $1}')
    min=$(printf '%s' "$range" | awk '{print $2}')
    max=$(printf '%s' "$range" | awk '{print $3}')
    case "$val" in ''|*[!0-9.]*) return 1 ;; esac
    ok=$(awk -v v="$val" -v lo="$min" -v hi="$max" 'BEGIN{
      if (lo != "" && v+0 < lo+0) { print "no"; exit }
      if (hi != "" && v+0 > hi+0) { print "no"; exit }
      print "yes"
    }' 2>/dev/null || echo no)
    [ "$ok" = "yes" ] && return 0
    return 1
  fi
  dom=$(mapping_item_domain_values "$handle" "$addr" "$item")
  if [ -n "$dom" ]; then
    case " $dom " in *" $val "*) return 0 ;; *) return 1 ;; esac
  fi
  return 0
}

# --- Selection-axis narrowing predicates (rule (d)) --------------------------
# Each predicate <idx> <declared> echoes true/false: does offering <idx>
# (an index into the OFF_* arrays) satisfy the declared constraint?

_pred_context() {
  local have="${OFF_CONTEXT[$1]}" want="$2"
  case "$have" in ''|*[!0-9]*) printf false; return 0 ;; esac
  case "$want" in ''|*[!0-9]*) printf false; return 0 ;; esac
  [ "$have" -ge "$want" ] && printf true || printf false
  return 0
}

_pred_locality() {
  local have="${OFF_LOCALITY[$1]:-any}" want="$2"
  [ "$have" = "$want" ] && printf true || printf false
  return 0
}

_pred_specialization() {
  local have="${OFF_SPEC[$1]:-general}" want="$2"
  [ "$have" = "$want" ] && printf true || printf false
  return 0
}

_pred_speed() {
  local have="${OFF_SPEED[$1]:-standard}" want="$2"
  [ "$have" = "$want" ] && printf true || printf false
  return 0
}

_pred_modalities() {
  local have="${OFF_MODALITIES[$1]}" want="$2" m h found
  [ -z "$have" ] && have="text"
  for m in $want; do
    found=false
    for h in $have; do
      if [ "$h" = "$m" ]; then found=true; break; fi
    done
    if [ "$found" != true ]; then
      printf false
      return 0
    fi
  done
  printf true
  return 0
}

# --- Diagnostics (R32-R35) ---------------------------------------------------
# One record per line, fields in a fixed order separated by a single tab, the
# opening token distinguishing a drop record from a diagnostic note.
DIAG_LINES=()

_diag_drop() {
  # _diag_drop <agent> <target> <dotted-path> <declared-value> <reason>
  DIAG_LINES+=("$(printf 'model-drop\t%s\t%s\t%s\t%s\t%s' "$1" "$2" "$3" "$4" "$5")")
  return 0
}

_diag_note() {
  # _diag_note <agent> <target> <category> <detail>
  DIAG_LINES+=("$(printf 'model-note\t%s\t%s\t%s\t%s' "$1" "$2" "$3" "$4")")
  return 0
}

# --- The pure resolution rule engine (R1 resolution+emission halves, R4-R18,
#     R27-R31) -----------------------------------------------------------------

RESOLVED_OFFERING_ID=""
RESOLVED_NATIVE_VALUE=""
RESOLVED_OFFERING_SRS="false"
EMIT_FM_LINES=()
EMIT_PROSE=""

# Per-item state, indexed by _item_idx (parallel to ITEM_VOCAB_ORDER). Reset
# at the top of every resolve_agent call.
IT_DISPOSED=(false false false false false false false)
IT_DIRECTED=(false false false false false false false)
IT_FM=(false false false false false false false)
IT_GD=(false false false false false false false)
IT_VALUE=("" "" "" "" "" "" "")

# _narrow_axis <agent> <target> <axis> <declared> <predicate-fn> <has-flag>
# [<display-value>] — rule (d)'s one narrowing step (R9/R10). Mutates the
# caller's CANDIDATES array in place (bash dynamic scoping: a `local`
# declared by resolve_agent is visible to every function it calls,
# unmodified when the axis is undeclared or the narrowing is abandoned).
_narrow_axis() {
  local agent="$1" target="$2" axis="$3" declared="$4" pred="$5" has="$6"
  local display="$declared"
  [ -n "${7:-}" ] && display="$7"
  [ "$has" != true ] && return 0
  local kept=() i
  for i in ${CANDIDATES[@]+"${CANDIDATES[@]}"}; do
    if [ "$("$pred" "$i" "$declared")" = true ]; then
      kept+=("$i")
    fi
  done
  if [ "${#kept[@]}" -eq 0 ]; then
    _diag_drop "$agent" "$target" "metadata.model.$axis" "$display" "unserved-value"
  else
    CANDIDATES=(${kept[@]+"${kept[@]}"})
  fi
  return 0
}

# _narrow_encoded_reasoning <agent> <target> — rule (e) (R11/R22, D11).
# Mutates CANDIDATES; marks the reasoning item directed-by-selection.
_narrow_encoded_reasoning() {
  local agent="$1" target="$2" i any_encodes=false
  local enc_candidates=()
  for i in ${CANDIDATES[@]+"${CANDIDATES[@]}"}; do
    [ -n "${OFF_ENC_REASONING[$i]}" ] && any_encodes=true
  done
  [ "$any_encodes" != true ] && return 0
  for i in ${CANDIDATES[@]+"${CANDIDATES[@]}"}; do
    [ -n "${OFF_ENC_REASONING[$i]}" ] && enc_candidates+=("$i")
  done

  local decl_idx; decl_idx=$(_rung_index "$REASONING_RUNGS" "$PROF_REASONING")
  [ -z "$decl_idx" ] && return 0

  local best_set=() eidx
  for i in ${enc_candidates[@]+"${enc_candidates[@]}"}; do
    eidx=$(_rung_index "$REASONING_RUNGS" "${OFF_ENC_REASONING[$i]}")
    [ "$eidx" = "$decl_idx" ] && best_set+=("$i")
  done

  if [ "${#best_set[@]}" -eq 0 ]; then
    local best_below=""
    for i in ${enc_candidates[@]+"${enc_candidates[@]}"}; do
      eidx=$(_rung_index "$REASONING_RUNGS" "${OFF_ENC_REASONING[$i]}")
      [ -z "$eidx" ] && continue
      if [ "$eidx" -lt "$decl_idx" ]; then
        if [ -z "$best_below" ] || [ "$eidx" -gt "$best_below" ]; then
          best_below="$eidx"
        fi
      fi
    done
    if [ -n "$best_below" ]; then
      for i in ${enc_candidates[@]+"${enc_candidates[@]}"}; do
        eidx=$(_rung_index "$REASONING_RUNGS" "${OFF_ENC_REASONING[$i]}")
        [ "$eidx" = "$best_below" ] && best_set+=("$i")
      done
    fi
  fi

  if [ "${#best_set[@]}" -eq 0 ]; then
    local best_above=""
    for i in ${enc_candidates[@]+"${enc_candidates[@]}"}; do
      eidx=$(_rung_index "$REASONING_RUNGS" "${OFF_ENC_REASONING[$i]}")
      [ -z "$eidx" ] && continue
      if [ "$eidx" -gt "$decl_idx" ]; then
        if [ -z "$best_above" ] || [ "$eidx" -lt "$best_above" ]; then
          best_above="$eidx"
        fi
      fi
    done
    if [ -n "$best_above" ]; then
      for i in ${enc_candidates[@]+"${enc_candidates[@]}"}; do
        eidx=$(_rung_index "$REASONING_RUNGS" "${OFF_ENC_REASONING[$i]}")
        [ "$eidx" = "$best_above" ] && best_set+=("$i")
      done
    fi
  fi

  if [ "${#best_set[@]}" -gt 0 ]; then
    CANDIDATES=(${best_set[@]+"${best_set[@]}"})
    local ridx; ridx=$(_item_idx reasoning)
    IT_DISPOSED[$ridx]=true
    IT_DIRECTED[$ridx]=true
    local matched_idx; matched_idx=$(_rung_index "$REASONING_RUNGS" "${OFF_ENC_REASONING[${best_set[0]}]}")
    if [ "$matched_idx" != "$decl_idx" ]; then
      local matched_name; matched_name=$(_rung_name "$REASONING_RUNGS" "$matched_idx")
      _diag_note "$agent" "$target" "reasoning-rung-substituted" "declared=$PROF_REASONING encoded=$matched_name"
    fi
  fi
  return 0
}

# _resolve_item <agent> <target> <handle> <fm_addr> <gd_addr> <guard_state>
# <item> — rule (g): the eligibility gate (g)(0), tested before any mapping
# property is read, then the first applicable sub-rule of (g)(3)-(g)(8).
# Sub-rule (g)(2) (directed-by-selection) is handled entirely inside
# _narrow_encoded_reasoning above, before this loop runs; IT_DISPOSED being
# already true for `reasoning` is what stops this function from re-entering
# it.
_resolve_item() {
  local agent="$1" target="$2" handle="$3" fm_addr="$4" gd_addr="$5" guard_state="$6" item="$7"
  local idx; idx=$(_item_idx "$item")

  # (g)(0) — eligibility.
  [ "$(profile_declares_item "$item")" != true ] && return 0
  [ "${IT_DISPOSED[$idx]}" = true ] && return 0

  local is_knob=true
  case "$item" in model|reasoning) is_knob=false ;; esac

  local expressed_fm=false expressed_gd=false
  [ -n "$fm_addr" ] && [ "$(mapping_expresses_item "$handle" frontmatter "$item")" = true ] && expressed_fm=true
  [ -n "$gd_addr" ] && [ "$(mapping_expresses_item "$handle" guidance "$item")" = true ] && expressed_gd=true

  # D2 — a frontmatter `model` item is expressible only while the mapping
  # declares at least one offering (OFF_IDS, loaded by resolve_agent before
  # this loop runs regardless of whether intelligence was declared). Without
  # this, GitHub Copilot CLI's declared-but-unservable frontmatter model key
  # would wrongly pass (g)(3) instead of dropping unsupported-on-cli (R23).
  if [ "$item" = model ] && [ "$expressed_fm" = true ] && [ "${#OFF_IDS[@]}" -eq 0 ]; then
    expressed_fm=false
  fi

  # (g)(3) — expressibility (R16; D16 narrows the predicate for a tuning
  # knob to frontmatter-only, R15's second sentence being the rule specific
  # to those items).
  if [ "$is_knob" = true ]; then
    if [ "$expressed_fm" != true ]; then
      _diag_drop "$agent" "$target" "$(_dotted_path "$item")" "$(_declared_value_of "$item")" "unsupported-on-cli"
      IT_DISPOSED[$idx]=true
      return 0
    fi
  else
    if [ "$expressed_fm" != true ] && [ "$expressed_gd" != true ]; then
      _diag_drop "$agent" "$target" "$(_dotted_path "$item")" "$(_declared_value_of "$item")" "unsupported-on-cli"
      IT_DISPOSED[$idx]=true
      return 0
    fi
  fi

  # (g)(4) — R14, both clauses (D12): the selected offering refuses the
  # surface, or no offering was selected at all.
  if [ "$item" = reasoning ] && [ "$expressed_fm" = true ]; then
    if [ -z "$RESOLVED_OFFERING_ID" ] || [ "$RESOLVED_OFFERING_SRS" != true ]; then
      _diag_drop "$agent" "$target" "metadata.model.reasoning" "$PROF_REASONING" "unsupported-on-model"
      IT_DISPOSED[$idx]=true
      return 0
    fi
  fi

  # (g)(5) — R13: a rung the projection declares unmapped.
  local proj=""
  if [ "$item" = reasoning ] && [ "$expressed_fm" = true ]; then
    proj=$(mapping_reasoning_projection "$handle" "$fm_addr" "$PROF_REASONING")
    if [ "$proj" = "unmapped" ]; then
      _diag_drop "$agent" "$target" "metadata.model.reasoning" "$PROF_REASONING" "out-of-range-for-target"
      IT_DISPOSED[$idx]=true
      return 0
    fi
  fi

  # (g)(6) — R15's first sentence: a tuning knob's declared value falls
  # outside the domain the frontmatter surface declares.
  if [ "$is_knob" = true ]; then
    local val; val=$(_declared_value_of "$item")
    if ! _value_in_domain "$handle" "$fm_addr" "$item" "$val"; then
      _diag_drop "$agent" "$target" "$(_dotted_path "$item")" "$val" "out-of-range-for-target"
      IT_DISPOSED[$idx]=true
      return 0
    fi
  fi

  # (g)(7)/(g)(8) — direct. The guard (Claude Code only) gates the `model`
  # item's FRONTMATTER emission alone (R20/R31); its guidance emission is
  # unaffected, which is what lets both surfaces carry the same value under
  # a directed guard (spec 0197 R14) with no further special-casing.
  IT_DISPOSED[$idx]=true
  IT_DIRECTED[$idx]=true
  local fm_ok="$expressed_fm"
  if [ "$item" = model ] && [ "$guard_state" = withheld ]; then
    fm_ok=false
    local terms; terms=$(mapping_guard_holding_terms "$handle")
    _diag_note "$agent" "$target" "guard-withheld" "terms=$terms surface=guidance"
  fi

  case "$item" in
    model)
      if [ "$fm_ok" = true ]; then
        local dom; dom=$(mapping_item_domain_values "$handle" "$fm_addr" model)
        if [ -n "$dom" ]; then
          case " $dom " in
            *" $RESOLVED_NATIVE_VALUE "*) : ;;
            *)
              _diag_note "$agent" "$target" "unreadable-cell" "offering=${RESOLVED_OFFERING_ID} native-value=${RESOLVED_NATIVE_VALUE} outside the frontmatter model key's declared domain"
              fm_ok=false
              ;;
          esac
        fi
      fi
      IT_VALUE[$idx]="$RESOLVED_NATIVE_VALUE"
      ;;
    reasoning) IT_VALUE[$idx]="$proj" ;;
    *) IT_VALUE[$idx]="$(_declared_value_of "$item")" ;;
  esac
  IT_FM[$idx]="$fm_ok"
  IT_GD[$idx]="$expressed_gd"
  return 0
}

# _render_guidance <agent> <target> <handle> <gd_addr> — step 8 (R27-R31).
# Substitutes, for each placeholder of the guidance template, the directed
# value of the item that placeholder names; a line whose placeholder names
# an undirected (dropped, unmapped, or profile-absent) or unrecognised item
# is omitted; survivors join on a single space (R28's line-is-the-join-point
# reading, D9). D7's structural predicate — a fragment containing a `"`, a
# `\`, a CR or an LF cannot be emitted without altering the compiled
# output's YAML structure — is checked on the final joined fragment; the
# cold review confirmed this predicate is unreachable on every committed
# source today, so the degrade path below (empty EMIT_PROSE, one
# unrenderable-fragment note) is a defensive belt, not a live cell.
_render_guidance() {
  local agent="$1" target="$2" handle="$3" gd_addr="$4" template
  [ -z "$gd_addr" ] && return 0
  template=$(mapping_guidance_template "$handle" "$gd_addr")
  [ -z "$template" ] && return 0

  local survivors=() raw_line
  while IFS= read -r raw_line; do
    [ -z "$raw_line" ] && continue
    local names name rendered ok=true idx2 value esc
    names=$(printf '%s' "$raw_line" | grep -oE '\{\{[a-zA-Z0-9_-]+\}\}' | sed -E 's/[{}]//g')
    if [ -z "$names" ]; then
      survivors+=("$raw_line")
      continue
    fi
    rendered="$raw_line"
    for name in $names; do
      idx2=$(_item_idx "$name")
      if [ "$idx2" -lt 0 ]; then
        ok=false
        break
      fi
      if [ "${IT_GD[$idx2]}" != true ] || [ -z "${IT_VALUE[$idx2]}" ]; then
        ok=false
        break
      fi
      value="${IT_VALUE[$idx2]}"
      esc=$(printf '%s' "$value" | sed 's/[&/\]/\\&/g')
      rendered=$(printf '%s' "$rendered" | sed "s/{{${name}}}/${esc}/g")
    done
    [ "$ok" = true ] && survivors+=("$rendered")
  done <<< "$template"

  [ "${#survivors[@]}" -eq 0 ] && return 0

  local joined="" s
  for s in ${survivors[@]+"${survivors[@]}"}; do
    s="$(printf '%s' "$s" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
    [ -z "$s" ] && continue
    if [ -z "$joined" ]; then joined="$s"; else joined="$joined $s"; fi
  done
  [ -z "$joined" ] && return 0

  case "$joined" in
    *'"'*|*'\'*)
      _diag_note "$agent" "$target" "unrenderable-fragment" "rendered guidance fragment would alter the compiled description's YAML structure"
      return 0
      ;;
  esac
  if printf '%s' "$joined" | grep -qU $'\r'; then
    _diag_note "$agent" "$target" "unrenderable-fragment" "rendered guidance fragment carries a CR"
    return 0
  fi

  EMIT_PROSE="$joined"
  return 0
}

# resolve_agent <agent> <source> <target> — pure: the single mapping lookup
# of requirement 2, the total first-match-wins rule order of PLAN v3 step 3,
# ending in step 8's rendering rule. Always returns 0 (R4). Writes no file.
# Sets RESOLVED_OFFERING_ID, RESOLVED_NATIVE_VALUE, EMIT_FM_LINES,
# EMIT_PROSE and DIAG_LINES — the four outputs requirement 6's standalone
# exercise (--resolve) must report identically to what the build emits for
# the same (agent, target) pair.
resolve_agent() {
  local agent="$1" source="$2" target="$3" handle

  RESOLVED_OFFERING_ID=""
  RESOLVED_NATIVE_VALUE=""
  RESOLVED_OFFERING_SRS="false"
  EMIT_FM_LINES=()
  EMIT_PROSE=""
  DIAG_LINES=()
  IT_DISPOSED=(false false false false false false false)
  IT_DIRECTED=(false false false false false false false)
  IT_FM=(false false false false false false false)
  IT_GD=(false false false false false false false)
  IT_VALUE=("" "" "" "" "" "" "")

  profile_read "$source"
  [ "$PROFILE_PRESENT" != true ] && return 0

  handle=$(mapping_in_force "$target")
  if [ -z "$handle" ]; then
    _diag_note "$agent" "$target" "no-mapping" "no mapping file is present for target ${target}"
    return 0
  fi

  # Loaded unconditionally — D2's model-expressibility reading needs the
  # offering count regardless of whether intelligence was declared.
  mapping_offerings_load "$handle"

  local CANDIDATES=()

  if [ "$PROF_HAS_INTELLIGENCE" != true ]; then
    # Rule (b) — R7: no model selected; every OTHER declared axis is
    # dropped unserved-value; reasoning is additionally disposed so
    # (g)(0)(ii) stops it before (g)(4) is reached (D13).
    local axis
    for axis in reasoning specialization context speed modalities locality; do
      if [ "$(profile_declares_axis "$axis")" = true ]; then
        _diag_drop "$agent" "$target" "metadata.model.$axis" "$(_axis_declared_value "$axis")" "unserved-value"
        [ "$axis" = reasoning ] && IT_DISPOSED[$(_item_idx reasoning)]=true
      fi
    done
  else
    local n=${#OFF_IDS[@]} i idx declared_idx max_idx

    # Rule (c) — R8: the floor candidate set, else the ceiling clause.
    declared_idx=$(_rung_index "$INTELLIGENCE_RUNGS" "$PROF_INTELLIGENCE")
    if [ -n "$declared_idx" ]; then
      for ((i = 0; i < n; i++)); do
        idx=$(_rung_index "$INTELLIGENCE_RUNGS" "${OFF_INTEL[$i]}")
        [ -z "$idx" ] && continue
        [ "$idx" -ge "$declared_idx" ] && CANDIDATES+=("$i")
      done
      if [ "${#CANDIDATES[@]}" -eq 0 ]; then
        max_idx=0
        for ((i = 0; i < n; i++)); do
          idx=$(_rung_index "$INTELLIGENCE_RUNGS" "${OFF_INTEL[$i]}")
          [ -z "$idx" ] && continue
          [ "$idx" -gt "$max_idx" ] && max_idx="$idx"
        done
        if [ "$max_idx" -gt 0 ]; then
          for ((i = 0; i < n; i++)); do
            idx=$(_rung_index "$INTELLIGENCE_RUNGS" "${OFF_INTEL[$i]}")
            [ "$idx" = "$max_idx" ] && CANDIDATES+=("$i")
          done
        fi
      fi
    fi

    # Rule (d) — R9/R10: narrow context -> modalities -> locality ->
    # specialization -> speed, in order. A narrowing that would empty the
    # set is abandoned (one unserved-value drop) rather than applied.
    if [ "${#CANDIDATES[@]}" -gt 0 ]; then
      _narrow_axis "$agent" "$target" context "$PROF_CONTEXT" _pred_context "$PROF_HAS_CONTEXT"
      _narrow_axis "$agent" "$target" modalities "$PROF_MODALITIES" _pred_modalities "$PROF_HAS_MODALITIES" "$(_axis_declared_value modalities)"
      _narrow_axis "$agent" "$target" locality "$PROF_LOCALITY" _pred_locality "$PROF_HAS_LOCALITY"
      _narrow_axis "$agent" "$target" specialization "$PROF_SPECIALIZATION" _pred_specialization "$PROF_HAS_SPECIALIZATION"
      _narrow_axis "$agent" "$target" speed "$PROF_SPEED" _pred_speed "$PROF_HAS_SPEED"
    fi

    # Rule (e) — R11/R22: encoded-reasoning narrowing. Directs, never drops.
    if [ "$PROF_HAS_REASONING" = true ] && [ "${#CANDIDATES[@]}" -gt 0 ]; then
      _narrow_encoded_reasoning "$agent" "$target"
    fi

    # Rule (f) — R12: lowest rank wins. An empty candidate set (D17)
    # selects nothing and records nothing at this step.
    if [ "${#CANDIDATES[@]}" -gt 0 ]; then
      local best_rank="" best_i=""
      for i in ${CANDIDATES[@]+"${CANDIDATES[@]}"}; do
        if [ -z "$best_rank" ] || [ "${OFF_RANKS[$i]}" -lt "$best_rank" ]; then
          best_rank="${OFF_RANKS[$i]}"
          best_i="$i"
        fi
      done
      RESOLVED_OFFERING_ID="${OFF_IDS[$best_i]}"
      RESOLVED_NATIVE_VALUE="${OFF_NATIVE[$best_i]}"
      RESOLVED_OFFERING_SRS="${OFF_SRS[$best_i]}"
    fi
  fi

  # Rule (g) — the per-item eligibility gate and its seven sub-rules, in
  # the mapping's own declared item order.
  local fm_addr gd_addr guard_state order item
  fm_addr=$(mapping_surface_of_kind "$handle" frontmatter)
  gd_addr=$(mapping_surface_of_kind "$handle" guidance)
  guard_state=$(mapping_guard_state "$handle")
  order=$(mapping_item_order "$handle")
  for item in $order; do
    _resolve_item "$agent" "$target" "$handle" "$fm_addr" "$gd_addr" "$guard_state" "$item"
  done

  # Assemble the directed frontmatter lines in the mapping's declared
  # frontmatter item order (D8) — a mapping edit or a profile edit is the
  # only thing that can change a compiled output's key set.
  local fm_order item2 idx2 key
  fm_order=$(_frontmatter_item_order "$handle" "$fm_addr")
  for item2 in $fm_order; do
    idx2=$(_item_idx "$item2")
    [ "$idx2" -lt 0 ] && continue
    if [ "${IT_FM[$idx2]}" = true ]; then
      key=$(mapping_item_key "$handle" "$fm_addr" "$item2")
      [ -n "$key" ] && EMIT_FM_LINES+=("$key: ${IT_VALUE[$idx2]}")
    fi
  done

  _render_guidance "$agent" "$target" "$handle" "$gd_addr"

  return 0
}
