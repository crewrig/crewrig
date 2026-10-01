#!/usr/bin/env bash
# build-ci.sh — Derive the GitLab CI pipeline from the platform-neutral CI
# capability reference (spec 0048).
#
# Reads ci/ci-capabilities.yml (contract C1, normatively described by
# docs/ci-reference-format.md) and emits one GitLab job per PORTABLE
# capability into .gitlab-ci.yml at the repo root. Each job key IS the
# capability id (contract C2 primary path, id == job key). For each portable
# capability the generator composes:
#   - `requires:` (delta-02 R12) → the GitLab setup boilerplate that SATISFIES
#     the engine-agnostic need: `image` from runtime, `before_script` tool
#     installs from tools, `GIT_DEPTH: "0"` from history-depth. The boilerplate
#     is the generator's HOW; it is never round-tripped into the reference.
#   - `command:` (delta-01 R10) → the job's `script:` list (the business work).
#   - `trigger[]` → GitLab `rules:` (the neutral trigger vocabulary mapped to
#     GitLab's own syntax).
#
# Engine-specific capabilities (portability: specific) are SKIPPED entirely —
# no job, no placeholder (spec 0048 R4). They stay hand-authored per engine.
# The GitHub Actions workflows are NOT regenerated (spec 0048 R5); this script
# produces the GitLab pipeline only.
#
# The canonical forge stays GitHub: .gitlab-ci.yml is produced and drift-checked
# in this repository, never executed on a live GitLab (spec 0048 Out of scope).
#
# Usage:
#   bash scripts/build-ci.sh [--check]
#
# Options:
#   --check    Regenerate to a temp file and `diff -q` against the committed
#              .gitlab-ci.yml; exit non-zero on drift (drift detection, for CI).
#              Mirrors scripts/build-components.sh --check and
#              scripts/build-extension.sh --check.
#
# Prerequisites: yq (mikefarah v4; v4.33.2 or later for the single-pass reader
# below, which needs `-0` / `--nul-output`; an older yq rejects the flag and the
# generator falls back to the per-call path, see "Data source").
#
# Data source. The reference is decoded by ONE `yq -N -0 -r` program that emits
# a NUL-delimited token stream (written to a temp file, so a parse failure is an
# exit status, not a swallowed process substitution), and the emitters read their
# values back from it instead of spawning `yq` per value. Every list slot is
# count-prefixed and every record ends with a frame token, so a desynchronised
# stream aborts (exit 70) instead of shifting values. Every value is produced by
# the same yq expression the former per-value call used, on the same node.
#
# The single pass is used only when it can reproduce the per-call behaviour
# exactly: a single YAML document, yq printing nothing on stderr, every portable
# id a unique plain string, `trigger`/`command` a sequence and `env` a mapping
# (or absent), and no mapping, sequence or carriage-return-bearing string where a
# plain value is expected. Anything else (a multi-document reference, a parse
# error or warning, a duplicate id, a scalar `trigger:`, a crash inside yq, an old
# yq without `-0`) takes the original per-call path, whose `yq` calls sit at the
# same program points as before, so rc, stdout and stderr stay what they were.
#
# `yq` spawns: 1 per generation (the decode pass), independent of the number of
# capabilities, triggers, commands and env keys; the per-call path spends one per
# value, as before.

set -euo pipefail

command -v yq >/dev/null 2>&1 || {
  echo "Error: yq is required. Install with: brew install yq" >&2
  exit 2
}

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="${REPO_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
REFERENCE="$REPO_DIR/ci/ci-capabilities.yml"
OUTPUT="$REPO_DIR/.gitlab-ci.yml"

CHECK_MODE=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --check) CHECK_MODE=true; shift ;;
    *)       shift ;;
  esac
done

if [ ! -f "$REFERENCE" ]; then
  echo "Error: CI reference not found: $REFERENCE" >&2
  exit 2
fi

# --- Requirement → GitLab boilerplate translation (delta-02 R12) ------------

# Map a `requires.runtime` value (`node@22`, `python@3.12`) to a GitLab Docker
# image tag. The neutral `<name>@<version>` form is the contract; the
# `<name>:<version>` Docker form is the GitLab mechanism. Capabilities with no
# declared runtime get the project's default image (a Debian base wide enough
# for the bash/grep-only jobs and the yq/jq tool installs).
DEFAULT_IMAGE="debian:stable-slim"
runtime_to_image() {
  local runtime="$1"
  case "$runtime" in
    node@*)   echo "node:${runtime#node@}" ;;
    python@*) echo "python:${runtime#python@}" ;;
    "")       echo "$DEFAULT_IMAGE" ;;
    *)
      echo "Error: unknown runtime '$runtime' — no GitLab image mapping." >&2
      exit 1
      ;;
  esac
}

