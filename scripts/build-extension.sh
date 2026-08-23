#!/usr/bin/env bash
# build-extension.sh — The single render entry point for the generic extension
# declaration model (spec 0173, as amended by
# specs/0173-extension-declaration-model.delta-01.md).
#
# Walks an extension's declarations in `extension.json` and produces every
# CLI-native file for all four supported command-line tools. NOTHING
# generated is committed on the primary branch (0173Δ R7): every output lands
# in a build directory outside the committed source tree.
#
#   - Gemini CLI (the tool that loads an extension in place): rendered into
#     build/extensions/<name>/ as a COMPLETE installable tree — the verbatim
#     source tree plus the rendered gemini-extension.json and commands/*.toml
#     — because that tree is what install-extension.sh installs or links
#     (spec 0173Δ R20/R22).
#   - Claude Code, GitHub Copilot CLI, Antigravity CLI (tools that build a
#     plugin): delegated unchanged to their existing per-CLI builders
#     (scripts/build-{claude,copilot,antigravity}-*.sh), which keep their own
#     ephemeral output roots (dist-claude-plugin/, dist-copilot-plugin/,
#     dist-antigravity-plugin/) — spec 0173 R6/R7.
#
# `--check` (0173Δ R10) asserts, for every discovered extension:
#   (a) COMMITTED  — no file of the generated-output class
#       (scripts/lib/extension-generated-class.json) is committed anywhere in
#       the extension's SOURCE tree.
#   (b) RENDER-FAIL — a fresh --target all render succeeds.
#   (c) MISSING/UNDECLARED — the Gemini build tree's generated-class members
#       equal exactly the declared output set (the in-place target only —
#       the one target whose output set is enumerable independently of the
#       declarations; the plugin targets' file sets are pinned by
#       scripts/tests/test-extension-render-conformance.sh instead).
#   (d) GAP-UNDECLARED/GAP-STALE — the render's observed gap set
#       (build/gaps/<name>/observed-gaps.json) against the hand-authored,
#       committed extensions/<tier>/<name>/accepted-gaps.json (absent means
#       the empty set — 0173Δ R13).
#   (e) VERSION-DRIFT — the built gemini-extension.json's .version equals the
#       extension's authoritative version declaration (0173Δ R11, 0044Δ R9).
#
# Usage:
#   bash scripts/build-extension.sh [--target {gemini,claude,copilot,antigravity,all}] [<extension-dir-or-name> ...]
#   bash scripts/build-extension.sh --check [<extension-dir-or-name> ...]
#
#   With no extension argument, every extension under
#   extensions/{core,library,org} that carries an extension.json at its root
#   is processed (scripts/lib/extension-manifest.sh ext_discover_dirs).
#
# Prerequisites: jq, yq.

set -euo pipefail

command -v jq >/dev/null 2>&1 || { echo "Error: jq is required. Install with: brew install jq" >&2; exit 2; }
command -v yq >/dev/null 2>&1 || { echo "Error: yq is required. Install with: brew install yq" >&2; exit 2; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# shellcheck source=lib/render-command.sh
. "$SCRIPT_DIR/lib/render-command.sh"
# shellcheck source=lib/extension-manifest.sh
. "$SCRIPT_DIR/lib/extension-manifest.sh"

PERCLI_KEYS="$SCRIPT_DIR/lib/extension-percli-keys.json"
GENERATED_CLASS="$SCRIPT_DIR/lib/extension-generated-class.json"

CHECK_MODE=false
TARGET="all"
EXT_ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --check) CHECK_MODE=true; shift ;;
    --target)
      TARGET="${2:?--target requires a value}"
      shift 2
      ;;
    *) EXT_ARGS+=("$1"); shift ;;
  esac
done

case "$TARGET" in
  gemini|claude|copilot|antigravity|all) ;;
  *)
    echo "Error: --target must be one of gemini, claude, copilot, antigravity, all (got '$TARGET')." >&2
    exit 2
    ;;
esac

if [ "$TARGET" = "all" ]; then
  TARGETS=(gemini claude copilot antigravity)
else
  TARGETS=("$TARGET")
fi

