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
# Prerequisites: yq (mikefarah v4.33.2 or later). The single-pass reader below
# needs `-0` / `--nul-output` (NUL-separated output), added in v4.33.2
# (2023-03-31, release notes: "Add --nul-output|-0 flag to separate element with
# NUL character"); an older yq rejects the flag and the harness fails closed.
# It also passes `-N` / `--no-doc` (no `---` separators between the documents of
# a multi-document file), which every release carrying `-0` already has.
#
# Data source. YAML is decoded by a few `yq` programs, each emitting a
# NUL-delimited token stream that the loops below read back in the order the
# former per-value `yq` calls consumed it; every loop, message and exit code is
# unchanged. Every emitted position is a count-prefixed list (a missing path is
# an empty list, never a missing token) and every record ends with a frame
# token, so a desynchronised stream aborts (exit 70) instead of shifting values.
# Each former `yq` call kept its failure mode: fail-closed `$(yq …)` sites still
# abort with yq's own message and status, fail-open key scans still print yq's
# message and carry on, and the silent `2>/dev/null` sites stay silent.
#
# `yq` spawns: 1 (reference) + F (one key harvest per workflow file) + 1 (GitLab
# key harvest) + J (one step-record pass per workflow file holding an attributed
# portable job, J <= F) + 1 (GitLab cache arm, only when a capability declares
# `cache:`) — F + J + 3 at most; 34 on today's tree (F = 17, J = 14), against
# one spawn per value before.

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
# Pure bash (no fork): the result is left in NORM rather than echoed, so callers
# need no command substitution. Same steps, same order, as the former tr|sed
# pipeline: newline/tab to space, collapse space runs, trim one leading and one
# trailing space, strip one leading `sudo `.
normalize_cmd() {
  NORM=$1
  NORM=${NORM//$'\n'/ }
  NORM=${NORM//$'\t'/ }
  while [[ $NORM == *"  "* ]]; do NORM=${NORM//  / }; done
  NORM=${NORM# }
  NORM=${NORM% }
  NORM=${NORM#sudo }
}

# Classify a normalized `run:` body as a known setup tool-install recipe,
# leaving the tool it installs in RTOOL (empty if it is not a recognized install). The
# recognized recipes mirror the exact closed tool vocabulary build-ci.sh knows
# (tool_install_lines) and their hand-authored GHA forms, so the classifier
# stays in lock-step with the generator (spec 0049 PLAN Risk R3).
install_recipe_tool() {
  case "$1" in
    *yq_linux_amd64*|*mikefarah/yq*) RTOOL=yq ;;
    *taskfile.dev*)                  RTOOL=task ;;
    *markdownlint-cli*)              RTOOL=markdownlint-cli ;;
    *tesseract*)                     RTOOL=tesseract ;;
    *python3*)                       RTOOL=python3 ;;
    *apt-get*install*jq*|*install*-y*jq*) RTOOL=jq ;;
    *) RTOOL="" ;;
  esac
}

# True if one of a portable capability's own command entries self-installs the
# named tool (e.g. lint-markdown's `npm install -g markdownlint-cli`), so the
# tool need not appear under requires.tools (validity rule 6).
self_installs_tool() {
  local cmds="$1" want="$2" line
  while IFS= read -r line; do
    normalize_cmd "$line"
    install_recipe_tool "$NORM"
    [ "$RTOOL" = "$want" ] && return 0
  done <<< "$cmds"
  return 1
}

# Whole-line fixed-string membership (formerly `grep -qxF`), without a fork. A
# needle that itself spans lines is a multi-pattern grep, so only that shape
# keeps the grep.
in_list() {
  case $1 in
    *$'\n'*) grep -qxF "$1" <<< "$2" ;;
    *) [[ $'\n'$2$'\n' == *$'\n'"$1"$'\n'* ]] ;;
  esac
}

# True if any newline-separated entry in `$2` starts with prefix `$1`. Used for
# `requires.runtime`, which MAY declare more than one runtime (spec 0047
# delta-02 R12 extended for a capability whose command list genuinely needs
# two languages, e.g. `mempalace`: python@3.12 for its existing test scripts,
# node@24 for its TypeScript test) — checking "is EITHER runtime declared"
# rather than "does the single value equal this".
in_list_prefix() { [[ $'\n'$2 == *$'\n'"$1"* ]]; }

# Extract the file list from a GHA `hashFiles('a', 'b')` cache-key expression
# (spec 0147 R6/R7). The engine's hashFiles() is the mechanism; the reference
# declares the same inputs as the need. Echoes one file per line.
extract_hashfiles() {
  local expr="$1" inner
  inner="${expr#*hashFiles(}"
  inner="${inner%%)*}"
  printf '%s' "$inner" | tr -d "'" | tr ',' '\n' | sed 's/^ *//; s/ *$//' | grep -v '^$'
}

# --- Token stream layer -----------------------------------------------------
#
# One `yq -N -0 -r` program per pass writes NUL-delimited tokens to a temp file
# (not a pipe or process substitution: a parse failure must still abort under
# `set -e` with yq's own message and status, as the former `$(yq …)` did). The
# file is loaded into TOK[] by an `IFS= read -r -d ''` loop, so leading/trailing
# whitespace and embedded newlines survive. The reader functions below set
# globals instead of printing, so none of them is ever called inside `$(…)`.

TOKDIR=$(mktemp -d "${TMPDIR:-/tmp}/check-ci-parity.XXXXXX")
trap 'rm -rf "$TOKDIR"' EXIT

TOK=()
TOKN=0
TOKI=0
TV=""
TC=0
TRAW=""

# A desynchronised stream means the yq program and its reader disagree about the
# record layout — a bug here, never an input condition — so it aborts loudly.
tok_die() {
  echo "Error: check-ci-parity: yq token stream out of sync ($1)" >&2
  exit 70
}

# tok_load <file> — read every NUL-terminated token of <file> into TOK[].
tok_load() {
  local t
  TOK=()
  TOKN=0
  TOKI=0
  while IFS= read -r -d '' t; do
    TOK[TOKN]=$t
    TOKN=$((TOKN + 1))
  done < "$1"
}

# tok_append <file> — like tok_load, but keeps the tokens already in TOK[].
tok_append() {
  local t
  while IFS= read -r -d '' t; do
    TOK[TOKN]=$t
    TOKN=$((TOKN + 1))
  done < "$1"
}

# tok_next — the next raw token, in TV.
tok_next() {
  [ "$TOKI" -lt "$TOKN" ] || tok_die "stream exhausted"
  TV=${TOK[$TOKI]}
  TOKI=$((TOKI + 1))
}