# Map a `requires.tools` entry to the before_script install line(s) that make
# the tool available on the GitLab runner. Each tool the contract may declare
# has exactly one install recipe here; an undeclared tool is a hard error so a
# capability whose command needs a tool it never declared in `requires:` is
# rejected at generation time (delta-02 Scenario 2).
tool_install_lines() {
  local tool="$1"
  case "$tool" in
    yq)
      echo 'apt-get update && apt-get install -y --no-install-recommends wget ca-certificates'
      echo 'wget -qO /usr/local/bin/yq https://github.com/mikefarah/yq/releases/latest/download/yq_linux_amd64'
      echo 'chmod +x /usr/local/bin/yq'
      ;;
    jq)
      echo 'apt-get update && apt-get install -y --no-install-recommends jq'
      ;;
    task)
      echo 'sh -c "$(curl --location https://taskfile.dev/install.sh)" -- -d -b /usr/local/bin'
      ;;
    markdownlint-cli)
      # Forward-compat recipe: no capability currently declares
      # `markdownlint-cli` under `requires.tools` (the lint-markdown job
      # installs it inline within its `command:`, mirroring the real GHA
      # step). Kept so a future capability can request it as a first-class
      # tool without re-deriving the install line.
      echo 'npm install -g markdownlint-cli'
      ;;
    tesseract)
      echo 'apt-get update && apt-get install -y --no-install-recommends tesseract-ocr'
      ;;
    python3)
      echo 'apt-get update && apt-get install -y --no-install-recommends python3'
      ;;
    *)
      echo "Error: unknown tool '$tool' — no GitLab install recipe (delta-02 Scenario 2)." >&2
      exit 1
      ;;
  esac
}

# Map a SECONDARY `requires.runtime` entry — any beyond the first, which
# `runtime_to_image()` turns into the job's Docker image — to the
# before_script install line(s) that make it available alongside the image's
# own runtime. A portable capability MAY need more than one runtime (e.g.
# `mempalace`: the image is `python:3.12` for its existing test scripts, and
# node@24 is installed here for its TypeScript test); this mirrors
# `tool_install_lines`'s need-vs-mechanism split, just keyed by runtime rather
# than by tool name.
secondary_runtime_install_lines() {
  local runtime="$1"
  case "$runtime" in
    node@*)
      local major="${runtime#node@}"
      major="${major%%.*}"
      # NodeSource's setup script, not apt: Debian's own repos lag the pinned
      # major version, and every node@X capability elsewhere in the reference
      # (ratchet, lint-typescript) means the exact major, not "whatever apt has".
      echo "curl -fsSL https://deb.nodesource.com/setup_${major}.x | bash -"
      echo 'apt-get install -y --no-install-recommends nodejs'
      ;;
    python@*)
      # Unlike the node case, apt's python3 is an acceptable secondary install:
      # no capability pins an exact minor here, matching the pre-existing
      # `tools: [python3]` recipe above (figure-labels), which never pins one
      # either.
      echo 'apt-get update && apt-get install -y --no-install-recommends python3'
      ;;
    *)
      echo "Error: unknown secondary runtime '$runtime' — no GitLab install recipe." >&2
      exit 1
      ;;
  esac
}

# --- Reference decoder (single yq pass) -------------------------------------

# One `yq -N -0 -r` program writes NUL-delimited tokens to a temp file; the file
# is loaded into TOK[] by an `IFS= read -r -d ''` loop, so leading/trailing
# whitespace and embedded newlines survive. The readers set globals instead of
# printing, so none of them is ever called inside `$(…)`.
TOK=()
TOKN=0
TOKI=0
TV=""
TC=0
TRAW=""
SL=()
SLN=0
BAD=0
Q=""
FAST=false

