#!/usr/bin/env bash
# check-ci-parity.sh — 3-way CI drift harness (spec 0049).
#
# Treats ci/ci-capabilities.yml (contract C1, normatively described by
# docs/ci-reference-format.md) as the source of truth and verifies that the
# GitHub Actions workflows and the committed .gitlab-ci.yml both faithfully
# exhibit its PORTABLE capability set. It re-derives nothing: the
# reference↔GitLab arm composes `scripts/build-ci.sh --check` (the generator's
# own drift gate, spec 0048), never re-implementing GitLab generation.
#
# Five concerns (spec 0049 R2–R8):
#   1. Reference validity (R2) — fail closed on each docs/ci-reference-format.md
#      validity-rule violation (unknown trigger kind/filter; engine-specific
#      capability without evidence; missing/duplicate id; portable without
#      command; portable whose command needs an undeclared runtime/tool).
#   2. Traceability harvest (R7) — per-job attribution on BOTH engines: a job is
#      traceable iff its key equals a capability id, or its `# ci-capability:`
#      trailing key-comment maps to one (contract C2). Fail closed on any job
#      that is neither.
#   3. Arm 1 — reference↔GitHub Actions at the business-step level (R3/R4):
#      each portable capability's `command:` must be exhibited by its attributed
#      GHA job's business `run:` steps, and its `requires:` must be satisfied by
#      that job's setup steps, judged by presence/equivalence not exact syntax.
#   4. Arm 2 — reference↔GitLab (R5): compose `build-ci.sh --check`; propagate.
#   5. Arm 3 — GitHub Actions↔GitLab portable-set parity (R6): both engines'
#      exhibited portable sets must agree with the reference's portable set.
#
# Engine-specific capabilities are expected absent on the engines their
# exception does not name (R8) — never demanded as generated jobs, their absence
# is not a divergence. When one engine's pipeline artifacts are absent the
# harness checks only the present arms (R11). The reference is always required.
#
# Exit: non-zero on ANY validity violation, divergence, evidence-less exception,
# or untraceable job (R9); zero with an OK line on a clean pass.
#
# Usage:
#   bash scripts/check-ci-parity.sh
#
# Override the repository root with CREWRIG_REPO_DIR (used by the self-test
# against temporary fixtures).
#
# Prerequisites: yq (mikefarah v4).

set -euo pipefail

command -v yq >/dev/null 2>&1 || {
  echo "Error: yq is required. Install with: brew install yq" >&2
  exit 2
}

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="${CREWRIG_REPO_DIR:-"$(cd "$SCRIPT_DIR/.." && pwd)"}"
REFERENCE="$REPO_DIR/ci/ci-capabilities.yml"
GITLAB_CI="$REPO_DIR/.gitlab-ci.yml"
WORKFLOWS_DIR="$REPO_DIR/.github/workflows"

if [ ! -f "$REFERENCE" ]; then
  echo "Error: CI reference not found: $REFERENCE" >&2
  exit 2
fi

# GitLab reserved top-level keywords (docs/ci-reference-format.md lines 237-243).
# A job whose key is one of these is a keyword, not a capability, unless it
# carries a `# ci-capability:` fallback annotation (reserved-name fallback).
RESERVED="stages workflow default include variables image before_script after_script cache services pages"

# Trigger vocabulary (docs/ci-reference-format.md — Neutral trigger vocabulary).
TRIGGER_KINDS="push pull-request tag scheduled manual"
FILTER_KEYS="on branches paths tag-pattern"

# --- Failure accumulator ----------------------------------------------------

FAILURES=()
fail() {
  echo "  DRIFT: $*" >&2
  FAILURES+=("$*")
}

# --- Helpers ----------------------------------------------------------------

# Normalize a command/step body for equivalence comparison: collapse every
# whitespace run (including newlines) to a single space, trim the ends, and
# strip a leading `sudo ` — so hand-authored boilerplate differences in
# whitespace or a sudo prefix are not divergences (spec 0049 R4).
normalize_cmd() {
  printf '%s' "$1" \
    | tr '\n\t' '  ' \
    | sed -e 's/  */ /g' -e 's/^ //' -e 's/ $//' -e 's/^sudo //'
}

