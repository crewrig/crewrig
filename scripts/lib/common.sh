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