# A desynchronised stream means the yq program and its reader disagree about the
# record layout — a bug here, never an input condition — so it aborts loudly.
tok_die() {
  echo "Error: build-ci: yq token stream out of sync ($1)" >&2
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

# tok_slot — read one list slot (count, unsafe count, items). The items are left
# in SL[0..SLN-1]; TRAW is what the former `$(yq -r EXPR …)` captured before
# stripping (every result followed by a newline) and TV is that text with the
# trailing newlines stripped, as `$(…)` strips them. A slot holding a mapping or
# a sequence prints differently from a scalar, and `yq -0` drops a trailing CR
# from a string (so any string holding one is not carried faithfully); either
# marks the stream BAD and the per-call path takes over.
tok_slot() {
  local _i
  tok_count
  SLN=$TC
  tok_count
  [ "$TC" -eq 0 ] || BAD=1
  TRAW=""
  for ((_i = 0; _i < SLN; _i++)); do
    tok_next
    SL[_i]=$TV
    TRAW+=$TV$'\n'
  done
  TV=$TRAW
  while [[ $TV == *$'\n' ]]; do TV=${TV%$'\n'}; done
}

# slot <yq-expr> — append one list slot to the program text being built in PROG:
# `[ expr ] | (length, unsafe count, .[])` is total on any input shape (a missing
# path, or an expression with no result, is a count of 0), whereas a bare
# expression would emit nothing and shift every later token. An item is unsafe
# when it is a mapping, a sequence, or a string holding a carriage return (`yq -0`
# drops a trailing one, so such a string cannot be carried faithfully). Each
# slot is parenthesised because `a | b, c` parses as `(a | b), c` in yq.
slot() { PROG+="([ $1 ] | (length, ([ .[] | select(tag == \"!!map\" or tag == \"!!seq\" or (tag == \"!!str\" and test(\"\\r\"))) ] | length), .[])), "; }

# Per-capability record, in the order read_entry consumes it. Each expression is
# the one the former per-value call applied to the capability. List positions
# inside a record are written `.[] | [ … ] | .[]` because yq evaluates a
# parenthesised union after `.[] |` column-wise rather than per element.
PROG=""
slot '.on'
slot '.branches // [] | .[]'
slot '.tag-pattern // ""'
slot '.paths // [] | .[]'
TRIGGER_RECORD=$PROG'"@@trec"'

PROG=""
# `.requires.runtime` may be a bare scalar (every pre-existing capability) or a
# list (a capability needing more than one runtime, e.g. `mempalace`:
# python@3.12 + node@24) — normalized to one entry per line either way.
# shellcheck disable=SC2016  # `$rt` is a yq variable, not a shell expansion
slot '.requires.runtime as $rt | ($rt | select(tag == "!!seq")) // [$rt] | .[]'
slot '.requires.history-depth // ""'
slot '.env // {} | keys | .[]'
slot '.env // {} | .[]'
slot '.env | tag'
slot '.requires.tools // [] | .[]'
slot '.cache.files // [] | .[]'
slot '.cache.env // [] | .[]'
slot 'select(has("cache-guard")) | .cache-guard'
slot '.command | tag'
slot '.command[]'
slot '.trigger | tag'
PROG+='([ .trigger | select(tag == "!!seq") | .[] ] | length), '
PROG+='(.trigger | select(tag == "!!seq") | .[] | [ '"$TRIGGER_RECORD"' ] | .[]), '
PROG+='"@@rec"'
CAP_RECORD=$PROG

# Header: the portable ids and their tags (the former id loop), then every id
# and its tag (what each former `select(.id == "…")` ranged over).
PROG=""
slot '.capabilities[] | select(.portability == "portable") | .id'
slot '.capabilities[] | select(.portability == "portable") | .id | tag'
slot '.capabilities[] | .id'
slot '.capabilities[] | .id | tag'
REF_PROG='[ '"$PROG"'(.capabilities[] | select(.portability == "portable") | [ '"$CAP_RECORD"' ] | .[]), "@@end" ] | (length, .[])'

# read_entry — decode one capability record from TOK[] into the e_* globals, in
# the order the program above emits it. Sets BAD when the capability has a shape
# the per-call code treats differently from a plain sequence/mapping of scalars.
read_entry() {
  local _j _k
  tok_slot; e_runtimes=$TV
  tok_slot; e_hist=$TV
  tok_slot
  e_envkeys=$TV
  e_nek=$SLN
  e_ek=()
  for ((_j = 0; _j < e_nek; _j++)); do
    e_ek[_j]=${SL[_j]}
    # The per-call code splices the key into a yq path: keep to keys that path
    # reads literally.
    case ${SL[_j]} in
      *[!A-Za-z0-9_.-]*) BAD=1 ;;
    esac
  done
  tok_slot
  e_nev=$SLN
  e_ev=()
  for ((_j = 0; _j < e_nev; _j++)); do
    e_ev[_j]=${SL[_j]}
  done
  [ "$e_nev" -eq "$e_nek" ] || BAD=1
  tok_slot
  case $TV in
    '!!map'|'!!null') ;;
    *) BAD=1 ;;
  esac
  tok_slot; e_tools=$TV
  tok_slot; e_cfiles=$TV
  tok_slot; e_cenv=$TV
  tok_slot; e_cguard=$TV
  tok_slot
  case $TV in
    '!!seq'|'!!null') ;;
    *) BAD=1 ;;
  esac
  tok_slot
  e_ncmd=$SLN
  e_cmd=()
  for ((_j = 0; _j < e_ncmd; _j++)); do
    _k=${SL[_j]}
    while [[ $_k == *$'\n' ]]; do _k=${_k%$'\n'}; done
    e_cmd[_j]=$_k
  done
  tok_slot
  case $TV in
    '!!seq'|'!!null') ;;
    *) BAD=1 ;;
  esac
  tok_count; e_ntrig=$TC
  e_tkind=()
  e_tbranches=()
  e_ttagpat=()
  e_tpaths=()
  for ((_j = 0; _j < e_ntrig; _j++)); do
    tok_slot; e_tkind[_j]=$TV
    tok_slot; e_tbranches[_j]=$TV
    tok_slot; e_ttagpat[_j]=$TV
    tok_slot; e_tpaths[_j]=$TV
    tok_expect '@@trec'
  done
  tok_expect '@@rec'
}

