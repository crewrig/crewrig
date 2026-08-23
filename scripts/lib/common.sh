#!/usr/bin/env bash
# scripts/lib/common.sh — Shared helpers sourced by setup and import scripts.
# Do NOT execute directly.

# --- MemPalace supported version pin (single source of truth) ---
# Declared once here and consumed by every script that sources this file:
# the four setup-*-interactive.sh flows, start-chroma-server.sh, and
# prune-transcripts.sh. Keep this the ONLY executable declaration of the pin;
# the literal-text copies (README, Taskfile, docs, skills) are kept in sync by
# scripts/tests/test-mempalace-version-range.sh.
#
# The framework targets the MemPalace 3.6.x line. The cross-tool continuity
# protocol relies on the `wing` parameter on diary tools, BM25 hybrid search,
# and Halls — all still present in the 3.6.x line.
MEMPALACE_MIN_VERSION="3.6.0"
MEMPALACE_MAX_VERSION_EXCLUSIVE="3.7"

# LAST_BACKUP_PATH — set by every backup_file call so a caller can name the
# backup it just produced (spec 0089 R9 warning). Deterministic on ALL paths:
# the path of the backup when one was made, the empty string when the target
# was absent, or when backup creation failed. Initialising it unconditionally
# means a caller reading it after a no-backup call never sees a prior call's
# value, never sees a nonexistent backup path, and never trips `set -u`
# (spec 0089 review F2, issue #982).
LAST_BACKUP_PATH=""

backup_file() {
  local target="$1"
  LAST_BACKUP_PATH=""
  if [ -f "$target" ] || [ -L "$target" ]; then
    local stamp bak
    stamp="$(date +%Y%m%d-%H%M%S)"
    bak="${target}.bak.${stamp}"
    if cp -P "$target" "$bak" 2>/dev/null && [ -e "$bak" ]; then
      # shellcheck disable=SC2034  # read by scripts that source this lib (R9 warning), not here
      LAST_BACKUP_PATH="$bak"
      echo "  Backed up: ${target##*/} -> ${target##*/}.bak.${stamp}"
    else
      echo "  WARNING: Failed to back up ${target##*/} (could not create ${bak##*/})" >&2
    fi
  fi
}

# --- MCP reserved (framework-managed) server names (spec 0089 R1) ------------
# The single source of truth for the names the framework owns. A declaration
# found under one of these names is framework-managed, never an operator
# declaration: it is written by the framework on selection (R7, framework wins)
# and absent on decline (R8). Every other MCP server name is an operator
# declaration and is preserved verbatim across a setup run (R2/R3).
MCP_RESERVED_NAMES=(mempalace sequentialthinking)

