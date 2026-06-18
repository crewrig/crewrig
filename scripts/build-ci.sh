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
#              scripts/build-extension-pivot.sh --check.
#
# Prerequisites: yq (mikefarah v4).

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
    *)
      echo "Error: unknown tool '$tool' — no GitLab install recipe (delta-02 Scenario 2)." >&2
      exit 1
      ;;
  esac
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
  n=$(yq ".capabilities[] | select(.id == \"$id\") | .trigger | length" "$REFERENCE")

  echo "  rules:"
  local i
  for ((i = 0; i < n; i++)); do
    local kind
    kind=$(yq ".capabilities[] | select(.id == \"$id\") | .trigger[$i].on" "$REFERENCE")

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
    branches=$(yq -r ".capabilities[] | select(.id == \"$id\") | .trigger[$i].branches // [] | .[]" "$REFERENCE")
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
    tag_pattern=$(yq -r ".capabilities[] | select(.id == \"$id\") | .trigger[$i].tag-pattern // \"\"" "$REFERENCE")
    if [ -n "$tag_pattern" ] && [ "$tag_pattern" != "null" ]; then
      cond="$cond && \$CI_COMMIT_TAG =~ /$tag_pattern/"
    fi

    # Strip a leading ` && ` left when the kind contributed no base condition
    # (the `manual` case has no `$CI_…` predicate of its own).
    cond="${cond# && }"

    echo "    - if: '$cond'"

    # Path filter → changes:
    local paths
    paths=$(yq -r ".capabilities[] | select(.id == \"$id\") | .trigger[$i].paths // [] | .[]" "$REFERENCE")
    if [ -n "$paths" ]; then
      echo "      changes:"
      local p
      while IFS= read -r p; do
        [ -z "$p" ] && continue
        echo "        - \"$p\""
      done <<< "$paths"
    fi

    if [ "$kind" = "manual" ]; then
      echo "      when: manual"
    fi
  done
}

# --- Job emitter ------------------------------------------------------------

# Emit one GitLab job for one portable capability. The job key IS the
# capability id (C2 primary path).
emit_job() {
  local id="$1"

  local runtime
  runtime=$(yq -r ".capabilities[] | select(.id == \"$id\") | .requires.runtime // \"\"" "$REFERENCE")
  local image
  image=$(runtime_to_image "$runtime")

  echo ""
  echo "$id:"
  echo "  image: $image"

  # history-depth: full → GIT_DEPTH "0" (clone full history, like GHA
  # fetch-depth: 0) so base-ref diffing checks resolve their base.
  local history_depth
  history_depth=$(yq -r ".capabilities[] | select(.id == \"$id\") | .requires.history-depth // \"\"" "$REFERENCE")
  if [ "$history_depth" = "full" ]; then
    echo "  variables:"
    echo "    GIT_DEPTH: \"0\""
  fi

  # before_script: tool installs satisfying requires.tools.
  # The install lines are gathered via command substitution (NOT process
  # substitution) so that an unknown tool — for which tool_install_lines has
  # no recipe — propagates its non-zero exit to `set -e` and fails the whole
  # derivation closed (delta-02 Scenario 2: a command needing an undeclared
  # tool is rejected). A `< <(...)` process substitution would swallow that
  # exit in a subshell.
  local tools
  tools=$(yq -r ".capabilities[] | select(.id == \"$id\") | .requires.tools // [] | .[]" "$REFERENCE")
  if [ -n "$tools" ]; then
    local before_lines=""
    local t lines
    while IFS= read -r t; do
      [ -z "$t" ] && continue
      lines=$(tool_install_lines "$t")
      before_lines="${before_lines}${before_lines:+$'\n'}${lines}"
    done <<< "$tools"
    echo "  before_script:"
    local line
    while IFS= read -r line; do
      echo "    - $line"
    done <<< "$before_lines"
  fi

  # script: the command list (delta-01 R10). A command entry may be a
  # multi-line block (the inline grep jobs); emit it as a single YAML
  # block scalar so the newlines survive.
  echo "  script:"
  local ncmds
  ncmds=$(yq ".capabilities[] | select(.id == \"$id\") | .command | length" "$REFERENCE")
  local j
  for ((j = 0; j < ncmds; j++)); do
    local cmd
    cmd=$(yq -r ".capabilities[] | select(.id == \"$id\") | .command[$j]" "$REFERENCE")
    # A command is multi-line iff it carries an INTERIOR newline. `yq -r` does
    # not append a trailing newline to a scalar, and `$(...)` strips any, so a
    # `grep -c` count > 1 (or any embedded newline) marks a block.
    if [ "$(printf '%s' "$cmd" | wc -l | tr -d ' ')" -gt 0 ]; then
      # Multi-line command → literal block scalar.
      echo "    - |"
      printf '%s\n' "$cmd" | while IFS= read -r line; do
        echo "        $line"
      done
    else
      # Single-line command. Quote defensively (commands carry globs, quotes).
      echo "    - \"$(printf '%s' "$cmd" | sed 's/\\/\\\\/g; s/"/\\"/g')\""
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

  local id
  while IFS= read -r id; do
    [ -z "$id" ] && continue
    emit_job "$id"
  done < <(yq -r '.capabilities[] | select(.portability == "portable") | .id' "$REFERENCE")
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
  generate > "$OUTPUT"
  echo "Generated: $OUTPUT"
fi