# decode_reference — run the single pass and check that it may be used. Returns
# non-zero (nothing emitted, nothing consumed) when the per-call path must run
# instead; on success PID[0..PID_N-1] are the portable ids and TOKI sits on the
# first capability record. Runs in `if` context, so every failure is explicit.
PID=()
PID_N=0
ENT_START=0
decode_reference() {
  local tf rc=0 yq_err ref_len i j p
  local ids_all=() n_all cnt
  tf="$(mktemp "${TMPDIR:-/tmp}/build-ci-tok.XXXXXX" 2>/dev/null)" || return 1
  # Any diagnostic from yq (a failure, or a warning such as the merge-anchor
  # one, which the per-call path repeats on every call) sends the run to the
  # per-call path, which then emits exactly the diagnostics it always did.
  yq_err=$(yq -N -0 -r "$REF_PROG" "$REFERENCE" 2>&1 > "$tf") || rc=$?
  if [ "$rc" -eq 0 ] && [ -z "$yq_err" ]; then tok_load "$tf" || rc=1; else rc=1; fi
  rm -f "$tf"
  [ "$rc" -eq 0 ] || return 1
  # No document at all (an empty file): the program never ran.
  [ "$TOKN" -gt 0 ] || return 1
  BAD=0
  tok_count; ref_len=$TC
  # yq runs the program once per YAML document and the per-call code joins the
  # per-document results, which a single pass cannot reproduce.
  [ "$TOKN" -eq $((ref_len + 1)) ] || return 1

  tok_slot
  PID_N=$SLN
  PID=()
  for ((i = 0; i < PID_N; i++)); do PID[i]=${SL[i]}; done
  tok_slot
  [ "$SLN" -eq "$PID_N" ] || return 1
  for ((i = 0; i < PID_N; i++)); do
    [ "${SL[i]}" = '!!str' ] || return 1
    p=${PID[i]}
    # The per-call code splices the id into a yq expression: keep to ids that
    # expression reads literally.
    case $p in
      ''|*[!A-Za-z0-9._-]*) return 1 ;;
    esac
  done
  tok_slot
  n_all=$SLN
  for ((i = 0; i < n_all; i++)); do ids_all[i]=${SL[i]}; done
  tok_slot
  [ "$SLN" -eq "$n_all" ] || return 1
  for ((i = 0; i < n_all; i++)); do
    case ${SL[i]} in
      '!!str'|'!!null') ;;
      *) return 1 ;;
    esac
  done
  [ "$BAD" -eq 0 ] || return 1
  # `select(.id == "…")` ranged over every capability, so a portable id that
  # another capability also carries selected both of them.
  for ((i = 0; i < PID_N; i++)); do
    cnt=0
    for ((j = 0; j < n_all; j++)); do
      if [ "${ids_all[j]}" = "${PID[i]}" ]; then cnt=$((cnt + 1)); fi
    done
    [ "$cnt" -eq 1 ] || return 1
  done

  # Dry-read every record once, so a shape the single pass cannot reproduce is
  # found before anything is emitted; emit_job then re-reads them in order.
  ENT_START=$TOKI
  for ((i = 0; i < PID_N; i++)); do read_entry; done
  tok_expect '@@end'
  TOKI=$ENT_START
  [ "$BAD" -eq 0 ] || return 1
  return 0
}

# --- Data accessors ---------------------------------------------------------