# tok_count — the next token as a non-negative integer, in TC.
tok_count() {
  tok_next
  case $TV in
    ''|*[!0-9]*) tok_die "expected a count, got '$TV'" ;;
  esac
  TC=$TV
}

# tok_expect <frame> — the next token must be the given frame marker.
tok_expect() {
  tok_next
  [ "$TV" = "$1" ] || tok_die "expected frame '$1', got '$TV'"
}

# tok_cmdsub — read one count-prefixed list slot and rebuild what the former
# `$(yq -r EXPR …)` produced: every result followed by a newline is the raw
# stdout (TRAW); TV is that text with trailing newlines stripped, as `$(…)`
# strips them. Zero results give the empty string, several give a joined list.
tok_cmdsub() {
  local _n _i
  tok_count
  _n=$TC
  TRAW=""
  for ((_i = 0; _i < _n; _i++)); do
    tok_next
    TRAW+=$TV$'\n'
  done
  TV=$TRAW
  while [[ $TV == *$'\n' ]]; do TV=${TV%$'\n'}; done
}

# slot <yq-expr> — append one list slot to the program text being built in PROG:
# `[ expr ] | (length, .[])` is total on any input shape (a missing path, or an
# expression with no result, is a count of 0), whereas a bare expression would
# emit nothing and shift every later token. Each slot is parenthesised because
# `a | b, c` parses as `(a | b), c` in yq.
slot() { PROG+="([ $1 ] | (length, .[])), "; }

# --- Concern 1: reference validity (R2) -------------------------------------

# One yq program decodes the whole reference. Layout (list slots are
# count-prefixed): capability count, number of capability records, one default
# record (a null capability: what the former `.capabilities[$i]` read for every
# index of a non-sequence `capabilities`), then one record per capability, each
# closed by `@@rec`, then `@@end`; the whole document is preceded by its token
# count, so a second document (yq runs the program once per document) is detected
# by tokens left over after the first one.
#
# A slot the former shell evaluated only conditionally (engine-specific
# `exception`, portable `requires`, `cache` as a mapping) keeps the same
# condition inside the slot, so a shape that crashed yq there still crashes it
# and one that never reached it still never does. `.[]` unions inside a record
# are written `.[] | [ … ] | .[]` because yq evaluates a parenthesised union
# after `.[] |` column-wise rather than per element.
P_SPECIFIC='(.portability // "") == "specific"'
P_PORTABLE='(.portability // "") == "portable"'
P_COMMAND='((.portability // "") == "portable") and ((.command // [] | length) != 0)'
P_CACHEMAP='(.cache | tag) == "!!map"'

PROG=""
slot '.id // ""'
slot '.portability // ""'
slot '.trigger // [] | length'
PROG+='([ .trigger | select(tag == "!!seq") | .[] ] | length), '
PROG+='(.trigger | select(tag == "!!seq") | .[] | [ ([ .on // "" ] | (length, .[])), tag, ([ select(tag == "!!map" or tag == "!!seq") | keys | .[] ] | (length, .[])) ] | .[]), '
slot "select($P_SPECIFIC) | .exception.engine // \"\""
slot "select($P_SPECIFIC) | .exception.evidence // \"\""
slot "select($P_PORTABLE) | .command // [] | length"
slot "select($P_PORTABLE) | .command[]"
slot '.command | tag'
# requires.runtime is normalised to one runtime-spec per line whether the
# reference declares it as a bare scalar (every pre-existing capability) or a
# list (a capability needing more than one runtime, e.g. `mempalace`:
# python@3.12 + node@24). Absent entirely yields nothing, matching the old
# scalar `// ""` default.
slot "select($P_COMMAND) | .requires.runtime as \$rt | (\$rt | select(tag == \"!!seq\")) // [\$rt] | .[]"
slot "select($P_COMMAND) | .requires.tools // [] | .[]"
slot "select($P_COMMAND) | .requires.history-depth // \"\""
slot '.env | tag'
slot "select($P_COMMAND) | .env // {} | select(tag == \"!!map\" or tag == \"!!seq\") | keys | .[]"
slot '.cache | tag'
slot "select($P_CACHEMAP) | .cache.files // [] | length"
slot "select($P_CACHEMAP) | .cache.env | tag"
slot '.cache // "" | length'
slot "select($P_CACHEMAP) | .cache.files[]"
PROG+='"@@rec"'
CAP_RECORD=$PROG

REF_PROG='[ ([ .capabilities | length ] | (length, .[])), ([ .capabilities | select(tag == "!!seq") | .[] ] | length), (null | [ '"$CAP_RECORD"' ] | .[]), (.capabilities | select(tag == "!!seq") | .[] | [ '"$CAP_RECORD"' ] | .[]), "@@end" ] | (length, .[])'

# Per-capability facts Arm 1 and the GitLab cache arm need after validity,
# indexed by capability position (no associative arrays: Bash 3.2).
CAP_ID=()
CAP_PORT=()
CAP_NCMD=()
CAP_RUNTIME=()
CAP_TOOLS=()
CAP_HIST=()
CAP_ENVKEYS=()
CAP_CACHETYPE=()
CAP_CACHELEN=()
CAP_CACHEFILES=()
CAP_CMDTAG=()
CAP_CMD0=()
CAP_CMDN=()
CMD_ITEM=()
CMD_TOTAL=0

# read_cap — decode one capability record from TOK[] into the c_* globals, in
# the order the program above emits it.
read_cap() {
  local _j _n
  tok_cmdsub; c_id=$TV
  tok_cmdsub; c_port=$TV
  tok_cmdsub; c_ntrig=$TV
  tok_count; c_ntrec=$TC
  c_tkind=()
  c_ttag=()
  c_tkeys=()
  for ((_j = 0; _j < c_ntrec; _j++)); do
    tok_cmdsub; c_tkind[_j]=$TV
    tok_next;   c_ttag[_j]=$TV
    tok_cmdsub; c_tkeys[_j]=$TV
  done
  tok_cmdsub; c_eng=$TV
  tok_cmdsub; c_ev=$TV
  tok_cmdsub; c_ncmd=$TV
  # The command entries, kept one by one for Arm 1's positional lookup and
  # joined for the validity scan.
  tok_count; _n=$TC
  c_cmd0=$CMD_TOTAL
  c_cmdn=$_n
  c_cmds=""
  for ((_j = 0; _j < _n; _j++)); do
    tok_next
    CMD_ITEM[CMD_TOTAL]=$TV
    CMD_TOTAL=$((CMD_TOTAL + 1))
    c_cmds+=$TV$'\n'
  done
  while [[ $c_cmds == *$'\n' ]]; do c_cmds=${c_cmds%$'\n'}; done
  tok_cmdsub; c_cmdtag=$TV
  tok_cmdsub; c_runtime=$TV
  tok_cmdsub; c_tools=$TV
  tok_cmdsub; c_hist=$TV
  tok_cmdsub; c_envtype=$TV
  tok_cmdsub; c_envkeys=$TV
  tok_cmdsub; c_cachetype=$TV
  tok_cmdsub; c_ncf=$TV
  tok_cmdsub; c_envtag=$TV
  tok_cmdsub; c_cachelen=$TV
  tok_cmdsub; c_cachefiles=$TRAW
  tok_expect '@@rec'
}

