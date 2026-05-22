#!/bin/bash
set -e
# shellcheck source=scripts/lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

GEMINI_HOME="${HOME}/.gemini"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
INSTALL_MODE="copy"  # Default: copy (secure). Override with --link.

# --- Parse arguments ---
while [[ $# -gt 0 ]]; do
  case "$1" in
    --link) INSTALL_MODE="link"; shift ;;
    *)      shift ;;
  esac
done

echo "===================================="
echo "  Gemini CLI Configuration Setup"
echo "===================================="
echo ""

# --- Security disclaimer for link mode ---
if [ "$INSTALL_MODE" = "link" ]; then
  echo "WARNING: You are using symlink mode for system context files."
  echo "Symlinked files will change when you switch branches in this repository."
  echo "A malicious branch could alter your agent's behavior, permissions, and"
  echo "tool access without your knowledge."
  echo ""
  echo "Only use this mode if you TRUST ALL branches in this repository."
  echo "For production use, prefer copy mode (the default)."
  echo ""
  read -p "Continue with symlink mode? [y/N] " -n 1 -r
  echo ""
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted. Run without --link for secure copy mode."
    exit 1
  fi
  echo ""
fi

mkdir -p "$GEMINI_HOME"

# --- Prerequisites: tooling ---
command -v fzf >/dev/null 2>&1 || {
  echo "Error: fzf is required but not installed."
  echo "Install with: brew install fzf (macOS) or apt-get install fzf (Linux)"
  exit 1
}
command -v jq >/dev/null 2>&1 || {
  echo "Error: jq is required but not installed."
  echo "Install with: brew install jq (macOS) or apt-get install jq (Linux)"
  exit 1
}

# --- Prerequisites: identity files ---
# SOUL.md and PROFILE.md must be generated BEFORE running this setup.
MISSING_PREREQS=()

check_finalized() {
  local file="$1" template="$2" label="$3" skill="$4"
  if [ ! -f "$file" ]; then
    MISSING_PREREQS+=("$label is missing — run: gemini $skill")
  elif [ -f "$template" ] && diff -q "$file" "$template" >/dev/null 2>&1; then
    MISSING_PREREQS+=("$label is identical to its template — run: gemini $skill to customize it")
  fi
}

check_finalized "$REPO_DIR/config/SOUL.md"    "$REPO_DIR/config/SOUL.md.template"    "config/SOUL.md"    "/init-soul"
check_finalized "$REPO_DIR/config/PROFILE.md" "$REPO_DIR/config/PROFILE.md.template" "config/PROFILE.md" "/init-personal-profile"