# Each accessor leaves in Q exactly what the former `$(yq … "$REFERENCE")` at
# that program point captured (trailing newlines stripped). On the single-pass
# path the value comes from the record read_entry loaded; on the per-call path
# it is the original yq call, issued at the same point as before, so a failing
# yq still aborts there under `set -e` with its own message and status.
# $1 is the capability id; $2 the trigger index (or env key / command index).
q_trigger_n() {
  if [ "$FAST" = true ]; then Q=$e_ntrig
  else Q=$(yq ".capabilities[] | select(.id == \"$1\") | .trigger | length" "$REFERENCE"); fi
}
q_kind() {
  if [ "$FAST" = true ]; then Q=${e_tkind[$2]}
  else Q=$(yq ".capabilities[] | select(.id == \"$1\") | .trigger[$2].on" "$REFERENCE"); fi
}
q_branches() {
  if [ "$FAST" = true ]; then Q=${e_tbranches[$2]}
  else Q=$(yq -r ".capabilities[] | select(.id == \"$1\") | .trigger[$2].branches // [] | .[]" "$REFERENCE"); fi
}
q_tag_pattern() {
  if [ "$FAST" = true ]; then Q=${e_ttagpat[$2]}
  else Q=$(yq -r ".capabilities[] | select(.id == \"$1\") | .trigger[$2].tag-pattern // \"\"" "$REFERENCE"); fi
}
q_paths() {
  if [ "$FAST" = true ]; then Q=${e_tpaths[$2]}
  else Q=$(yq -r ".capabilities[] | select(.id == \"$1\") | .trigger[$2].paths // [] | .[]" "$REFERENCE"); fi
}
q_runtimes() {
  if [ "$FAST" = true ]; then Q=$e_runtimes
  else Q=$(yq -r ".capabilities[] | select(.id == \"$1\") | .requires.runtime as \$rt | (\$rt | select(tag == \"!!seq\")) // [\$rt] | .[]" "$REFERENCE"); fi
}
q_history_depth() {
  if [ "$FAST" = true ]; then Q=$e_hist
  else Q=$(yq -r ".capabilities[] | select(.id == \"$1\") | .requires.history-depth // \"\"" "$REFERENCE"); fi
}
q_env_keys() {
  if [ "$FAST" = true ]; then Q=$e_envkeys
  else Q=$(yq -r ".capabilities[] | select(.id == \"$1\") | .env // {} | keys | .[]" "$REFERENCE"); fi
}
q_env_value() {
  local _j
  if [ "$FAST" = true ]; then
    Q=""
    for ((_j = 0; _j < e_nek; _j++)); do
      if [ "${e_ek[_j]}" = "$2" ]; then
        Q=${e_ev[_j]}
        break
      fi
    done
    while [[ $Q == *$'\n' ]]; do Q=${Q%$'\n'}; done
  else Q=$(yq -r ".capabilities[] | select(.id == \"$1\") | .env.\"$2\"" "$REFERENCE"); fi
}
q_tools() {
  if [ "$FAST" = true ]; then Q=$e_tools
  else Q=$(yq -r ".capabilities[] | select(.id == \"$1\") | .requires.tools // [] | .[]" "$REFERENCE"); fi
}
q_cache_files() {
  if [ "$FAST" = true ]; then Q=$e_cfiles
  else Q=$(yq -r ".capabilities[] | select(.id == \"$1\") | .cache.files // [] | .[]" "$REFERENCE"); fi
}
q_cache_env() {
  if [ "$FAST" = true ]; then Q=$e_cenv
  else Q=$(yq -r ".capabilities[] | select(.id == \"$1\") | .cache.env // [] | .[]" "$REFERENCE"); fi
}
q_cache_guard() {
  if [ "$FAST" = true ]; then Q=$e_cguard
  else Q=$(yq -r '.capabilities[] | select(.id == "'"$1"'") | select(has("cache-guard")) | .cache-guard' "$REFERENCE"); fi
}
q_command_n() {
  if [ "$FAST" = true ]; then Q=$e_ncmd
  else Q=$(yq ".capabilities[] | select(.id == \"$1\") | .command | length" "$REFERENCE"); fi
}
q_command() {
  if [ "$FAST" = true ]; then Q=${e_cmd[$2]}
  else Q=$(yq -r ".capabilities[] | select(.id == \"$1\") | .command[$2]" "$REFERENCE"); fi
}