# merge_preexisting_mcp_servers <pre_run_mcpservers_json> <framework_config_path> <backup_ref>
#
# Folds an operator's pre-existing MCP server declarations back into a
# freshly-written framework MCP config so custom (non-reserved) servers survive
# a setup run (spec 0089). The three overwrite-based setups (Gemini, Copilot,
# Antigravity) each call this ONE helper at their write step, which is what
# keeps them symmetric (R5) and is the only shape R11's hermetic test can
# exercise without fzf / the `agy` guard / the chroma daemon.
#
# Policy (all owned here):
#   R2/R3/R4 — every non-reserved pre-existing server is merged back VERBATIM
#     and wins over any same-named framework entry (right-biased jq object
#     merge: `.mcpServers + $preserved`).
#   R7 — a framework reserved server selected during the run keeps its own name:
#     reserved names are stripped from the operator side before the merge, so
#     the framework entry cannot be overwritten (framework wins on selection).
#   R8 — a declined reserved server is absent from BOTH operands (the framework
#     write removed it, `$preserved` stripped it), so the result has no entry
#     under that name (decline toggle-off preserved).
#   R9 — each reserved-name collision in the pre-run config emits a non-silent
#     warning naming the server and pointing at <backup_ref>, worded for the
#     replacement (framework kept the name) or the removal (framework declined).
#   R6 — the framework's reserved entries were TLS-wrapped (spec 0084) BEFORE
#     this fold and are never in the operator side, so their wrapping survives.
#
# Args:
#   $1 pre_run_mcpservers_json — the target's `.mcpServers` captured BEFORE the
#      framework overwrite (a JSON object; "" or "{}" when none pre-existed).
#   $2 framework_config_path   — the just-written framework config; rewritten in
#      place (atomic tmp + mv).
#   $3 backup_ref              — timestamped backup path named in the R9 warning
#      (may be empty when the target did not pre-exist).
merge_preexisting_mcp_servers() {
  local pre_run="$1" config_path="$2" backup_ref="$3"
  [ -n "$pre_run" ] || pre_run='{}'

  # Defensive: an unparseable capture degrades to "nothing to preserve" rather
  # than aborting the setup. The timestamped backup (R10) still holds the
  # operator's data byte-for-byte, so nothing is lost. Not a spec scenario.
  if ! printf '%s' "$pre_run" | jq -e . >/dev/null 2>&1; then
    echo "  WARNING: pre-existing MCP config could not be parsed — pre-existing" \
         "declarations are NOT preserved in place; recover them from: ${backup_ref:-(none)}"
    pre_run='{}'
  fi

  # R9 — one warning per reserved name that pre-existed, distinguishing the
  # framework-wins replacement (name still present after the framework write)
  # from the decline removal (name absent after the write).
  local name
  for name in ${MCP_RESERVED_NAMES[@]+"${MCP_RESERVED_NAMES[@]}"}; do
    if printf '%s' "$pre_run" | jq -e --arg n "$name" 'has($n)' >/dev/null 2>&1; then
      if jq -e --arg n "$name" '(.mcpServers // {}) | has($n)' "$config_path" >/dev/null 2>&1; then
        echo "  WARNING: '$name' is a framework-managed MCP server — your prior '$name' entry was replaced (framework wins)."
      else
        echo "  WARNING: '$name' is a framework-managed MCP server — your prior '$name' entry was removed (you declined it)."
      fi
      echo "           The prior entry is preserved in the timestamped backup: ${backup_ref:-(none)}"
    fi
  done

  # The reserved set as a JSON array, so the jq program stays declarative.
  local reserved_json
  reserved_json="$(jq -cn '$ARGS.positional' --args ${MCP_RESERVED_NAMES[@]+"${MCP_RESERVED_NAMES[@]}"})"

  # Right-biased merge. `preserved` = operator servers minus reserved names, so
  # framework reserved entries survive and operator non-reserved entries win
  # verbatim over any same-named framework default (e.g. a hand-customised
  # `github`).
  jq --argjson pre "$pre_run" --argjson reserved "$reserved_json" \
    'def preserved: reduce $reserved[] as $r ($pre; del(.[$r]));
     .mcpServers = ((.mcpServers // {}) + preserved)' \
    "$config_path" > "${config_path}.tmp" && mv "${config_path}.tmp" "$config_path"
}

# --- Org-declared MCP servers (spec 0091) ------------------------------------
# A THIRD precedence layer folded on top of the spec-0089 operator merge, wired
# identically into all four setups but through each CLI's own mechanism. An
# org-owned root manifest `mcp-servers.org.json` declares servers in a small
# neutral schema keyed by name; the three file CLIs (Gemini/Copilot/Antigravity)
# translate it into their native `mcpServers` shape and fold it AFTER the 0089
# merge, while Claude iterates the same manifest and issues one `claude mcp add`
# per entry. Resolved precedence on every CLI:
#     framework-reserved  >  org  >  operator-pre-existing
# R10 — reserved names (mempalace / sequentialthinking) stay framework-managed:
#   an org declaration under a reserved name is NOT applied, with a non-silent
#   warning (framework wins). R11 — a non-reserved org name that collides with
#   an operator's pre-existing entry wins, with a non-silent warning naming it.
# The 0089 helper (merge_preexisting_mcp_servers) above is deliberately left
# untouched; these are siblings folded strictly after it.

# read_org_mcp_manifest <manifest_path>
# Echoes the manifest's `.mcpServers` object, or `{}` when the file is absent,
# empty, unparseable, or `.mcpServers` is not an object — degrade, never abort,
# exactly as merge_preexisting_mcp_servers does for a bad capture. Only the
# `.mcpServers` key is read; a sibling `_example`/`_note` key is inert docs.
read_org_mcp_manifest() {
  local manifest="$1"
  [ -f "$manifest" ] || { printf '{}'; return 0; }
  local servers
  servers="$(jq -c '.mcpServers // {}' "$manifest" 2>/dev/null)" || servers=""
  if [ -z "$servers" ] || ! printf '%s' "$servers" | jq -e 'type == "object"' >/dev/null 2>&1; then
    printf '{}'
    return 0
  fi
  printf '%s' "$servers"
}

# org_mcp_to_native <cli> <neutral_mcpservers_json>
# Pure translator: maps the neutral org `mcpServers` object into the native
# `mcpServers` object for a file CLI (gemini | copilot | antigravity). Emits the
# native JSON object on STDOUT only (safe for command substitution); any
# capability warning goes to STDERR.
#
# Grounded native shapes (verified against each CLI's own `mcp add`, temp HOME):
#   stdio  gemini/antigravity -> {command, args?, env?}   (no "type")
#          copilot            -> {type:"stdio", command, args?, env?}
#          (copilot's own `mcp add` writes "type":"local"; the shipped template
#           and the live mempalace/seqthink entries use "type":"stdio", so we
#           match the framework's proven convention.)
#   http/  gemini/copilot     -> {type:<transport>, url, headers?}
#   sse    antigravity        -> {serverUrl, headers?}   (NOTE: Antigravity's
#          remote-entry key is `serverUrl`, NOT `url`, and carries no transport
#          `type` field — one shape covers both http and Streamable-HTTP/SSE.
#          Grounded against the official Antigravity MCP docs
#          (https://antigravity.google/docs/mcp#mcp-configuration-structure):
#          file `~/.gemini/config/mcp_config.json`, stdio {command,args,env,cwd?}
#          + remote {serverUrl, headers?}. This SUPERSEDES the stale note in
#          spec 0054 §Open questions that the mcp_config.json format is "not
#          publicly documented" — the format is now officially documented, so
#          the earlier remote-transport gap-acceptance is closed. Auth extras
#          (authProviderType/oauth) are out of scope for this base declaration.)
org_mcp_to_native() {
  local cli="$1" neutral="$2"
  [ -n "$neutral" ] || neutral='{}'
  printf '%s' "$neutral" | jq -e 'type == "object"' >/dev/null 2>&1 || neutral='{}'

  printf '%s' "$neutral" | jq -c --arg cli "$cli" '
    to_entries
    | map(
        .key as $name | .value as $e
        | (($e.transport) // "stdio") as $t
        | if $t == "stdio" then
            { key: $name, value: (
                { command: $e.command }
                + (if $e.args then { args: $e.args } else {} end)
                + (if $e.env  then { env:  $e.env  } else {} end)
                + (if $cli == "copilot" then { type: "stdio" } else {} end)
            ) }
          elif $cli == "antigravity" then
            # Antigravity remote shape: `serverUrl` (not `url`), no `type`.
            { key: $name, value: (
                { serverUrl: $e.url }
                + (if $e.headers then { headers: $e.headers } else {} end)
            ) }
          else
            { key: $name, value: (
                { type: $t, url: $e.url }
                + (if $e.headers then { headers: $e.headers } else {} end)
            ) }
          end
      )
    | from_entries'
}

# apply_org_mcp_servers <native_org_json> <config_path> <preexisting_json> <backup_ref>
# File-CLI applier. Folds the (already-translated) native org `mcpServers` object
# over an on-disk config's `.mcpServers`, AFTER the 0089 operator merge, so org
# wins over operator (R11) while framework-reserved names stay framework-owned
# (R10). Emits non-silent warnings on stdout — the single warning surface,
# mirroring merge_preexisting_mcp_servers — then rewrites the config in place
# (atomic tmp + mv).
#   $1 native_org_json — org servers in the CLI's native shape (org_mcp_to_native)
#   $2 config_path     — the just-merged config; rewritten in place
#   $3 preexisting_json — the operator's pre-run `.mcpServers` (for the R11 warning)
#   $4 backup_ref      — timestamped backup path named in the R11 warning
apply_org_mcp_servers() {
  local org_native="$1" config_path="$2" preexisting="$3" backup_ref="$4"
  [ -n "$org_native" ] || org_native='{}'
  printf '%s' "$org_native" | jq -e 'type == "object"' >/dev/null 2>&1 || org_native='{}'
  [ -n "$preexisting" ] || preexisting='{}'
  printf '%s' "$preexisting" | jq -e 'type == "object"' >/dev/null 2>&1 || preexisting='{}'

  # Nothing declared -> nothing to do (leave the 0089 result as-is).
  if [ "$(printf '%s' "$org_native" | jq -r 'length')" = "0" ]; then
    return 0
  fi

  local reserved_json
  reserved_json="$(jq -cn '$ARGS.positional' --args ${MCP_RESERVED_NAMES[@]+"${MCP_RESERVED_NAMES[@]}"})"

  # R10 — an org declaration under a framework-reserved name is NOT applied.
  local name
  for name in ${MCP_RESERVED_NAMES[@]+"${MCP_RESERVED_NAMES[@]}"}; do
    if printf '%s' "$org_native" | jq -e --arg n "$name" 'has($n)' >/dev/null 2>&1; then
      echo "  WARNING: '$name' is a framework-managed MCP server — the org declaration for '$name' was NOT applied (framework wins)."
    fi
  done

  # R11 — a non-reserved org name that collides with an operator pre-existing
  # entry wins; warn (non-silent) and point at the backup.
  local collisions c
  collisions="$(jq -rn --argjson org "$org_native" --argjson pre "$preexisting" --argjson reserved "$reserved_json" '
    $org | keys[] as $k
    | select( ($pre | has($k)) and (($reserved | index($k)) | not) )
    | $k' 2>/dev/null)"
  while IFS= read -r c; do
    [ -n "$c" ] || continue
    echo "  WARNING: org-declared MCP server '$c' overrides your pre-existing '$c' entry (org declaration wins)."
    echo "           The prior entry is preserved in the timestamped backup: ${backup_ref:-(none)}"
  done <<< "$collisions"

  # Fold: org (minus reserved) wins over whatever the config holds.
  jq --argjson org "$org_native" --argjson reserved "$reserved_json" \
    'def org_min_reserved: reduce $reserved[] as $r ($org; del(.[$r]));
     .mcpServers = ((.mcpServers // {}) + org_min_reserved)' \
    "$config_path" > "${config_path}.tmp" && mv "${config_path}.tmp" "$config_path"
}

# org_mcp_to_claude_argv <name> <neutral_entry_json>
# Pure translator for the Claude imperative path: emits the argv tokens that
# follow `claude mcp add`, ONE TOKEN PER LINE (space-safe; read with `mapfile`).
# Grounded against `claude mcp add --help`:
#   stdio -> --scope user [-e K=V]… <name> -- <command> <args…>
#   http/ -> --scope user --transport <t> <name> <url> [--header "K: V"]…
#   sse
org_mcp_to_claude_argv() {
  local name="$1" entry="$2"
  printf '%s' "$entry" | jq -r --arg name "$name" '
    (.transport // "stdio") as $t
    | if $t == "stdio" then
        ([ "--scope", "user" ]
         + ((.env // {}) | to_entries | map([ "-e", (.key + "=" + .value) ]) | add // [])
         + [ $name, "--", .command ]
         + (.args // []))
      else
        ([ "--scope", "user", "--transport", $t, $name, .url ]
         + ((.headers // {}) | to_entries | map([ "--header", (.key + ": " + .value) ]) | add // []))
      end
    | .[]'
}

# register_org_mcp_claude <manifest_path> <claude_user_config>
# Claude applier: iterate the org manifest and deliver each server via
# `claude mcp add --scope user`, AFTER the framework-managed reserved servers, so
# precedence is framework-reserved > org > operator (R10/R11). Self-contained —
# uses only the `claude` binary and MCP_RESERVED_NAMES, so it does not depend on
# helpers defined in setup-claude-interactive.sh.
#   R10 reserved name -> skip + warning (framework wins).
#   R11 name already registered -> org wins: remove-then-add, GUARDED — the
#       prior entry is captured from <claude_user_config> and restored if the
#       re-add fails, so a partial run never drops the operator's server
#       (cold-review rider #3; the remove-then-add is non-atomic).
#   otherwise -> add.
register_org_mcp_claude() {
  local manifest="$1" claude_config="$2"
  local servers names
  servers="$(read_org_mcp_manifest "$manifest")"
  [ "$servers" = "{}" ] && return 0
  names="$(printf '%s' "$servers" | jq -r 'keys[]' 2>/dev/null)"

  local name entry saved r is_reserved tok
  local -a argv
  while IFS= read -r name; do
    [ -n "$name" ] || continue

    is_reserved=0
    for r in ${MCP_RESERVED_NAMES[@]+"${MCP_RESERVED_NAMES[@]}"}; do
      [ "$r" = "$name" ] && is_reserved=1
    done
    if [ "$is_reserved" -eq 1 ]; then
      echo "  WARNING: '$name' is a framework-managed MCP server — the org declaration for '$name' was NOT applied (framework wins)."
      continue
    fi

    entry="$(printf '%s' "$servers" | jq -c --arg n "$name" '.[$n]')"
    argv=()
    while IFS= read -r tok; do argv+=("$tok"); done < <(org_mcp_to_claude_argv "$name" "$entry")

    if claude mcp list 2>/dev/null | grep -qE "^${name}:[[:space:]]"; then
      # R11 — org wins over the operator's pre-existing entry. Guard the
      # non-atomic remove-then-add: capture, then restore on re-add failure.
      echo "  WARNING: org-declared MCP server '$name' overrides your pre-existing '$name' entry (org declaration wins)."
      saved="$(jq -c --arg n "$name" '.mcpServers[$n] // empty' "$claude_config" 2>/dev/null || true)"
      claude mcp remove --scope user "$name" >/dev/null 2>&1 || true
      if claude mcp add ${argv[@]+"${argv[@]}"} >/dev/null 2>&1; then
        echo "  ${name}: org declaration registered (replaced prior entry)"
      else
        echo "  ${name}: FAILED to register org declaration — restoring your prior entry."
        if [ -n "$saved" ] && [ -f "$claude_config" ]; then
          local tmp
          tmp="$(mktemp)"
          if jq --arg n "$name" --argjson v "$saved" '.mcpServers[$n] = $v' "$claude_config" > "$tmp" 2>/dev/null; then
            mv "$tmp" "$claude_config"
            echo "  ${name}: prior entry restored from ~/.claude.json."
          else
            rm -f "$tmp"
            echo "  ${name}: could not auto-restore — recover from the ~/.claude.json backup."
          fi
        fi
      fi
    else
      if claude mcp add ${argv[@]+"${argv[@]}"} >/dev/null 2>&1; then
        echo "  ${name}: org declaration registered"
      else
        echo "  ${name}: FAILED to register org declaration — re-run manually: claude mcp add ${argv[*]:-}"
      fi
    fi
  done <<< "$names"
}

install_file() {
  local source="$1" target="$2" label="$3"
  if [ "$INSTALL_MODE" = "link" ]; then
    ln -sfn "$source" "$target"
    echo "  Linked: $label"
  else
    cp "$source" "$target"
    echo "  Copied: $label"
  fi
}

# install_dir <source_dir> <target_dir> <label>
# Directory analogue of install_file (spec 0068). Mirrors its link/copy duality
# so the forkable-first symlink path works for a whole store directory:
#   INSTALL_MODE=link  -> target is a symlink to the source dir (tracks the
#                         working tree, same trust caveat as install_file link).
#   otherwise (copy)   -> target is a real directory holding copies of the
#                         source's files (byte-identical to the source).
# Any prior install (a copy-mode directory or a link-mode symlink) is cleared
# first so switching modes is idempotent.
install_dir() {
  local source="$1" target="$2" label="$3"
  mkdir -p "$(dirname "$target")"
  if [ -L "$target" ]; then
    rm -f "$target"
  elif [ -d "$target" ]; then
    rm -rf "$target"
  fi
  if [ "$INSTALL_MODE" = "link" ]; then
    ln -sfn "$source" "$target"
    echo "  Linked dir: $label"
  else
    mkdir -p "$target"
    cp -R "$source"/. "$target"/
    echo "  Copied dir: $label"
  fi
}

# pick_catalogue_entry <category_dir> <category_label>
# Shared team/expertise/level picker (spec 0096), replacing the verbatim-
# duplicated selection block across the four setup-*-interactive.sh scripts.
#
# Nullglob-safe: when <category_dir> holds zero *.md files, short-circuits to
# an empty result BEFORE ever invoking fzf — no literal `*`/`*.md` placeholder
# reaches the picker (R1). Otherwise pipes the candidate basenames through fzf;
# the `|| true` on that invocation is load-bearing: it neutralizes fzf's own
# exit status (1 on decline, 2 on error, 130 on Ctrl-C) so a caller running
# under `set -e` cannot abort the assignment before the caller's own
# if/else skip-handling runs (all four setup-*-interactive.sh scripts run
# under `set -e`).
#
# Prints the chosen basename (no .md suffix) to stdout on a normal pick.
# Prints nothing to stdout, and a category-naming, cause-distinguishing
# message to stderr, on either an empty catalogue or a declined pick (R4) —
# the caller only needs to test for an empty result, not which cause fired.
pick_catalogue_entry() {
  local category_dir="$1" category_label="$2"
  local candidates=() f
  shopt -s nullglob
  for f in "$category_dir"/*.md; do
    candidates+=("$(basename "$f" .md)")
  done
  shopt -u nullglob

  if [ "${#candidates[@]}" -eq 0 ]; then
    echo "No $category_label catalogue entries found under $category_dir — skipping $category_label selection." >&2
    return 0
  fi

  local choice
  choice="$(printf '%s\n' ${candidates[@]+"${candidates[@]}"} \
    | fzf --height 40% --preview "head -20 $category_dir/{}.md" || true)"
  if [ -z "$choice" ]; then
    echo "No $category_label selected — skipping $category_label selection." >&2
    return 0
  fi

  printf '%s\n' "$choice"
}

# ensure_tier_built <repo_dir> <build_target> <staging_path>
# Auto-builds a tier's staging output (spec 0107) so the interactive setup
# scripts no longer require a manual `bash scripts/build-components.sh` run
# before the `library` tier can be installed.
#
# If <staging_path> already exists as a directory, returns 0 immediately
# (no message) — the tier is already built, nothing to do. Otherwise builds
# it on the fly via `bash "$repo_dir/scripts/build-components.sh" --target
# <build_target>`, returning 1 (with an ERROR: line naming the failed build
# target) if that build fails, or 0 on a successful build.
ensure_tier_built() {
  local repo_dir="$1" build_target="$2" staging_path="$3"

  if [ -d "$staging_path" ]; then
    return 0
  fi

  echo "Tier not built (no $staging_path) — building automatically via 'bash scripts/build-components.sh --target $build_target'..."
  if ! bash "$repo_dir/scripts/build-components.sh" --target "$build_target"; then
    echo "ERROR: automatic build failed for target '$build_target'." >&2
    return 1
  fi
  return 0
}

mempalace_installed_version() {
  "$1" -c "from importlib.metadata import version; print(version('mempalace'))" 2>/dev/null
}

# mempalace_version_in_range <python>
# Reads MEMPALACE_MIN_VERSION and MEMPALACE_MAX_VERSION_EXCLUSIVE, declared as
# the single source of truth at the top of this file.
# Returns 0 if the installed version is in [MIN, MAX_EXCLUSIVE), 1 otherwise.
mempalace_version_in_range() {
  local py="$1"
  "$py" - <<EOF >/dev/null 2>&1
import sys
from importlib.metadata import version
from packaging.version import Version
v = Version(version("mempalace"))
mn = Version("${MEMPALACE_MIN_VERSION}")
mx = Version("${MEMPALACE_MAX_VERSION_EXCLUSIVE}")
sys.exit(0 if mn <= v < mx else 1)
EOF
}

# mempalace_python_candidates
# Prints the interpreter candidates detect_mempalace_python considers, one per
# line, highest priority first. Extracted from the helper below (spec 0108 R10)
# so the operator diagnostic can report the very same ordered list the framework
# would walk, and name a fallback selection instead of leaving it silent.
# Candidate *ordering* only — no candidate is probed for a working mempalace
# here; that is detect_mempalace_python's job.
mempalace_python_candidates() {
  local candidates=()
  candidates+=("$HOME/.local/pipx/venvs/mempalace/bin/python")
  local mp_bin shebang_py
  mp_bin="$(command -v mempalace 2>/dev/null || true)"
  if [ -n "$mp_bin" ] && [ -f "$mp_bin" ]; then
    shebang_py="$(head -1 "$mp_bin" 2>/dev/null | sed -n 's|^#!\([^ ]*\).*|\1|p')"
    [ -n "$shebang_py" ] && candidates+=("$shebang_py")
  fi
  candidates+=("python3")
  local py
  for py in ${candidates[@]+"${candidates[@]}"}; do
    [ -n "$py" ] && printf '%s\n' "$py"
  done
}

detect_mempalace_python() {
  local py
  # Process substitution, not a pipe: a pipeline would run this loop in a
  # subshell and `return 0` would return from that subshell, not the helper.
  while IFS= read -r py; do
    [ -n "$py" ] || continue
    command -v "$py" >/dev/null 2>&1 || continue
    if "$py" -c "import mempalace.mcp_server" >/dev/null 2>&1; then
      echo "$py"
      return 0
    fi
  done < <(mempalace_python_candidates)
  return 1
}

offer_mempalace_install() {
  if ! command -v pipx >/dev/null 2>&1; then
    echo "  pipx not found — install MemPalace manually:"
    echo "    pipx install 'mempalace>=${MEMPALACE_MIN_VERSION},<${MEMPALACE_MAX_VERSION_EXCLUSIVE}'"
    echo "  Install pipx: brew install pipx (macOS) or python3 -m pip install --user pipx"
    return 1
  fi
  local choice
  choice=$(echo -e "no\nyes" | fzf --height 10% \
    --header "MemPalace not found — install via pipx now? (mempalace>=${MEMPALACE_MIN_VERSION},<${MEMPALACE_MAX_VERSION_EXCLUSIVE})")
  if [ "$choice" != "yes" ]; then
    echo "  MemPalace install skipped."
    return 1
  fi
  if ! pipx install "mempalace>=${MEMPALACE_MIN_VERSION},<${MEMPALACE_MAX_VERSION_EXCLUSIVE}"; then
    echo "  pipx install failed — install MemPalace manually then re-run this script."
    return 1
  fi
  echo "  MemPalace installed."
  return 0
}

# install_chroma_daemon <repo_dir>
#
# Installs and starts the shared ChromaDB HTTP daemon supervisor (issue #98,
# ADR 0006). Idempotent — re-running on an already-loaded unit is a no-op.
#
# On macOS: copies config/launchd/com.mempalace.chroma-server.plist to
#           ~/Library/LaunchAgents/ and loads it via launchctl.
# On Linux: copies config/systemd/mempalace-chroma-server.service to
#           ~/.config/systemd/user/ and enables+starts it via systemctl --user.
#
# After install, runs scripts/status-chroma-server.sh to confirm the daemon
# is healthy before returning. Exits 1 if the daemon fails to come up — the
# wrapper's fail-loud contract requires the daemon to be reachable before
# any MCP entry is registered.
# install_daemon_supervisor <launchd_label> <systemd_unit> <materialise_fn> <health_fn> <log_hint>
#
# Installs and starts a supervised user-level daemon. Idempotent — re-running
# on an already-loaded unit is a no-op.
#
#   <launchd_label>  launchd label, and the basename of the plist under
#                    config/launchd/ (e.g. com.mempalace.chroma-server)
#   <systemd_unit>   systemd unit name, and the basename of the unit file under
#                    config/systemd/ (e.g. mempalace-chroma-server). The two
#                    naming schemes genuinely differ — reverse-DNS on macOS,
#                    hyphenated on Linux — so they are separate parameters
#                    rather than one derived from the other.
#   <materialise_fn> name of a function taking <src> <dst>; writes the
#                    substituted unit and returns non-zero on refusal. Every
#                    placeholder set is daemon-specific — Chroma needs the
#                    chroma binary, the MCP daemon needs a port and a token —
#                    so substitution is the caller's, not this function's.
#   <health_fn>      name of a function returning 0 once the daemon serves.
#                    Polled on a deadline; a supervised process needs a few
#                    seconds to bind its socket (issue #138).
#   <log_hint>       path shown to the operator when the deadline expires.
#
# Generalised from install_chroma_daemon by spec 0113. The three parts that
# are genuinely daemon-specific — placeholder substitution, the binary
# preflight, and the health check — are callbacks; the OS branching, the unit
# install, the load/enable and the deadline poll are shared.
install_daemon_supervisor() {
  local label="$1"
  local systemd_unit="$2"
  local materialise_fn="$3"
  local health_fn="$4"
  local log_hint="$5"
  local os
  os="$(uname -s)"
  case "$os" in
    Darwin)
      local plist_src="$CREWRIG_REPO_DIR/config/launchd/${label}.plist"
      local plist_dst="$HOME/Library/LaunchAgents/${label}.plist"
      if [ ! -f "$plist_src" ]; then
        echo "  ERROR: $plist_src missing — daemon supervisor unit not shipped."
        return 1
      fi
      mkdir -p "$HOME/Library/LaunchAgents"
      "$materialise_fn" "$plist_src" "$plist_dst" || return 1
      echo "  Installed: $plist_dst"
      if launchctl list | grep -q "$label"; then
        echo "  launchd agent already loaded — skipping load."
      else
        launchctl load -w "$plist_dst" \
          && echo "  Loaded launchd agent: $label" \
          || { echo "  ERROR: launchctl load failed."; return 1; }
      fi
      ;;
    Linux)
      local svc_src="$CREWRIG_REPO_DIR/config/systemd/${systemd_unit}.service"
      local svc_dst="$HOME/.config/systemd/user/${systemd_unit}.service"
      if [ ! -f "$svc_src" ]; then
        echo "  ERROR: $svc_src missing — daemon supervisor unit not shipped."
        return 1
      fi
      mkdir -p "$HOME/.config/systemd/user"
      "$materialise_fn" "$svc_src" "$svc_dst" || return 1
      echo "  Installed: $svc_dst"
      systemctl --user daemon-reload \
        && systemctl --user enable --now "$systemd_unit" \
        && echo "  Enabled and started: ${systemd_unit}.service" \
        || { echo "  ERROR: systemctl --user enable --now failed."; return 1; }
      ;;
    *)
      echo "  ERROR: unsupported OS '$os' — install the daemon manually."
      return 1
      ;;
  esac
  # Health check — confirm the daemon answers before any MCP entry is written.
  # The supervisor-managed process needs a few seconds to bind its socket, so
  # poll with a 15s budget instead of one-shotting the health command
  # (see issue #138). The `# Health check` marker on this line is load-bearing:
  # scripts/tests/test-chroma-health-race.sh extracts the block between it and
  # this function's closing brace to assert the polling shape, so moving or
  # rewording it breaks that regression test.
  local deadline=$((SECONDS + 15))
  local healthy=0
  while [ "$SECONDS" -lt "$deadline" ]; do
    if "$health_fn" >/dev/null 2>&1; then
      healthy=1
      break
    fi
    sleep 0.3
  done
  if [ "$healthy" -ne 1 ]; then
    # Surface the health check's own diagnostics so the operator sees the real
    # cause before the generic ERROR line.
    "$health_fn" || true
    echo "  ERROR: daemon '$label' did not become healthy."
    echo "         Inspect logs at $log_hint and retry."
    return 1
  fi
  return 0
}

# Materialise callback for the ChromaDB unit. Placeholders are chroma-specific:
# the plist on disk is user-agnostic (no hardcoded $HOME) and is filled here
# with the detected mempalace interpreter and chroma binary so the supervised
# agent runs against the right venv.
_materialise_chroma_unit() {
  local src="$1"
  local dst="$2"
  local pipx_py chroma_bin mempalace_home chroma_palace_path
  pipx_py="${MEMPALACE_PYTHON:-$(detect_mempalace_python || true)}"
  if [ -z "$pipx_py" ]; then
    echo "  ERROR: cannot detect mempalace pipx python — install mempalace first."
    return 1
  fi
  chroma_bin="$(dirname "$pipx_py")/chroma"
  if [ ! -x "$chroma_bin" ] && [ "${CREWRIG_TEST_MOCK_CHROMA_BIN:-false}" != "true" ]; then
    echo "  ERROR: chroma binary not found at $chroma_bin — run: pipx inject mempalace 'chromadb>=1.5.9'"
    return 1
  fi
  mempalace_home="$HOME/.mempalace"
  if [ -n "${MEMPALACE_PALACE_PATH:-}" ]; then
    chroma_palace_path="${MEMPALACE_PALACE_PATH}"
  else
    case "$src" in
      *.service) chroma_palace_path="%h/.mempalace/palace" ;;
      *)         chroma_palace_path="${mempalace_home}/palace" ;;
    esac
  fi

  sed \
    -e "s|__MEMPALACE_HOME__|${mempalace_home}|g" \
    -e "s|__PIPX_PYTHON__|${pipx_py}|g" \
    -e "s|__CHROMA_BIN__|${chroma_bin}|g" \
    -e "s|__CHROMA_PALACE_PATH__|${chroma_palace_path}|g" \
    -e "s|__TLS_EXEC__|${CREWRIG_REPO_DIR}/scripts/lib/tls-exec.sh|g" \
    "$src" > "$dst"

  if grep -qE '__[A-Z][A-Z0-9_]*__' "$dst" 2>/dev/null; then
    echo "  ERROR: $dst still contains an unsubstituted placeholder." >&2
    rm -f "$dst"
    return 1
  fi
  return 0
}

_health_chroma_daemon() {
  if [ -x "$CREWRIG_REPO_DIR/scripts/status-chroma-server.sh" ]; then
    bash "$CREWRIG_REPO_DIR/scripts/status-chroma-server.sh"
    return $?
  fi
  echo "  WARNING: scripts/status-chroma-server.sh not found — cannot health-check."
  return 0
}

install_chroma_daemon() {
  local repo_dir="$1"
  CREWRIG_REPO_DIR="$repo_dir"
  echo ""
  echo "Installing shared ChromaDB HTTP daemon supervisor (issue #98)..."
  install_daemon_supervisor \
    "com.mempalace.chroma-server" \
    "mempalace-chroma-server" \
    _materialise_chroma_unit \
    _health_chroma_daemon \
    "$HOME/.mempalace/chroma-server.log"
}

# --- MCP HTTP daemon: install (spec 0113, ADR 0016) --------------------------
MCP_DAEMON_HOST_DEFAULT="127.0.0.1"
# 41893: high, outside the ephemeral range (macOS starts at 49152, so an
# ephemeral port can be claimed at random by any outgoing connection), and with
# no /etc/services assignment. The previous default, 8021, is registered as
# intu-ec-client and collided on the very first machine this ran on — held by
# launchd for a system service, invisible to lsof without elevation (#748).
MCP_DAEMON_PORT_DEFAULT="41893"
# Overridable so a test can bind elsewhere. A test that shares the production
# port reaches the production daemon even when its own unit is correctly
# labelled and simply failed to bind — the isolation must cover the port, not
# only the unit name (spec 0113 step 2c).
MCP_DAEMON_LABEL_DEFAULT="com.mempalace.mcp-server"
MCP_DAEMON_UNIT_DEFAULT="mempalace-mcp-server"

# mcp_listener_pid <port> — the PID of the process listening on <port>, or
# empty when none can be identified. lsof on macOS, ss on Linux.
#
# MEMPALACE_MCP_LISTENER_PID fixes the listener side for a hermetic suite
# (spec 0158 R3). The set-but-empty contract is load-bearing: an explicitly
# empty value forces the lookup to report undeterminable, while an unset one
# falls through to the real lookup. `${VAR+x}` is what distinguishes the two —
# `:-` would collapse both to the fallback.
mcp_listener_pid() {
  local port="$1"
  if [ -n "${MEMPALACE_MCP_LISTENER_PID+x}" ]; then
    printf '%s\n' "${MEMPALACE_MCP_LISTENER_PID}"
    return 0
  fi
  local pid=""
  case "$(uname -s)" in
    Darwin)
      pid="$(lsof -nP -iTCP:"${port}" -sTCP:LISTEN -t 2>/dev/null | head -n1)"
      ;;
    Linux)
      pid="$(ss -H -tlnp "sport = :${port}" 2>/dev/null \
        | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' | head -n1)"
      ;;
    *)
      pid=""
      ;;
  esac
  printf '%s\n' "${pid}"
}

# mcp_supervisor_pid — the PID the OS supervisor reports for the daemon unit,
# or empty when the unit is not loaded or reports no running process. The
# expected process comes from the OS supervisor — launchctl print
# gui/<uid>/<label> on macOS, systemctl --user show -p MainPID on Linux — never
# from a file a same-uid local process could write (spec 0158 R2).
#
# MEMPALACE_MCP_EXPECTED_PID fixes the supervisor side for a hermetic suite
# (spec 0158 R3); set-but-empty forces undeterminable, unset falls through to
# the real supervisor lookup.
mcp_supervisor_pid() {
  if [ -n "${MEMPALACE_MCP_EXPECTED_PID+x}" ]; then
    printf '%s\n' "${MEMPALACE_MCP_EXPECTED_PID}"
    return 0
  fi
  local label unit pid=""
  label="${MEMPALACE_MCP_LABEL:-$MCP_DAEMON_LABEL_DEFAULT}"
  unit="${MEMPALACE_MCP_UNIT:-$MCP_DAEMON_UNIT_DEFAULT}"
  case "$(uname -s)" in
    Darwin)
      pid="$(launchctl print "gui/$(id -u)/${label}" 2>/dev/null \
        | sed -n 's/^[[:space:]]*pid = \([0-9][0-9]*\)[[:space:]]*$/\1/p' \
        | head -n1)"
      ;;
    Linux)
      pid="$(systemctl --user show -p MainPID --value "${unit}" 2>/dev/null)"
      # systemctl reports MainPID=0 when the unit is loaded but no process
      # runs; that is undeterminable, not a PID.
      [ "${pid}" = "0" ] && pid=""
      ;;
    *)
      pid=""
      ;;
  esac
  printf '%s\n' "${pid}"
}

mcp_launcher_installed_path() {
  printf '%s\n' "${MEMPALACE_MCP_LAUNCHER_PATH:-$HOME/.crewrig/mcp-daemon-launcher.sh}"
}

mcp_launcher_source_sha() {
  local src="$CREWRIG_REPO_DIR/scripts/lib/mcp-daemon-launcher.sh"
  [ -f "$src" ] || return 1
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$src" | cut -d' ' -f1
  else
    sha256sum "$src" | cut -d' ' -f1
  fi
}

# Materialise the launcher into ~/.crewrig/ with its placeholders substituted,
# recording the SOURCE hash so status-mcp-server.sh can detect drift between
# the installed copy and the repository. Comparing installed bytes to source
# bytes would report divergence on every correct install — the substitutions
# guarantee they differ — so the recorded hash is the comparable quantity.
install_mcp_launcher() {
  local dst src sha py
  dst="$(mcp_launcher_installed_path)"
  src="$CREWRIG_REPO_DIR/scripts/lib/mcp-daemon-launcher.sh"
  if [ ! -f "$src" ]; then
    echo "  ERROR: $src missing — launcher template not shipped."
    return 1
  fi
  # MEMPALACE_PYTHON wins when set — the same variable the transcript hook
  # honours. It lets a hermetic test materialise the launcher on a machine with
  # no mempalace venv, which is every CI runner.
  py="${MEMPALACE_PYTHON:-$(detect_mempalace_python || true)}"
  if [ -z "$py" ]; then
    echo "  ERROR: cannot detect mempalace pipx python — install mempalace first."
    echo "         (set MEMPALACE_PYTHON to override detection)"
    return 1
  fi
  sha="$(mcp_launcher_source_sha)" || return 1
  mkdir -p "$(dirname "$dst")"
  sed \
    -e "s|__CREWRIG_REPO_DIR__|${CREWRIG_REPO_DIR}|g" \
    -e "s|__MCP_HOST__|${MEMPALACE_MCP_HOST:-$MCP_DAEMON_HOST_DEFAULT}|g" \
    -e "s|__MCP_PORT__|${MEMPALACE_MCP_PORT:-$MCP_DAEMON_PORT_DEFAULT}|g" \
    -e "s|__CHROMA_HOST__|${MEMPALACE_CHROMA_HOST:-127.0.0.1}|g" \
    -e "s|__CHROMA_PORT__|${MEMPALACE_CHROMA_PORT:-8001}|g" \
    -e "s|__MEMPALACE_PYTHON__|${py}|g" \
    -e "s|__MEMPALACE_PALACE_PATH__|${MEMPALACE_PALACE_PATH:-}|g" \
    -e "s|__LAUNCHER_SOURCE_SHA__|${sha}|g" \
    "$src" > "$dst"
  chmod 755 "$dst"
  if grep -qE '__[A-Z][A-Z0-9_]*__' "$dst" 2>/dev/null; then
    echo "  ERROR: $dst still contains an unsubstituted placeholder." >&2
    rm -f "$dst"
    return 1
  fi
  echo "  Installed launcher: $dst"
  return 0
}

_materialise_mcp_unit() {
  local src="$1"
  local dst="$2"
  # Both units name the launcher through the same placeholder, so an
  # overridden launcher path (a test's) reaches both platforms identically.
  sed \
    -e "s|__LAUNCHER_PATH__|$(mcp_launcher_installed_path)|g" \
    -e "s|__MEMPALACE_HOME__|${HOME}/.mempalace|g" \
    "$src" > "$dst"
  # Refuse to emit a unit that still carries an unsubstituted placeholder
  # (spec 0133 R7). A materialised unit that logs to /__MEMPALACE_HOME__/...
  # or execs the literal /__LAUNCHER_PATH__ points at a path that does not
  # exist; failing here beats a supervisor that silently restarts a program
  # that was never installed. A unit that reaches the supervisor only through
  # the two placeholders above is the only shape install_daemon_supervisor
  # ever builds, so a residual placeholder means the template gained a token
  # this materialiser does not know how to fill.
  if grep -qE '__[A-Z][A-Z0-9_]*__' "$dst" 2>/dev/null; then
    echo "  ERROR: $dst still contains an unsubstituted placeholder." >&2
    rm -f "$dst"
    return 1
  fi
  return 0
}

_health_mcp_daemon() {
  local host port
  host="${MEMPALACE_MCP_HOST:-$MCP_DAEMON_HOST_DEFAULT}"
  port="${MEMPALACE_MCP_PORT:-$MCP_DAEMON_PORT_DEFAULT}"
  curl -sf --max-time 3 "http://${host}:${port}/healthz" >/dev/null 2>&1
}

install_mcp_daemon() {
  local repo_dir="$1"
  CREWRIG_REPO_DIR="$repo_dir"
  echo ""
  echo "Installing shared MemPalace MCP HTTP daemon supervisor (spec 0113)..."
  # The token must exist before the launcher runs: it refuses to serve without
  # one, by design (an empty token disables the bearer check upstream).
  if ! mcp_token_read_or_create >/dev/null; then
    echo "  ERROR: could not provision the MCP bearer token."
    echo "         Refusing to install a daemon that would serve unauthenticated."
    return 1
  fi
  install_mcp_launcher || return 1
  install_daemon_supervisor \
    "${MEMPALACE_MCP_LABEL:-$MCP_DAEMON_LABEL_DEFAULT}" \
    "${MEMPALACE_MCP_UNIT:-$MCP_DAEMON_UNIT_DEFAULT}" \
    _materialise_mcp_unit \
    _health_mcp_daemon \
    "$HOME/.mempalace/mcp-server.log"
}

# _mcp_daemon_probe_accepts <host> <port> <token> — true when POST /mcp
# answers a bearer-authenticated, non-notification request (tools/list) with
# a 2xx status. A POSITIVE accept predicate, not "neither 401 nor 000":
# accepting on the class of code an authenticated request actually returns
# retires the 401-vs-403 question outright instead of widening the refusal
# set to guess at it (cold PLAN review on issue #880, non-blocking note #2).
# Verified against mempalace's own HTTP handler while writing this function
# (mempalace/mcp_server.py `_request_rejected` / `do_POST`): a missing OR
# incorrect bearer both send exactly 401 — there is no reachable 403 branch
# on a loopback probe with no Origin header — and an authenticated
# non-notification method is answered `_send_json(200, response)`. `/healthz`
# cannot serve this check: it is `require_auth=False` and returns 200 in
# every state (status-mcp-server.sh:15-17), so it is satisfied by a stale
# process and would be green for exactly the wrong reason.
_mcp_daemon_probe_accepts() {
  local host="$1" port="$2" token="$3" code
  # No `|| echo "000"` fallback: curl's own `-w '%{http_code}'` already
  # writes literal "000" whenever no HTTP response code was received (dead
  # connection, timeout) — REGARDLESS of curl's exit status. Appending a
  # fallback double-writes on that exact path (verified: a refused
  # connection captures "000000", not "000") without ever being needed for
  # a genuinely absent code.
  #
  # The bearer reaches curl through a config read from stdin (`-K -`), never
  # through an `-H` argv flag — the same reasoning `register_mempalace_mcp`
  # records for the Claude registration path below: on Linux
  # /proc/<pid>/cmdline is world-readable, so any local uid sampling the
  # process table while this probe polls harvests the credential. Only the
  # credential leaves argv; `Content-Type` is not a secret and stays there.
  # `-w '%{http_code}'` is unaffected — it still writes a single literal "000"
  # on a dead connection, so the no-fallback reasoning above survives this
  # change. The config's double-quoted value carries no escaping, which is
  # exact only for tokens `mcp_token_read_or_create` MINTED — those are 48
  # characters of [A-Za-z0-9] by construction (`tr -dc 'A-Za-z0-9' | head -c
  # 48`), and widening that charset is what would break this line. On its READ
  # path that function returns whatever a pre-existing token file holds, minus
  # whitespace, so an operator-supplied token can carry quotes or backslashes.
  # That is a malformed-header risk, not an injection one: the same
  # `tr -d '[:space:]'` strips the newline a second config directive would
  # need, and a malformed header can only produce a non-2xx — i.e. the
  # fail-visible path this helper already contracts for, never a silent
  # accept. (spec 0139 delta-01 rationale; spec 0113 R8)
  code="$(printf 'header = "Authorization: Bearer %s"\n' "$token" \
    | curl -K - -s -o /dev/null -w '%{http_code}' --max-time 3 \
      -X POST "http://${host}:${port}/mcp" \
      -H 'Content-Type: application/json' \
      -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' 2>/dev/null)"
  case "$code" in
    2??) return 0 ;;
    *) return 1 ;;
  esac
}

# mcp_daemon_replace_process — leave the running MCP daemon process honouring
# the CURRENT value of the token file, replacing it via the supervisor when it
# does not already (spec 0139 R1, R2).
#
# The fresh-load case (this run's install_daemon_supervisor loaded the unit
# itself, so the process already started on the new token) returns
# immediately — the probe above accepts on the first try and no restart is
# requested. The already-loaded case (install_daemon_supervisor skipped the
# load because a unit was already running — common.sh:602-608 — so the OLD
# process is still the one answering) issues the supervisor's restart
# request: the same launchctl/systemctl primitives stop-mcp-server.sh:24,34
# document as "a stop IS a restart request" under KeepAlive / Restart=always.
# Either way the result is re-probed on a deadline; expiry is reported and
# returned as a failure, never treated as a completed switch over the stale
# credential (R2).
#
# MCP_DAEMON_REPLACE_DEADLINE overrides the poll deadline in seconds (default
# 15, the same budget install_daemon_supervisor's own health poll uses at
# common.sh:637). A hermetic test asserting the expiry path would otherwise
# pay that full deadline on every CI run.
mcp_daemon_replace_process() {
  local label unit host port token deadline_s deadline
  label="${MEMPALACE_MCP_LABEL:-$MCP_DAEMON_LABEL_DEFAULT}"
  unit="${MEMPALACE_MCP_UNIT:-$MCP_DAEMON_UNIT_DEFAULT}"
  host="${MEMPALACE_MCP_HOST:-$MCP_DAEMON_HOST_DEFAULT}"
  port="${MEMPALACE_MCP_PORT:-$MCP_DAEMON_PORT_DEFAULT}"
  token="$(mcp_token_read_or_create)" || return 1
  deadline_s="${MCP_DAEMON_REPLACE_DEADLINE:-15}"

  local initial_listener initial_expected
  initial_listener="$(mcp_listener_pid "$port")"
  initial_expected="$(mcp_supervisor_pid)"

  # Only accept immediately if the listener is NOT a squatter (i.e. if supervisor PID is
  # known, listener PID must match it). If listener differs from supervisor PID, it is an
  # impostor claiming the port and must NOT receive early acceptance even if it answers probes.
  if [ -z "$initial_listener" ] || [ -z "$initial_expected" ] || [ "$initial_listener" = "$initial_expected" ]; then
    if _mcp_daemon_probe_accepts "$host" "$port" "$token"; then
      return 0
    fi
  fi

  # Disclose the replacement window and the evict-then-rotate recovery action
  # before opening the window (spec 0139 R5 delta-01; spec 0149 R3 delta-01).
  echo ""
  echo "  WARNING: replacing the daemon frees ${host}:${port} between the stop and"
  echo "           the relaunch. Any local process that binds it in that window"
  echo "           receives the newly minted token in the very next probe — this"
  echo "           one — and can then answer your agents with fabricated memory."
  echo "           Nothing below can tell that process from the real daemon."
  echo "           Evict any squatter process on ${host}:${port}, verify port"
  echo "           release, and only then rotate the token."
  echo ""

  case "$(uname -s)" in
    Darwin)
      if launchctl list 2>/dev/null | grep -q "$label"; then
        launchctl stop "$label" 2>/dev/null || true
      else
        echo "  WARNING: no launchd unit loaded for '$label' — issuing no restart request." >&2
      fi
      ;;
    Linux)
      if systemctl --user is-active --quiet "$unit" 2>/dev/null; then
        systemctl --user restart "$unit" 2>/dev/null || true
      else
        echo "  WARNING: no systemd unit active for '$unit' — issuing no restart request." >&2
      fi
      ;;
    *)
      echo "  ERROR: unsupported OS '$(uname -s)' — replace the daemon process manually." >&2
      return 1
      ;;
  esac

  deadline=$((SECONDS + deadline_s))
  while [ "$SECONDS" -lt "$deadline" ]; do
    local cur_listener cur_expected
    cur_listener="$(mcp_listener_pid "$port")"
    cur_expected="$(mcp_supervisor_pid)"

    # If an unauthorized squatter process is detected listening on the port:
    if [ -n "$cur_listener" ] && [ -n "$cur_expected" ] && [ "$cur_listener" != "$cur_expected" ]; then
      echo "  WARNING: squatter PID ${cur_listener} detected on ${host}:${port} (expected PID ${cur_expected}) — evicting." >&2
      if [ -n "${MEMPALACE_MCP_EVICT_CMD+x}" ]; then
        eval "${MEMPALACE_MCP_EVICT_CMD}"
      else
        kill -15 "$cur_listener" 2>/dev/null || true
        sleep 0.2
        if [ "$(mcp_listener_pid "$port")" = "$cur_listener" ]; then
          kill -9 "$cur_listener" 2>/dev/null || true
          sleep 0.2
        fi
      fi
      cur_listener="$(mcp_listener_pid "$port")"
      if [ -n "$cur_listener" ] && [ "$cur_listener" != "$cur_expected" ]; then
        echo "  ERROR: failed to evict squatter PID ${cur_listener} from ${host}:${port}." >&2
        return 1
      fi
    fi

    # Only probe if the listener is verified (matches supervisor PID) or if supervisor PID is unknown
    if [ -n "$cur_expected" ]; then
      if [ "$cur_listener" = "$cur_expected" ]; then
        if _mcp_daemon_probe_accepts "$host" "$port" "$token"; then
          return 0
        fi
      fi
    else
      if _mcp_daemon_probe_accepts "$host" "$port" "$token"; then
        return 0
      fi
    fi
    sleep 0.3
  done
  echo "  ERROR: daemon '$label' ('$unit') did not accept the current token within ${deadline_s}s." >&2
  echo "         It may still be honouring a superseded one. Inspect" >&2
  echo "         $HOME/.mempalace/mcp-server.log and retry." >&2
  return 1
}

# --- Four-CLI registration surface (spec 0113 R3, R11; step 8) ---------------
# Built here rather than reused from spec 0091: `apply_org_mcp_servers` skips
# every name in MCP_RESERVED_NAMES by design, and `mempalace` is reserved — the
# org appliers deliberately refuse to touch exactly the server we must
# register. And setup-claude-interactive.sh's `mcp_register_user` takes
# `-- "$@"`, a stdio argv shape with no room for a transport or a header.
#
# One helper, four native shapes, so they cannot drift:
#   Claude       claude mcp add --transport http <name> <url> --header "..."
#   Gemini       {"type":"http","url":…,"headers":{…}}
#   Copilot      {"type":"http","url":…,"headers":{…}}
#   Antigravity  {"serverUrl":…,"headers":{…}}   (no transport type key)

mcp_assistant_config_path() {
  case "$1" in
    claude)      printf '%s\n' "$HOME/.claude.json" ;;
    gemini)      printf '%s\n' "$HOME/.gemini/settings.json" ;;
    copilot)     printf '%s\n' "$HOME/.copilot/mcp-config.json" ;;
    antigravity) printf '%s\n' "$HOME/.gemini/config/mcp_config.json" ;;
    *) return 1 ;;
  esac
}

mcp_daemon_url() {
  printf 'http://%s:%s/mcp\n' \
    "${MEMPALACE_MCP_HOST:-$MCP_DAEMON_HOST_DEFAULT}" \
    "${MEMPALACE_MCP_PORT:-$MCP_DAEMON_PORT_DEFAULT}"
}

# capture_mempalace_registration <cli> — echoes the current registration as
# JSON, or `null` when there is none. Claude's is read from its own config file
# rather than from `claude mcp get`, because restoring must write back the exact
# object the CLI stores.
capture_mempalace_registration() {
  local cli="$1" cfg
  cfg="$(mcp_assistant_config_path "$cli")" || return 1
  [ -f "$cfg" ] || { printf 'null\n'; return 0; }
  jq -c '.mcpServers.mempalace // null' "$cfg" 2>/dev/null || printf 'null\n'
}

# restore_mempalace_registration <cli> <captured_json>
# Returns non-zero when the restore fails — the caller must report that state
# (R14) rather than assume the machine is back where it started.
restore_mempalace_registration() {
  local cli="$1" captured="$2" cfg tmp
  cfg="$(mcp_assistant_config_path "$cli")" || return 1
  [ -f "$cfg" ] || return 1
  if [ "$captured" = "null" ] || [ -z "$captured" ]; then
    write_json_config_secure "$cfg" 'del(.mcpServers.mempalace)' || return 1
  else
    write_json_config_secure "$cfg" --argjson v "$captured" '.mcpServers.mempalace = $v' || return 1
  fi
  return 0
}

# register_mempalace_mcp <cli> <token> — switch one assistant to the shared
# daemon. Returns non-zero on failure, leaving the caller to restore.
register_mempalace_mcp() {
  local cli="$1" token="$2" url cfg
  url="$(mcp_daemon_url)"
  case "$cli" in
    claude)
      command -v claude >/dev/null 2>&1 || return 1
      # NOT `claude mcp add --header "Authorization: Bearer $token"`: on Linux
      # /proc/<pid>/cmdline is world-readable, so any local uid sampling the
      # process table during setup harvests the credential. `mcp add-json` puts
      # the JSON in argv too, so it is no better. Upstream makes the same point
      # about its own token handling. We therefore write the entry the way the
      # other three CLIs are written — the same path restore already uses.
      cfg="$(mcp_assistant_config_path claude)"
      # Claude Code installed but never run has no config file yet — an
      # ordinary state, and one `claude mcp add` used to paper over by creating
      # the file itself. Since we now write the file directly, we must create
      # it, or a fresh install fails the whole all-or-nothing transaction and
      # switches nobody.
      if [ ! -f "$cfg" ]; then
        ( umask 077; printf '%s\n' '{"mcpServers":{}}' > "$cfg" ) || return 1
        chmod 600 "$cfg" || return 1
      fi
      claude mcp remove --scope user mempalace >/dev/null 2>&1 || true
      write_json_config_secure "$cfg" --arg url "$url" --arg auth "Bearer ${token}" \
        '.mcpServers.mempalace = {type:"http", url:$url, headers:{Authorization:$auth}}' \
        || return 1
      return 0
      ;;
    gemini|copilot)
      cfg="$(mcp_assistant_config_path "$cli")"
      [ -f "$cfg" ] || return 1
      write_json_config_secure "$cfg" --arg url "$url" --arg auth "Bearer ${token}" \
        '.mcpServers.mempalace = {type:"http", url:$url, headers:{Authorization:$auth}}' \
        || return 1
      return 0
      ;;
    antigravity)
      # Antigravity's remote shape is {serverUrl, headers} with NO transport
      # type key — grounded in docs/cli-matrix.md row 7h.
      cfg="$(mcp_assistant_config_path "$cli")"
      [ -f "$cfg" ] || return 1
      write_json_config_secure "$cfg" --arg url "$url" --arg auth "Bearer ${token}" \
        '.mcpServers.mempalace = {serverUrl:$url, headers:{Authorization:$auth}}' \
        || return 1
      return 0
      ;;
    *) return 1 ;;
  esac
}

# mcp_assistant_present <cli> — the delta-01 definition of "present on the
# machine": this repo ships a setup script for it AND its own CLI is
# detectable. An absent tool is not part of the all-or-nothing obligation.
mcp_assistant_present() {
  case "$1" in
    claude)      command -v claude >/dev/null 2>&1 ;;
    gemini)      command -v gemini >/dev/null 2>&1 ;;
    copilot)     command -v copilot >/dev/null 2>&1 ;;
    antigravity) command -v agy >/dev/null 2>&1 ;;
    *) return 1 ;;
  esac
}

# switch_assistants_to_http — the transaction (R3, R4, R11-R15).
#
# R12 floor first: every present assistant's config must be readable AND
# writable before anything is applied. `claude mcp add` cannot be pre-flighted
# — no --dry-run, --check or --validate exists — so the floor is what CAN be
# established in advance, and R13's restore covers what cannot.
switch_assistants_to_http() {
  local token="$1"
  local clis="claude gemini copilot antigravity"
  local cli cfg present="" arrangement
  local had_http=0 had_stdio=0

  # --- R15: report a partial state found on entry ---------------------------
  for cli in $clis; do
    mcp_assistant_present "$cli" || continue
    present="$present $cli"
    arrangement="$(mcp_assistant_arrangement "$cli")"
    case "$arrangement" in
      http)    had_http=1 ;;
      stdio)   had_stdio=1 ;;
      unknown)
        echo "  ERROR: $cli is in an unrecognised arrangement."
        echo "         A repeated run cannot resolve a configuration it cannot"
        echo "         recognise. Run 'task mempalace:repair', then re-run. (R14)"
        return 1
        ;;
    esac
  done
  if [ -z "$present" ]; then
    echo "  No supported assistant found on this machine — nothing to switch."
    return 0
  fi
  if [ "$had_http" -eq 1 ] && [ "$had_stdio" -eq 1 ]; then
    echo "  NOTE: found a partial state — some assistants were already switched"
    echo "        and others were not. Converging them now. (R15)"
  fi

  # --- R12: the floor -------------------------------------------------------
  for cli in $present; do
    cfg="$(mcp_assistant_config_path "$cli")"
    # A present assistant with NO config file is a pre-flight failure, not a
    # skip: the apply step needs a file to write into and will fail there
    # instead — after earlier assistants have already been changed, which is
    # exactly what delta-01's first scenario forbids ("no assistant SHALL be
    # changed"). Nesting the checks inside `[ -f ]` let that case through.
    if [ ! -f "$cfg" ]; then
      echo "  ERROR: $cli is installed but has no configuration file yet:"
      echo "         $cfg"
      echo "         Run its own setup script once first. No assistant has been"
      echo "         changed. (R12)"
      return 1
    fi
    if [ ! -r "$cfg" ] || [ ! -w "$cfg" ]; then
      echo "  ERROR: $cli's configuration is not both readable and writable:"
      echo "         $cfg"
      echo "         No assistant has been changed. (R12)"
      return 1
    fi
    if ! jq -e . "$cfg" >/dev/null 2>&1; then
      echo "  ERROR: $cli's configuration does not parse: $cfg"
      echo "         No assistant has been changed. (R12)"
      return 1
    fi
  done

  # --- Capture, then apply --------------------------------------------------
  local applied="" captured_claude="null" captured_gemini="null"
  local captured_copilot="null" captured_antigravity="null" cap
  for cli in $present; do
    cap="$(capture_mempalace_registration "$cli")"
    case "$cli" in
      claude)      captured_claude="$cap" ;;
      gemini)      captured_gemini="$cap" ;;
      copilot)     captured_copilot="$cap" ;;
      antigravity) captured_antigravity="$cap" ;;
    esac
    backup_file "$(mcp_assistant_config_path "$cli")"
  done

  for cli in $present; do
    # Record the assistant as touched BEFORE attempting, not after succeeding.
    # register_mempalace_mcp is not atomic for Claude — it removes the old
    # entry, then writes the new one — so a failure leaves the assistant with
    # NO registration at all. Rolling back only the successes would then skip
    # the one assistant that actually lost its configuration, and `failed`
    # would stay empty so R14's report never fires: silent, total memory loss
    # on the primary CLI.
    applied="$applied $cli"
    if register_mempalace_mcp "$cli" "$token"; then
      echo "  $cli: switched to the shared daemon"
    else
      echo "  ERROR: $cli could not be switched."
      _switch_rollback "$applied" \
        "$captured_claude" "$captured_gemini" "$captured_copilot" "$captured_antigravity"
      return 1
    fi
  done
  return 0
}

# _switch_rollback <applied_list> <claude> <gemini> <copilot> <antigravity>
# R13, and R14 when a restore itself fails.
_switch_rollback() {
  local applied="$1" c_claude="$2" c_gemini="$3" c_copilot="$4" c_antigravity="$5"
  local cli cap failed=""
  echo "  Restoring the assistants already changed in this run... (R13)"
  for cli in $applied; do
    case "$cli" in
      claude)      cap="$c_claude" ;;
      gemini)      cap="$c_gemini" ;;
      copilot)     cap="$c_copilot" ;;
      antigravity) cap="$c_antigravity" ;;
      *) continue ;;
    esac
    if restore_mempalace_registration "$cli" "$cap"; then
      echo "    $cli: restored"
    else
      echo "    $cli: RESTORE FAILED"
      failed="$failed $cli"
    fi
  done
  if [ -n "$failed" ]; then
    echo ""
    echo "  *** MANUAL REPAIR REQUIRED (R14) ***"
    echo "  These assistants could not be returned to their previous arrangement:"
    for cli in $failed; do
      echo "    - $cli  ($(mcp_assistant_config_path "$cli"))"
    done
    echo "  Each config was backed up before the change; run"
    # `--` is load-bearing, not decoration: the Taskfile entry forwards
    # {{.CLI_ARGS}}, which go-task populates ONLY from arguments after a `--`
    # separator. Without it the flag is parsed as a task flag and the operator
    # gets `unknown flag:` plus a usage dump instead of the restore this
    # handoff exists to hand them (same form as `task prune-transcripts --`).
    echo "  'task mempalace:repair -- --restore-backup' to restore the timestamped"
    echo "  .bak file, or re-run setup once the cause is fixed."
    echo ""
    echo "  Current state of every assistant:"
    mcp_report_assistant_arrangements
  fi
}

# mcp_assistant_arrangement <cli>
#
# Echoes the arrangement one assistant is currently configured for, as one of:
#   http     — reaches shared memory through the shared MCP daemon
#   stdio    — spawns its own memory server (the previous arrangement)
#   none     — no mempalace registration
#   unknown  — a registration exists but matches neither shape (spec 0113 R14:
#              reported, never silently converged — repetition cannot resolve a
#              configuration it cannot recognise)
#   absent   — the assistant's own CLI is not installed on this machine, so it
#              is not part of the all-or-nothing obligation (delta-01 definition)
#
# One reader, consumed by both status-mcp-server.sh and doctor-mempalace.sh so
# the two cannot drift apart on what "current arrangement" means.
mcp_assistant_arrangement() {
  local cli="$1" entry="" entry_cfg=""
  case "$cli" in
    claude)
      command -v claude >/dev/null 2>&1 || { printf 'absent\n'; return 0; }
      # Read the CONFIG FILE, not `claude mcp get` output. Grepping that text
      # for http|url|/mcp matched `mempalace-http-wrapper.py` sitting in a
      # STDIO entry's args, so a stdio Claude reported as http — verified on a
      # real machine. The file is JSON like the other three, so the same exact
      # test applies and the only textual branch disappears.
      entry_cfg="$(mcp_assistant_config_path claude)"
      [ -f "$entry_cfg" ] || { printf 'none\n'; return 0; }
      # R3 (spec 0165): a file that does not parse is residue, not "no
      # registration" — reporting it as none would let a repeated setup run
      # treat it as convergeable and fail mid-switch.
      if ! jq -e . "$entry_cfg" >/dev/null 2>&1; then
        printf 'unknown\n'
        return 0
      fi
      entry="$(jq -c '.mcpServers.mempalace // empty' "$entry_cfg" 2>/dev/null)"
      if [ -z "$entry" ]; then
        printf 'none\n'
      elif printf '%s' "$entry" | jq -e 'has("url") or has("serverUrl")' >/dev/null 2>&1; then
        printf 'http\n'
      elif printf '%s' "$entry" | jq -e 'has("command")' >/dev/null 2>&1; then
        printf 'stdio\n'
      else
        printf 'unknown\n'
      fi
      return 0
      ;;
    gemini)      entry="$HOME/.gemini/settings.json" ;;
    copilot)     entry="$HOME/.copilot/mcp-config.json" ;;
    antigravity) entry="$HOME/.gemini/config/mcp_config.json" ;;
    *) printf 'unknown\n'; return 0 ;;
  esac
  [ -f "$entry" ] || { printf 'absent\n'; return 0; }
  # R3 (spec 0165): a file that does not parse is residue, not "no
  # registration" — reporting it as none would let a repeated setup run
  # treat it as convergeable and fail mid-switch.
  if ! jq -e . "$entry" >/dev/null 2>&1; then
    printf 'unknown\n'
    return 0
  fi
  local node
  node="$(jq -c '.mcpServers.mempalace // empty' "$entry" 2>/dev/null)"
  if [ -z "$node" ]; then
    printf 'none\n'
  elif printf '%s' "$node" | jq -e 'has("url") or has("serverUrl")' >/dev/null 2>&1; then
    printf 'http\n'
  elif printf '%s' "$node" | jq -e 'has("command")' >/dev/null 2>&1; then
    printf 'stdio\n'
  else
    printf 'unknown\n'
  fi
  return 0
}

mcp_report_assistant_arrangements() {
  local daemon_status="${1:-}"
  local cli state has_lockout=0
  for cli in claude gemini copilot antigravity; do
    state="$(mcp_assistant_arrangement "$cli")"
    case "$state" in
      http)    printf '  %-12s http (shared daemon)\n' "$cli" ;;
      stdio)
        if [ "$daemon_status" = "serving" ] || [ "$daemon_status" = "healthy" ]; then
          printf '  %-12s stdio (LOCKED OUT by shared daemon)\n' "$cli"
          has_lockout=1
        else
          printf '  %-12s stdio (previous arrangement)\n' "$cli"
        fi
        ;;
      none)    printf '  %-12s no mempalace registration\n' "$cli" ;;
      absent)  printf '  %-12s CLI not installed\n' "$cli" ;;
      *)       printf "  %-12s *** UNRECOGNISED — run 'task mempalace:repair' ***\n" "$cli" ;;
    esac
  done
  [ "$has_lockout" -eq 0 ] || return 1
  return 0
}

# offer_mcp_http_switch <repo_dir> <cli>
#
# Called by each setup script after it has written its MCP configuration
# (spec 0113 R3). Without this, a setup run would leave that assistant on the
# previous stdio arrangement — and worse, SILENTLY UNDO an earlier switch:
# `mempalace` is in MCP_RESERVED_NAMES, so merge_preexisting_mcp_servers
# deliberately does not preserve an operator's entry under that name, and the
# framework write that replaces it is stdio-shaped. A user who ran the switch
# and later re-ran any setup would find the lock contention back with nothing
# explaining why.
#
# SCOPE, stated rather than implied: this switches THIS assistant only. The
# machine-wide all-or-nothing obligation (R4, delta R12-R14) belongs to
# `switch-mempalace-http.sh`; a single-CLI run sits outside it by design, so it
# reports which other assistants it is leaving behind instead of pretending to
# have converged the machine.
offer_mcp_http_switch() {
  local repo_dir="$1" cli="$2" token other state left=""
  CREWRIG_REPO_DIR="$repo_dir"
  echo ""
  echo "Shared memory daemon (spec 0113):"
  echo "  Without it, every session spawns its own memory server and only the"
  echo "  first one to write can write — the rest are refused for their whole life."
  local choice
  choice=$(echo -e "yes\nno" | fzf --height 10% \
    --header "Reach shared memory through the shared daemon? (recommended)")
  if [ "$choice" != "yes" ]; then
    echo "  Skipped — this assistant keeps spawning its own memory server."
    return 0
  fi
  if ! install_mcp_daemon "$repo_dir"; then
    echo "  ERROR: the daemon is not serving — leaving this assistant unchanged."
    echo "         Registering it against a daemon that is not there would break"
    echo "         every session (R5: fail visibly, never fall back silently)."
    return 1
  fi
  token="$(mcp_token_read_or_create)" || {
    echo "  ERROR: could not read the bearer token — leaving this assistant unchanged."
    return 1
  }
  if register_mempalace_mcp "$cli" "$token"; then
    echo "  $cli now reaches shared memory through the daemon."
  else
    echo "  ERROR: could not switch $cli."
    return 1
  fi
  for other in claude gemini copilot antigravity; do
    [ "$other" = "$cli" ] && continue
    mcp_assistant_present "$other" || continue
    state="$(mcp_assistant_arrangement "$other")"
    [ "$state" = "http" ] && continue
    left="$left $other"
  done
  if [ -n "$left" ]; then
    echo ""
    echo "  NOTE: this run switched $cli only. Still on the previous arrangement:"
    for other in $left; do echo "    - $other"; done
    echo "  They will contend for the memory lock with $cli until they switch too."
    echo "  Switch the whole machine at once with: task mempalace:switch-http"
  fi
  echo ""
  echo "  Restart any running $cli session to pick this up."
  return 0
}

# uninstall_daemon_supervisor <launchd_label> <systemd_unit>
#
# The symmetric inverse of install_daemon_supervisor (spec 0113, step 2b).
# Each verb undoes exactly the verb the installer used:
#
#   launchd:  `unload -w`      undoes  `load -w`      (common.sh install path)
#   systemd:  `disable --now`  undoes  `enable --now`
#
# The `-w` half matters and is NOT an oversight to modernise: `load -w` writes
# the "enabled" state that survives a reboot, so only `unload -w` un-writes it.
# `launchctl unload` without `-w` stops the daemon now and lets it return at the
# next login. The pair is legacy launchd API on purpose — modernising one half
# would break the symmetry that makes the uninstall honest.
#
# This is deliberately NOT what stop-*-server.sh calls. Stopping a supervised
# daemon is a restart request (KeepAlive / Restart=always bring it straight
# back); ending it is this function. Two verbs, two meanings, two entry points.
uninstall_daemon_supervisor() {
  local label="$1"
  local systemd_unit="$2"
  local os removed=0
  os="$(uname -s)"
  case "$os" in
    Darwin)
      local plist_dst="$HOME/Library/LaunchAgents/${label}.plist"
      if launchctl list 2>/dev/null | grep -q "$label"; then
        if [ -f "$plist_dst" ]; then
          launchctl unload -w "$plist_dst" 2>/dev/null && removed=1
        else
          # Loaded with no plist on disk: remove by label so it stops
          # respawning even though the file we would unload is gone.
          launchctl remove "$label" 2>/dev/null && removed=1
        fi
      fi
      if [ -f "$plist_dst" ]; then
        rm -f "$plist_dst"
        echo "  Removed unit: $plist_dst"
      fi
      ;;
    Linux)
      if systemctl --user is-enabled --quiet "$systemd_unit" 2>/dev/null \
        || systemctl --user is-active --quiet "$systemd_unit" 2>/dev/null; then
        systemctl --user disable --now "$systemd_unit" 2>/dev/null && removed=1
      fi
      local svc_dst="$HOME/.config/systemd/user/${systemd_unit}.service"
      if [ -f "$svc_dst" ]; then
        rm -f "$svc_dst"
        systemctl --user daemon-reload 2>/dev/null || true
        echo "  Removed unit: $svc_dst"
      fi
      ;;
    *)
      echo "  ERROR: unsupported OS '$os' — remove the supervisor unit manually."
      return 1
      ;;
  esac
  if [ "$removed" -eq 1 ]; then
    echo "  Supervisor stopped and disabled: $label"
  else
    echo "  Supervisor was not loaded: $label"
  fi
  return 0
}

# --- MCP HTTP daemon: token provisioning (spec 0113 R8, step 6) --------------
# The bearer token the MCP HTTP daemon requires and every CLI registration
# sends. Keyed per palace so two palaces on one machine never share a
# credential, and mode 0600 because it IS a credential.
#
# The path scheme mirrors upstream's own (`_server_token_path` in mempalace's
# cli.py): ~/.mempalace/server/<sha256(realpath(palace))[:24]>/token. Matching
# it means an operator who ran `mempalace serve` by hand and the framework
# converge on one file rather than two competing ones.
#
# Read-or-create, never truncate-then-write: a concurrent reader must never
# observe a half-written token. Creation is exclusive (`set -C`), so two setup
# scripts racing produce one token and one winner, and the loser reads it.
mcp_token_path() {
  local palace_path="${MEMPALACE_PALACE_PATH:-$HOME/.mempalace/palace}"
  local resolved key
  if [ -d "$palace_path" ]; then
    resolved="$(cd -P "$palace_path" 2>/dev/null && pwd -P)"
  else
    # The parent must exist before resolving, or the key would depend on whether
    # the directory happens to be there yet.
    mkdir -p "$(dirname "$palace_path")" 2>/dev/null || true
    resolved="$(cd -P "$(dirname "$palace_path")" 2>/dev/null && pwd -P)/$(basename "$palace_path")"
  fi
  key="$(printf '%s' "$resolved" | shasum -a 256 2>/dev/null | cut -c1-24)"
  if [ -z "$key" ]; then
    key="$(printf '%s' "$resolved" | sha256sum | cut -c1-24)"
  fi
  printf '%s\n' "$HOME/.mempalace/server/${key}/token"
}

# mcp_token_read_or_create — echoes the token, creating it when absent.
# Returns non-zero without echoing when it can neither read nor create one:
# the caller must fail loudly rather than proceed with an empty credential.
mcp_token_read_or_create() {
  local token_file token dir existing
  token_file="$(mcp_token_path)"
  if [ -s "$token_file" ]; then
    # Strip whitespace on the way out: upstream strips before storing, so a
    # whitespace-only file is a non-empty string here and an EMPTY token there,
    # which disables the bearer check. Returning it verbatim would register
    # `Authorization: Bearer ` across all four CLIs.
    existing="$(tr -d '[:space:]' < "$token_file")"
    if [ -n "$existing" ]; then
      printf '%s\n' "$existing"
      return 0
    fi
    echo "  ERROR: the token file exists but is whitespace-only: $token_file" >&2
    echo "         Refusing to use it — an empty token disables authentication." >&2
    return 1
  fi
  dir="$(dirname "$token_file")"
  mkdir -p "$dir" 2>/dev/null || return 1
  # Fatal, not best-effort: the entire security model rests on these modes, so a
  # silent failure would leave a credential readable by every uid on the host.
  chmod 700 "$dir" || { echo "  ERROR: cannot restrict $dir to 0700" >&2; return 1; }
  chmod 700 "$(dirname "$dir")" 2>/dev/null || true
  token="$(LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom 2>/dev/null | head -c 48)"
  if [ -z "$token" ]; then
    return 1
  fi
  # umask 077 so the file is NEVER briefly world-readable: creating at the
  # ambient umask and narrowing afterwards leaves a window, and leaves the
  # credential wide forever if the chmod fails. `set -C` keeps the create
  # exclusive so a concurrent winner's token is read rather than clobbered.
  ( umask 077; set -C; printf '%s' "$token" > "$token_file" ) 2>/dev/null || true
  chmod 600 "$token_file" || { echo "  ERROR: cannot restrict $token_file to 0600" >&2; return 1; }
  if [ -s "$token_file" ]; then
    tr -d '[:space:]' < "$token_file"
    printf '\n'
    return 0
  fi
  return 1
}

# write_json_config_secure <path> <jq_program> [jq_args...]
#
# Rewrite a config that carries the bearer token, without ever widening it.
# `mv` is rename(2): the destination inherits the TEMP file's mode, so a plain
# `jq > tmp && mv` created at umask 022 silently downgrades a 0600 config to
# 0644 — in the same operation that inserts the credential. Observed on a real
# machine: ~/.gemini/settings.json is 0600 before, 0644 after, token inside.
write_json_config_secure() {
  local cfg="$1"; shift
  local tmp
  # mktemp, not "${cfg}.tmp.$$". Every operation below follows symlinks, and a
  # predictable name turns write access to the config's directory into an
  # arbitrary-file-write with the bearer token as payload: pre-create the
  # expected name as a symlink and the victim is truncated and overwritten with
  # this JSON. Demonstrated during review against a 0600 file in another
  # directory. mktemp refuses to reuse an existing name, so the primitive dies.
  tmp="$(umask 077; mktemp "${cfg}.tmp.XXXXXX")" || return 1
  chmod 600 "$tmp" || { rm -f "$tmp"; return 1; }
  if ! jq "$@" "$cfg" > "$tmp" 2>/dev/null; then
    rm -f "$tmp"
    return 1
  fi
  mv "$tmp" "$cfg" || { rm -f "$tmp"; return 1; }
  # The destination now holds a credential regardless of what it was before.
  chmod 600 "$cfg" || {
    echo "  ERROR: $cfg holds a bearer token and could not be restricted to 0600." >&2
    return 1
  }
  return 0
}

# print_store_access_guidance <cli>
#
# Prints actionable, evidence-grounded guidance on how to grant the
# per-invocation read of the user-space system-context store
# (~/.crewrig/system-context, spec 0068) on the two CLIs that gate an
# out-of-workspace absolute-path read behind trust/path approval:
# Gemini and Copilot. This function ONLY echoes to the user — it writes no
# file and mutates no config, upholding ADR-0013 / spec 0075 R2 (no durable
# trust config is written on any CLI). The grants named below are traced to
# the sandbox probe (docs/research/system-context-sandbox-probe.md §1, §4.3,
# §4.4); no flags are invented. The PASS-default CLIs (Claude, Antigravity)
# do NOT call this — they read the store bare, with no flags or config.
print_store_access_guidance() {
  local cli="$1"
  local store="~/.crewrig/system-context"
  echo ""
  echo "System-context store access (spec 0068):"
  echo "  The framework installs a shared rule store at $store."
  echo "  When a rule from the store is needed, the CLI reads it on demand."
  echo "  Setup writes NO durable trust config; where the read still cannot be"
  echo "  satisfied, the store surfaces its explicit fallback signal (spec 0068)."
  case "$cli" in
    gemini)
      echo "  Gemini gates tool use on workspace trust. Make the store path"
      echo "  trusted for the invocation with one of:"
      echo "    gemini --include-directories $store"
      echo "    GEMINI_CLI_TRUST_WORKSPACE=true gemini ..."
      echo "    gemini --skip-trust ..."
      echo "  or approve the directory interactively when prompted."
      ;;
    copilot)
      echo "  Copilot denies the out-of-workspace read unless the path is"
      echo "  granted. Grant it per-invocation with one of:"
      echo "    copilot --add-dir $store"
      echo "    copilot --allow-all-paths"
      echo "  or approve the read interactively when prompted."
      echo "  Note: trustedFolders in ~/.copilot/config.json does NOT durably"
      echo "  authorize this cross-project read."
      ;;
  esac
}

# configure_validation_backend
#
# Captures the per-user user-gate validation backend and the three cross-cutting
# options (spec 0080), then persists them to ~/.crewrig/validation.conf — a
# per-user, machine-local file OUTSIDE the core layer, never a committed layer
# file (spec 0080 R15/R16, delta-01). The `user-validate` skill reads this file
# at gate time to decide how to realise a validation gate.
#
# Two drive paths:
#   Interactive (default) — fzf prompts, mirroring the opt-in toggles elsewhere
#     in these scripts (e.g. INSTALL_SEQTHINK).
#   Non-interactive (hermetic CI) — when ANY of VALIDATION_BACKEND,
#     VALIDATION_TRANSLATE, VALIDATION_PEDAGOGY, or VALIDATION_ILLUSTRATION is
#     set, the fzf prompts are bypassed and values are taken from the
#     environment (each unset variable falls back to its documented default).
#     This is the surface the CI test drives.
#
# Enum contract (an invalid value fails loudly — load-bearing in the
# non-interactive path):
#   backend      : internal | plannotator          (default: internal)
#   translate    : off | on                         (default: off)
#   pedagogy     : simple | contextual | professor  (default: contextual)
#   illustration : off | on                         (default: off)
#
# The selection is recorded verbatim. Selecting `plannotator` only prints
# install guidance; it never downgrades the recorded backend — the
# binary-absent fallback to `internal` happens at gate time in the skill
# (spec 0080 R4), not here.
configure_validation_backend() {
  local conf_dir="${HOME}/.crewrig"
  local conf_file="${conf_dir}/validation.conf"
  local backend translate pedagogy illustration

  if [ -n "${VALIDATION_BACKEND:-}" ] || [ -n "${VALIDATION_TRANSLATE:-}" ] \
     || [ -n "${VALIDATION_PEDAGOGY:-}" ] || [ -n "${VALIDATION_ILLUSTRATION:-}" ]; then
    # Non-interactive path (hermetic CI): env overrides, defaults for the rest.
    backend="${VALIDATION_BACKEND:-internal}"
    translate="${VALIDATION_TRANSLATE:-off}"
    pedagogy="${VALIDATION_PEDAGOGY:-contextual}"
    illustration="${VALIDATION_ILLUSTRATION:-off}"
  else
    # Interactive path. Esc / empty selection falls back to the default so an
    # optional convenience prompt never aborts the whole setup.
    echo ""
    echo "User-gate validation backend (spec 0080):"
    backend=$(printf '%s\n' internal plannotator | fzf --height 10% \
      --header "Validation backend? (internal = built-in AskUserQuestion prompt; plannotator = rich browser review, opt-in)") || backend=""
    [ -n "$backend" ] || backend="internal"

    translate=$(printf '%s\n' off on | fzf --height 10% \
      --header "Translate the spec/plan into your preferred language for the gate presentation only? (the repo artifact stays English)") || translate=""
    [ -n "$translate" ] || translate="off"

    pedagogy=$(printf '%s\n' contextual simple professor | fzf --height 10% \
      --header "Pedagogy level for validation requests? (simple / contextual / professor)") || pedagogy=""
    [ -n "$pedagogy" ] || pedagogy="contextual"

    illustration=$(printf '%s\n' off on | fzf --height 10% \
      --header "Generate illustrations for reviews? (honoured only with the plannotator backend + a browser surface)") || illustration=""
    [ -n "$illustration" ] || illustration="off"
  fi

  # --- Enum validation (defensive interactively; load-bearing in CI) ---
  case "$backend" in
    internal|plannotator) ;;
    *) echo "  ERROR: invalid validation backend '$backend' (want: internal|plannotator)"; return 1 ;;
  esac
  case "$translate" in
    on|off) ;;
    *) echo "  ERROR: invalid validation translate '$translate' (want: on|off)"; return 1 ;;
  esac
  case "$pedagogy" in
    simple|contextual|professor) ;;
    *) echo "  ERROR: invalid validation pedagogy '$pedagogy' (want: simple|contextual|professor)"; return 1 ;;
  esac
  case "$illustration" in
    on|off) ;;
    *) echo "  ERROR: invalid validation illustration '$illustration' (want: on|off)"; return 1 ;;
  esac

  # --- Persist (machine-local, outside the core layer; spec 0080 R15/R16) ---
  mkdir -p "$conf_dir"
  {
    printf '# crewrig user-gate validation backend (spec 0080)\n'
    printf '# Per-user, machine-local; not a committed layer file. Read by the user-validate skill.\n'
    printf 'backend=%s\n' "$backend"
    printf 'translate=%s\n' "$translate"
    printf 'pedagogy=%s\n' "$pedagogy"
    printf 'illustration=%s\n' "$illustration"
  } > "${conf_file}.tmp" && mv "${conf_file}.tmp" "$conf_file"
  echo "  Validation backend recorded: backend=$backend translate=$translate pedagogy=$pedagogy illustration=$illustration"
  echo "    -> $conf_file"

  if [ "$backend" = "plannotator" ]; then
    echo "  Plannotator backend selected. Install the binary if it is not present:"
    echo "    curl -fsSL https://plannotator.ai/install.sh | bash"
    if ! command -v plannotator >/dev/null 2>&1; then
      echo "  Note: 'plannotator' is not on PATH yet — until it is installed, gates"
      echo "        fall back to the 'internal' backend at gate time (spec 0080 R4)."
    fi
  fi
  return 0
}

# --- Antigravity CLI transcript-hook deployment (spec 0116 R13/R14/R15) ------
#
# deploy_antigravity_transcript_hooks <manifest_src> <hook_src> <hooks_dir> <manifest_target> <env_prefix> <guard_src>
#
# Why this is a helper rather than an inline block like its three siblings:
# `scripts/tests/test-setup-mcp-merge.sh` records the house rule that the
# interactive setup scripts cannot run end-to-end in CI (fzf prompts, the `agy`
# guard, the chroma daemon). Spec 0116 R17 requires hermetic coverage of the
# deployment, so the deployment has to live somewhere a test can call. The two
# `fzf` prompts stay in the setup script and are asserted structurally.
#
# What it does, in order:
#   1. installs the shared hook script under the assistant's own directory, so
#      the deployed hook stops depending on this repository's path (R13);
#   2. rewrites every command in the manifest by named-hook dispatch (spec 0116
#      delta-03 R28):
#      - under `crewrig-mempalace-transcript`, every command names the installed
#        absolute path, prefixed with `$env_prefix`, and appends the lifecycle
#        event name (R14, and R5 — the Antigravity payload carries no event
#        name, so the manifest must say which event fired);
#      - under `crewrig-worktree-git-guard`, the command names the absolute
#        REPOSITORY path of the guard (never installed), with NO env prefix and
#        NO event argument — the guard inspects the payload it reads from stdin,
#        and it delegates claim validation to `scripts/worktree-claim.sh`
#        relative to the repo, so an installed copy would break that chain;
#   3. backs up an existing manifest before touching it (R15) and MERGES into
#      it rather than overwriting: `hooks.json`'s top level is a map of NAMED
#      hooks and the operator may own others. Same-named hooks are replaced,
#      which is what re-running setup should do.
#
# The rewrite uses `with_entries`, not the `map` the sibling setups use, for two
# reasons: the event name is a KEY here rather than a field, and a named hook may
# carry a non-array `enabled` member that must be passed through untouched.
deploy_antigravity_transcript_hooks() {
  local manifest_src="$1" hook_src="$2" hooks_dir="$3" manifest_target="$4" env_prefix="$5" guard_src="$6"
  local hook_target="${hooks_dir}/mempalace-transcript.sh"
  # The guard is NEVER installed under the assistant's own directory (unlike the
  # transcript hook): it delegates claim validation to
  # `scripts/worktree-claim.sh` via `$(dirname "${BASH_SOURCE[0]}")/..`, and
  # `BASH_SOURCE[0]` is the invocation path — an installed copy would resolve
  # `..` to the wrong tree. Pin the rewrite to this repository's absolute path.
  local guard_abs
  guard_abs="$(cd "$(dirname "$guard_src")" && pwd -P)/$(basename "$guard_src")"

  mkdir -p "$hooks_dir" "$(dirname "$manifest_target")"

  install_file "$hook_src" "$hook_target" \
    "mempalace-transcript.sh -> ${hook_target}"
  chmod +x "$hook_target" 2>/dev/null || true

  local patched
  patched="$(mktemp)"
  # Two element shapes, per the CLI's own docs/hooks.md: PreToolUse/PostToolUse
  # are GROUPED — each element is `{matcher, hooks: [handler, ...]}` — while
  # PreInvocation/PostInvocation/Stop are FLAT, each element being a handler
  # itself. Rewriting `.command` unconditionally would bolt a meaningless
  # `command` onto a group object and leave the real handler inside `hooks`
  # untouched, which the CLI would happily load and never run. The shipped
  # manifest registers only flat events today, so that mistake would have been
  # invisible until the first tool event was ever registered.
  # Two rewrite paths, dispatched on the named-hook key (spec 0116 delta-03 R28):
  #   - `crewrig-mempalace-transcript` keeps the established contract — absolute
  #     INSTALLED path, transcript enabling env prefix, lifecycle-event argument.
  #   - `crewrig-worktree-git-guard` is rewritten to the absolute REPOSITORY path
  #     of the guard with NO env prefix and NO event argument: the guard reads
  #     the command from its stdin payload rather than a positional argument (R5
  #     exemption), and must resolve `scripts/worktree-claim.sh` relative to the
  #     repo, so an installed copy would break its delegation chain.
  jq --arg envp "$env_prefix" --arg hp "$hook_target" --arg gp "$guard_abs" '
    def rewrite($ev): .command = ($envp + " bash " + ($hp | tojson) + " " + $ev);
    def guard_rewrite: .command = ("bash " + ($gp | tojson));
    with_entries(
      if .key == "crewrig-worktree-git-guard"
      then .value |= with_entries(
        if (.value | type) == "array"
        then .value |= map(
          if has("hooks") and (.hooks | type) == "array"
          then .hooks |= map(guard_rewrite)
          else guard_rewrite
          end
        )
        else .
        end
      )
      else .value |= with_entries(
        if (.value | type) == "array"
        then (.key) as $ev
             | .value |= map(
                 if has("hooks") and (.hooks | type) == "array"
                 then .hooks |= map(rewrite($ev))
                 else rewrite($ev)
                 end
               )
        else .
        end
      )
      end
    )' "$manifest_src" > "$patched" || { rm -f "$patched"; return 1; }

  # `cmd > out && mv` would swallow a jq failure: POSIX exempts every command in
  # an `&&` list except the last from `set -e`, so a refused input would skip the
  # `mv`, fall through to the success message, and return 0 — reporting a
  # deployment that never happened. Fail loudly instead.
  if [ -f "$manifest_target" ]; then
    backup_file "$manifest_target"
    # `+`, NOT `*`. Object `+` is a SHALLOW right-biased merge: a hook we own is
    # replaced wholesale, while every hook the operator owns is untouched. Deep
    # merge (`*`) would union the EVENT keys inside our own hook, so an event we
    # have since retired — say the `SessionEnd` that spec 0056 shipped and this
    # spec removes — would survive a re-run, still pointing at a stale command.
    # The operator's entries are preserved either way; only our own must be
    # authoritative.
    if ! jq -s '.[0] + .[1]' "$manifest_target" "$patched" > "${manifest_target}.tmp" 2>/dev/null; then
      rm -f "${manifest_target}.tmp" "$patched"
      echo "  ERROR: $manifest_target is not a JSON object; refusing to merge." >&2
      echo "         Your original file is untouched, and a backup sits beside it." >&2
      # The hook script installed above is deliberately NOT removed. It may have
      # been put there by an earlier successful run, and a manifest already on
      # disk may still reference it; deleting it to tidy up this failure would
      # break that deployment. An unreferenced copy is inert — a deleted one that
      # something still points at is not.
      return 1
    fi
    mv "${manifest_target}.tmp" "$manifest_target"
  else
    cp "$patched" "$manifest_target"
  fi
  rm -f "$patched"

  echo "  Transcript hooks deployed to $manifest_target"
}

# ============================================================================
# Antigravity component install and superseded-placement migration (spec 0123)
# ============================================================================
#
# WHY THESE LIVE HERE AND NOT INLINE. `docs/cli-matrix.md` row 10 records that
# the interactive setup scripts cannot run end-to-end in CI — `fzf` prompts, the
# `agy` binary guard, the chroma daemon. Spec 0116 R17 moved the transcript-hook
# deployment into this file for exactly that reason, and the same constraint
# applies to placement, verification and migration: the code that has to be
# hermetically tested must be callable, so `scripts/tests/*.sh` can `source` it
# and the `fzf` prompts are asserted structurally instead.

# _antigravity_frontmatter_name <file>
#
# The component's declared name, read from the LEADING `---` block only.
#
# DELIBERATELY NOT `yaml_field`. That helper (scripts/lib/render-command.sh)
# ends `… | yq -r ".$field" 2>/dev/null || echo ""`, so on a machine without
# `yq` it does not fail — it returns the EMPTY STRING. Neither Antigravity
# install surface requires `yq` (`setup-antigravity-interactive.sh` and
# `manage-antigravity-component.sh` require `jq` only), so a `yaml_field`-based
# predicate would yield an empty name set, a migration that removes nothing, and
# an exit status of 0: a silent no-op, which is the exact failure class this
# spec exists to correct.
_antigravity_frontmatter_name() {
  awk '
    NR == 1 && $0 != "---" { exit }
    NR == 1 { in_fm = 1; next }
    in_fm && $0 == "---" { exit }
    in_fm && /^name:[ \t]*/ {
      sub(/^name:[ \t]*/, "")
      sub(/^["\047]/, ""); sub(/["\047]$/, "")
      print
      exit
    }
  ' "$1" 2>/dev/null
}

# _antigravity_has_provenance <file>
#
# True iff the file's LEADING frontmatter block carries a
# `metadata.provenance.canonical` entry — the marker `inject_provenance()` in
# scripts/build-components.sh stamps into every built component, and therefore
# the half of the migration predicate that distinguishes a framework install
# from a directory the user happens to have named the same thing.
#
# THE FRONTMATTER BOUNDARY IS THE WHOLE POINT, and it is one line thick.
# Deleting the `in_fm && $0 == "---" { exit }` rule below turns this into a
# whole-file scan that matches prose. That is not a theoretical degradation:
# the shipped `artifacts/library/skills/harness-report/SKILL.md` carries a
# `canonical:` token on FOUR body lines besides the real one — frontmatter
# closes at line 18, the real entry is line 11, and lines 73, 76, 146 and 206
# are body. A whole-file reader would call every one of them provenance, which
# would let the migration delete a user's own directory. The regression fixture
# in scripts/tests/test-antigravity-component-install.sh puts an INDENTED
# `canonical:` in a fixture's body precisely so that only this boundary
# separates it from a real one.
_antigravity_has_provenance() {
  local verdict
  verdict="$(awk '
    NR == 1 && $0 != "---" { exit }
    NR == 1 { in_fm = 1; next }
    in_fm && $0 == "---" { exit }
    in_fm && /^[[:space:]]+provenance:[[:space:]]*$/ { seen_prov = 1; next }
    in_fm && seen_prov && /^[[:space:]]+canonical:[[:space:]]*[^[:space:]]/ {
      print "YES"; exit
    }
  ' "$1" 2>/dev/null)"
  [ "$verdict" = "YES" ]
}

# _antigravity_kind_marker <kind> — the file whose presence makes a component of
# that kind real: a skill is its SKILL.md, an agent its AGENT.md.
_antigravity_kind_marker() {
  case "$1" in
    skills) printf 'SKILL.md\n' ;;
    *)      printf 'AGENT.md\n' ;;
  esac
}

# install_antigravity_tier_to_home <repo_dir> <tier> <skills_home> <agents_home>
#
# Copy a staged tier's Antigravity components into the user home, then VERIFY.
# The superseded version of this code reported what it intended to do; this one
# reports what it observed.
#
#   R5 — presence at the destination is asserted BEFORE the `Installed …` line
#        is printed, never after and never instead.
#   R4 — `staged` and `placed` are tallied per kind and any shortfall is named.
#   R6 — a kind that staged components and placed none returns non-zero.
#
# A tier that stages nothing has `staged == 0`, so the R6 guard is vacuous and
# the call exits 0 — covering both an absent `<staging>/agents` and one that
# exists but is empty. An unbuilt tier returns 0 early.
#
# Both kinds are DIRECTORY-shaped (`<name>/SKILL.md`, `<name>/AGENT.md`), which
# is what `scripts/build-components.sh` stages and what the 2026-08-11 discovery
# probe observed the assistant to accept — see
# docs/runbooks/antigravity-discovery-probe.md. The superseded installer globbed
# `"$staging/agents"/*.md` for a FLAT shape the build has never produced, so the
# glob matched nothing, `[ -f ] || continue` swallowed it, and the step exited 0
# having installed no agent at all. The failure mode was silence, which is why
# R4/R5/R6 exist.
install_antigravity_tier_to_home() {
  local repo_dir="$1" tier="$2" skills_home="$3" agents_home="$4"
  local staging="$repo_dir/dist/$tier/.agents"

  if [ ! -d "$staging" ]; then
    echo "  Tier '$tier' not built (no $staging) — run 'bash scripts/build-components.sh' first."
    return 0
  fi

  local staged_skills=0 placed_skills=0 staged_agents=0 placed_agents=0
  local missing=()
  local entry item marker

  if [ -d "$staging/skills" ]; then
    mkdir -p "$skills_home"
    for entry in "$staging/skills"/*/; do
      [ -d "$entry" ] || continue
      staged_skills=$((staged_skills + 1))
      item="$(basename "$entry")"
      rm -rf "${skills_home:?}/$item"
      # A failed copy must not abort the caller: the presence assertion below is
      # the single source of truth for "placed", and a shortfall has to be
      # REPORTED rather than crashed on.
      cp -R "$entry" "$skills_home/$item" 2>/dev/null || true
      if [ -f "$skills_home/$item/SKILL.md" ]; then
        placed_skills=$((placed_skills + 1))
        echo "  Installed skill: $tier/$item -> $skills_home/$item"
      else
        missing+=("skill $tier/$item")
      fi
    done
  fi

  if [ -d "$staging/agents" ]; then
    mkdir -p "$agents_home"
    for entry in "$staging/agents"/*/; do
      [ -d "$entry" ] || continue
      staged_agents=$((staged_agents + 1))
      item="$(basename "$entry")"
      rm -rf "${agents_home:?}/$item"
      cp -R "$entry" "$agents_home/$item" 2>/dev/null || true
      if [ -f "$agents_home/$item/AGENT.md" ]; then
        placed_agents=$((placed_agents + 1))
        echo "  Installed agent: $tier/$item -> $agents_home/$item"
      else
        missing+=("agent $tier/$item")
      fi
    done
  fi

  # R4 — the shortfall report. Deliberately a separate code path from the R6
  # return below: a tier that stages two and places one is a defect the run must
  # name, even though it is not the total failure R6 catches.
  if [ "$staged_skills" -ne "$placed_skills" ] || [ "$staged_agents" -ne "$placed_agents" ]; then
    echo "  WARNING: tier '$tier' staged ${staged_skills} skill(s) and ${staged_agents} agent(s)" >&2
    echo "           but placed ${placed_skills} and ${placed_agents} at the install target." >&2
    for item in ${missing[@]+"${missing[@]}"}; do
      echo "           absent from the install target: $item" >&2
    done
  fi

  # R6 — staged components, placed none. The tier has NOT been installed and the
  # run must not complete as though it had.
  local failed=0
  if [ "$staged_skills" -gt 0 ] && [ "$placed_skills" -eq 0 ]; then
    echo "  ERROR: tier '$tier' staged ${staged_skills} skill(s) and placed none at $skills_home." >&2
    failed=1
  fi
  if [ "$staged_agents" -gt 0 ] && [ "$placed_agents" -eq 0 ]; then
    echo "  ERROR: tier '$tier' staged ${staged_agents} agent(s) and placed none at $agents_home." >&2
    failed=1
  fi
  return "$failed"
}

# _antigravity_framework_names <artifacts_root> <kind>
#
# Every component name the framework SERVES for that kind, read from the
# authoring sources under all three non-core tiers.
#
# ALL THREE TIERS, UNCONDITIONALLY, AND NOT FROM `dist/`. R8 and its scenario
# are written without a tier qualifier — "no framework-installed skill or agent
# at the superseded location" — so an adopter who once opted into `org` and
# declines it on the re-run must still have those components REMOVED, not
# reported. Deriving from `dist/` instead would be worse still: it is gitignored
# and `ensure_tier_built` short-circuits on directory existence, so a stale
# staging tree would orphan any component that has moved into a tier since it
# was last built.
#
# Widening the sweep costs nothing under R9, because tier scope was never what
# protected user content — the provenance half of the conjunction is.
_antigravity_framework_names() {
  local artifacts_root="$1" kind="$2"
  local tier dir marker name
  marker="$(_antigravity_kind_marker "$kind")"
  for tier in library community org; do
    [ -d "$artifacts_root/$tier/$kind" ] || continue
    for dir in "$artifacts_root/$tier/$kind"/*/; do
      [ -d "$dir" ] || continue
      [ -f "$dir$marker" ] || continue
      name="$(_antigravity_frontmatter_name "$dir$marker")"
      if [ -n "$name" ]; then
        printf '%s\n' "$name"
      fi
    done
  done
}

# _antigravity_source_dir_count <artifacts_root> <kind> — how many component
# source directories exist for that kind. Used only to tell "this fork ships no
# agents" (fine) apart from "the name reader returned nothing for directories
# that are right there" (a defect, see the empty-name-set guard below).
_antigravity_source_dir_count() {
  local artifacts_root="$1" kind="$2"
  local tier dir marker count=0
  marker="$(_antigravity_kind_marker "$kind")"
  for tier in library community org; do
    [ -d "$artifacts_root/$tier/$kind" ] || continue
    for dir in "$artifacts_root/$tier/$kind"/*/; do
      [ -d "$dir" ] || continue
      [ -f "$dir$marker" ] || continue
      count=$((count + 1))
    done
  done
  printf '%s\n' "$count"
}

# migrate_antigravity_superseded_components \
#     <superseded_root> <artifacts_root> <kind: all|skills|agents> [name...]
#
# Remove every framework-installed component left at the superseded placement
# (R8) while leaving everything else there untouched (R9).
#
# THE PREDICATE IS A CONJUNCTION, and both halves are load-bearing:
#   1. the on-disk name is one the framework serves, AND
#   2. that component's own frontmatter carries `metadata.provenance.canonical`.
# Names like `user-validate`, `developer`, `tester` and `architect` are entirely
# plausible names for a directory a user created themselves; a degraded
# predicate that keeps only half of this destroys user content. Anything failing
# either half is left alone, and a leftover that carries provenance but matches
# no served name is REPORTED by name with its removal command rather than
# removed — a component the framework once installed and has since deleted, or
# moved out of a served tier, is the one accepted failure mode here.
#
# `<artifacts_root>` is an ARGUMENT rather than a constant resolved from
# `$REPO_DIR` so the org-orphan case can be tested hermetically: this repository
# ships `artifacts/org/skills/` and `artifacts/community/skills/` empty.
#
# With explicit names the sweep is narrowed to them — the per-component install
# surface needs only enough cleanup to keep R7's placement property true for the
# component it just touched; R8 binds a setup run.
migrate_antigravity_superseded_components() {
  local superseded_root="$1" artifacts_root="$2" kind_filter="$3"
  shift 3
  local explicit_names=("$@")

  local kinds="skills agents"
  case "$kind_filter" in
    skills) kinds="skills" ;;
    agents) kinds="agents" ;;
  esac

  local kind names name_count dir_count entry item marker removed=0
  local residue=()

  for kind in $kinds; do
    local dest="$superseded_root/$kind"

    if [ ${#explicit_names[@]} -gt 0 ]; then
      names="$(printf '%s\n' ${explicit_names[@]+"${explicit_names[@]}"})"
    else
      names="$(_antigravity_framework_names "$artifacts_root" "$kind")"
      name_count="$(printf '%s' "$names" | grep -c . || true)"
      dir_count="$(_antigravity_source_dir_count "$artifacts_root" "$kind")"
      # An EMPTY NAME SET IS AN ERROR, not "nothing to do". A migration that
      # removes nothing and exits 0 is indistinguishable from a clean run, and
      # that is precisely how a `yq`-less `yaml_field` would fail. A fork that
      # genuinely ships no components of this kind has dir_count 0 and is fine.
      if [ "$dir_count" -gt 0 ] && [ "$name_count" -eq 0 ]; then
        echo "  ERROR: read no $kind name from $dir_count source director(ies) under" >&2
        echo "         $artifacts_root — refusing to run a migration that would" >&2
        echo "         remove nothing and report success." >&2
        return 1
      fi
    fi

    [ -d "$dest" ] || continue
    marker="$(_antigravity_kind_marker "$kind")"

    for entry in "$dest"/*; do
      [ -e "$entry" ] || continue
      item="$(basename "$entry")"

      # Both shapes are recognised at the superseded location: the installer
      # that wrote there only ever produced flat `<name>.md` agents, but naming
      # the directory shape costs one branch and removes a reasoning-by-absence.
      local marker_file="" strip_ext="$item"
      if [ -d "$entry" ]; then
        marker_file="$entry/$marker"
      elif [ -f "$entry" ]; then
        case "$item" in
          *.md) marker_file="$entry"; strip_ext="${item%.md}" ;;
          *) continue ;;
        esac
      else
        continue
      fi
      [ -f "$marker_file" ] || continue

      local declared
      declared="$(_antigravity_frontmatter_name "$marker_file")"
      [ -n "$declared" ] || declared="$strip_ext"

      local in_set=0
      # `-F`, not a bare pattern: `$declared` comes off disk and is compared as
      # a LITERAL. Read as a regexp it would over-match — a directory named
      # `a.b` would satisfy a served name `axb` — and this predicate's true
      # branch deletes.
      if printf '%s\n' "$names" | grep -qxF -- "$declared"; then
        in_set=1
      fi
      local has_prov=0
      if _antigravity_has_provenance "$marker_file"; then
        has_prov=1
      fi

      if [ "$in_set" -eq 1 ] && [ "$has_prov" -eq 1 ]; then
        if [ -d "$entry" ]; then
          # Not `rm -rf`. `find -delete` is bounded to this directory, does not
          # follow symlinks out of it, and leaves `rmdir` as the final
          # only-if-empty gate: anything that resisted deletion keeps the
          # directory alive and surfaces below as residue instead of vanishing.
          find "$entry" -mindepth 1 -delete 2>/dev/null || true
          rmdir "$entry" 2>/dev/null || true
        else
          rm -f "$entry"
        fi
        if [ -e "$entry" ]; then
          residue+=("$entry (removal incomplete)")
        else
          removed=$((removed + 1))
          echo "  Migrated away: $entry (superseded placement)"
        fi
      elif [ "$has_prov" -eq 1 ]; then
        residue+=("$entry")
      fi
    done
  done

  if [ ${#residue[@]} -gt 0 ]; then
    echo "  The following carry framework provenance but match no served component" >&2
    echo "  name. They were NOT removed — check them, then remove by hand:" >&2
    for item in ${residue[@]+"${residue[@]}"}; do
      echo "    rm -rf ${item%% (*}" >&2
    done
  fi

  if [ "$removed" -gt 0 ]; then
    echo "  Removed $removed framework component(s) from the superseded placement at $superseded_root."
  fi
  return 0
}
