#!/bin/bash
# build-components.sh — Build community components for Gemini CLI, Claude Code, and/or GitHub Copilot CLI
#
# Usage:
#   bash scripts/build-components.sh [--target gemini|claude|copilot|all] [--check]
#
# Options:
#   --target   Which tool to generate for (default: all)
#   --check    Verify generated files match source (drift detection, for CI)
#
# Prerequisites: yq, jq

set -euo pipefail

REPO_DIR="${REPO_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
ARTIFACTS_DIR="$REPO_DIR/artifacts"
# Build/install scope separation (ADR-0011, spec 0019):
#   The build is tier-agnostic — it discovers and compiles every tier
#   directory present under artifacts/ (core, library, community, org, and
#   any tier added later), with no hardcoded tier list.
#   Output routing depends on the tier (see output_root_for_tier):
#     core     — written into the committed project tree (.claude/, .gemini/,
#                .github/); installed automatically because it ships with the
#                repo.
#     non-core — written into the gitignored staging tree dist/<tier>/, from
#                which the interactive setup scripts install to the user home
#                (library automatically; community and org on opt-in).
#   Building a component is independent of installing it: a successful build
#   never installs a non-core component anywhere but dist/.
TARGET="all"
CHECK_MODE=false

# --- Parse arguments ---
# Note: do not seed TARGET from $1. The previous form `TARGET="${1:-all}"`
# silently set TARGET to `--check` when invoked as `bash ... --check`,
# which made every later `[ "$TARGET" = "all" ]` test fail and turned the
# whole --check mode into a silent no-op.
while [[ $# -gt 0 ]]; do
  case "$1" in
    --target) TARGET="$2"; shift 2 ;;
    --check)  CHECK_MODE=true; shift ;;
    *)        shift ;;
  esac
done

# --- Prerequisites ---
command -v yq >/dev/null 2>&1 || { echo "Error: yq is required. Install with: brew install yq"; exit 1; }

# --- Shared command renderer (spec 0042) ---
# build_commands() below delegates the pivot-source → consumed-form render to
# the shared library so the extension renderer (scripts/build-extension-pivot.sh)
# and the Claude plugin builder use the exact same logic. The library guards its
# helper definitions (extract_frontmatter/extract_body/yaml_field), so the
# versions defined later in THIS file win and the artifacts/ output stays
# byte-identical.
# shellcheck source=lib/render-command.sh
. "$(dirname "$0")/lib/render-command.sh"

DRIFT_FOUND=false

# --- Crewrig fork configuration ---
# Reads crewrig.config.toml at the repo root. Each `key = "value"` line becomes
# a CFG_<UPPERCASED_KEY> shell variable, and the placeholder ${UPPERCASED_KEY}
# in component sources resolves to its value at build time. Forks edit this
# file to redirect provenance/feedback URLs without touching the components.
CFG_KEYS=""
load_crewrig_config() {
  local config="$REPO_DIR/crewrig.config.toml"
  if [ ! -f "$config" ]; then
    echo "Warning: $config not found — placeholders will be left literal." >&2
    return 0
  fi
  while IFS='=' read -r raw_key raw_value; do
    local key
    key=$(printf '%s' "$raw_key" | tr -d '[:space:]')
    [ -z "$key" ] && continue
    case "$key" in \#*) continue ;; esac
    local value
    value=$(printf '%s' "$raw_value" | sed -E 's/^[[:space:]]*"?//; s/"?[[:space:]]*$//')
    local upper
    upper=$(printf '%s' "$key" | tr '[:lower:]' '[:upper:]')
    printf -v "CFG_${upper}" '%s' "$value"
    CFG_KEYS="$CFG_KEYS $upper"
  done < "$config"
}