if [ ${#MISSING_PREREQS[@]} -gt 0 ]; then
  echo "Cannot proceed — required identity files are missing or not customized:"
  for item in "${MISSING_PREREQS[@]}"; do
    echo "  - $item"
  done
  echo ""
  echo "Generate them BEFORE re-running this script."
  exit 1
fi

# --- MemPalace version pin ---
# The framework targets the v3.3.x line (see issue #30, Phase 0.1).
# v3.3.3 introduces the `wing` parameter on diary tools, BM25 hybrid search,
# and Halls — all relied upon by the cross-tool continuity protocol.
MEMPALACE_MIN_VERSION="3.3.3"
MEMPALACE_MAX_VERSION_EXCLUSIVE="3.4"

# --- Existing context files: keep or refresh? ---
SKIP_RULES_CONFIG=0
EXISTING=$(find "$GEMINI_HOME" -maxdepth 1 \( -type f -o -type l \) -name "[0-9][0-9]_*.md" 2>/dev/null)
if [ -n "$EXISTING" ]; then
  echo "Existing context files found in $GEMINI_HOME:"
  echo "$EXISTING" | sed "s|^$GEMINI_HOME/|   - |"
  echo ""
  RULES_ACTION=$(echo -e "keep\nrefresh" | fzf --height 15% \
    --header "Existing context files detected — keep them (skip selection) or refresh from scratch?")
  if [ "$RULES_ACTION" = "keep" ]; then
    SKIP_RULES_CONFIG=1
    echo "Keeping existing context files. Team / expertise / level / profile selection will be skipped."
    echo ""
  elif [ "$RULES_ACTION" = "refresh" ]; then
    find "$GEMINI_HOME" -maxdepth 1 \( -type f -o -type l \) -name "[0-9][0-9]_*.md" -delete
    echo "Existing context files removed. Full selection flow will run."
    echo ""
  else
    echo "No choice made. Aborting."
    exit 1
  fi
fi

if [ "$SKIP_RULES_CONFIG" -ne 1 ]; then

# --- Shared enterprise configuration ---
echo "Installing shared configuration..."

install_file "$REPO_DIR/config/ORGANIZATION.md" "$GEMINI_HOME/20_ORGANIZATION.md" \
  "ORGANIZATION.md -> 20_ORGANIZATION.md"

install_file "$REPO_DIR/config/TOOLS.md" "$GEMINI_HOME/60_TOOLS.md" \
  "TOOLS.md -> 60_TOOLS.md"

install_file "$REPO_DIR/config/SOUL.md" "$GEMINI_HOME/00_SOUL.md" \
  "SOUL.md -> 00_SOUL.md"
echo ""

fi  # end: SKIP_RULES_CONFIG guard for shared configuration

# --- settings.json install + MCP server patching ---
echo "Configuring ~/.gemini/settings.json..."
SETTINGS_TARGET="$GEMINI_HOME/settings.json"
SETTINGS_SRC="$REPO_DIR/config/gemini/settings.json"

backup_file "$SETTINGS_TARGET"

# Detect MemPalace Python interpreter (used to patch mcpServers.mempalace.command)
MEMPALACE_PYTHON_BIN="$(detect_mempalace_python || true)"
if [ -z "$MEMPALACE_PYTHON_BIN" ]; then
  echo "  MemPalace not found."
  offer_mempalace_install || true
  MEMPALACE_PYTHON_BIN="$(detect_mempalace_python || true)"
fi

INSTALL_MEMPALACE_GEMINI=no
if [ -n "$MEMPALACE_PYTHON_BIN" ]; then
  MEMPALACE_VERSION="$(mempalace_installed_version "$MEMPALACE_PYTHON_BIN")"
  if ! mempalace_version_in_range "$MEMPALACE_PYTHON_BIN"; then
    echo "  ERROR: MemPalace ${MEMPALACE_VERSION:-(unknown)} is outside the supported range >=${MEMPALACE_MIN_VERSION},<${MEMPALACE_MAX_VERSION_EXCLUSIVE}."
    echo "         Upgrade with: pipx install --force 'mempalace>=${MEMPALACE_MIN_VERSION},<${MEMPALACE_MAX_VERSION_EXCLUSIVE}'"
    exit 1
  fi
  echo "  Detected MemPalace interpreter: $MEMPALACE_PYTHON_BIN (mempalace $MEMPALACE_VERSION)"
  INSTALL_MEMPALACE_GEMINI=$(echo -e "yes\nno" | fzf --height 10% \
    --header "Include MemPalace MCP server in settings.json?")
fi

if [ "$INSTALL_MEMPALACE_GEMINI" = "yes" ]; then
  # Copy template, then patch mcpServers.mempalace.command with the detected python
  jq --arg py "$MEMPALACE_PYTHON_BIN" \
    '.mcpServers.mempalace.command = $py' \
    "$SETTINGS_SRC" > "${SETTINGS_TARGET}.tmp" && mv "${SETTINGS_TARGET}.tmp" "$SETTINGS_TARGET"
  echo "  Installed: settings.json (mempalace patched with detected Python)"
  MEMPALACE_INSTALLED=1
else
  # Copy template with mempalace removed from mcpServers
  jq 'del(.mcpServers.mempalace)' \
    "$SETTINGS_SRC" > "${SETTINGS_TARGET}.tmp" && mv "${SETTINGS_TARGET}.tmp" "$SETTINGS_TARGET"
  echo "  Installed: settings.json (mempalace omitted from mcpServers)"
  MEMPALACE_INSTALLED=0
fi
echo ""

if [ "$SKIP_RULES_CONFIG" -ne 1 ]; then

# --- Team selection ---
echo "Select your team:"
TEAM=$(for f in "$REPO_DIR"/config/teams/*.md; do basename "$f" .md; done \
  | fzf --height 40% --preview "head -20 $REPO_DIR/config/teams/{}.md")
if [ -z "$TEAM" ]; then
  echo "No team selected. Aborting."
  exit 1
fi
install_file "$REPO_DIR/config/teams/${TEAM}.md" "$GEMINI_HOME/50_USER_TEAM.md" \
  "teams/${TEAM}.md -> 50_USER_TEAM.md"
echo "$TEAM" > "$GEMINI_HOME/.selected_team"
echo "Team: $TEAM"
echo ""

# --- Expertise selection ---
echo "Select your expertise:"
EXPERTISE=$(for f in "$REPO_DIR"/config/expertise/*.md; do basename "$f" .md; done \
  | fzf --height 40% --preview "head -20 $REPO_DIR/config/expertise/{}.md")
if [ -z "$EXPERTISE" ]; then
  echo "No expertise selected. Aborting."
  exit 1
fi
install_file "$REPO_DIR/config/expertise/${EXPERTISE}.md" "$GEMINI_HOME/40_USER_EXPERTISE.md" \
  "expertise/${EXPERTISE}.md -> 40_USER_EXPERTISE.md"
echo "$EXPERTISE" > "$GEMINI_HOME/.selected_expertise"
echo "Expertise: $EXPERTISE"
echo ""

# --- Level selection ---
echo "Select your experience level:"
LEVEL=$(for f in "$REPO_DIR"/config/level/*.md; do basename "$f" .md; done \
  | fzf --height 40% --preview "head -20 $REPO_DIR/config/level/{}.md")
if [ -z "$LEVEL" ]; then
  echo "No level selected. Aborting."
  exit 1
fi
install_file "$REPO_DIR/config/level/${LEVEL}.md" "$GEMINI_HOME/10_USER_LEVEL.md" \
  "level/${LEVEL}.md -> 10_USER_LEVEL.md"
echo "$LEVEL" > "$GEMINI_HOME/.selected_level"
echo "Level: $LEVEL"
echo ""

# --- Profile handling ---
TARGET="$GEMINI_HOME/30_USER_PROFILE.md"
if [ ! -e "$TARGET" ]; then
  echo "Setting up personal profile..."
  install_file "$REPO_DIR/config/PROFILE.md" "$TARGET" \
    "PROFILE.md -> 30_USER_PROFILE.md"
elif ! diff -q "$REPO_DIR/config/PROFILE.md" "$TARGET" >/dev/null 2>&1; then
  echo "Local profile differs from repository version."
  METHOD=$(echo -e "keep-local\noverwrite" | fzf --height 10% --header "How to resolve?")
  if [ "$METHOD" = "overwrite" ]; then
    mv "$TARGET" "${TARGET}.ori"
    install_file "$REPO_DIR/config/PROFILE.md" "$TARGET" \
      "PROFILE.md -> 30_USER_PROFILE.md (backup saved as .ori)"
  elif [ "$METHOD" = "keep-local" ]; then
    echo "Keeping local profile."
  fi
else
  echo "Profile is up to date."
fi

fi  # end: SKIP_RULES_CONFIG guard for team/expertise/level/profile

# --- Transcript hooks (opt-in) ---
echo ""
ENABLE_TRANSCRIPTS=$(echo -e "no\nyes" | fzf --height 10% --header "Enable automatic session recording to MemPalace? (opt-in)")
if [ "$ENABLE_TRANSCRIPTS" = "yes" ]; then
  HOOKS_SRC="$REPO_DIR/hooks/gemini-transcript-hooks.json"
  HOOK_SCRIPT_SRC="$REPO_DIR/hooks/mempalace-transcript.sh"
  GEMINI_HOOKS_DIR="$GEMINI_HOME/hooks"
  HOOK_SCRIPT_TARGET="$GEMINI_HOOKS_DIR/mempalace-transcript.sh"
  echo ""
  echo "Activating transcript hooks will:"
  echo "  1. Install the hook script to $HOOK_SCRIPT_TARGET (project-independent)"
  echo "  2. Backup $SETTINGS_TARGET to ${SETTINGS_TARGET}.bak.<timestamp>"
  echo "  3. Merge hooks from $HOOKS_SRC into $SETTINGS_TARGET"
  echo "  4. Rewrite each hook command to point at $HOOK_SCRIPT_TARGET (absolute path)"
  echo "  5. Hardcode MEMPALACE_TRANSCRIPT_ENABLED=1 (and MEMPALACE_PYTHON if detected)"
  echo "     into each hook's command line — no shell-profile changes needed."
  echo ""
  CONFIRM_TRANSCRIPTS=$(echo -e "yes\nno" | fzf --height 10% --header "Apply these changes to settings.json?")
  if [ "$CONFIRM_TRANSCRIPTS" = "yes" ]; then
    mkdir -p "$GEMINI_HOOKS_DIR"
    install_file "$HOOK_SCRIPT_SRC" "$HOOK_SCRIPT_TARGET" \
      "mempalace-transcript.sh -> ~/.gemini/hooks/mempalace-transcript.sh"
    chmod +x "$HOOK_SCRIPT_TARGET" 2>/dev/null || true
    backup_file "$SETTINGS_TARGET"
    ENV_PREFIX='MEMPALACE_TRANSCRIPT_ENABLED=1'
    if [ -n "${MEMPALACE_PYTHON_BIN:-}" ]; then
      ENV_PREFIX="MEMPALACE_TRANSCRIPT_ENABLED=1 MEMPALACE_PYTHON=$MEMPALACE_PYTHON_BIN"
    fi
    # Rewrite every nested command: substitute the source-file token with the
    # installed absolute path, then prefix env vars. Hooks become independent
    # of any project-dir variable resolution.
    jq --arg envp "$ENV_PREFIX" --arg hook_path "$HOOK_SCRIPT_TARGET" \
      '(.. | objects | select(.type? == "command") | .command) |=
         ($envp + " " + (gsub("\\$\\{GEMINI_PROJECT_DIR\\}/hooks/mempalace-transcript.sh"; $hook_path)))' \
      "$HOOKS_SRC" > "${SETTINGS_TARGET}.hooks.tmp"
    jq -s '.[0] * .[1]' \
      "$SETTINGS_TARGET" "${SETTINGS_TARGET}.hooks.tmp" > "${SETTINGS_TARGET}.tmp"
    mv "${SETTINGS_TARGET}.tmp" "$SETTINGS_TARGET"
    rm -f "${SETTINGS_TARGET}.hooks.tmp"
    echo "  Transcript hooks merged into settings.json"
    echo "  Hook script installed at $HOOK_SCRIPT_TARGET (no longer depends on the repo path)"
  else
    echo "  Transcript activation cancelled by user."
  fi
else
  echo "  Session recording disabled (can enable later by re-running this script)."
fi

echo ""
echo "===================================="
echo "  Setup complete"
echo "===================================="
echo ""
echo "Install mode: $INSTALL_MODE"
echo ""
echo "Active context files:"
ls -1 "$GEMINI_HOME"/[0-9][0-9]_*.md 2>/dev/null | sed 's|^|  |' || echo "  (none)"
echo ""
echo "MCP servers (from settings.json):"
jq -r '.mcpServers // {} | keys[]' "$SETTINGS_TARGET" 2>/dev/null | sed 's|^|  - |' || echo "  (none)"
echo ""
if [ "${MEMPALACE_INSTALLED:-0}" -ne 1 ]; then
  echo "Note: MemPalace MCP server is NOT installed in settings.json."
  echo "      Install MemPalace at the supported version, then re-run this script:"
  echo "      pipx install 'mempalace>=${MEMPALACE_MIN_VERSION},<${MEMPALACE_MAX_VERSION_EXCLUSIVE}'"
  echo ""
fi
echo "Restart any running Gemini CLI session to pick up the new configuration."