# Classify a normalized `run:` body as a known setup tool-install recipe,
# echoing the tool it installs (empty if it is not a recognized install). The
# recognized recipes mirror the exact closed tool vocabulary build-ci.sh knows
# (tool_install_lines) and their hand-authored GHA forms, so the classifier
# stays in lock-step with the generator (spec 0049 PLAN Risk R3).
install_recipe_tool() {
  case "$1" in
    *yq_linux_amd64*|*mikefarah/yq*) echo yq ;;
    *taskfile.dev*)                  echo task ;;
    *markdownlint-cli*)              echo markdownlint-cli ;;
    *apt-get*install*jq*|*install*-y*jq*) echo jq ;;
    *) echo "" ;;
  esac
}

# True if one of a portable capability's own command entries self-installs the
# named tool (e.g. lint-markdown's `npm install -g markdownlint-cli`), so the
# tool need not appear under requires.tools (validity rule 6).
self_installs_tool() {
  local cmds="$1" want="$2" line
  while IFS= read -r line; do
    [ "$(install_recipe_tool "$(normalize_cmd "$line")")" = "$want" ] && return 0
  done <<< "$cmds"
  return 1
}

in_list() { grep -qxF "$1" <<< "$2"; }

# --- Concern 1: reference validity (R2) -------------------------------------

validity_errors=()
verr() { validity_errors+=("$*"); }

cap_count=$(yq '.capabilities | length' "$REFERENCE")
ids_seen=""
for ((i = 0; i < cap_count; i++)); do
  id=$(yq -r ".capabilities[$i].id // \"\"" "$REFERENCE")
  port=$(yq -r ".capabilities[$i].portability // \"\"" "$REFERENCE")
  label="capability index $i"
  [ -n "$id" ] && [ "$id" != "null" ] && label="capability '$id'"

  # Rule 4 — id present and unique.
  if [ -z "$id" ] || [ "$id" = "null" ]; then
    verr "$label: missing traceability id (validity rule 4)"
  else
    if in_list "$id" "$ids_seen"; then
      verr "capability '$id': duplicate traceability id (validity rule 4)"
    fi
    ids_seen="${ids_seen}${id}"$'\n'
  fi

  # Rule 2 — trigger kinds and filters within the neutral vocabulary.
  ntrig=$(yq ".capabilities[$i].trigger // [] | length" "$REFERENCE")
  if [ "$ntrig" -eq 0 ]; then
    verr "$label: declares no trigger (a trigger is mandatory)"
  fi
  for ((t = 0; t < ntrig; t++)); do
    kind=$(yq -r ".capabilities[$i].trigger[$t].on // \"\"" "$REFERENCE")
    case " $TRIGGER_KINDS " in
      *" $kind "*) ;;
      *) verr "$label: trigger kind '$kind' is outside the neutral vocabulary (validity rule 2)" ;;
    esac
    while IFS= read -r fk; do
      [ -z "$fk" ] && continue
      case " $FILTER_KEYS " in
        *" $fk "*) ;;
        *) verr "$label: trigger filter '$fk' is outside {branches, paths, tag-pattern} (validity rule 2)" ;;
      esac
    done < <(yq -r ".capabilities[$i].trigger[$t] | keys | .[]" "$REFERENCE")
  done

  # Rule 3 — engine-specific capability carries evidence-backed exception.
  if [ "$port" = "specific" ]; then
    eng=$(yq -r ".capabilities[$i].exception.engine // \"\"" "$REFERENCE")
    ev=$(yq -r ".capabilities[$i].exception.evidence // \"\"" "$REFERENCE")
    ev_trim=$(printf '%s' "$ev" | tr -d '[:space:]')
    if [ -z "$eng" ] || [ "$eng" = "null" ]; then
      verr "$label: engine-specific capability without exception.engine (validity rule 3)"
    fi
    if [ -z "$ev_trim" ] || [ "$ev" = "null" ]; then
      verr "$label: engine-specific capability with empty exception.evidence (validity rule 3)"
    fi
  fi

  # Rules 5 and 6 — portable capability declares a command, and its command
  # invokes no runtime/tool it does not declare under requires (or self-install).
  if [ "$port" = "portable" ]; then
    ncmd=$(yq ".capabilities[$i].command // [] | length" "$REFERENCE")
    if [ "$ncmd" -eq 0 ]; then
      verr "$label: portable capability declares no command (validity rule 5)"
    else
      cmds=$(yq -r ".capabilities[$i].command[]" "$REFERENCE")
      cmds_norm=" $(normalize_cmd "$cmds") "
      runtime=$(yq -r ".capabilities[$i].requires.runtime // \"\"" "$REFERENCE")
      req_tools=$(yq -r ".capabilities[$i].requires.tools // [] | .[]" "$REFERENCE")

      # Runtime tokens — a command invoking node/npm or python needs the
      # matching runtime declared.
      case "$cmds_norm" in
        *" npm "*|*" npx "*|*" node "*)
          case "$runtime" in node@*) ;; *) verr "$label: command needs the node runtime but requires.runtime is '${runtime:-unset}' (validity rule 6)" ;; esac ;;
      esac
      case "$cmds_norm" in
        *" python "*|*" python3 "*|*" pip "*|*" pip3 "*)
          case "$runtime" in python@*) ;; *) verr "$label: command needs the python runtime but requires.runtime is '${runtime:-unset}' (validity rule 6)" ;; esac ;;
      esac

      # Tool tokens — a command invoking yq/jq/task/markdownlint needs the tool
      # declared under requires.tools, unless the command self-installs it.
      for probe in yq jq task markdownlint; do
        case "$cmds_norm" in
          *" $probe "*)
            mapped="$probe"
            [ "$probe" = markdownlint ] && mapped="markdownlint-cli"
            if in_list "$mapped" "$req_tools"; then
              :
            elif self_installs_tool "$cmds" "$mapped"; then
              :
            else
              verr "$label: command invokes '$probe' but does not declare '$mapped' under requires.tools (validity rule 6)"
            fi
            ;;
        esac
      done
    fi
  fi