validity_errors=()
verr() { validity_errors+=("$*"); }

# reference_validity_per_call — the original validity loop, one yq call per
# value. It runs ONLY when the reference holds more than one YAML document: yq
# evaluates every call once per document and `$(yq …)` then joins the results
# (with `---` separators between documents), so each value is a multi-line string
# and the checks below fail or error on it exactly as they always did. The
# single-pass decoder cannot reproduce that joining, so such a reference keeps
# the per-call code and its verdict (always a validity failure in practice).
reference_validity_per_call() {
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
        normalize_cmd "$cmds"
        cmds_norm=" $NORM "
        runtime=$(yq -r ".capabilities[$i].requires.runtime as \$rt | (\$rt | select(tag == \"!!seq\")) // [\$rt] | .[]" "$REFERENCE")
        runtime_display=$(tr '\n' ',' <<< "$runtime" | sed 's/,$//')
        [ -z "$runtime_display" ] && runtime_display="unset"
        req_tools=$(yq -r ".capabilities[$i].requires.tools // [] | .[]" "$REFERENCE")

        # Runtime tokens — a command invoking node/npm or python needs the
        # matching runtime declared among (possibly several) requires.runtime
        # entries: a portable capability MAY need more than one runtime (e.g.
        # `mempalace`: python@3.12 for its existing test scripts, node@24 for
        # its TypeScript test), so this checks "is EITHER declared", not "does
        # the single value equal this".
        case "$cmds_norm" in
          *" npm "*|*" npx "*|*" node "*)
            in_list_prefix "node@" "$runtime" || \
              verr "$label: command needs the node runtime but requires.runtime is '$runtime_display' (validity rule 6)" ;;
        esac
        case "$cmds_norm" in
          *" python "*|*" python3 "*|*" pip "*|*" pip3 "*)
            in_list_prefix "python@" "$runtime" || \
              verr "$label: command needs the python runtime but requires.runtime is '$runtime_display' (validity rule 6)" ;;
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

    # Check env mapping if present (spec 0131).
    env_type=$(yq ".capabilities[$i].env | tag" "$REFERENCE")
    if [ "$env_type" != "!!null" ] && [ -n "$env_type" ] && [ "$env_type" != "null" ]; then
      if [ "$env_type" != "!!map" ]; then
        verr "$label: env must be a key-value mapping (spec 0131)"
      fi
    fi

    # Rule 7 (spec 0147 R6/R7) — cache: field, when present, is a mapping whose
    # `files` is a non-empty list of key-derivation inputs. `env` may be an empty
    # list (a group with no env-derived key inputs). The reference declares the
    # NEED (which files + env vars the key is derived from); engine cache syntax
    # is the mechanism and is never written here.
    cache_type=$(yq ".capabilities[$i].cache | tag" "$REFERENCE")
    if [ "$cache_type" != "!!null" ] && [ -n "$cache_type" ] && [ "$cache_type" != "null" ]; then
      if [ "$cache_type" != "!!map" ]; then
        verr "$label: cache must be a mapping with files and env (spec 0147)"
      else
        ncf=$(yq ".capabilities[$i].cache.files // [] | length" "$REFERENCE")
        if [ "$ncf" -eq 0 ]; then
          verr "$label: cache declares no files (spec 0147)"
        fi
        # env may be an empty list (a group with no env-derived key inputs); it
        # must still be a list, not a scalar.
        env_tag=$(yq ".capabilities[$i].cache.env | tag" "$REFERENCE")
        if [ "$env_tag" != "!!seq" ]; then
          verr "$label: cache.env must be a list (spec 0147)"
        fi
      fi
    fi
  done
}

yq -N -0 -r "$REF_PROG" "$REFERENCE" > "$TOKDIR/reference.tok"
tok_load "$TOKDIR/reference.tok"
tok_count; ref_len=$TC
tok_cmdsub; cap_count=$TV
tok_count; cap_nrec=$TC
cap_def=$TOKI
read_cap
ref_multi=false
if [ "$TOKN" -gt $((ref_len + 1)) ]; then
  ref_multi=true
  reference_validity_per_call
  [ "${#validity_errors[@]}" -gt 0 ] || \
    verr "reference holds more than one YAML document"
  cap_count=0