# Resolve a bare extension name to its source dir extensions/<tier>/<name>/,
# searching every tier (first match; hard-error on a duplicate name). A path
# argument is accepted verbatim.
resolve_extension_dir() {
  local arg="$1"
  if [ -d "$arg" ]; then
    (cd "$arg" && pwd)
    return 0
  fi
  local found="" tier
  for tier in core library org; do
    if [ -d "$REPO_DIR/extensions/$tier/$arg" ]; then
      if [ -n "$found" ]; then
        echo "Error: extension '$arg' exists in multiple tiers; names must be unique." >&2
        exit 1
      fi
      found="$REPO_DIR/extensions/$tier/$arg"
    fi
  done
  if [ -z "$found" ]; then
    echo "Error: extension directory or name '$arg' not found." >&2
    exit 1
  fi
  (cd "$found" && pwd)
}

# generic_subject_declared <manifest> <subject> — true iff <subject> is
# present as a GENERIC top-level section (never via the legacy
# components.<subject>.enabled fallback). Used only for gap detection
# (hooks/context, R12): those two subjects have no legacy reader at all
# (the parent spec's own grounding record: "components.hooks is read by no
# script"), so a stray legacy components.hooks/components.context toggle
# stays exactly as inert as it always was, rather than newly surfacing a gap
# warning nothing before this render ever produced.
generic_subject_declared() {
  local manifest="$1" subject="$2"
  jq -e --arg s "$subject" 'has($s) and (.[$s] != null)' "$manifest" >/dev/null 2>&1
}

# ext_class_scan <dir> <class-json> — echoes, one per line, every path
# (relative to <dir>) that is a member of the generated-output class: a
# manifest_class entry whose literal relative shape occurs under <dir>, or a
# generated_globs match anywhere under <dir>. The SAME predicate runs in
# opposite polarity on a committed source tree (must match nothing) and on a
# build tree (identifies exactly the generated set) — spec 0173 PLAN step 4.
ext_class_scan() {
  local dir="$1" class_json="$2" rel glob matched
  [ -d "$dir" ] || return 0
  local globs
  globs=$(jq -r '.generated_globs[]' "$class_json")
  while IFS= read -r rel; do
    [ -z "$rel" ] && continue
    if jq -e --arg r "$rel" '.manifest_class | index($r) != null' "$class_json" >/dev/null 2>&1; then
      echo "$rel"
      continue
    fi
    matched=0
    while IFS= read -r glob; do
      [ -z "$glob" ] && continue
      # shellcheck disable=SC2254  # deliberate: $glob is a glob pattern, not a literal
      case "$rel" in
        $glob) matched=1 ;;
      esac
    done <<< "$globs"
    [ "$matched" -eq 1 ] && echo "$rel"
  done < <(cd "$dir" && find . -type f | sed 's#^\./##' | sort)
}

