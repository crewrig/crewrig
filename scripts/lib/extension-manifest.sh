#!/usr/bin/env bash
# scripts/lib/extension-manifest.sh — Shared manifest accessors and validator
# for the generic extension declaration model (spec 0173).
#
# Do NOT execute directly; source it. Requires: jq.
#
# An extension declares its whole cross-CLI surface once in `extension.json`
# (spec 0173 R1): each declaration subject (`commands`, `skills`, `agents`,
# `hooks`, `mcpServers`, `context`) lives in a generic top-level section, and a
# per-CLI section (`gemini`, `claude`, `copilot`, `antigravity`) carries only
# the keys that fail to generalize (R2/R3). The accessors below resolve the
# generic section FIRST, falling back to the legacy `components.<subject>.*`
# shape when the generic section is absent — the interim spec 0173's *Out of
# scope* grants until the clean-break migration (S5, issue #1008) removes the
# fallback chain. This is the ONE place that fallback is decided; every
# caller (the three plugin builders, scripts/build-extension.sh) reads through
# it rather than re-implementing the two-shape read.
#
# Under the generic schema a subject has NO enablement toggle (R5): its
# presence as a top-level section IS its enablement. Under the legacy
# `components.*` shape a subject is enabled by `components.<subject>.enabled`.

ext_subject_present() {
  # ext_subject_present <manifest-file> <subject>
  # Echoes "true"/"false".
  local manifest="$1" subject="$2"
  jq -r --arg s "$subject" '
    if (has($s) and (.[$s] != null)) then "true"
    else ((.components[$s].enabled // false) | if type == "boolean" then . else false end | tostring)
    end
  ' "$manifest"
}

ext_subject_location() {
  # ext_subject_location <manifest-file> <subject> <default>
  local manifest="$1" subject="$2" default="$3"
  jq -r --arg s "$subject" --arg d "$default" '
    if (has($s) and (.[$s] != null)) then (.[$s].location // $d)
    else (.components[$s].location // $d)
    end
  ' "$manifest"
}

ext_subject_option() {
  # ext_subject_option <manifest-file> <subject> <option> [<default>]
  local manifest="$1" subject="$2" option="$3" default="${4:-}"
  jq -r --arg s "$subject" --arg o "$option" --arg d "$default" '
    if (has($s) and (.[$s] != null)) then (.[$s][$o] // $d)
    else (.components[$s][$o] // $d)
    end
  ' "$manifest"
}

ext_version() {
  # ext_version <manifest-file> — reads .version from extension.json (R11: the
  # render's own single source, independent of package.json).
  local manifest="$1"
  jq -r '.version // ""' "$manifest"
}

ext_validate_manifest() {
  # ext_validate_manifest <manifest-file> <percli-keys-allowlist-json>
  # Implements R3/R8 as a hard failure: any key inside a per-CLI top-level
  # section (gemini/claude/copilot/antigravity) that is not a row of the
  # allowlist is a manifest validation error. Prints one line per offense to
  # stderr and returns non-zero; returns 0 (silent) when the manifest is
  # clean. Fail-closed: an allowlist row absent or malformed does not admit
  # the key (spec 0173 PLAN step 3).
  local manifest="$1" allowlist="$2"
  local cli errors=0
  for cli in gemini claude copilot antigravity; do
    local keys
    keys=$(jq -r --arg c "$cli" '.[$c] // {} | keys[]?' "$manifest" 2>/dev/null) || continue
    while IFS= read -r key; do
      [ -z "$key" ] && continue
      if ! jq -e --arg k "$cli.$key" 'any(.[]?; .key == $k)' "$allowlist" >/dev/null 2>&1; then
        echo "VALIDATION-ERROR: $manifest — inadmissible per-CLI key '$cli.$key' (not in $allowlist)" >&2
        errors=$((errors + 1))
      fi
    done <<< "$keys"
  done
  [ "$errors" -eq 0 ]
}

ext_discover_dirs() {
  # ext_discover_dirs <repo-dir>
  # The single extension-discovery predicate (spec 0173 PLAN v2-F3): every
  # directory extensions/{core,library,org}/*/ carrying an extension.json at
  # its root — R1's own mandatory marker. Called by both the render and the
  # --check walk of scripts/build-extension.sh, so R6's "no second entry point
  # or second drift guard" holds at the discovery layer too. All three tiers
  # are in scope, `org` included (R10 as amended names no tier carve-out).
  local repo_dir="$1" tier ext_dir
  for tier in core library org; do
    [ -d "$repo_dir/extensions/$tier" ] || continue
    for ext_dir in "$repo_dir/extensions/$tier"/*/; do
      [ -f "${ext_dir}extension.json" ] || continue
      (cd "$ext_dir" && pwd)
    done
  done
}

ext_build_dir() {
  # ext_build_dir <repo-dir> <name> — the single place the build-directory
  # layout is decided (spec 0173Δ R7/R22). Render, --check, install-extension.sh
  # and the debugging link task all resolve it through this one function.
  local repo_dir="$1" name="$2"
  echo "$repo_dir/build/extensions/$name"
}

ext_gap_dir() {
  # ext_gap_dir <repo-dir> <name> — the observed gap set lives beside the
  # build directory but OUTSIDE it (spec 0173Δ R22: the installable tree must
  # stay complete with no second render, so build metadata must not ship
  # inside it).
  local repo_dir="$1" name="$2"
  echo "$repo_dir/build/gaps/$name"
}