fi
ids_seen=""
for ((i = 0; i < cap_count; i++)); do
  if [ "$i" -lt "$cap_nrec" ]; then
    read_cap
  else
    # `capabilities` is not a sequence: every index reads as null.
    cap_next=$TOKI
    TOKI=$cap_def
    read_cap
    TOKI=$cap_next
  fi
  id=$c_id
  port=$c_port
  label="capability index $i"
  [ -n "$id" ] && [ "$id" != "null" ] && label="capability '$id'"

  CAP_ID[i]=$id
  CAP_PORT[i]=$port
  CAP_NCMD[i]=$c_ncmd
  CAP_RUNTIME[i]=$c_runtime
  CAP_TOOLS[i]=$c_tools
  CAP_HIST[i]=$c_hist
  CAP_ENVKEYS[i]=$c_envkeys
  CAP_CACHETYPE[i]=$c_cachetype
  CAP_CACHELEN[i]=$c_cachelen
  CAP_CACHEFILES[i]=$c_cachefiles
  CAP_CMDTAG[i]=$c_cmdtag
  CAP_CMD0[i]=$c_cmd0
  CAP_CMDN[i]=$c_cmdn

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
  ntrig=$c_ntrig
  if [ "$ntrig" -eq 0 ]; then
    verr "$label: declares no trigger (a trigger is mandatory)"
  fi
  for ((t = 0; t < ntrig; t++)); do
    if [ "$t" -lt "$c_ntrec" ]; then
      kind=${c_tkind[$t]}
      kind_tag=${c_ttag[$t]}
      kind_keys=${c_tkeys[$t]}
    else
      kind=""
      kind_tag="!!null"
      kind_keys=""
    fi
    case " $TRIGGER_KINDS " in
      *" $kind "*) ;;
      *) verr "$label: trigger kind '$kind' is outside the neutral vocabulary (validity rule 2)" ;;
    esac
    case $kind_tag in
      '!!map'|'!!seq') ;;
      *)
        # Listing the keys of a scalar or null trigger entry is an error that
        # never stopped the loop (the key scan was fail-open): re-run the
        # original query so yq's own message still reaches stderr.
        yq -r ".capabilities[$i].trigger[$t] | keys | .[]" "$REFERENCE" >/dev/null || true
        ;;
    esac
    while IFS= read -r fk; do
      [ -z "$fk" ] && continue
      case " $FILTER_KEYS " in
        *" $fk "*) ;;
        *) verr "$label: trigger filter '$fk' is outside {branches, paths, tag-pattern} (validity rule 2)" ;;
      esac
    done <<< "$kind_keys"
  done

  # Rule 3 — engine-specific capability carries evidence-backed exception.
  if [ "$port" = "specific" ]; then
    eng=$c_eng
    ev=$c_ev
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
    ncmd=$c_ncmd
    if [ "$ncmd" -eq 0 ]; then
      verr "$label: portable capability declares no command (validity rule 5)"
    else
      cmds=$c_cmds
      normalize_cmd "$cmds"
      cmds_norm=" $NORM "
      runtime=$c_runtime
      runtime_display=${runtime//$'\n'/,}
      [ -z "$runtime_display" ] && runtime_display="unset"
      req_tools=$c_tools

      # Runtime tokens — a command invoking node/npm or python needs the
      # matching runtime declared among (possibly several) requires.runtime
      # entries: a portable capability MAY need more than one runtime (e.g.
      # `mempalace`: python@3.12 for its existing test scripts, node@24 for
      # its TypeScript test), so this checks "is EITHER declared", not "does
      # the single value equal this".
      case "$cmds_norm" in
        *" npm "*|*" npx "*|*" node "*)
          in_list_prefix "node@" "$runtime" || \
            verr "$label: command needs the node runtime but requires.runtime is '$runtime_display' (validity rule 6)" ;;
      esac
      case "$cmds_norm" in
        *" python "*|*" python3 "*|*" pip "*|*" pip3 "*)
          in_list_prefix "python@" "$runtime" || \
            verr "$label: command needs the python runtime but requires.runtime is '$runtime_display' (validity rule 6)" ;;
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

  # Check env mapping if present (spec 0131).
  env_type=$c_envtype
  if [ "$env_type" != "!!null" ] && [ -n "$env_type" ] && [ "$env_type" != "null" ]; then
    if [ "$env_type" != "!!map" ]; then
      verr "$label: env must be a key-value mapping (spec 0131)"
    fi
  fi

  # Rule 7 (spec 0147 R6/R7) — cache: field, when present, is a mapping whose
  # `files` is a non-empty list of key-derivation inputs. `env` may be an empty
  # list (a group with no env-derived key inputs). The reference declares the
  # NEED (which files + env vars the key is derived from); engine cache syntax
  # is the mechanism and is never written here.
  cache_type=$c_cachetype
  if [ "$cache_type" != "!!null" ] && [ -n "$cache_type" ] && [ "$cache_type" != "null" ]; then
    if [ "$cache_type" != "!!map" ]; then
      verr "$label: cache must be a mapping with files and env (spec 0147)"
    else
      ncf=$c_ncf
      if [ "$ncf" -eq 0 ]; then
        verr "$label: cache declares no files (spec 0147)"
      fi
      # env may be an empty list (a group with no env-derived key inputs); it
      # must still be a list, not a scalar.
      env_tag=$c_envtag
      if [ "$env_tag" != "!!seq" ]; then
        verr "$label: cache.env must be a list (spec 0147)"
      fi
    fi
  fi
done
if ! $ref_multi; then tok_expect '@@end'; fi

if [ "${#validity_errors[@]}" -gt 0 ]; then
  echo "FAILED: ${#validity_errors[@]} reference-validity violation(s) in $REFERENCE:" >&2
  for e in ${validity_errors[@]+"${validity_errors[@]}"}; do
    echo "  - $e" >&2
  done
  echo "" >&2
  echo "The reference is the source of truth; refusing to check the engines against" >&2
  echo "a malformed reference (spec 0049 R2)." >&2
  exit 1
fi

# --- Reference id sets ------------------------------------------------------

# Validity has already rejected missing / duplicate ids, so these are exactly
# `.capabilities[].id` and the ids of the `portability == "portable"` entries.
ALL_IDS=""
PORTABLE_IDS=""
for ((i = 0; i < cap_count; i++)); do
  ALL_IDS="${ALL_IDS:+$ALL_IDS$'\n'}${CAP_ID[$i]}"
  if [ "${CAP_PORT[$i]}" = "portable" ]; then
    PORTABLE_IDS="${PORTABLE_IDS:+$PORTABLE_IDS$'\n'}${CAP_ID[$i]}"
  fi
done

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
# `lc` is the job key's trailing key-comment, harvested in the same yq pass as
# the key itself (`key | line_comment`, key-bound as contract C2 requires).
# Leaves the attributed id in ATTRIBUTED, or empty if untraceable.
attribute_job() {
  local jk="$1" lc="$2" cand
  ATTRIBUTED=""
  if in_list "$jk" "$ALL_IDS"; then
    ATTRIBUTED=$jk
    return
  fi
  case "$lc" in
    "ci-capability: "*)
      cand="${lc#ci-capability: }"
      if in_list "$cand" "$ALL_IDS"; then ATTRIBUTED=$cand; return; fi
      ;;
  esac
}

# Key harvest programs: one `[key, key-comment]` pair per entry, in document
# order (`keys` order). `to_entries` would drop the key comments, so the pairs
# are built from `.[] | [ key, (key | line_comment) ]`. GHA stream: the skip
# flag (`.jobs | not`, true where `yq -e '.jobs'` fails on null or false), the
# tag of `.jobs`, the pair count, the pairs, `@@end`. GitLab: the same without
# the skip flag, over the top-level keys.
GHA_HARVEST_PROG='(.jobs | not), (.jobs | tag), ([ .jobs[] ] | length), (.jobs[] | [ key, (key | line_comment) ] | .[]), "@@end"'
GITLAB_HARVEST_PROG='(tag), ([ .[] ] | length), (.[] | [ key, (key | line_comment) ] | .[]), "@@end"'

# gha_note_job <workflow> <job-key> <key-comment> — attribute one job of a
# workflow file, then record it (GHA_JOBS / GHA_EXHIBITED) or report it untraceable.
gha_note_job() {
  local wf="$1" jk="$2" jlc="$3"
  attribute_job "$jk" "$jlc"
  attributed=$ATTRIBUTED
  if [ -z "$attributed" ]; then
    fail "untraceable job '$jk' in $(basename "$wf") (github-actions) — not a capability id and no valid '# ci-capability:' annotation (R7)"
  else
    GHA_JOBS="${GHA_JOBS}${attributed}	${wf}	${jk}"$'\n'
    GHA_EXHIBITED="${GHA_EXHIBITED}${attributed}"$'\n'
  fi
}