done

if [ "${#validity_errors[@]}" -gt 0 ]; then
  echo "FAILED: ${#validity_errors[@]} reference-validity violation(s) in $REFERENCE:" >&2
  for e in "${validity_errors[@]}"; do
    echo "  - $e" >&2
  done
  echo "" >&2
  echo "The reference is the source of truth; refusing to check the engines against" >&2
  echo "a malformed reference (spec 0049 R2)." >&2
  exit 1
fi

# --- Reference id sets ------------------------------------------------------

ALL_IDS=$(yq -r '.capabilities[].id' "$REFERENCE")
PORTABLE_IDS=$(yq -r '.capabilities[] | select(.portability == "portable") | .id' "$REFERENCE")

# --- Engine presence (R11 graceful degradation) -----------------------------

GHA_PRESENT=false
if [ -d "$WORKFLOWS_DIR" ]; then
  for _wf in "$WORKFLOWS_DIR"/*.yml "$WORKFLOWS_DIR"/*.yaml; do
    # An unmatched glob expands to the literal pattern, which is not a file.
    [ -f "$_wf" ] && { GHA_PRESENT=true; break; }
  done
fi
GITLAB_PRESENT=false
[ -f "$GITLAB_CI" ] && GITLAB_PRESENT=true

# --- Concern 2: traceability harvest, per-job attribution (R7) --------------

# Attribute a job key to a capability id: the key itself when it equals an id
# (C2 primary path), else the `# ci-capability:` annotation target when valid.
# Echoes the attributed id, or empty if untraceable.
attribute_job() {
  local jk="$1" file="$2" sel="$3" cand lc
  if in_list "$jk" "$ALL_IDS"; then
    echo "$jk"
    return
  fi
  lc=$(yq "$sel | key | line_comment" "$file")
  case "$lc" in
    "ci-capability: "*)
      cand="${lc#ci-capability: }"
      if in_list "$cand" "$ALL_IDS"; then echo "$cand"; return; fi
      ;;
  esac
  echo ""
}

# GHA harvest — union across ALL workflow files. Records `id<TAB>file<TAB>jobkey`
# triples so Arm 1 can locate each portable capability's job.
GHA_JOBS=""
GHA_EXHIBITED=""
if $GHA_PRESENT; then
  for wf in "$WORKFLOWS_DIR"/*.yml "$WORKFLOWS_DIR"/*.yaml; do
    [ -f "$wf" ] || continue
    yq -e '.jobs' "$wf" >/dev/null 2>&1 || continue
    while IFS= read -r jk; do
      [ -z "$jk" ] && continue
      attributed=$(attribute_job "$jk" "$wf" ".jobs.\"$jk\"")
      if [ -z "$attributed" ]; then
        fail "untraceable job '$jk' in $(basename "$wf") (github-actions) — not a capability id and no valid '# ci-capability:' annotation (R7)"
      else
        GHA_JOBS="${GHA_JOBS}${attributed}	${wf}	${jk}"$'\n'
        GHA_EXHIBITED="${GHA_EXHIBITED}${attributed}"$'\n'
      fi
    done < <(yq -r '.jobs | keys | .[]' "$wf")
  done
fi

# GitLab harvest — top-level keys minus reserved keywords, plus reserved-named
# jobs bearing a fallback annotation (the complete harvest, docs lines 287-315).
GITLAB_EXHIBITED=""
if $GITLAB_PRESENT; then
  while IFS= read -r jk; do
    [ -z "$jk" ] && continue
    case " $RESERVED " in
      *" $jk "*)
        # Reserved keyword — a job only if it carries a fallback annotation.
        lc=$(yq ".\"$jk\" | key | line_comment" "$GITLAB_CI")
        case "$lc" in
          "ci-capability: "*)
            cand="${lc#ci-capability: }"
            if in_list "$cand" "$ALL_IDS"; then
              GITLAB_EXHIBITED="${GITLAB_EXHIBITED}${cand}"$'\n'
            else
              fail "untraceable job '$jk' in .gitlab-ci.yml (gitlab) — annotation '$cand' is not a capability id (R7)"
            fi
            ;;
        esac
        continue
        ;;
    esac
    attributed=$(attribute_job "$jk" "$GITLAB_CI" ".\"$jk\"")
    if [ -z "$attributed" ]; then
      fail "untraceable job '$jk' in .gitlab-ci.yml (gitlab) — not a capability id and no valid '# ci-capability:' annotation (R7)"
    else
      GITLAB_EXHIBITED="${GITLAB_EXHIBITED}${attributed}"$'\n'
    fi
  done < <(yq -r 'keys | .[]' "$GITLAB_CI")
fi

# --- Arm 1: reference↔GitHub Actions business-step check (R3/R4) ------------

# Verify one portable capability against its attributed GHA job. Aligns the
# job's business `run:` steps against the capability's command list in order,
# skipping `uses:` setup steps and recognized tool-install recipes; then checks
# that requires is satisfied by the recorded setup (presence/equivalence).
check_gha_job() {
  local id="$1" wf="$2" jk="$3"
  local ncmd runtime req_tools hist nsteps
  ncmd=$(yq ".capabilities[] | select(.id == \"$id\") | .command | length" "$REFERENCE")
  runtime=$(yq -r ".capabilities[] | select(.id == \"$id\") | .requires.runtime // \"\"" "$REFERENCE")
  req_tools=$(yq -r ".capabilities[] | select(.id == \"$id\") | .requires.tools // [] | .[]" "$REFERENCE")
  hist=$(yq -r ".capabilities[] | select(.id == \"$id\") | .requires.history-depth // \"\"" "$REFERENCE")
  nsteps=$(yq ".jobs.\"$jk\".steps | length" "$wf")

  local ci=0
  local prov_node="" prov_python="" prov_fetch="" prov_tools=""
  local s uses run nrun nextcmd rtool
  for ((s = 0; s < nsteps; s++)); do
    uses=$(yq -r ".jobs.\"$jk\".steps[$s].uses // \"\"" "$wf")
    run=$(yq -r ".jobs.\"$jk\".steps[$s].run // \"\"" "$wf")

    if [ -n "$uses" ] && [ "$uses" != "null" ]; then
      case "$uses" in
        */checkout@*)     prov_fetch=$(yq -r ".jobs.\"$jk\".steps[$s].with.fetch-depth // \"\"" "$wf") ;;
        */setup-node@*)   prov_node=$(yq -r ".jobs.\"$jk\".steps[$s].with.node-version // \"\"" "$wf") ;;
        */setup-python@*) prov_python=$(yq -r ".jobs.\"$jk\".steps[$s].with.python-version // \"\"" "$wf") ;;
      esac
      continue
    fi

    if [ -n "$run" ] && [ "$run" != "null" ]; then
      nrun=$(normalize_cmd "$run")
      # Business step iff it matches the next expected command entry, in order.
      if [ "$ci" -lt "$ncmd" ]; then
        nextcmd=$(normalize_cmd "$(yq -r ".capabilities[] | select(.id == \"$id\") | .command[$ci]" "$REFERENCE")")
        if [ "$nrun" = "$nextcmd" ]; then
          ci=$((ci + 1))
          continue
        fi
      fi
      # Otherwise it must be a recognized setup tool-install recipe.
      rtool=$(install_recipe_tool "$nrun")
      if [ -n "$rtool" ]; then
        prov_tools="${prov_tools}${rtool}"$'\n'
        continue
      fi
      fail "capability '$id' (github-actions): business step diverges from the declared command — unexpected step: '$nrun' (R3)"
      return
    fi
  done

  if [ "$ci" -ne "$ncmd" ]; then
    fail "capability '$id' (github-actions): job '$jk' exhibits $ci of $ncmd declared business steps (R3)"
  fi

  # R4 — requires satisfied by setup, judged by presence/equivalence.
  case "$runtime" in
    node@*)
      local want="${runtime#node@}"
      [ "${prov_node%%.*}" = "${want%%.*}" ] || \
        fail "capability '$id' (github-actions): requires runtime '$runtime' but setup provides node '${prov_node:-none}' (R4)"
      ;;
    python@*)
      local want="${runtime#python@}"
      case "$prov_python" in
        "$want"*) ;;
        *) fail "capability '$id' (github-actions): requires runtime '$runtime' but setup provides python '${prov_python:-none}' (R4)" ;;
      esac
      ;;
  esac
  while IFS= read -r rt; do
    [ -z "$rt" ] && continue
    in_list "$rt" "$prov_tools" || \
      fail "capability '$id' (github-actions): requires tool '$rt' but no setup step installs it (R4)"
  done <<< "$req_tools"
  if [ "$hist" = "full" ]; then
    [ "$prov_fetch" = "0" ] || \
      fail "capability '$id' (github-actions): requires full source history but checkout fetch-depth is '${prov_fetch:-unset}' (R4)"
  fi
}

