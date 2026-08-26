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
# `--check` (0173Δ R10, as amended by spec 0183 R9/R11) runs over TWO
# subjects. For every discovered EXTENSION:
#   (a) COMMITTED  — no file of the generated-output class
#       (scripts/lib/extension-generated-class.json) is committed anywhere in
#       the extension's SOURCE tree, AND no file committed anywhere in that
#       tree is named for a supported command-line tool
#       (ext_name_axis_scan, spec 0183 R9) with no declaration generating it
#       — whether or not that file is also a generated-output-class member.
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
# For the SCAFFOLD TEMPLATE CONTAINER (extension-skeleton/, spec 0183 R9's
# Scenario "The scaffold template container is charged like an extension
# tree"), checked once per run regardless of any extension argument:
#   (a) COMMITTED (name-axis only) — no committed file under
#       extension-skeleton/ is named for a supported command-line tool. Arms
#       (b)-(e) do not apply: the container has no declarations to render, no
#       version, and no gap set.
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
# shellcheck source=lib/extension-hooks.sh
. "$SCRIPT_DIR/lib/extension-hooks.sh"
# shellcheck source=lib/render-context.sh
. "$SCRIPT_DIR/lib/render-context.sh"

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

# _ext_name_axis_matches <rel-path> <newline-separated-tool-tokens> — true
# (rc 0) iff ANY path segment of <rel-path> — split on '/', basename
# included — is, after stripping AT MOST ONE leading dot and lowercasing, a
# case-insensitive PREFIX match against one of <tool-tokens>. Deliberately a
# prefix rule, not a substring rule (spec 0183 R9/PLAN step 15): a substring
# rule would charge "regeminate.md" — the near-miss this predicate must NOT
# charge — while the prefix rule correctly excludes it and still charges
# ".geminiignore", "GEMINI.md", "copilot-instructions.md", and a committed
# ".claude-plugin/" path segment.
_ext_name_axis_matches() {
  local rel="$1" tokens="$2" segment stripped lower token
  while IFS= read -r segment; do
    [ -z "$segment" ] && continue
    stripped="$segment"
    case "$stripped" in
      .*) stripped="${stripped#.}" ;;
    esac
    lower="$(printf '%s' "$stripped" | tr '[:upper:]' '[:lower:]')"
    while IFS= read -r token; do
      [ -z "$token" ] && continue
      # shellcheck disable=SC2254  # deliberate: $token is used as a glob prefix, not a literal
      case "$lower" in
        "$token"*) return 0 ;;
      esac
    done <<< "$tokens"
  done <<< "$(printf '%s' "$rel" | tr '/' '\n')"
  return 1
}

# ext_name_axis_scan <dir> <targets-json> — echoes, one per line, every path
# (relative to <dir>) that names a supported command-line tool on the name
# axis (spec 0183 R9): the token set is the keys of <targets-json> MINUS
# `_readme` (a documentation row that designates no tool), matched via
# _ext_name_axis_matches above. Runs whether or not any declaration
# generates the file — R9 admits no exemption for "no declaration generates
# it" — so this is deliberately a DIFFERENT predicate from ext_class_scan's
# generated-output-class membership, not a restriction of it: the two are
# combined by check_extension's arm (a), below.
ext_name_axis_scan() {
  local dir="$1" targets_json="$2" rel
  [ -d "$dir" ] || return 0
  local tokens
  tokens="$(jq -r 'keys[] | select(. != "_readme")' "$targets_json")"
  while IFS= read -r rel; do
    [ -z "$rel" ] && continue
    if _ext_name_axis_matches "$rel" "$tokens"; then
      echo "$rel"
    fi
  done < <(cd "$dir" && find . -type f | sed 's#^\./##' | sort)
}