# gha_harvest_per_call <workflow> — the original harvest, one yq call per value.
# It runs ONLY for a workflow file holding more than one YAML document, where yq
# evaluates every call once per document: `-e '.jobs'` passes if any document has
# jobs, the key scan lists the keys of the documents before the first one without
# a mapping `.jobs` and then fails with yq's message (fail-open), and each
# key-comment lookup joins one result per document, `---` separators included.
# The single-pass harvest cannot reproduce that joining.
gha_harvest_per_call() {
  local wf="$1" jk lc
  yq -e '.jobs' "$wf" >/dev/null 2>&1 || return 0
  while IFS= read -r jk; do
    [ -z "$jk" ] && continue
    lc=""
    if ! in_list "$jk" "$ALL_IDS"; then
      lc=$(yq ".jobs.\"$jk\" | key | line_comment" "$wf")
    fi
    gha_note_job "$wf" "$jk" "$lc"
  done < <(yq -r '.jobs | keys | .[]' "$wf")
}

# GHA harvest — union across ALL workflow files. Records `id<TAB>file<TAB>jobkey`
# triples so Arm 1 can locate each portable capability's job.
GHA_JOBS=""
GHA_EXHIBITED=""
if $GHA_PRESENT; then
  for wf in "$WORKFLOWS_DIR"/*.yml "$WORKFLOWS_DIR"/*.yaml; do
    [ -f "$wf" ] || continue
    # An unparseable workflow, or one whose `.jobs` is absent, null or false, is
    # skipped silently (the former `yq -e '.jobs' … || continue`).
    yq -N -0 -r "$GHA_HARVEST_PROG" "$wf" > "$TOKDIR/workflow.tok" 2>/dev/null || continue
    tok_load "$TOKDIR/workflow.tok"
    tok_next; jobs_skip=$TV
    tok_next; jobs_tag=$TV
    tok_count; njobs=$TC
    if [ "$TOKN" -gt $((4 + 2 * njobs)) ]; then
      gha_harvest_per_call "$wf"
      continue
    fi
    [ "$jobs_skip" = true ] && continue
    case $jobs_tag in
      '!!map'|'!!seq') ;;
      *)
        # A scalar `.jobs` has no keys: the former key scan was fail-open, so
        # yq's own message reaches stderr and the file simply yields no jobs.
        yq -r '.jobs | keys | .[]' "$wf" >/dev/null || true
        ;;
    esac
    for ((j = 0; j < njobs; j++)); do
      tok_next; jk=$TV
      tok_next; jlc=$TV
      [ -z "$jk" ] && continue
      gha_note_job "$wf" "$jk" "$jlc"
    done
    tok_expect '@@end'
  done
fi

# GitLab harvest — top-level keys minus reserved keywords, plus reserved-named
# jobs bearing a fallback annotation (the complete harvest, docs lines 287-315).
GITLAB_EXHIBITED=""

# gitlab_note_job <job-key> <key-comment> — attribute one top-level key.
gitlab_note_job() {
  local jk="$1" lc="$2" cand
  case " $RESERVED " in
    *" $jk "*)
      # Reserved keyword — a job only if it carries a fallback annotation.
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
      return
      ;;
  esac
  attribute_job "$jk" "$lc"
  attributed=$ATTRIBUTED
  if [ -z "$attributed" ]; then
    fail "untraceable job '$jk' in .gitlab-ci.yml (gitlab) — not a capability id and no valid '# ci-capability:' annotation (R7)"
  else
    GITLAB_EXHIBITED="${GITLAB_EXHIBITED}${attributed}"$'\n'
  fi
}

# gitlab_harvest_per_call — the original harvest, one yq call per value; used
# ONLY when .gitlab-ci.yml holds more than one YAML document (see
# gha_harvest_per_call for why the single-pass harvest cannot serve that).
gitlab_harvest_per_call() {
  local jk lc
  while IFS= read -r jk; do
    [ -z "$jk" ] && continue
    lc=""
    case " $RESERVED " in
      *" $jk "*) lc=$(yq ".\"$jk\" | key | line_comment" "$GITLAB_CI") ;;
      *) if ! in_list "$jk" "$ALL_IDS"; then lc=$(yq ".\"$jk\" | key | line_comment" "$GITLAB_CI"); fi ;;
    esac
    gitlab_note_job "$jk" "$lc"
  done < <(yq -r 'keys | .[]' "$GITLAB_CI")
}

if $GITLAB_PRESENT; then
  # The key scan was fail-open: an unparseable file reports yq's message on
  # stderr and yields no keys.
  if ! yq -N -0 -r "$GITLAB_HARVEST_PROG" "$GITLAB_CI" > "$TOKDIR/gitlab.tok"; then
    : > "$TOKDIR/gitlab.tok"
  fi
  tok_load "$TOKDIR/gitlab.tok"
  njobs=0
  gl_multi=false
  if [ "$TOKN" -gt 0 ]; then
    tok_next; gl_tag=$TV
    tok_count; njobs=$TC
    if [ "$TOKN" -gt $((3 + 2 * njobs)) ]; then
      gl_multi=true
    else
      case $gl_tag in
        '!!map'|'!!seq') ;;
        *) yq -r 'keys | .[]' "$GITLAB_CI" >/dev/null || true ;;
      esac
    fi
  fi
  if $gl_multi; then
    gitlab_harvest_per_call
  else
    for ((j = 0; j < njobs; j++)); do
      tok_next; jk=$TV
      tok_next; lc=$TV
      [ -z "$jk" ] && continue
      gitlab_note_job "$jk" "$lc"
    done
    if [ "$TOKN" -gt 0 ]; then tok_expect '@@end'; fi
  fi
fi

# --- Arm 1: reference↔GitHub Actions business-step check (R3/R4) ------------

# cap_find <id> — position of the capability with this id (first match, as the
# former `select(.id == "<id>")` lookups), in CAPIDX. Ids are unique by now:
# validity rule 4 has already rejected duplicates.
cap_find() {
  local k
  CAPIDX=0
  for ((k = 0; k < cap_count; k++)); do
    if [ "${CAP_ID[$k]}" = "$1" ]; then CAPIDX=$k; return 0; fi
  done
}

# Step-record pass: one yq program per workflow file that holds an attributed
# portable job, emitting the records of exactly those jobs (selected by key), in
# document order. The consumers read them back at the same points where the
# per-job, per-step queries used to run, so behaviour (including which message
# comes first) is unchanged; only the data source is.
#
# Layout per selected job: its key, then a count-prefixed block: tag of the job
# node, step count (`.steps | length`), number of step records, the records,
# job-level env keys, step-level env keys, `@@job`. A step record: sequence-step
# flag, uses, run, with-is-a-sequence flag, then `with.fetch-depth`,
# `with.node-version`, `with.python-version`, `with.key`, `@@step`. Records exist
# only when `steps` is a sequence; for any other shape every indexed step read as
# null before, so Arm 1 treats the missing ones the same. A step that is itself a
# sequence, a `with` that is a sequence, or a job that is a sequence made the
# per-call query fail; the flags let the consumer re-run that exact query at the
# exact point it used to run, so yq's message and status still surface there. The
# two env listings were `2>/dev/null || true`, i.e. they listed nothing when yq
# failed: a non-mapping env, or a sequence step among the steps, is counted in
# `$bad` and the step-level listing is then empty. (The count emits `tag`, not a
# literal: yq evaluates a constant on the right of a pipe once even when the left
# side selected nothing.)
SAFE_STEP='select(tag != "!!seq")'
PROG=""
slot 'select(tag != "!!seq") | .steps | length'
PROG+='([ select(tag != "!!seq") | .steps | select(tag == "!!seq") | .[] ] | length), '
PROG+='(select(tag != "!!seq") | .steps | select(tag == "!!seq") | .[] | [ (tag == "!!seq"), '
slot "$SAFE_STEP | .uses // \"\""
slot "$SAFE_STEP | .run // \"\""
slot "$SAFE_STEP | (.with | tag) == \"!!seq\""
slot "$SAFE_STEP | select((.with | tag) != \"!!seq\") | .with.fetch-depth // \"\""
slot "$SAFE_STEP | select((.with | tag) != \"!!seq\") | .with.node-version // \"\""
slot "$SAFE_STEP | select((.with | tag) != \"!!seq\") | .with.python-version // \"\""
slot "$SAFE_STEP | select((.with | tag) != \"!!seq\") | .with.key // \"\""
PROG+='"@@step" ] | .[]), '
slot 'select(tag != "!!seq") | .env // {} | select(tag == "!!map" or tag == "!!seq") | keys | .[]'
# shellcheck disable=SC2016  # `$bad` is a yq variable, not a shell expansion
slot 'select(tag != "!!seq") | select($bad == 0) | .steps[].env // {} | keys | .[]'
PROG+='"@@job"'
JOB_BLOCK='(tag), '$PROG
JOB_BAD='([ select(tag != "!!seq") | .steps[] | ((select(tag == "!!seq") | tag), (select(tag != "!!seq") | .env // {} | select((tag == "!!map" or tag == "!!seq") | not) | tag)) ] | length)'

# Where each selected job's block sits in TOK[], by (workflow file, job key).
BLK_WF=()
BLK_JK=()
BLK_OFF=()
BLK_N=0

# job_fetch_all — one pass per workflow file over the WANT_* jobs resolved
# below. The key list is spliced into the program as string literals.
job_fetch_all() {
  local n m wf sel k done_files="" start len
  TOK=()
  TOKN=0
  for ((n = 0; n < want_n; n++)); do
    wf=${WANT_WF[$n]}
    if in_list "$wf" "$done_files"; then continue; fi
    done_files="${done_files}${wf}"$'\n'
    sel=""
    for ((m = n; m < want_n; m++)); do
      [ "${WANT_WF[$m]}" = "$wf" ] || continue
      k=${WANT_JK[$m]}
      k=${k//\\/\\\\}
      k=${k//\"/\\\"}
      sel="${sel:+$sel or }(. == \"$k\")"
    done
    # `key | a or b` binds as `(key | a) or b` in yq: the alternatives need
    # their own parentheses.
    start=$TOKN
    yq -N -0 -r ".jobs[] | select(key | ($sel)) | $JOB_BAD as \$bad | [ key, ([ $JOB_BLOCK ] | (length, .[])) ] | .[], \"@@end\"" "$wf" > "$TOKDIR/jobs.tok"
    tok_append "$TOKDIR/jobs.tok"
    TOKI=$start
    while :; do
      tok_next
      if [ "$TV" = '@@end' ]; then
        # One `@@end` per YAML document of the file.
        [ "$TOKI" -lt "$TOKN" ] || break
        continue
      fi
      BLK_WF[BLK_N]=$wf
      BLK_JK[BLK_N]=$TV
      tok_count; len=$TC
      BLK_OFF[BLK_N]=$TOKI
      BLK_N=$((BLK_N + 1))
      TOKI=$((TOKI + len))
    done
  done
}

# job_load <workflow> <job-key> — decode the job's block into JOB_* globals.
job_load() {
  local wf="$1" jk="$2" s b
  for ((b = 0; b < BLK_N; b++)); do
    if [ "${BLK_WF[$b]}" = "$wf" ] && [ "${BLK_JK[$b]}" = "$jk" ]; then break; fi
  done
  [ "$b" -lt "$BLK_N" ] || tok_die "no step records for job '$jk'"
  TOKI=${BLK_OFF[$b]}
  tok_next; JOB_TAG=$TV
  tok_cmdsub; JOB_NSTEPS=$TV
  tok_count; JOB_NREC=$TC
  for ((s = 0; s < JOB_NREC; s++)); do
    tok_next;   JOB_SEQSTEP[s]=$TV
    tok_cmdsub; JOB_USES[s]=$TV
    tok_cmdsub; JOB_RUN[s]=$TV
    tok_cmdsub; JOB_WITHSEQ[s]=$TV
    tok_cmdsub; JOB_FETCH[s]=$TV
    tok_cmdsub; JOB_NODE[s]=$TV
    tok_cmdsub; JOB_PYTHON[s]=$TV
    tok_cmdsub; JOB_KEY[s]=$TV
    tok_expect '@@step'
  done
  tok_cmdsub; JOB_ENV=$TV
  tok_cmdsub; JOB_STEPENV=$TV
  tok_expect '@@job'
  if [ "$JOB_TAG" = '!!seq' ]; then
    # A sequence job made `.jobs."<key>".steps` fail: surface that same failure.
    yq ".jobs.\"$jk\".steps | length" "$wf" >/dev/null
  fi
}

# job_step_probe <workflow> <job-key> <step> [<with-key>] — re-run the original
# per-step query when the step record says it used to fail (a sequence step for
# uses/run; a sequence `with` for the given with-key), so the failure surfaces
# exactly where the per-call code raised it. A no-op for every well-formed step.
job_step_probe() {
  local wf="$1" jk="$2" s="$3" wk="${4:-}"
  if [ -z "$wk" ]; then
    if [ "${JOB_SEQSTEP[$s]}" = true ]; then
      yq -r ".jobs.\"$jk\".steps[$s].uses // \"\"" "$wf" >/dev/null
    fi
  elif [ "${JOB_WITHSEQ[$s]}" = true ]; then
    yq -r ".jobs.\"$jk\".steps[$s].with.$wk // \"\"" "$wf" >/dev/null
  fi
}

# Verify one portable capability against its attributed GHA job. Aligns the
# job's business `run:` steps against the capability's command list in order,
# skipping `uses:` setup steps and recognized tool-install recipes; then checks
# that requires is satisfied by the recorded setup (presence/equivalence).
check_gha_job() {
  local id="$1" wf="$2" jk="$3"
  local ncmd runtime req_tools hist nsteps cap_ix cmd_ix
  cap_find "$id"
  cap_ix=$CAPIDX
  ncmd=${CAP_NCMD[$cap_ix]}
  runtime=${CAP_RUNTIME[$cap_ix]}
  req_tools=${CAP_TOOLS[$cap_ix]}
  hist=${CAP_HIST[$cap_ix]}
  job_load "$wf" "$jk"
  nsteps=$JOB_NSTEPS

  local ci=0
  local prov_node="" prov_python="" prov_fetch="" prov_tools=""
  local s uses run nrun nextcmd rtool
  for ((s = 0; s < nsteps; s++)); do
    # `steps` that is not a sequence has no addressable entry: every indexed
    # step read as null (no uses, no run).
    [ "$s" -lt "$JOB_NREC" ] || continue
    job_step_probe "$wf" "$jk" "$s"
    uses=${JOB_USES[$s]}
    run=${JOB_RUN[$s]}

    if [ -n "$uses" ] && [ "$uses" != "null" ]; then
      case "$uses" in
        */checkout@*)     job_step_probe "$wf" "$jk" "$s" fetch-depth;   prov_fetch=${JOB_FETCH[$s]} ;;
        */setup-node@*)   job_step_probe "$wf" "$jk" "$s" node-version;  prov_node=${JOB_NODE[$s]} ;;
        */setup-python@*) job_step_probe "$wf" "$jk" "$s" python-version; prov_python=${JOB_PYTHON[$s]} ;;
      esac
      continue
    fi

    if [ -n "$run" ] && [ "$run" != "null" ]; then
      normalize_cmd "$run"
      nrun=$NORM
      # Unwrap the cache-guard wrapper (spec 0147 R6/R7): the guard is a
      # mechanism, not business work. Extract the inner command after ` -- `,
      # mirroring how install_recipe_tool skips setup steps.
      case "$nrun" in
        "bash scripts/ci-cache-guard.sh "*)
          nrun="${nrun#* -- }"
          ;;
      esac
      # Business step iff it matches the next expected command entry, in order.
      if [ "$ci" -lt "$ncmd" ]; then
        # `.command[ci]` addresses an entry of a sequence only; any other shape
        # (a scalar command) has none, which read as empty.
        nextcmd=""
        if [ "${CAP_CMDTAG[$cap_ix]}" = '!!seq' ] && [ "$ci" -lt "${CAP_CMDN[$cap_ix]}" ]; then
          cmd_ix=$((CAP_CMD0[cap_ix] + ci))
          nextcmd=${CMD_ITEM[$cmd_ix]}
        fi
        normalize_cmd "$nextcmd"
        nextcmd=$NORM
        if [ "$nrun" = "$nextcmd" ]; then
          ci=$((ci + 1))
          continue
        fi
      fi
      # Otherwise it must be a recognized setup tool-install recipe.
      install_recipe_tool "$nrun"
      rtool=$RTOOL
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

  # R4 — requires satisfied by setup, judged by presence/equivalence. A
  # capability MAY declare more than one runtime (e.g. `mempalace`:
  # python@3.12 + node@24), so every declared entry is checked independently
  # against the setup steps recorded above.
  local runtime_entry want
  while IFS= read -r runtime_entry; do
    [ -z "$runtime_entry" ] && continue
    case "$runtime_entry" in
      node@*)
        want="${runtime_entry#node@}"
        [ "${prov_node%%.*}" = "${want%%.*}" ] || \
          fail "capability '$id' (github-actions): requires runtime '$runtime_entry' but setup provides node '${prov_node:-none}' (R4)"
        ;;
      python@*)
        want="${runtime_entry#python@}"
        case "$prov_python" in
          "$want"*) ;;
          *) fail "capability '$id' (github-actions): requires runtime '$runtime_entry' but setup provides python '${prov_python:-none}' (R4)" ;;
        esac
        ;;
    esac
  done <<< "$runtime"
  while IFS= read -r rt; do
    [ -z "$rt" ] && continue
    # jq, git, and diff (diffutils) are preinstalled on GitHub Actions
    # ubuntu-latest runners. GitLab CI installs jq via tool_install_lines;
    # git/diff have no GitLab recipe yet, so a capability declaring them
    # still fails Arm 2 (reference↔GitLab) until one is added there.
    case "$rt" in
      jq|git|diff) continue ;;
    esac
    # A setup-python step (any version) satisfies a bare `python3` tool
    # requirement the same way it satisfies `requires.runtime: python@X` above
    # — it is a genuine setup step, not a business step the command list must
    # exhibit.
    if [ "$rt" = "python3" ] && [ -n "$prov_python" ]; then
      continue
    fi
    in_list "$rt" "$prov_tools" || \
      fail "capability '$id' (github-actions): requires tool '$rt' but no setup step installs it (R4)"
  done <<< "$req_tools"
  if [ "$hist" = "full" ]; then
    [ "$prov_fetch" = "0" ] || \
      fail "capability '$id' (github-actions): requires full source history but checkout fetch-depth is '${prov_fetch:-unset}' (R4)"
  fi

  # Spec 0131 — env parity check.
  local req_env gha_env_job gha_env_steps gha_env_all
  req_env=${CAP_ENVKEYS[$cap_ix]}
  gha_env_job=$JOB_ENV
  gha_env_steps=$JOB_STEPENV
  gha_env_all=""
  if [ -n "$gha_env_job$gha_env_steps" ]; then
    gha_env_all=$(printf '%s\n%s' "$gha_env_job" "$gha_env_steps" | grep -v '^$' | sort -u || true)
  fi

  local ek
  while IFS= read -r ek; do
    [ -z "$ek" ] && continue
    if ! in_list "$ek" "$gha_env_all"; then
      fail "capability '$id' (github-actions): requires env variable '$ek' but GHA job does not exhibit it (spec 0131)"
    fi
  done <<< "$req_env"

  local gek
  while IFS= read -r gek; do
    [ -z "$gek" ] && continue
    if ! in_list "$gek" "$req_env"; then
      fail "capability '$id' (github-actions): GHA job defines env variable '$gek' not declared in reference env block (spec 0131)"
    fi
  done <<< "$gha_env_all"
}