if $GHA_PRESENT; then
  while IFS= read -r pid; do
    [ -z "$pid" ] && continue
    triple=$(printf '%s' "$GHA_JOBS" | awk -F'\t' -v id="$pid" '$1 == id { print $2 "\t" $3; exit }')
    # A portable capability with no GHA job is an Arm-3 omission, reported there.
    [ -z "$triple" ] && continue
    wf="${triple%%	*}"
    jk="${triple#*	}"
    check_gha_job "$pid" "$wf" "$jk"
  done <<< "$PORTABLE_IDS"
fi

# --- Arm 2: reference↔GitLab (R5) -------------------------------------------

if $GITLAB_PRESENT; then
  if ! gitlab_out=$(REPO_DIR="$REPO_DIR" bash "$SCRIPT_DIR/build-ci.sh" --check 2>&1); then
    fail "reference↔GitLab divergence (gitlab) — composed 'build-ci.sh --check' failed (R5):"
    while IFS= read -r ln; do
      echo "    $ln" >&2
    done <<< "$gitlab_out"
  fi
fi

# --- Arm 3: GitHub Actions↔GitLab portable-set parity (R6) ------------------

# The portable ids each engine exhibits (specific capabilities excluded, R8).
portable_subset() {
  local exhibited="$1" x
  while IFS= read -r x; do
    [ -z "$x" ] && continue
    in_list "$x" "$PORTABLE_IDS" && echo "$x"
  done <<< "$exhibited" | sort -u
}