# esc_dq <text> — leave in ESC the text with `\` and `"` backslash-escaped for a
# double-quoted YAML scalar (backslashes first, as the former sed pair did).
esc_dq() {
  ESC=${1//\\/\\\\}
  ESC=${ESC//\"/\\\"}
}

# --- Trigger → GitLab rules translation (neutral vocabulary, spec 0047 R2) --

# Emit GitLab `rules:` entries for one capability's `trigger[]` list. The
# neutral kinds map to GitLab as:
#   pull-request → $CI_PIPELINE_SOURCE == "merge_request_event"
#   push         → $CI_PIPELINE_SOURCE == "push"
#   tag          → $CI_COMMIT_TAG
#   scheduled    → $CI_PIPELINE_SOURCE == "schedule"
#   manual       → `when: manual`
# `branches` filters add `&& $CI_COMMIT_BRANCH =~ /…/` (push) or
# `$CI_MERGE_REQUEST_TARGET_BRANCH_NAME =~ /…/` (pull-request). `paths` filters
# map to `changes:`. `tag-pattern` adds `&& $CI_COMMIT_TAG =~ /…/`.
emit_rules() {
  local id="$1"
  local n
  q_trigger_n "$id"; n=$Q

  echo "  rules:"
  local i
  for ((i = 0; i < n; i++)); do
    local kind
    q_kind "$id" "$i"; kind=$Q

    local cond=""
    case "$kind" in
      pull-request) cond='$CI_PIPELINE_SOURCE == "merge_request_event"' ;;
      push)         cond='$CI_PIPELINE_SOURCE == "push"' ;;
      tag)          cond='$CI_COMMIT_TAG' ;;
      scheduled)    cond='$CI_PIPELINE_SOURCE == "schedule"' ;;
      manual)       cond='' ;;
      *)
        echo "Error: capability '$id' has unknown trigger kind '$kind'." >&2
        exit 1
        ;;
    esac

    # Branch filter (push uses the commit branch; pull-request uses the MR
    # target branch). Translate each neutral branch glob to a GitLab regex.
    local branches
    q_branches "$id" "$i"; branches=$Q
    if [ -n "$branches" ]; then
      local branch_var
      case "$kind" in
        pull-request) branch_var='$CI_MERGE_REQUEST_TARGET_BRANCH_NAME' ;;
        *)            branch_var='$CI_COMMIT_BRANCH' ;;
      esac
      local regex=""
      local b
      while IFS= read -r b; do
        [ -z "$b" ] && continue
        # `main` → ^main$ ; `release/**` → ^release/ ; tolerate the glob form.
        # An interior `/` collides with the GitLab `/…/` regex delimiter, so
        # escape it to `\/`.
        local re
        if [[ "$b" == *'**'* ]]; then
          re="^${b%%\*\*}"
        else
          re="^${b}\$"
        fi
        re="${re//\//\\/}"
        if [ -z "$regex" ]; then regex="$re"; else regex="$regex|$re"; fi
      done <<< "$branches"
      if [ -n "$regex" ]; then
        cond="$cond && $branch_var =~ /$regex/"
      fi
    fi

    # Tag pattern filter.
    local tag_pattern
    q_tag_pattern "$id" "$i"; tag_pattern=$Q
    if [ -n "$tag_pattern" ] && [ "$tag_pattern" != "null" ]; then
      cond="$cond && \$CI_COMMIT_TAG =~ /$tag_pattern/"
    fi

    # Strip a leading ` && ` left when the kind contributed no base condition
    # (the `manual` case has no `$CI_…` predicate of its own).
    cond="${cond# && }"

    if [ -n "$cond" ]; then
      echo "    - if: '$cond'"
    elif [ "$kind" = "manual" ]; then
      echo "    - when: manual"
    fi

    # Path filter → changes:
    local paths
    q_paths "$id" "$i"; paths=$Q
    if [ -n "$paths" ]; then
      echo "      changes:"
      local p
      while IFS= read -r p; do
        [ -z "$p" ] && continue
        echo "        - \"$p\""
      done <<< "$paths"
    fi

    if [ "$kind" = "manual" ] && [ -n "$cond" ]; then
      echo "      when: manual"
    fi
  done
}

# --- Job emitter ------------------------------------------------------------