# Verify one cached capability's GHA cache key inputs agree with the reference
# (spec 0147 R6/R7): the actions/cache step's hashFiles(...) args must be the
# same declared inputs as the reference's cache.files (semantic, not string).
# Runs right after check_gha_job for the same job, so the JOB_* records it
# loaded are reused rather than fetched again.
check_gha_cache() {
  local id="$1" wf="$2" jk="$3"
  local ref_files gha_files nsteps s uses key cap_ix
  cap_find "$id"
  cap_ix=$CAPIDX
  ref_files=$(printf '%s' "${CAP_CACHEFILES[$cap_ix]}" | sort)
  nsteps=$JOB_NSTEPS
  gha_files=""
  for ((s = 0; s < nsteps; s++)); do
    [ "$s" -lt "$JOB_NREC" ] || continue
    job_step_probe "$wf" "$jk" "$s"
    uses=${JOB_USES[$s]}
    case "$uses" in
      */cache@*)
        job_step_probe "$wf" "$jk" "$s" key
        key=${JOB_KEY[$s]}
        gha_files=$(extract_hashfiles "$key" | sort)
        ;;
    esac
  done
  if [ -z "$gha_files" ]; then
    fail "capability '$id' (github-actions): declares cache: but no actions/cache step with a hashFiles key found (R6)"
    return
  fi
  if [ "$ref_files" != "$gha_files" ]; then
    fail "capability '$id' (github-actions): cache key inputs diverge from the reference cache.files (R6)"
  fi
}