# render_gemini <ext_dir> <manifest> <name> — renders the complete installable
# Gemini tree into build/extensions/<name>/.
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
  # spec 0181 R9: the render supplies the built manifest's own contextFileName
  # from its OWN knowledge of the target (the descriptor's contextOutput
  # column) — the authored manifest no longer carries this key at all.
  # Non-empty only when the extension actually declares a context source.
  local ctx_source=""
  context_fname=""
  ctx_source="$(jq -r '.context.source // ""' "$manifest")"
  if [ -n "$ctx_source" ]; then
    context_fname="$(render_context_target_output gemini "$name")"
  fi
  # spec 0180 step 5: translate through the shared org-channel translator and
  # rewrite the neutral ${extensionRoot} token to Gemini's own ${extensionPath}
  # spelling — Gemini itself resolves ${extensionPath} when it loads the
  # extension in place (R7), so no render-time absolute path is baked in (R8).
  mcp_servers="$(ext_mcp_native gemini "$manifest")"
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

  # Context (spec 0181 R1/R9): render the single neutral source through the
  # shared resolver into this target's own contextOutput location. A
  # resolver failure (an unresolved reference or a malformed span) fails the
  # render (R5) — no context output for ANY target, per the scenario.
  if [ -n "$ctx_source" ] && [ -f "$ext_dir/$ctx_source" ]; then
    # A plain `render_context ... > "$dest"` redirection creates $dest via
    # the SHELL before the command's exit status is known, so a resolver
    # failure would still leave a (truncated or empty) file behind — the
    # exact stray output R5's "no context output for any target" forbids.
    # Render to a scratch file first; only place it on success.
    local ctx_tmp
    ctx_tmp="$(mktemp)"
    if render_context "$ext_dir/$ctx_source" gemini "$manifest" "$ext_dir" > "$ctx_tmp"; then
      mv "$ctx_tmp" "$build_dir/$context_fname"
      echo "  Rendered: build/extensions/$name/$context_fname"
    else
      rm -f "$ctx_tmp"
      rc=1
    fi
  fi

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

  # Hooks (spec 0179): translated by the shared library. R16 retired the
  # blanket per-subject gap arm in the same change that gave the subject a
  # renderer; context's own last unmappable-subject arm is retired here,
  # in the same spirit, now that every declared subject maps on this target.
  ext_hooks_render gemini "$manifest" "$ext_dir" "$build_dir"
  ext_hooks_gaps gemini "$manifest" >&3

  return "$rc"
}

# _plugin_default_out_dir <ext_dir> <name> <label> — the SAME default output
# root each per-CLI builder resolves for a bare invocation (no explicit
# output-dir argument), so the translator writes the hook file into the tree
# the builder actually produced rather than guessing a second path.
_plugin_default_out_dir() {
  local ext_dir="$1" name="$2" label="$3"
  case "$label" in
    claude) echo "$ext_dir/dist-claude-plugin/$name" ;;
    copilot) echo "$REPO_DIR/dist-copilot-plugin/$name" ;;
    antigravity) echo "$REPO_DIR/dist-antigravity-plugin/$name" ;;
  esac
}