# Substitute ${KEY} placeholders in `content` with values loaded above.
# Sed-special characters in the value (`&`, `\`, `|`) are escaped first.
# Escaping the literal `\` is what protects against backreferences too:
# a value of `\1` becomes `\\1` after the escape, which sed reads as a
# literal backslash followed by `1` — not a backref. Bash 5.2+ builtin
# substitution `${var//pat/repl}` would have its own `&`-as-match trap
# that does not exist on bash 3.2 (macOS default), so sed is portable.
resolve_placeholders() {
  local content="$1"
  local key
  for key in $CFG_KEYS; do
    local var_name="CFG_${key}"
    local value="${!var_name}"
    local escaped
    escaped=$(printf '%s' "$value" | sed -e 's/[&\\|]/\\&/g')
    content=$(printf '%s' "$content" | sed "s|\${${key}}|${escaped}|g")
  done
  printf '%s' "$content"
}

load_crewrig_config

validate_canonical_repo() {
  local repo="${CFG_CANONICAL_REPO:-}"
  [ -z "$repo" ] && return 0   # placeholder absent → resolve_placeholders leaves ${CANONICAL_REPO} literal; not our concern
  if [[ ! "$repo" =~ ^https://[^/[:space:]]+/[^/[:space:]]+/[^/[:space:]]+/?$ ]]; then
    echo "Error: canonical_repo in crewrig.config.toml is malformed: '$repo'" >&2
    echo "Expected: https://<host>/<owner>/<repo> (no deeper path, no file:// scheme)" >&2
    exit 1
  fi
}
validate_canonical_repo

# --- Provenance propagation ---
# Components may declare a `metadata.provenance:` block in their source
# frontmatter. This block must travel to every output that supports YAML
# frontmatter, so installers and the harness curator can read where the
# component came from. The build only natively copies name+description, so we
# inject the `metadata:` wrapper explicitly at the bottom of the output
# frontmatter.
#
# Schema note: provenance lives under `metadata:` to keep the root
# frontmatter restricted to fields recognized by the agentskills.io spec
# (`name`, `description`, `license`, `compatibility`, `metadata`,
# `allowed-tools`).

# Returns the YAML block (top-level `metadata:` with a nested `provenance:`)
# ready to splice into a frontmatter, or empty if `frontmatter` (already
# extracted) has no `metadata.provenance` key.
# Takes the frontmatter as input so callers can reuse a single extraction.
provenance_block() {
  local frontmatter="$1"
  local has_prov
  has_prov=$(printf '%s\n' "$frontmatter" | yq -r '.metadata // {} | has("provenance")' 2>/dev/null || echo "false")
  if [ "$has_prov" != "true" ]; then
    return 0
  fi
  printf 'metadata:\n'
  printf '  provenance:\n'
  printf '%s\n' "$frontmatter" \
    | yq -r '.metadata.provenance | to_entries | .[] | "    " + .key + ": \"" + .value + "\""' 2>/dev/null
}

# Returns a single-line HTML comment carrying provenance, or empty if the
# frontmatter has no `metadata.provenance` key. Used for Gemini agents,
# whose CLI 0.42.0+ rejects any frontmatter key outside `name`/`description`
# — so the provenance has to travel in the body instead. The comment is
# stable, greppable, and ignored by Markdown renderers.
gemini_provenance_comment() {
  local frontmatter="$1"
  local has_prov
  has_prov=$(printf '%s\n' "$frontmatter" | yq -r '.metadata // {} | has("provenance")' 2>/dev/null || echo "false")
  if [ "$has_prov" != "true" ]; then
    return 0
  fi
  local version canonical feedback
  version=$(printf '%s\n' "$frontmatter" | yq -r '.metadata.provenance.version // ""' 2>/dev/null)
  canonical=$(printf '%s\n' "$frontmatter" | yq -r '.metadata.provenance.canonical // ""' 2>/dev/null)
  feedback=$(printf '%s\n' "$frontmatter" | yq -r '.metadata.provenance.feedback // ""' 2>/dev/null)
  printf '<!-- crewrig-provenance: version="%s" canonical="%s" feedback="%s" -->\n' \
    "$version" "$canonical" "$feedback"
}

# Splice a provenance block before the closing `---` of the first frontmatter
# of `content`. No-op if the source has no provenance.
# Uses a tempfile to feed multi-line provenance into awk — BSD awk does not
# accept newlines in `-v var=...`, so we read the block via getline instead.
#
# Coordination note: the spliced block emits a full top-level `metadata:`
# key (with `provenance:` nested under it). If a future build path also
# needs to emit `metadata.*` fields into the output frontmatter, it must
# merge with this splice rather than emit a second `metadata:` key — YAML
# does not allow duplicate top-level mappings.
inject_provenance() {
  local content="$1"
  local source="$2"
  local frontmatter
  frontmatter=$(extract_frontmatter "$source")
  local prov
  prov=$(provenance_block "$frontmatter")
  if [ -z "$prov" ]; then
    printf '%s' "$content"
    return 0
  fi
  local prov_file
  prov_file=$(mktemp -t crewrig-prov.XXXXXX)
  printf '%s\n' "$prov" > "$prov_file"
  printf '%s' "$content" | awk -v provfile="$prov_file" '
    BEGIN {
      while ((getline line < provfile) > 0) {
        prov = (prov == "" ? line : prov "\n" line)
      }
      close(provfile)
      c = 0; injected = 0
    }
    /^---$/ {
      c++
      if (c == 2 && !injected) {
        print prov
        injected = 1
      }
    }
    { print }
  '
  rm -f "$prov_file"
}

# --- Helpers ---

# Extract YAML frontmatter from a Markdown file (between first two ---)
extract_frontmatter() {
  awk 'NR==1 && /^---$/{inblk=1; next} inblk && /^---$/{exit} inblk{print}' "$1"
}

# Extract body from a Markdown file (everything after second ---)
extract_body() {
  sed '1,/^---$/!d' "$1" | wc -l > /dev/null  # skip first ---
  awk 'BEGIN{c=0} /^---$/{c++; if(c==2){found=1; next}} found{print}' "$1"
}

# Read a YAML field from frontmatter
yaml_field() {
  local file="$1" field="$2"
  extract_frontmatter "$file" | yq -r ".$field" 2>/dev/null || echo ""
}

# Read a nested YAML field
yaml_nested() {
  local file="$1" field="$2"
  local result
  result=$(extract_frontmatter "$file" | yq -r "$field" 2>/dev/null)
  if [ "$result" = "null" ] || [ -z "$result" ]; then
    echo ""
  else
    echo "$result"
  fi
}

# Per-tier drift-compare switch, set by the main build loop. In CHECK_MODE
# only `core` outputs are committed, so only `core` is drift-compared; non-core
# tiers compile into a throwaway staging root and take the write branch below
# (compile-and-discard) so R10's "check every tier it builds" still holds
# without comparing against a non-existent committed dist/.
CHECK_COMPARE=true

# Compare file with expected content, report drift.
# When a source path is passed as $3, splices any `provenance:` block from
# that source into the output frontmatter before resolving placeholders.
check_or_write() {
  local target_file="$1"
  local content="$2"
  local source="${3:-}"

  if [ -n "$source" ]; then
    content=$(inject_provenance "$content" "$source")
  fi
  content=$(resolve_placeholders "$content")

  if [ "$CHECK_MODE" = true ] && [ "$CHECK_COMPARE" = true ]; then
    if [ ! -f "$target_file" ]; then
      echo "DRIFT: $target_file does not exist (expected from source)"
      DRIFT_FOUND=true
      return
    fi
    if ! echo "$content" | diff -q - "$target_file" >/dev/null 2>&1; then
      echo "DRIFT: $target_file differs from source"
      DRIFT_FOUND=true
      return
    fi
  else
    mkdir -p "$(dirname "$target_file")"
    echo "$content" > "$target_file"
    echo "  Generated: $target_file"
  fi
}

# Copy the spec-recognized skill resource subfolders (`scripts/`,
# `references/`, `assets/` per https://agentskills.io/specification)
# verbatim from source to target. Respects --check mode the same way
# check_or_write does. Preserves the executable bit so packaged scripts
# stay runnable after install.
propagate_skill_resources() {
  local src_dir="$1"
  local target_dir="$2"
  local subdir src_sub src_file rel target_file
  for subdir in scripts references assets; do
    src_sub="$src_dir/$subdir"
    [ -d "$src_sub" ] || continue
    while IFS= read -r src_file; do
      rel="${src_file#"$src_sub"/}"
      target_file="$target_dir/$subdir/$rel"
      if [ "$CHECK_MODE" = true ] && [ "$CHECK_COMPARE" = true ]; then
        if [ ! -f "$target_file" ]; then
          echo "DRIFT: $target_file does not exist (expected from source)"
          DRIFT_FOUND=true
          continue
        fi
        if ! cmp -s "$src_file" "$target_file"; then
          echo "DRIFT: $target_file differs from source"
          DRIFT_FOUND=true
          continue
        fi
      else
        mkdir -p "$(dirname "$target_file")"
        cp "$src_file" "$target_file"
        [ -x "$src_file" ] && chmod +x "$target_file"
        echo "  Generated: $target_file"
      fi
    done < <(find "$src_sub" -type f | sort)
  done
}

# --- Tier discovery and output routing (ADR-0011, spec 0019) ---

# Discover every tier present under artifacts/. A tier is a subdirectory of
# artifacts/ (the trailing-slash glob ignores artifacts/FORMAT.md, a file).
# Echoes one tier name per line. Adding a new tier directory needs no edit
# here — the build picks it up automatically.
discover_tiers() {
  local tier_path tier_name
  for tier_path in "$ARTIFACTS_DIR"/*/; do
    [ -d "$tier_path" ] || continue
    tier_name="$(basename "$tier_path")"
    echo "$tier_name"
  done
}

# Map a tier name to the root directory its compiled output is written under.
#   core     -> $REPO_DIR             (committed project tree: .claude/ etc.)
#   non-core -> $REPO_DIR/dist/<tier> (gitignored staging tree)
# The setup scripts read the non-core roots when installing to the user home.
#
# --check exception: only `core` outputs are committed (they live in the
# project tree). Non-core tiers route to the gitignored dist/, which is absent
# on a clean checkout — there is nothing to drift-compare. But R10 requires
# --check to compile every tier it builds (to catch build/transform errors).
# So in CHECK_MODE non-core tiers resolve to a throwaway temp root, forcing
# them through the write path (compile + discard) instead of the compare path
# against a non-existent dist/. CHECK_STAGING_ROOT is initialized once in the
# main flow (not here — this function runs inside `$(...)` subshells, so a
# global assigned here would not survive to the parent) and removed on exit.
CHECK_STAGING_ROOT=""
cleanup_check_staging() {
  # Must return 0: under `set -e`, a non-zero exit from an EXIT trap becomes
  # the script's exit status. A bare `[ -n "" ] && rm` would exit 1 when the
  # staging root was never created (normal build), failing the whole build.
  [ -n "$CHECK_STAGING_ROOT" ] && rm -rf "$CHECK_STAGING_ROOT"
  return 0
}
trap cleanup_check_staging EXIT
output_root_for_tier() {
  local tier="$1"
  if [ "$tier" = "core" ]; then
    echo "$REPO_DIR"
  elif [ "$CHECK_MODE" = true ]; then
    echo "$CHECK_STAGING_ROOT/$tier"
  else
    echo "$REPO_DIR/dist/$tier"
  fi
}

# --- Build Skills ---
# Compiles every skill in one tier into the tier's output root.
build_skills() {
  local tier="$1"
  local tier_dir="$2"
  local out_root
  out_root="$(output_root_for_tier "$tier")"
  local skills_dir="$tier_dir/skills"

  [ ! -d "$skills_dir" ] && return
  for skill_dir in "$skills_dir"/*/; do
    [ ! -d "$skill_dir" ] && continue
    local source="$skill_dir/SKILL.md"
    [ ! -f "$source" ] && continue

    local name
    name=$(yaml_field "$source" "name")
    local description
    description=$(yaml_field "$source" "description")
    local body
    body=$(extract_body "$source")

    [ -z "$name" ] && { echo "Warning: $source missing 'name' field, skipping"; continue; }

    echo "Building skill: $name"

    # --- Gemini CLI output ---
    if [ "$TARGET" = "gemini" ] || [ "$TARGET" = "all" ]; then
      local license compatibility
      license=$(yaml_field "$source" "license")
      compatibility=$(yaml_field "$source" "compatibility")

      local gemini_frontmatter="name: $name
description: \"$description\""
      if [ -n "$license" ] && [ "$license" != "null" ]; then
        gemini_frontmatter="$gemini_frontmatter
license: $license"
      fi
      if [ -n "$compatibility" ] && [ "$compatibility" != "null" ]; then
        gemini_frontmatter="$gemini_frontmatter
compatibility: \"$compatibility\""
      fi

      local gemini_content
      gemini_content=$(cat <<GEMINI_EOF
---
$gemini_frontmatter
---

$body
GEMINI_EOF
      )
      check_or_write "$out_root/.gemini/skills/$name/SKILL.md" "$gemini_content" "$source"
      propagate_skill_resources "$skill_dir" "$out_root/.gemini/skills/$name"
    fi

    # --- Claude Code output ---
    if [ "$TARGET" = "claude" ] || [ "$TARGET" = "all" ]; then
      local claude_frontmatter="name: $name
description: \"$description\""

      local license compatibility
      license=$(yaml_field "$source" "license")
      compatibility=$(yaml_field "$source" "compatibility")
      if [ -n "$license" ] && [ "$license" != "null" ]; then
        claude_frontmatter="$claude_frontmatter
license: $license"
      fi
      if [ -n "$compatibility" ] && [ "$compatibility" != "null" ]; then
        claude_frontmatter="$claude_frontmatter
compatibility: \"$compatibility\""
      fi

      # Add Claude-specific fields if present
      local allowed_tools
      allowed_tools=$(extract_frontmatter "$source" | yq -r '.claude.allowed-tools // [] | .[]' 2>/dev/null)
      if [ -n "$allowed_tools" ]; then
        claude_frontmatter="$claude_frontmatter
allowed-tools:"
        while IFS= read -r tool; do
          claude_frontmatter="$claude_frontmatter
  - $tool"
        done <<< "$allowed_tools"
      fi

      local user_invocable
      user_invocable=$(yaml_nested "$source" '.claude.user-invocable')
      if [ -n "$user_invocable" ]; then
        claude_frontmatter="$claude_frontmatter
user-invocable: $user_invocable"
      fi

      local disable_model
      disable_model=$(yaml_nested "$source" '.claude.disable-model-invocation')
      if [ -n "$disable_model" ]; then
        claude_frontmatter="$claude_frontmatter
disable-model-invocation: $disable_model"
      fi

      local context
      context=$(yaml_nested "$source" '.claude.context')
      if [ -n "$context" ]; then
        claude_frontmatter="$claude_frontmatter
context: $context"
      fi

      local agent
      agent=$(yaml_nested "$source" '.claude.agent')
      if [ -n "$agent" ]; then
        claude_frontmatter="$claude_frontmatter
agent: $agent"
      fi

      local claude_content
      claude_content=$(cat <<CLAUDE_EOF
---
$claude_frontmatter
---

$body
CLAUDE_EOF
      )
      check_or_write "$out_root/.claude/skills/$name/SKILL.md" "$claude_content" "$source"
      propagate_skill_resources "$skill_dir" "$out_root/.claude/skills/$name"
    fi

    # --- GitHub Copilot CLI output (Agent Skills standard) ---
    # Copilot loads skills from .github/skills/<name>/SKILL.md. Frontmatter
    # is the open agentskills.io shape — same shape we produce for Gemini.
    if [ "$TARGET" = "copilot" ] || [ "$TARGET" = "all" ]; then
      local license compatibility
      license=$(yaml_field "$source" "license")
      compatibility=$(yaml_field "$source" "compatibility")

      local copilot_frontmatter="name: $name
description: \"$description\""
      if [ -n "$license" ] && [ "$license" != "null" ]; then
        copilot_frontmatter="$copilot_frontmatter
license: $license"
      fi
      if [ -n "$compatibility" ] && [ "$compatibility" != "null" ]; then
        copilot_frontmatter="$copilot_frontmatter
compatibility: \"$compatibility\""
      fi

      local copilot_content
      copilot_content=$(cat <<COPILOT_EOF
---
$copilot_frontmatter
---

$body
COPILOT_EOF
      )
      check_or_write "$out_root/.github/skills/$name/SKILL.md" "$copilot_content" "$source"
      propagate_skill_resources "$skill_dir" "$out_root/.github/skills/$name"
    fi
  done
}

# --- Build Commands ---
# Compiles every command in one tier into the tier's output root.
build_commands() {
  local tier="$1"
  local tier_dir="$2"
  local out_root
  out_root="$(output_root_for_tier "$tier")"
  local commands_dir="$tier_dir/commands"

  [ ! -d "$commands_dir" ] && return

  for source in "$commands_dir"/*.md; do
    [ ! -f "$source" ] && continue

    local name
    name=$(yaml_field "$source" "name")
    local description
    description=$(yaml_field "$source" "description")
    local body
    body=$(extract_body "$source")

    [ -z "$name" ] && { echo "Warning: $source missing 'name' field, skipping"; continue; }

    echo "Building command: $name"

    # --- Gemini CLI output: TOML ---
    # Rendered by the shared command library (spec 0042). For artifacts/ commands
    # — which carry no metadata.provenance today — the output is byte-identical
    # to the prior inline emitter.
    if [ "$TARGET" = "gemini" ] || [ "$TARGET" = "all" ]; then
      local toml_content
      toml_content=$(render_command_gemini "$source")
      check_or_write "$out_root/.gemini/commands/$name.toml" "$toml_content" "$source"
    fi

    # --- Claude Code output: SKILL.md ---
    # Rendered by the shared command library (spec 0042). Provenance, when
    # present, is spliced into the Markdown frontmatter by check_or_write
    # (inject_provenance), exactly as before.
    if [ "$TARGET" = "claude" ] || [ "$TARGET" = "all" ]; then
      local claude_content
      claude_content=$(render_command_claude "$source")
      check_or_write "$out_root/.claude/skills/$name/SKILL.md" "$claude_content" "$source"
    fi

    # --- GitHub Copilot CLI output: SKILL.md (commands compile as skills) ---
    # Copilot has no first-class slash-command file format. Every CrewRig
    # command compiles as a user-invocable skill under .github/skills/.
    if [ "$TARGET" = "copilot" ] || [ "$TARGET" = "all" ]; then
      local copilot_frontmatter="name: $name
description: \"$description\""

      local allowed_tools
      allowed_tools=$(extract_frontmatter "$source" | yq -r '.claude.allowed-tools // [] | .[]' 2>/dev/null)
      if [ -n "$allowed_tools" ]; then
        copilot_frontmatter="$copilot_frontmatter
allowed-tools:"
        while IFS= read -r tool; do
          copilot_frontmatter="$copilot_frontmatter
  - $tool"
        done <<< "$allowed_tools"
      fi

      local copilot_content
      copilot_content=$(cat <<COPILOT_EOF
---
$copilot_frontmatter
---

$body
COPILOT_EOF
      )
      check_or_write "$out_root/.github/skills/$name/SKILL.md" "$copilot_content" "$source"
    fi
  done
}

# --- Build Agents ---
# Compiles every agent in one tier into the tier's output root.
build_agents() {
  local tier="$1"
  local tier_dir="$2"
  local out_root
  out_root="$(output_root_for_tier "$tier")"
  local agents_dir="$tier_dir/agents"

  [ ! -d "$agents_dir" ] && return
  for agent_dir in "$agents_dir"/*/; do
    [ ! -d "$agent_dir" ] && continue
    local source="$agent_dir/AGENT.md"
    [ ! -f "$source" ] && continue

    local name
    name=$(yaml_field "$source" "name")
    local description
    description=$(yaml_field "$source" "description")
    local body
    body=$(extract_body "$source")

    [ -z "$name" ] && { echo "Warning: $source missing 'name' field, skipping"; continue; }

    echo "Building agent: $name"

    # --- Gemini CLI output: <name>.md (flat file with YAML frontmatter) ---
    # Per https://geminicli.com/docs/core/subagents/#creating-custom-subagents
    # Gemini CLI requires a flat `.gemini/agents/<name>.md` file whose
    # frontmatter declares `name` and `description` (required) and optional
    # `tools`, `model`, etc. The body becomes the system prompt. A directory
    # layout or a frontmatter-less body is not discovered.
    if [ "$TARGET" = "gemini" ] || [ "$TARGET" = "all" ]; then
      # Gemini CLI 0.42.0+ rejects any frontmatter key outside `name` /
      # `description`. Provenance therefore travels as an HTML comment at
      # the top of the body — see gemini_provenance_comment() and the
      # "Agent provenance" row in docs/cli-matrix.md.
      local gemini_source_frontmatter
      gemini_source_frontmatter=$(extract_frontmatter "$source")
      local gemini_prov_comment
      gemini_prov_comment=$(gemini_provenance_comment "$gemini_source_frontmatter")
      local gemini_content
      gemini_content=$(cat <<GEMINI_EOF
---
name: $name
description: "$description"
---
$gemini_prov_comment
$body
GEMINI_EOF
      )
      # NOTE: no $source arg — we intentionally bypass inject_provenance
      # so the `metadata:` YAML block does NOT land in the frontmatter.
      check_or_write "$out_root/.gemini/agents/$name.md" "$gemini_content"
    fi

    # --- Claude Code output: AGENT.md (with frontmatter) ---
    if [ "$TARGET" = "claude" ] || [ "$TARGET" = "all" ]; then
      local claude_content
      claude_content=$(cat <<CLAUDE_EOF
---
name: $name
description: "$description"
---

$body
CLAUDE_EOF
      )
      check_or_write "$out_root/.claude/agents/$name/AGENT.md" "$claude_content" "$source"
    fi

    # --- GitHub Copilot CLI output: <name>.md (flat file, by parallelism with Gemini) ---
    # [GAP-confirmation] — repo-level agent file convention is not in the
    # public Copilot reference. We adopt .github/agents/<name>.md mirroring
    # the skill layout. See docs/cli-matrix.md and the ADR.
    if [ "$TARGET" = "copilot" ] || [ "$TARGET" = "all" ]; then
      local copilot_content
      copilot_content=$(cat <<COPILOT_EOF
---
name: $name
description: "$description"
---

$body
COPILOT_EOF
      )
      check_or_write "$out_root/.github/agents/$name.md" "$copilot_content" "$source"
    fi
  done
}

# --- Main ---
echo "========================================="
echo "  Community Component Builder"
echo "  Target: $TARGET"
if [ "$CHECK_MODE" = true ]; then
  echo "  Mode: CHECK (drift detection)"
else
  echo "  Mode: BUILD (generate files)"
fi
echo "========================================="
echo ""

# In CHECK_MODE, non-core tiers compile into a throwaway staging root (see
# output_root_for_tier). Create it once here so every tier shares the same
# directory and the EXIT trap can clean it up.
if [ "$CHECK_MODE" = true ]; then
  CHECK_STAGING_ROOT=$(mktemp -d -t crewrig-check-staging.XXXXXX)
fi

# Iterate every discovered tier. Build and --check share this loop, so drift
# detection automatically covers every tier the build compiles (R10).
while IFS= read -r tier; do
  [ -z "$tier" ] && continue
  tier_dir="$ARTIFACTS_DIR/$tier"
  # In CHECK_MODE, drift-compare only `core` (the sole committed tier); non-core
  # tiers compile into the throwaway staging root and take the write branch.
  if [ "$tier" = "core" ]; then CHECK_COMPARE=true; else CHECK_COMPARE=false; fi
  echo "--- Tier: $tier (output root: $(output_root_for_tier "$tier")) ---"
  build_skills   "$tier" "$tier_dir"
  build_commands "$tier" "$tier_dir"
  build_agents   "$tier" "$tier_dir"
done < <(discover_tiers)

echo ""
if [ "$CHECK_MODE" = true ]; then
  bash "$(dirname "$0")/tests/test-assembly-verification.sh" || exit 1
  if [ "$DRIFT_FOUND" = true ]; then
    echo "FAILED: Drift detected. Run 'bash scripts/build-components.sh' to regenerate."
    exit 1
  else
    echo "OK: All generated files match source."
    exit 0
  fi
else
  echo "Done."
fi