# render_gemini <ext_dir> <manifest> <name> — renders the complete installable
# Gemini tree into build/extensions/<name>/. Echoes one "<subject>@gemini"
# line per unmappable declared subject to fd 3 (the gap collector).
render_gemini() {
  local ext_dir="$1" manifest="$2" name="$3"
  local build_dir
  build_dir="$(ext_build_dir "$REPO_DIR" "$name")"
  rm -rf "$build_dir"
  mkdir -p "$build_dir"
  cp -a "$ext_dir"/. "$build_dir"/

  # Strip any generated-output-class member the verbatim copy just carried
  # over — a stray committed file the source tree should never have had in
  # the first place (arm (a) is what catches it there). The build tree must
  # reflect only what THIS render actually produces, never a raw copy of a
  # committed generated-class file, so a leaked stray cannot masquerade as
  # a rendered output.
  local stray
  while IFS= read -r stray; do
    [ -z "$stray" ] && continue
    rm -f "$build_dir/$stray"
  done < <(ext_class_scan "$build_dir" "$GENERATED_CLASS")

  local description version context_fname mcp_servers themes rc=0
  description="$(jq -r '.description // ""' "$manifest")"
  version="$(ext_version "$manifest")"
  context_fname="$(jq -r '.gemini.contextFileName // ""' "$manifest")"
  mcp_servers="$(jq -c '.mcpServers // {}' "$manifest")"
  themes="$(jq -c '.gemini.themes // []' "$manifest")"

  jq -n \
    --arg name "$name" \
    --arg version "$version" \
    --arg description "$description" \
    --arg contextFileName "$context_fname" \
    --argjson mcpServers "$mcp_servers" \
    --argjson themes "$themes" \
    '
    {name: $name, version: $version, description: $description}
    + (if $contextFileName != "" then {contextFileName: $contextFileName} else {} end)
    + (if ($mcpServers | length) > 0 then {mcpServers: $mcpServers} else {} end)
    + (if ($themes | length) > 0 then {themes: $themes} else {} end)
    ' > "$build_dir/gemini-extension.json" || rc=1
  echo "  Rendered: build/extensions/$name/gemini-extension.json"

  if [ "$(ext_subject_present "$manifest" commands)" = "true" ]; then
    local loc source cmd_name rendered
    loc="$(ext_subject_location "$manifest" commands "commands/")"
    loc="${loc%/}"
    if [ -d "$ext_dir/$loc" ]; then
      for source in "$ext_dir/$loc"/*.md; do
        [ -f "$source" ] || continue
        cmd_name="$(yaml_field "$source" "name")"
        if [ -z "$cmd_name" ] || [ "$cmd_name" = "null" ]; then
          echo "Warning: $source missing 'name' field, skipping" >&2
          continue
        fi
        rendered="$(render_command_gemini "$source")" || { rc=1; continue; }
        mkdir -p "$build_dir/$loc"
        printf '%s\n' "$rendered" > "$build_dir/$loc/$cmd_name.toml"
        echo "  Rendered: build/extensions/$name/$loc/$cmd_name.toml"
      done
    fi
  fi

  local subj
  for subj in hooks context; do
    if generic_subject_declared "$manifest" "$subj"; then
      echo "Warning: extension '$name' declares subject '$subj' with no renderer on target 'gemini' yet (its sub-spec has not landed)" >&2
      echo "${subj}@gemini" >&3
    fi
  done
  return "$rc"
}

# render_plugin <builder> <ext_dir> <manifest> <name> <target-label>
render_plugin() {
  local builder="$1" ext_dir="$2" manifest="$3" name="$4" label="$5" rc=0
  bash "$builder" "$ext_dir" >&2 || rc=1

  local subj
  for subj in hooks context; do
    if generic_subject_declared "$manifest" "$subj"; then
      echo "Warning: extension '$name' declares subject '$subj' with no renderer on target '$label' yet (its sub-spec has not landed)" >&2
      echo "${subj}@${label}" >&3
    fi
  done
  return "$rc"
}

# render_extension <ext_dir> — renders every target in $TARGETS for one
# extension. Returns non-zero if validation or any target's render fails.
# Writes build/gaps/<name>/observed-gaps.json ONLY when $TARGETS covers all
# four targets (a partial single-target render leaves any prior full gap
# record untouched rather than risk overwriting it with a partial view).
render_extension() {
  local ext_dir="$1"
  local manifest="$ext_dir/extension.json"
  local name
  name="$(jq -r '.name' "$manifest")"

  if ! ext_validate_manifest "$manifest" "$PERCLI_KEYS"; then
    echo "FAIL: $ext_dir — manifest validation failed (see VALIDATION-ERROR lines above)" >&2
    return 1
  fi

  echo "Building extension: $name"

  local gap_file
  gap_file="$(mktemp)"
  local rc=0

  {
    if [[ " ${TARGETS[*]:-} " == *" gemini "* ]]; then
      render_gemini "$ext_dir" "$manifest" "$name" || rc=1
    fi
    if [[ " ${TARGETS[*]:-} " == *" claude "* ]]; then
      render_plugin "$REPO_DIR/scripts/build-claude-plugin.sh" "$ext_dir" "$manifest" "$name" claude || rc=1
    fi
    if [[ " ${TARGETS[*]:-} " == *" copilot "* ]]; then
      render_plugin "$REPO_DIR/scripts/build-copilot-plugin.sh" "$ext_dir" "$manifest" "$name" copilot || rc=1
    fi
    if [[ " ${TARGETS[*]:-} " == *" antigravity "* ]]; then
      render_plugin "$REPO_DIR/scripts/build-antigravity-extension.sh" "$ext_dir" "$manifest" "$name" antigravity || rc=1
    fi
  } 3>"$gap_file"

  if [ "${#TARGETS[@]}" -eq 4 ]; then
    local gap_dir
    gap_dir="$(ext_gap_dir "$REPO_DIR" "$name")"
    mkdir -p "$gap_dir"
    jq -R -s '
      split("\n") | map(select(length > 0)) | map(split("@")) |
      map({subject: .[0], target: .[1],
           reason: "declared subject has no renderer yet (its sub-spec has not landed)"})
    ' "$gap_file" > "$gap_dir/observed-gaps.json"
  fi
  rm -f "$gap_file"

  return "$rc"
}

# --- --check arms ------------------------------------------------------

# declared_outputs <ext_dir> <manifest> — echoes the Gemini in-place target's
# DECLARED output set, one relative path per line (R10(c)).
declared_outputs() {
  local ext_dir="$1" manifest="$2"
  echo "gemini-extension.json"
  if [ "$(ext_subject_present "$manifest" commands)" = "true" ]; then
    local loc source stem
    loc="$(ext_subject_location "$manifest" commands "commands/")"
    loc="${loc%/}"
    if [ -d "$ext_dir/$loc" ]; then
      for source in "$ext_dir/$loc"/*.md; do
        [ -f "$source" ] || continue
        stem="$(yaml_field "$source" name)"
        if [ -z "$stem" ] || [ "$stem" = "null" ]; then
          continue
        fi
        echo "$loc/$stem.toml"
      done
    fi
  fi
}

# check_version_drift <ext_dir> <name> — arm (e): the built manifest's
# .version must equal the authoritative version declaration (package.json
# where the extension ships one, extension.json otherwise). Prints a
# VERSION-DRIFT line and returns 1 on mismatch.
check_version_drift() {
  local ext_dir="$1" name="$2"
  local build_dir built built_version authoritative
  build_dir="$(ext_build_dir "$REPO_DIR" "$name")"
  built="$build_dir/gemini-extension.json"
  if [ ! -f "$built" ]; then
    echo "  FAIL VERSION-DRIFT $name — $built was not produced by the render"
    return 1
  fi
  built_version="$(jq -r '.version // ""' "$built")"
  if [ -f "$ext_dir/package.json" ]; then
    authoritative="$(jq -r '.version // ""' "$ext_dir/package.json")"
  else
    authoritative="$(jq -r '.version // ""' "$ext_dir/extension.json")"
  fi
  if [ "$built_version" != "$authoritative" ]; then
    echo "  FAIL VERSION-DRIFT $name — built gemini-extension.json version '$built_version' != authoritative version '$authoritative'"
    return 1
  fi
  echo "  OK   VERSION-DRIFT $name (version $built_version)"
  return 0
}

# check_gaps <ext_dir> <name> — arm (d): the render's observed gap set against
# the hand-authored, committed accepted-gaps.json (absent means the empty
# set, spec 0173Δ R13).
check_gaps() {
  local ext_dir="$1" name="$2"
  local gap_dir observed accepted obs_keys acc_keys ok=0 k
  gap_dir="$(ext_gap_dir "$REPO_DIR" "$name")"
  observed="$gap_dir/observed-gaps.json"
  accepted="$ext_dir/accepted-gaps.json"
  obs_keys=""
  [ -f "$observed" ] && obs_keys="$(jq -r '.[] | "\(.subject)@\(.target)"' "$observed" | sort -u)"
  acc_keys=""
  [ -f "$accepted" ] && acc_keys="$(jq -r '.[] | "\(.subject)@\(.target)"' "$accepted" | sort -u)"

  while IFS= read -r k; do
    [ -z "$k" ] && continue
    if ! grep -qxF "$k" <<< "$acc_keys"; then
      echo "  FAIL GAP-UNDECLARED $name — observed gap '$k' has no matching entry in $ext_dir/accepted-gaps.json"
      ok=1
    fi
  done <<< "$obs_keys"
  while IFS= read -r k; do
    [ -z "$k" ] && continue
    if ! grep -qxF "$k" <<< "$obs_keys"; then
      echo "  FAIL GAP-STALE $name — $ext_dir/accepted-gaps.json declares '$k' but the render no longer observes it"
      ok=1
    fi
  done <<< "$acc_keys"
  [ "$ok" -eq 0 ] && echo "  OK   GAP $name"
  return "$ok"
}

# check_extension <ext_dir> — runs all five arms for one extension against a
# forced --target all render, regardless of any --target the caller passed
# (0173Δ R10(b) always renders every target). Returns non-zero on any
# failure; every failing arm has already printed its own diagnostic.
check_extension() {
  local ext_dir="$1" manifest name failures=0
  manifest="$ext_dir/extension.json"
  name="$(jq -r '.name' "$manifest")"

  # Arm (a) — COMMITTED, on the SOURCE tree, independent of the render below.
  local committed
  committed="$(ext_class_scan "$ext_dir" "$GENERATED_CLASS")"
  if [ -n "$committed" ]; then
    local f
    while IFS= read -r f; do
      [ -z "$f" ] && continue
      echo "  FAIL COMMITTED $name — $f is a member of the generated-output class and MUST NOT be committed at all; delete it and reach it through one of the delivery paths in EXTENSION-FORMAT.md"
      failures=$((failures + 1))
    done <<< "$committed"
  else
    echo "  OK   COMMITTED $name (no generated-output-class file committed)"
  fi

  # Arm (b) — RENDER-FAIL. Forces --target all regardless of the CLI --target.
  local saved_targets=(${TARGETS[@]+"${TARGETS[@]}"}) render_log
  render_log="$(mktemp)"
  TARGETS=(gemini claude copilot antigravity)
  if ! render_extension "$ext_dir" >"$render_log" 2>&1; then
    echo "  FAIL RENDER-FAIL $name — a fresh --target all render failed:"
    sed 's/^/         /' "$render_log"
    failures=$((failures + 1))
    rm -f "$render_log"
    TARGETS=(${saved_targets[@]+"${saved_targets[@]}"})
    return "$failures"
  fi
  rm -f "$render_log"
  echo "  OK   RENDER-FAIL $name (fresh --target all render succeeded)"
  TARGETS=(${saved_targets[@]+"${saved_targets[@]}"})

  # Arm (c) — MISSING/UNDECLARED, in-place target only.
  local build_dir declared produced
  build_dir="$(ext_build_dir "$REPO_DIR" "$name")"
  declared="$(declared_outputs "$ext_dir" "$manifest" | sort -u)"
  produced="$(ext_class_scan "$build_dir" "$GENERATED_CLASS" | sort -u)"
  local missing undeclared
  missing="$(comm -23 <(echo "$declared") <(echo "$produced"))"
  undeclared="$(comm -13 <(echo "$declared") <(echo "$produced"))"
  if [ -n "$missing" ]; then
    local f
    while IFS= read -r f; do
      [ -z "$f" ] && continue
      echo "  FAIL MISSING $name — declared output '$f' was not produced"
      failures=$((failures + 1))
    done <<< "$missing"
  fi
  if [ -n "$undeclared" ]; then
    local f
    while IFS= read -r f; do
      [ -z "$f" ] && continue
      echo "  FAIL UNDECLARED $name — produced output '$f' is not a declared output"
      failures=$((failures + 1))
    done <<< "$undeclared"
  fi
  if [ -z "$missing" ] && [ -z "$undeclared" ]; then
    echo "  OK   MISSING/UNDECLARED $name (produced set matches declared set)"
  fi

  # Arm (d) — GAP-UNDECLARED/GAP-STALE.
  check_gaps "$ext_dir" "$name" || failures=$((failures + 1))

  # Arm (e) — VERSION-DRIFT.
  check_version_drift "$ext_dir" "$name" || failures=$((failures + 1))

  return "$failures"
}

# --- main ---------------------------------------------------------------

ext_dirs=()
if [ "${#EXT_ARGS[@]}" -gt 0 ]; then
  for arg in ${EXT_ARGS[@]+"${EXT_ARGS[@]}"}; do
    ext_dirs+=("$(resolve_extension_dir "$arg")")
  done
else
  while IFS= read -r d; do
    [ -z "$d" ] && continue
    ext_dirs+=("$d")
  done < <(ext_discover_dirs "$REPO_DIR")
fi

if [ "$CHECK_MODE" = true ]; then
  echo "Extension render — CHECK (no committed generated output, fresh render, exact declared set)"
  total_failures=0
  for ext_dir in ${ext_dirs[@]+"${ext_dirs[@]}"}; do
    if ! check_extension "$ext_dir"; then
      total_failures=$((total_failures + 1))
    fi
  done
  echo ""
  if [ "$total_failures" -gt 0 ]; then
    echo "FAILED: $total_failures extension(s) failed one or more --check arms."
    exit 1
  fi
  echo "OK: every extension carries no committed generated output, renders cleanly, and matches its declared set."
else
  echo "Extension render — BUILD (--target ${TARGET})"
  for ext_dir in ${ext_dirs[@]+"${ext_dirs[@]}"}; do
    render_extension "$ext_dir"
  done
  echo ""
  echo "Done."
fi