if $GHA_PRESENT; then
  # Resolve each portable capability to its attributed job first, so the step
  # records of all of them come from one yq pass per workflow file.
  want_n=0
  WANT_ID=()
  WANT_WF=()
  WANT_JK=()
  while IFS= read -r pid; do
    [ -z "$pid" ] && continue
    # First attributed job for this id, as `file<TAB>jobkey` (the former awk
    # first-match lookup over GHA_JOBS).
    triple=""
    while IFS= read -r jline; do
      case $jline in
        "$pid"$'\t'*) triple=${jline#*$'\t'}; break ;;
      esac
    done <<< "$GHA_JOBS"
    # A portable capability with no GHA job is an Arm-3 omission, reported there.
    [ -z "$triple" ] && continue
    WANT_ID[want_n]=$pid
    WANT_WF[want_n]="${triple%%	*}"
    WANT_JK[want_n]="${triple#*	}"
    want_n=$((want_n + 1))
  done <<< "$PORTABLE_IDS"
  job_fetch_all
  for ((n = 0; n < want_n; n++)); do
    pid=${WANT_ID[$n]}
    wf=${WANT_WF[$n]}
    jk=${WANT_JK[$n]}
    check_gha_job "$pid" "$wf" "$jk"
    # Cache key agreement for cached capabilities.
    cap_find "$pid"
    if [ "${CAP_CACHELEN[$CAPIDX]}" != "0" ]; then
      check_gha_cache "$pid" "$wf" "$jk"
    fi
  done
fi

# --- Arm 2: reference↔GitLab (R5) -------------------------------------------

if $GITLAB_PRESENT; then
  if ! gitlab_out=$(REPO_DIR="$REPO_DIR" bash "$SCRIPT_DIR/build-ci.sh" --check 2>&1); then
    fail "reference↔GitLab divergence (gitlab) — composed 'build-ci.sh --check' failed (R5):"
    while IFS= read -r ln; do
      echo "    $ln" >&2
    done <<< "$gitlab_out"
  fi

  # Cache key agreement (spec 0147 R6/R7): each cached capability's GitLab
  # cache:key:files must be the same declared inputs as the reference's
  # cache.files (semantic, not string). One yq pass answers for every cached
  # capability (none: no pass at all, as before).
  #
  # Per cached capability the stream carries a failure count, then its file list.
  # The count is the number of sequences on the path (`.<id>.cache.key`), each of
  # which made the per-id query fail. That query ran as `yq … 2>/dev/null | sort`
  # under pipefail: a failure ended the script silently with yq's status, after
  # the capabilities before it had already been compared. An unparseable
  # `.gitlab-ci.yml` fails the same way, at the first cached capability.
  gl_prog=""
  gl_cached=0
  for ((i = 0; i < cap_count; i++)); do
    case ${CAP_CACHETYPE[$i]} in
      ''|'!!null') continue ;;
    esac
    [ -n "${CAP_ID[$i]}" ] || continue
    gl_node="select(tag != \"!!seq\") | .\"${CAP_ID[$i]}\" | select(tag != \"!!seq\") | .cache | select(tag != \"!!seq\") | .key | select(tag != \"!!seq\")"
    gl_bad="((select(tag == \"!!seq\") | tag), (select(tag != \"!!seq\") | .\"${CAP_ID[$i]}\" | ((select(tag == \"!!seq\") | tag), (select(tag != \"!!seq\") | .cache | ((select(tag == \"!!seq\") | tag), (select(tag != \"!!seq\") | .key | select(tag == \"!!seq\") | tag))))))"
    gl_prog+="([ $gl_bad ] | length), ([ $gl_node | .files[] ] | (length, .[])), "
    gl_cached=$((gl_cached + 1))
  done
  if [ "$gl_cached" -gt 0 ]; then
    # A multi-document .gitlab-ci.yml keeps the per-capability query: yq answers
    # it once per document and the results (and their `---` separators) join.
    if ! $gl_multi; then
      yq -N -0 -r "$gl_prog\"@@end\"" "$GITLAB_CI" 2>/dev/null > "$TOKDIR/gitlab-cache.tok"
      tok_load "$TOKDIR/gitlab-cache.tok"
    fi
    for ((i = 0; i < cap_count; i++)); do
      case ${CAP_CACHETYPE[$i]} in
        ''|'!!null') continue ;;
      esac
      cid=${CAP_ID[$i]}
      [ -n "$cid" ] || continue
      ref_files=$(printf '%s' "${CAP_CACHEFILES[$i]}" | sort)
      if $gl_multi; then
        gl_files=$(yq -r ".\"$cid\".cache.key.files[]" "$GITLAB_CI" 2>/dev/null | sort)
      else
        tok_next
        [ "$TV" = 0 ] || exit 1
        tok_cmdsub
        gl_files=$(printf '%s' "$TRAW" | sort)
      fi
      if [ "$ref_files" != "$gl_files" ]; then
        fail "capability '$cid' (gitlab): cache key inputs diverge from the reference cache.files (R6)"
      fi
    done
    if ! $gl_multi; then tok_expect '@@end'; fi
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