arm3_compare() {
  local platform="$1" exhibited_portable="$2" pid
  while IFS= read -r pid; do
    [ -z "$pid" ] && continue
    in_list "$pid" "$exhibited_portable" || \
      fail "capability '$pid' is in the reference portable set but absent from $platform (R6)"
  done <<< "$PORTABLE_IDS"
}

if $GHA_PRESENT; then
  arm3_compare "github-actions" "$(portable_subset "$GHA_EXHIBITED")"
fi
if $GITLAB_PRESENT; then
  arm3_compare "gitlab" "$(portable_subset "$GITLAB_EXHIBITED")"
fi

# Engine-specific capabilities (R8) need no check here: they are expected absent
# on the engines their exception does not name, Arm 3 excludes them from the
# portable comparison, and their absence is not a divergence.

# --- Verdict (R9) -----------------------------------------------------------

if [ "${#FAILURES[@]}" -gt 0 ]; then
  echo "" >&2
  echo "FAILED: ${#FAILURES[@]} CI parity violation(s) detected (spec 0049)." >&2
  exit 1
fi

arms="reference"
$GHA_PRESENT && arms="$arms, GitHub Actions"
$GITLAB_PRESENT && arms="$arms, GitLab"
echo "OK: $arms agree on the portable capability set; every pipeline job is traceable."