# Emit one GitLab job for one portable capability. The job key IS the
# capability id (C2 primary path). On the single-pass path the capability's
# record is consumed from the token stream first.
emit_job() {
  local id="$1"
  if [ "$FAST" = true ]; then read_entry; fi

  # `.requires.runtime` may be a bare scalar (every pre-existing capability)
  # or a list (a capability needing more than one runtime, e.g. `mempalace`:
  # python@3.12 + node@24) — normalized to one entry per line either way. The
  # FIRST entry becomes the job's Docker image (unchanged behaviour for every
  # scalar-only capability); any further entries are installed alongside it
  # in before_script, below.
  local runtimes
  q_runtimes "$id"; runtimes=$Q
  local primary_runtime secondary_runtimes=""
  primary_runtime=${runtimes%%$'\n'*}
  case $runtimes in
    *$'\n'*) secondary_runtimes=${runtimes#*$'\n'} ;;
  esac
  local image
  image=$(runtime_to_image "$primary_runtime")

  echo ""
  echo "$id:"
  echo "  image: $image"

  # history-depth: full → GIT_DEPTH "0" (clone full history, like GHA
  # fetch-depth: 0) so base-ref diffing checks resolve their base.
  local history_depth
  q_history_depth "$id"; history_depth=$Q
  local env_keys
  q_env_keys "$id"; env_keys=$Q

  if [ "$history_depth" = "full" ] || [ -n "$env_keys" ]; then
    echo "  variables:"
    if [ "$history_depth" = "full" ]; then
      echo "    GIT_DEPTH: \"0\""
    fi
    if [ -n "$env_keys" ]; then
      local ek ev
      while IFS= read -r ek; do
        [ -z "$ek" ] && continue
        q_env_value "$id" "$ek"; ev=$Q
        esc_dq "$ev"
        echo "    $ek: \"$ESC\""
      done <<< "$env_keys"
    fi
  fi

  # before_script: secondary-runtime and tool installs satisfying
  # requires.runtime (beyond the primary/image entry) and requires.tools.
  # The install lines are gathered via command substitution (NOT process
  # substitution) so that an unknown runtime or tool — for which the install
  # functions below have no recipe — propagates its non-zero exit to `set -e`
  # and fails the whole derivation closed (delta-02 Scenario 2: a command
  # needing an undeclared tool is rejected; the same now applies to a
  # secondary runtime). A `< <(...)` process substitution would swallow that
  # exit in a subshell.
  local tools
  q_tools "$id"; tools=$Q
  local before_lines=""
  if [ -n "$secondary_runtimes" ]; then
    local sr lines
    while IFS= read -r sr; do
      [ -z "$sr" ] && continue
      lines=$(secondary_runtime_install_lines "$sr")
      before_lines="${before_lines}${before_lines:+$'\n'}${lines}"
    done <<< "$secondary_runtimes"
  fi
  if [ -n "$tools" ]; then
    local t lines
    while IFS= read -r t; do
      [ -z "$t" ] && continue
      lines=$(tool_install_lines "$t")
      before_lines="${before_lines}${before_lines:+$'\n'}${lines}"
    done <<< "$tools"
  fi
  if [ -n "$before_lines" ]; then
    echo "  before_script:"
    local line
    while IFS= read -r line; do
      echo "    - $line"
    done <<< "$before_lines"
  fi

  # cache: persist the .ci-cache/ directory keyed from the declared cache
  # inputs (spec 0147 R6/R7). The reference declares the key-derivation NEED
  # (which files + which env vars the key is derived from); the GitLab
  # `cache:key:files` syntax is the mechanism and is never written back into
  # the reference. The cache-guard script (ci-cache-guard.sh) is the real
  # correctness gate — it recomputes the content-addressed key from ALL
  # declared files and re-executes on a miss even if the engine cache restores
  # a stale .ci-cache/.
  local cache_files cache_env cache_guard
  q_cache_files "$id"; cache_files=$Q
  q_cache_env "$id"; cache_env=$Q
  q_cache_guard "$id"; cache_guard=$Q
  [ -z "$cache_guard" ] && cache_guard=true
  if [ -n "$cache_files" ]; then
    echo "  cache:"
    echo "    key:"
    echo "      files:"
    local cf
    while IFS= read -r cf; do
      [ -z "$cf" ] && continue
      echo "        - \"$cf\""
    done <<< "$cache_files"
    echo "    paths:"
    echo "      - .ci-cache/"
  fi

  # script: the command list (delta-01 R10). A command entry may be a
  # multi-line block (the inline grep jobs); emit it as a single YAML
  # block scalar so the newlines survive. When the capability declares a
  # `cache:`, each hermetic `bash scripts/…` command is wrapped in the
  # cache-guard so a cache hit skips re-execution (R6) and a changed input
  # re-executes (R7). Setup commands (e.g. `python3 -m pip install …`) are
  # NOT wrapped: their side effects are not captured by the .ci-cache/ marker,
  # so skipping them on a hit would break a fresh environment.
  echo "  script:"
  local ncmds
  q_command_n "$id"; ncmds=$Q
  local j
  for ((j = 0; j < ncmds; j++)); do
    local cmd
    q_command "$id" "$j"; cmd=$Q
    # A command is multi-line iff it carries an INTERIOR newline. `yq -r` does
    # not append a trailing newline to a scalar, and `$(...)` strips any, so
    # any embedded newline marks a block.
    if [[ $cmd == *$'\n'* ]]; then
      # Multi-line command → literal block scalar.
      echo "    - |"
      while IFS= read -r line; do
        echo "        $line"
      done <<< "$cmd"
    else
      # Single-line command. Quote defensively (commands carry globs, quotes).
      local emitted="$cmd"
      if [ -n "$cache_files" ] && [ "$cache_guard" != "false" ]; then
        case "$cmd" in
          bash\ scripts/*)
            local files_csv env_csv
            files_csv=${cache_files//$'\n'/,}
            env_csv=${cache_env//$'\n'/,}
            emitted="bash scripts/ci-cache-guard.sh --cache-dir .ci-cache --key-files \"$files_csv\" --key-env \"$env_csv\" -- $cmd"
            ;;
        esac
      fi
      esc_dq "$emitted"
      echo "    - \"$ESC\""
    fi
  done

  emit_rules "$id"
}

# --- Pipeline generator -----------------------------------------------------

generate() {
  cat <<'HEADER'
# .gitlab-ci.yml — GENERATED by scripts/build-ci.sh from ci/ci-capabilities.yml.
#
# DO NOT EDIT BY HAND. This pipeline is the derived GitLab form of the portable
# subset of the platform-neutral CI capability reference (spec 0048). Each job
# key IS a capability id (contract C2); each job's `script:` is the capability's
# declared `command:` (delta-01 R10); each job's `image`/`before_script`/
# `GIT_DEPTH` is the GitLab boilerplate satisfying the capability's `requires:`
# (delta-02 R12). Engine-specific capabilities (Pages, Releases, bot mentions)
# are deliberately absent — they stay hand-authored per engine (spec 0048 R4).
#
# To change a job, edit ci/ci-capabilities.yml and run:
#   bash scripts/build-ci.sh
# CI verifies this file is in sync via:
#   bash scripts/build-ci.sh --check
HEADER

  # Run merge-request and branch pipelines, but never duplicate a pipeline for
  # a branch that also has an open MR (standard GitLab workflow:rules idiom).
  cat <<'WORKFLOW'

workflow:
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
    - if: '$CI_COMMIT_BRANCH && $CI_OPEN_MERGE_REQUESTS'
      when: never
    - if: '$CI_COMMIT_BRANCH'
WORKFLOW

  local id k
  if decode_reference; then
    FAST=true
    for ((k = 0; k < PID_N; k++)); do
      id=${PID[k]}
      [ -z "$id" ] && continue
      emit_job "$id"
    done
  else
    FAST=false
    while IFS= read -r id; do
      [ -z "$id" ] && continue
      emit_job "$id"
    done < <(yq -r '.capabilities[] | select(.portability == "portable") | .id' "$REFERENCE")
  fi
}

# --- Main -------------------------------------------------------------------

if [ "$CHECK_MODE" = true ]; then
  tmp="$(mktemp -t crewrig-gitlab-ci.XXXXXX)"
  trap 'rm -f "$tmp"' EXIT
  generate > "$tmp"
  if [ ! -f "$OUTPUT" ]; then
    echo "DRIFT: $OUTPUT does not exist (expected from ci/ci-capabilities.yml)" >&2
    echo "FAILED: run 'bash scripts/build-ci.sh' to generate it." >&2
    exit 1
  fi
  if ! diff -q "$tmp" "$OUTPUT" >/dev/null 2>&1; then
    echo "DRIFT: $OUTPUT differs from a fresh derivation of ci/ci-capabilities.yml" >&2
    echo "" >&2
    diff "$OUTPUT" "$tmp" >&2 || true
    echo "" >&2
    echo "FAILED: run 'bash scripts/build-ci.sh' to regenerate the GitLab pipeline." >&2
    exit 1
  fi
  echo "OK: .gitlab-ci.yml matches the CI capability reference."
else
  tmp_out="$(mktemp "${OUTPUT}.tmp.XXXXXX")"
  trap 'rm -f "$tmp_out"' EXIT
  generate > "$tmp_out"
  mv "$tmp_out" "$OUTPUT"
  trap - EXIT
  echo "Generated: $OUTPUT"
fi
