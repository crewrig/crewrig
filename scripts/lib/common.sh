#!/usr/bin/env bash
# scripts/lib/common.sh — Shared helpers sourced by setup and import scripts.
# Do NOT execute directly.

backup_file() {
  local target="$1"
  if [ -f "$target" ] || [ -L "$target" ]; then
    local stamp
    stamp="$(date +%Y%m%d-%H%M%S)"
    cp -P "$target" "${target}.bak.${stamp}"
    echo "  Backed up: ${target##*/} -> ${target##*/}.bak.${stamp}"
  fi
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
# Requires MEMPALACE_MIN_VERSION and MEMPALACE_MAX_VERSION_EXCLUSIVE to be set
# by the calling script before this function is invoked.
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
      cp "$svc_src" "$svc_dst"
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
