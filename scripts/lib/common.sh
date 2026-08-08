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
# was absent and no backup was made. Initialising it unconditionally means a
# caller reading it after a no-backup call never sees a prior call's value and
# never trips `set -u` (spec 0089 review F2).
LAST_BACKUP_PATH=""

backup_file() {
  local target="$1"
  LAST_BACKUP_PATH=""
  if [ -f "$target" ] || [ -L "$target" ]; then
    local stamp
    stamp="$(date +%Y%m%d-%H%M%S)"
    cp -P "$target" "${target}.bak.${stamp}"
    # shellcheck disable=SC2034  # read by scripts that source this lib (R9 warning), not here
    LAST_BACKUP_PATH="${target}.bak.${stamp}"
    echo "  Backed up: ${target##*/} -> ${target##*/}.bak.${stamp}"
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
  for name in "${MCP_RESERVED_NAMES[@]}"; do
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
  reserved_json="$(jq -cn '$ARGS.positional' --args "${MCP_RESERVED_NAMES[@]}")"

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
  reserved_json="$(jq -cn '$ARGS.positional' --args "${MCP_RESERVED_NAMES[@]}")"

  # R10 — an org declaration under a framework-reserved name is NOT applied.
  local name
  for name in "${MCP_RESERVED_NAMES[@]}"; do
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
    for r in "${MCP_RESERVED_NAMES[@]}"; do
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
      if claude mcp add "${argv[@]}" >/dev/null 2>&1; then
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
      if claude mcp add "${argv[@]}" >/dev/null 2>&1; then
        echo "  ${name}: org declaration registered"
      else
        echo "  ${name}: FAILED to register org declaration — re-run manually: claude mcp add ${argv[*]}"
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
  choice="$(printf '%s\n' "${candidates[@]}" \
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
  for py in "${candidates[@]}"; do
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
  if [ "$(uname -s)" = "Linux" ]; then
    # The systemd unit carries only the TLS wrapper placeholder (spec 0084),
    # so ExecStart inherits any user-consented custom-CA trust.
    sed -e "s|__TLS_EXEC__|${CREWRIG_REPO_DIR}/scripts/lib/tls-exec.sh|g" "$src" > "$dst"
    return 0
  fi
  local pipx_py chroma_bin mempalace_home
  pipx_py="$(detect_mempalace_python || true)"
  if [ -z "$pipx_py" ]; then
    echo "  ERROR: cannot detect mempalace pipx python — install mempalace first."
    return 1
  fi
  chroma_bin="$(dirname "$pipx_py")/chroma"
  if [ ! -x "$chroma_bin" ]; then
    echo "  ERROR: chroma binary not found at $chroma_bin — run: pipx inject mempalace 'chromadb>=1.5.9'"
    return 1
  fi
  mempalace_home="$HOME/.mempalace"
  sed \
    -e "s|__MEMPALACE_HOME__|${mempalace_home}|g" \
    -e "s|__PIPX_PYTHON__|${pipx_py}|g" \
    -e "s|__CHROMA_BIN__|${chroma_bin}|g" \
    -e "s|__TLS_EXEC__|${CREWRIG_REPO_DIR}/scripts/lib/tls-exec.sh|g" \
    "$src" > "$dst"
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
MCP_DAEMON_PORT_DEFAULT="8021"
# Overridable so a test can bind elsewhere. A test that shares the production
# port reaches the production daemon even when its own unit is correctly
# labelled and simply failed to bind — the isolation must cover the port, not
# only the unit name (spec 0113 step 2c).
MCP_DAEMON_LABEL_DEFAULT="com.mempalace.mcp-server"
MCP_DAEMON_UNIT_DEFAULT="mempalace-mcp-server"

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
    -e "s|__LAUNCHER_SOURCE_SHA__|${sha}|g" \
    "$src" > "$dst"
  chmod 755 "$dst"
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
        echo "         recognise. Repair it by hand, then re-run. (R14)"
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
    echo "  Each config was backed up before the change; restore the timestamped"
    echo "  .bak file beside it, or re-run setup once the cause is fixed."
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
  local cli state
  for cli in claude gemini copilot antigravity; do
    state="$(mcp_assistant_arrangement "$cli")"
    case "$state" in
      http)    printf '  %-12s http (shared daemon)\n' "$cli" ;;
      stdio)   printf '  %-12s stdio (previous arrangement)\n' "$cli" ;;
      none)    printf '  %-12s no mempalace registration\n' "$cli" ;;
      absent)  printf '  %-12s CLI not installed\n' "$cli" ;;
      *)       printf '  %-12s *** UNRECOGNISED — manual repair required ***\n' "$cli" ;;
    esac
  done
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
  # The parent must exist before resolving, or the key would depend on whether
  # the directory happens to be there yet: `cd` fails on a missing parent, the
  # path falls back to its unresolved form, and a later call — after some other
  # step created the directory — resolves differently and computes a DIFFERENT
  # key. That yields two token files for one palace, which reads as "the token
  # keeps changing". Creating the parent first makes the key a function of the
  # path alone.
  mkdir -p "$(dirname "$palace_path")" 2>/dev/null || true
  resolved="$(cd "$(dirname "$palace_path")" 2>/dev/null && pwd)/$(basename "$palace_path")" || resolved="$palace_path"
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
