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

detect_mempalace_python() {
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
    [ -n "$py" ] || continue
    command -v "$py" >/dev/null 2>&1 || continue
    if "$py" -c "import mempalace.mcp_server" >/dev/null 2>&1; then
      echo "$py"
      return 0
    fi
  done
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
install_chroma_daemon() {
  local repo_dir="$1"
  local os
  os="$(uname -s)"
  echo ""
  echo "Installing shared ChromaDB HTTP daemon supervisor (issue #98)..."
  case "$os" in
    Darwin)
      local plist_src="$repo_dir/config/launchd/com.mempalace.chroma-server.plist"
      local plist_dst="$HOME/Library/LaunchAgents/com.mempalace.chroma-server.plist"
      if [ ! -f "$plist_src" ]; then
        echo "  ERROR: $plist_src missing — daemon supervisor unit not shipped."
        return 1
      fi
      mkdir -p "$HOME/Library/LaunchAgents"
      # Substitute placeholders. The plist on disk is user-agnostic
      # (no hardcoded $HOME) — we materialise it here with the
      # detected mempalace interpreter and chroma binary so the launchd
      # agent runs against the right venv.
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
        -e "s|__TLS_EXEC__|${repo_dir}/scripts/lib/tls-exec.sh|g" \
        "$plist_src" > "$plist_dst"
      echo "  Installed: $plist_dst"
      if launchctl list | grep -q com.mempalace.chroma-server; then
        echo "  launchd agent already loaded — skipping load."
      else
        launchctl load -w "$plist_dst" \
          && echo "  Loaded launchd agent: com.mempalace.chroma-server" \
          || { echo "  ERROR: launchctl load failed."; return 1; }
      fi
      ;;
    Linux)
      local svc_src="$repo_dir/config/systemd/mempalace-chroma-server.service"
      local svc_dst="$HOME/.config/systemd/user/mempalace-chroma-server.service"
      if [ ! -f "$svc_src" ]; then
        echo "  ERROR: $svc_src missing — daemon supervisor unit not shipped."
        return 1
      fi
      mkdir -p "$HOME/.config/systemd/user"
      # Materialise the unit through the TLS wrapper (spec 0084): substitute
      # __TLS_EXEC__ in ExecStart so the supervised daemon inherits any
      # user-consented custom-CA trust for its embedding-model fetch.
      sed -e "s|__TLS_EXEC__|${repo_dir}/scripts/lib/tls-exec.sh|g" \
        "$svc_src" > "$svc_dst"
      echo "  Installed: $svc_dst"
      systemctl --user daemon-reload \
        && systemctl --user enable --now mempalace-chroma-server \
        && echo "  Enabled and started: mempalace-chroma-server.service" \
        || { echo "  ERROR: systemctl --user enable --now failed."; return 1; }
      ;;
    *)
      echo "  ERROR: unsupported OS '$os' — install the daemon manually."
      return 1
      ;;
  esac
  # Health check — confirm the daemon answers on the heartbeat endpoint
  # before any MCP entry is written. The launchd/systemd-managed process
  # needs a few seconds to bind its socket, so poll with a 15s budget
  # instead of one-shotting status-chroma-server.sh (see issue #138).
  if [ -x "$repo_dir/scripts/status-chroma-server.sh" ]; then
    local deadline=$((SECONDS + 15))
    local healthy=0
    while [ "$SECONDS" -lt "$deadline" ]; do
      if bash "$repo_dir/scripts/status-chroma-server.sh" >/dev/null 2>&1; then
        healthy=1
        break
      fi
      sleep 0.3
    done
    if [ "$healthy" -ne 1 ]; then
      # Surface the status script's diagnostics (stdout + stderr) so the user
      # sees the real failure cause before the generic ERROR line.
      bash "$repo_dir/scripts/status-chroma-server.sh" || true
      echo "  ERROR: ChromaDB daemon did not become healthy."
      echo "         Inspect logs at ~/.mempalace/chroma-server.log and retry."
      return 1
    fi
  else
    echo "  WARNING: scripts/status-chroma-server.sh not found — skipping health check."
  fi
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