# render_plugin <builder> <ext_dir> <manifest> <name> <target-label>
render_plugin() {
  local builder="$1" ext_dir="$2" manifest="$3" name="$4" label="$5" rc=0
  bash "$builder" "$ext_dir" >&2 || rc=1

  # Hooks (spec 0179): emitted into the builder's own output root AFTER the
  # delegated builder runs (0063 delta-01 R18 / 0065 delta-01 R9 — the
  # shared pipeline is the property's carrier, not a per-CLI build script
  # reading a manifest field of its own).
  local out_dir
  out_dir="$(_plugin_default_out_dir "$ext_dir" "$name" "$label")"
  ext_hooks_render "$label" "$manifest" "$ext_dir" "$out_dir"
  ext_hooks_gaps "$label" "$manifest" >&3

  # MCP (spec 0180 step 11, v2-F5): emitted from the PARENT shell, AFTER the
  # builder subprocess returns, reading the SAME mcpDelivery row the builder
  # itself already consumed before deciding whether to write its MCP file —
  # so the emit decision (inside the builder) and this gap decision cannot
  # disagree. A truthful reason, since MCP's sub-spec HAS landed (spec 0180),
  # unlike the generic "no renderer yet" reason below.
  if jq -e '(.mcpServers // {}) | length > 0' "$manifest" >/dev/null 2>&1 \
     && [ "$(ext_mcp_delivery "$label")" != "true" ]; then
    echo "Warning: extension '$name' declares mcpServers, which has no expressible delivery on target '$label'" >&2
    jq -c -n --arg subject mcpServers --arg target "$label" \
      --arg reason "no resolvable path form for this target's MCP delivery (see docs/cli-matrix.md)" \
      '{subject: $subject, target: $target, reason: $reason}' >&3
  fi

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
    # THE WIRE CONTRACT (spec 0179 step 14 — shared with #1006/#1007, whose
    # DEVs read this merged diff, not the plan text, as the contract):
    #
    #   fd 3 carries NDJSON — one COMPACT (`jq -c`) JSON object per line.
    #   Every emitter (ext_hooks_gaps below; the `context` gap loops above)
    #   writes with `jq -c -n --arg ...` — never string interpolation — so a
    #   value containing '"', '@' or a newline can never corrupt the line
    #   boundary the parse below depends on. Every entry carries `subject`
    #   and `target`; a hook-granular entry additionally carries `hook`,
    #   `event` and `part` (`"event"` | `"matcher"`). Sibling tickets extend
    #   this by ADDING fields, never by changing the framing.
    #
    #   Parsed here with `jq -R -s 'split("\n") | ... | map(fromjson)'` —
    #   raw input, split on literal newlines, each line parsed on its own —
    #   rather than the equivalent-looking `jq -s '.'` (jq's native
    #   multi-value stream slurp, which also happens to accept NDJSON, since
    #   consecutive JSON values separated only by whitespace are valid
    #   input to it). The two are NOT equivalent on a malformed line: `jq -s`
    #   parses "the next JSON value," so a value some future writer
    #   accidentally pretty-prints across several lines still parses
    #   silently, quietly breaking the "one compact object per LINE"
    #   contract without any error. Splitting on "\n" first and calling
    #   `fromjson` per line enforces that contract structurally — a
    #   multi-line value fails loudly right here instead of surfacing as a
    #   confusing downstream `check_gaps` key mismatch. If you extend this
    #   record, keep both the emitter (`jq -c -n --arg`) and this parse
    #   invocation exactly as documented; do not swap either independently.
    jq -R -s '
      split("\n") | map(select(length > 0)) | map(fromjson)
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
  # spec 0181 R15: the declared output set covers context — only when a
  # source is actually declared, so a context-less extension's arm (c)
  # stays exactly as before (the non-vacuous negative R15's scenario asks
  # for).
  if [ -n "$(jq -r '.context.source // ""' "$manifest")" ]; then
    printf '%s\n' "$(render_context_target_output gemini "$(jq -r '.name' "$manifest")")"
  fi
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
  if [ -n "$(_ext_hooks_resolved_entries gemini "$manifest")" ]; then
    echo "hooks/hooks.json"
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

# GAP_KEY_FILTER — the SINGLE canonical key builder (spec 0179 step 14),
# applied identically to the observed and accepted sides so the two can
# never drift apart by construction. Subject-granularity entries (the only
# surviving one being `mcpServers` — spec 0183 R10; `context`'s own
# unmappable-subject arm was retired earlier, at render_extension's
# `${extensionRoot}` resolution) key on `subject@target` alone, exactly as before;
# a hook-granularity entry additionally carries `hook`, `event` and `part`,
# so two hooks differing only in their neutral event produce distinguishable
# keys rather than colliding on one `subject@target` pair.
GAP_KEY_FILTER='def gap_key: "\(.subject)@\(.target)" + (if has("hook") then "@\(.hook)@\(.event)@\(.part)" else "" end); map(gap_key)'

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
  [ -f "$observed" ] && obs_keys="$(jq -r "$GAP_KEY_FILTER"' | .[]' "$observed" | sort -u)"
  acc_keys=""
  [ -f "$accepted" ] && acc_keys="$(jq -r "$GAP_KEY_FILTER"' | .[]' "$accepted" | sort -u)"

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
  # Two predicates converge here (spec 0183 R9/R11, PLAN step 16): the
  # pre-existing generated-output-class membership (a file the render itself
  # would produce) and the tool-designated name-axis charge (a file whose
  # name designates a supported command-line tool, whether or not any
  # declaration generates it — R9 admits no exemption for "no declaration
  # generates it"). A file caught by both prints once, under the more
  # specific generated-class message.
  local committed name_axis
  committed="$(ext_class_scan "$ext_dir" "$GENERATED_CLASS")"
  name_axis="$(ext_name_axis_scan "$ext_dir" "$EXT_MCP_TARGETS_JSON")"
  if [ -n "$committed" ] || [ -n "$name_axis" ]; then
    local f
    while IFS= read -r f; do
      [ -z "$f" ] && continue
      echo "  FAIL COMMITTED $name — $f is a member of the generated-output class and MUST NOT be committed at all; delete it and reach it through one of the delivery paths in EXTENSION-FORMAT.md"
      failures=$((failures + 1))
    done <<< "$committed"
    while IFS= read -r f; do
      [ -z "$f" ] && continue
      grep -qxF "$f" <<< "$committed" && continue
      echo "  FAIL COMMITTED $name — $f is named for a supported command-line tool but no declaration generates it; the permitted paths are to delete the file or to declare the subject that produces it"
      failures=$((failures + 1))
    done <<< "$name_axis"
  else
    echo "  OK   COMMITTED $name (no generated-output-class file committed, no undeclared tool-designated file)"
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

# check_skeleton_name_axis <skeleton-dir> — the second subject of --check's
# arm (a) (spec 0183 R9/Scenario "The scaffold template container is charged
# like an extension tree"): extension-skeleton/ has no declarations to
# render, no version, and no gap set, so it runs the name-axis scan ALONE —
# no RENDER-FAIL, no MISSING/UNDECLARED, no GAP, no VERSION-DRIFT arm applies
# to a template container that is not itself an extension.
check_skeleton_name_axis() {
  local skeleton_dir="$1" failures=0 f
  local hits
  hits="$(ext_name_axis_scan "$skeleton_dir" "$EXT_MCP_TARGETS_JSON")"
  if [ -n "$hits" ]; then
    while IFS= read -r f; do
      [ -z "$f" ] && continue
      echo "  FAIL COMMITTED extension-skeleton — $f is named for a supported command-line tool but no declaration generates it; the permitted paths are to delete the file or to declare the subject that produces it"
      failures=$((failures + 1))
    done <<< "$hits"
  else
    echo "  OK   COMMITTED extension-skeleton (no tool-designated file committed)"
  fi
  return "$failures"
}

# cleanup_stray_plugin_dist — --check's arm (b) forces a full --target all
# render per extension purely to prove it succeeds; nothing downstream of
# that arm consumes the delegated Claude/Copilot/Antigravity plugin
# builders' own staging output (arms (c)-(e) only ever look at the Gemini
# build/extensions/<name> tree). build-claude-plugin.sh's own
# bare-invocation default stages INSIDE the extension's own source directory
# (extensions/<tier>/<name>/dist-claude-plugin/ — an override exists and
# install-claude-plugin.sh already uses it, but build-extension.sh's own
# delegation call does not), so a --check run leaves that staging dir sitting
# inside a tree other, unrelated scripts subsequently walk in the SAME
# workspace: scripts/check-extension-provenance.sh's `find` over
# extensions/core and extensions/library, and
# scripts/tests/test-install-claude-plugin-marketplace.sh's `find` over the
# whole repo. Invisible when every CI job gets its own fresh checkout; a real
# false positive the moment more than one such script runs in one workspace
# (spec 0147 R5's fail-safe changeset-coverage job — issue #1004 iteration
# 3). Swept ONLY on the --check path (see the trap below): an ordinary
# `build-extension.sh --target ... <ext>` (no --check) is the one path whose
# whole point is to leave a persistent, inspectable plugin directory behind
# for `claude --plugin-dir` / the per-CLI install scripts to use
# (EXTENSION-FORMAT.md's documented model, pinned by
# scripts/tests/test-extension-render-conformance.sh), so it stays untouched.
cleanup_stray_plugin_dist() {
  find "$REPO_DIR/extensions" -mindepth 3 -maxdepth 3 -type d -name 'dist-*-plugin' -exec rm -rf {} + 2>/dev/null || true
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
  # EXIT (success or failure, including an early exit from a future change to
  # this branch) — see cleanup_stray_plugin_dist above for why only the
  # --check path registers this trap.
  trap cleanup_stray_plugin_dist EXIT
  echo "Extension render — CHECK (no committed generated output, fresh render, exact declared set)"
  total_failures=0
  for ext_dir in ${ext_dirs[@]+"${ext_dirs[@]}"}; do
    if ! check_extension "$ext_dir"; then
      total_failures=$((total_failures + 1))
    fi
  done
  # Second subject of arm (a) only (spec 0183 R9): the scaffold template
  # container, checked once per run regardless of any --target/extension
  # argument the caller passed — it is not itself a discovered extension.
  if ! check_skeleton_name_axis "$REPO_DIR/extension-skeleton"; then
    total_failures=$((total_failures + 1))
  fi
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
