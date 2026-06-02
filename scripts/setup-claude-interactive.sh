#!/bin/bash
set -e
# shellcheck source=scripts/lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

CLAUDE_HOME="${HOME}/.claude"
CLAUDE_RULES="${CLAUDE_HOME}/rules"
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
echo "  Claude Code Configuration Setup"
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

mkdir -p "$CLAUDE_RULES"

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
command -v claude >/dev/null 2>&1 || {
  echo "Error: 'claude' CLI is required to register MCP servers."
  echo "Install Claude Code: https://docs.claude.com/en/docs/claude-code/setup"
  exit 1
}

# --- Prerequisites: identity files ---
# SOUL.md and PROFILE.md must exist BEFORE running this setup.
# They are produced by the /init-soul and /init-personal-profile skills.
# Customization is optional: accepting all defaults in those skills is a
# valid outcome, so a presence check is the contract — not a byte-diff
# against the template.
MISSING_PREREQS=()

check_finalized() {
  local file="$1" label="$2" skill="$3"
  if [ ! -f "$file" ]; then
    MISSING_PREREQS+=("$label is missing — run: claude $skill")
  fi
}

check_finalized "$REPO_DIR/config/SOUL.md"    "config/SOUL.md"    "/init-soul"
check_finalized "$REPO_DIR/config/PROFILE.md" "config/PROFILE.md" "/init-personal-profile"

if [ ${#MISSING_PREREQS[@]} -gt 0 ]; then
  echo "Cannot proceed — required identity files are missing:"
  for item in "${MISSING_PREREQS[@]}"; do
    echo "  - $item"
  done
  echo ""
  echo "Generate them BEFORE re-running this script."
  exit 1
fi

# --- Existing rules: keep or refresh? ---
# If existing rules are detected, the user can:
#   - keep:    skip the entire rules-installation phase (shared config + team/
#              expertise/level/profile selection). Useful when only MCP servers
#              or transcript hooks need (re)configuring.
#   - refresh: wipe existing rules and re-run the full selection flow.
SKIP_RULES_CONFIG=0
EXISTING=$(find "$CLAUDE_RULES" -maxdepth 1 \( -type f -o -type l \) -name "*.md" 2>/dev/null)
if [ -n "$EXISTING" ]; then
  echo "Existing rule files found in $CLAUDE_RULES:"
  echo "$EXISTING" | sed "s|^$CLAUDE_RULES/|   - |"
  echo ""
  RULES_ACTION=$(echo -e "keep\nrefresh" | fzf --height 15% \
    --header "Existing rules detected — keep them (skip selection) or refresh from scratch?")
  if [ "$RULES_ACTION" = "keep" ]; then
    SKIP_RULES_CONFIG=1
    echo "Keeping existing rules. Team / expertise / level / profile selection will be skipped."
    echo ""
  elif [ "$RULES_ACTION" = "refresh" ]; then
    find "$CLAUDE_RULES" -maxdepth 1 \( -type f -o -type l \) -name "*.md" -delete
    echo "Existing rules removed. Full selection flow will run."
    echo ""
  else
    echo "No choice made. Aborting."
    exit 1
  fi
fi

if [ "$SKIP_RULES_CONFIG" -ne 1 ]; then

# --- Shared enterprise configuration ---
echo "Installing shared configuration..."

# Organization context
install_file "$REPO_DIR/config/ORGANIZATION.md" "$CLAUDE_RULES/20-organization.md" \
  "ORGANIZATION.md -> rules/20-organization.md"

# Tools guidelines
install_file "$REPO_DIR/config/TOOLS.md" "$CLAUDE_RULES/60-tools.md" \
  "TOOLS.md -> rules/60-tools.md"

# SOUL.md (guaranteed to exist by prerequisite check)
install_file "$REPO_DIR/config/SOUL.md" "$CLAUDE_RULES/00-soul.md" \
  "SOUL.md -> rules/00-soul.md"
echo ""

fi  # end: SKIP_RULES_CONFIG guard for shared configuration

# --- MCP server registration via 'claude mcp add' ---
# Claude Code reads MCP servers from ~/.claude.json (managed by 'claude mcp ...').
# The legacy ~/.claude/mcp.json file is NOT read by Claude Code — we no longer write it.
echo "Configuring MCP servers via 'claude mcp add --scope user'..."
CLAUDE_USER_CONFIG="$HOME/.claude.json"

# Helper: register an MCP server only if not already present
mcp_is_registered() {
  local name="$1"
  claude mcp list 2>/dev/null | grep -qE "^${name}:[[:space:]]"
}

mcp_register_user() {
  local name="$1"; shift
  if mcp_is_registered "$name"; then
    echo "  ${name}: already registered, skipping"
    return 0
  fi
  if claude mcp add --scope user "$name" -- "$@" >/dev/null 2>&1; then
    echo "  ${name}: registered (scope=user)"
  else
    echo "  ${name}: FAILED to register — re-run manually: claude mcp add --scope user $name -- $*"
    return 1
  fi
}

# --- MemPalace version pin ---
# The framework targets the v3.3.x line (see issue #30, Phase 0.1).
# v3.3.3 introduces the `wing` parameter on diary tools, BM25 hybrid search,
# and Halls — all relied upon by the cross-tool continuity protocol.
MEMPALACE_MIN_VERSION="3.3.3"
MEMPALACE_MAX_VERSION_EXCLUSIVE="3.4"

# Backup ~/.claude.json once before any MCP mutation
backup_file "$CLAUDE_USER_CONFIG"

# Sequential Thinking (opt-in, recommended)
echo ""
echo "Sequential Thinking MCP server (working memory):"
echo "  Command: npx -y @modelcontextprotocol/server-sequential-thinking"
INSTALL_SEQTHINK=$(echo -e "yes\nno" | fzf --height 10% --header "Install Sequential Thinking MCP server?")
if [ "$INSTALL_SEQTHINK" = "yes" ]; then
  mcp_register_user sequentialthinking npx -y @modelcontextprotocol/server-sequential-thinking
else
  echo "  Sequential Thinking install skipped."
fi
echo ""

# MemPalace (opt-in, persistent agent memory)
echo "MemPalace MCP server (persistent agent memory):"
MEMPALACE_INSTALLED=0
MEMPALACE_PYTHON_BIN="$(detect_mempalace_python || true)"

if [ -z "$MEMPALACE_PYTHON_BIN" ]; then
  echo "  MemPalace not found."
  offer_mempalace_install || true
  MEMPALACE_PYTHON_BIN="$(detect_mempalace_python || true)"
fi

if [ -n "$MEMPALACE_PYTHON_BIN" ]; then
  MEMPALACE_VERSION="$(mempalace_installed_version "$MEMPALACE_PYTHON_BIN")"
  if ! mempalace_version_in_range "$MEMPALACE_PYTHON_BIN"; then
    echo "  ERROR: MemPalace ${MEMPALACE_VERSION:-(unknown)} is outside the supported range >=${MEMPALACE_MIN_VERSION},<${MEMPALACE_MAX_VERSION_EXCLUSIVE}."
    echo "         Upgrade with: pipx install --force 'mempalace>=${MEMPALACE_MIN_VERSION},<${MEMPALACE_MAX_VERSION_EXCLUSIVE}'"
    exit 1
  fi
  # MCP entry goes through the shared-daemon http wrapper (issue #98, ADR 0006).
  MEMPALACE_WRAPPER="$REPO_DIR/scripts/lib/mempalace-http-wrapper.py"
  echo "  Detected interpreter: $MEMPALACE_PYTHON_BIN (mempalace $MEMPALACE_VERSION)"
  echo "  Full command:         $MEMPALACE_PYTHON_BIN $MEMPALACE_WRAPPER"
  if mcp_is_registered mempalace; then
    echo "  Currently registered. If the existing entry does not use the http wrapper, re-register it."
    REPLACE_MEMPALACE=$(echo -e "yes\nno" | fzf --height 10% \
      --header "Replace existing MemPalace registration with the http-wrapper entry?")
    if [ "$REPLACE_MEMPALACE" = "yes" ]; then
      # Install the ChromaDB daemon supervisor BEFORE writing the wrapper into MCP config.
      install_chroma_daemon "$REPO_DIR"
      claude mcp remove --scope user mempalace >/dev/null 2>&1 || true
      if mcp_register_user mempalace "$MEMPALACE_PYTHON_BIN" "$MEMPALACE_WRAPPER"; then
        MEMPALACE_INSTALLED=1
      fi
    else
      echo "  Existing registration kept."
      MEMPALACE_INSTALLED=1
    fi
  else
    INSTALL_MEMPALACE=$(echo -e "yes\nno" | fzf --height 10% --header "Install MemPalace MCP server now?")
    if [ "$INSTALL_MEMPALACE" = "yes" ]; then
      # Install the ChromaDB daemon supervisor BEFORE writing the wrapper into MCP config.
      install_chroma_daemon "$REPO_DIR"
      if mcp_register_user mempalace "$MEMPALACE_PYTHON_BIN" "$MEMPALACE_WRAPPER"; then
        MEMPALACE_INSTALLED=1
      fi
    else
      echo "  MemPalace install skipped."
      echo "  To install later: claude mcp add --scope user mempalace -- $MEMPALACE_PYTHON_BIN $MEMPALACE_WRAPPER"
    fi
  fi
fi

# Surface legacy ~/.claude/mcp.json (no longer used) to avoid confusion
LEGACY_MCP="$CLAUDE_HOME/mcp.json"
if [ -f "$LEGACY_MCP" ]; then
  echo ""
  echo "Note: $LEGACY_MCP is a legacy file and is NOT read by Claude Code."
  echo "      Active MCP config lives in ~/.claude.json."
  REMOVE_LEGACY=$(echo -e "no\nyes" | fzf --height 10% --header "Remove legacy ~/.claude/mcp.json (backup will be kept)?")
  if [ "$REMOVE_LEGACY" = "yes" ]; then
    backup_file "$LEGACY_MCP"
    rm "$LEGACY_MCP"
    echo "  Legacy mcp.json removed."
  fi
fi
echo ""

# --- Settings (optional) ---
SETTINGS_TARGET="$CLAUDE_HOME/settings.json"
if [ ! -f "$SETTINGS_TARGET" ]; then
  INSTALL_SETTINGS=$(echo -e "yes\nno" | fzf --height 10% --header "Install default settings.json?")
  if [ "$INSTALL_SETTINGS" = "yes" ]; then
    cp "$REPO_DIR/config/claude/settings.json.template" "$SETTINGS_TARGET"
    echo "  Installed: settings.json"
  fi
elif [ -f "$SETTINGS_TARGET" ]; then
  echo "  settings.json already exists, skipping."
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
install_file "$REPO_DIR/config/teams/${TEAM}.md" "$CLAUDE_RULES/50-team.md" \
  "teams/${TEAM}.md -> rules/50-team.md"
echo "$TEAM" > "$CLAUDE_HOME/.selected_team"
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
install_file "$REPO_DIR/config/expertise/${EXPERTISE}.md" "$CLAUDE_RULES/40-expertise.md" \
  "expertise/${EXPERTISE}.md -> rules/40-expertise.md"
echo "$EXPERTISE" > "$CLAUDE_HOME/.selected_expertise"
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
install_file "$REPO_DIR/config/level/${LEVEL}.md" "$CLAUDE_RULES/10-level.md" \
  "level/${LEVEL}.md -> rules/10-level.md"
echo "$LEVEL" > "$CLAUDE_HOME/.selected_level"
echo "Level: $LEVEL"
echo ""

# --- Profile handling ---
# config/PROFILE.md is guaranteed to exist (prerequisite check at the top).
TARGET="$CLAUDE_RULES/30-profile.md"
if [ ! -e "$TARGET" ]; then
  echo "Setting up personal profile..."
  install_file "$REPO_DIR/config/PROFILE.md" "$TARGET" \
    "PROFILE.md -> rules/30-profile.md"
elif ! diff -q "$REPO_DIR/config/PROFILE.md" "$TARGET" >/dev/null 2>&1; then
  echo "Local profile differs from repository version."
  METHOD=$(echo -e "keep-local\noverwrite" | fzf --height 10% --header "How to resolve?")
  if [ "$METHOD" = "overwrite" ]; then
    mv "$TARGET" "${TARGET}.ori"
    install_file "$REPO_DIR/config/PROFILE.md" "$TARGET" \
      "PROFILE.md -> rules/30-profile.md (backup saved as .ori)"
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
  HOOKS_SRC="$REPO_DIR/hooks/claude-transcript-hooks.json"
  HOOK_SCRIPT_SRC="$REPO_DIR/hooks/mempalace-transcript.sh"
  CLAUDE_HOOKS_DIR="$CLAUDE_HOME/hooks"
  HOOK_SCRIPT_TARGET="$CLAUDE_HOOKS_DIR/mempalace-transcript.sh"
  echo ""
  echo "Activating transcript hooks will:"
  echo "  1. Install the hook script to $HOOK_SCRIPT_TARGET (project-independent)"
  echo "  2. Backup $SETTINGS_TARGET to ${SETTINGS_TARGET}.bak.<timestamp>"
  echo "  3. Merge hooks from $HOOKS_SRC into $SETTINGS_TARGET, with each command"
  echo "     rewritten to point at $HOOK_SCRIPT_TARGET (absolute path)"
  echo "  4. Set env.MEMPALACE_TRANSCRIPT_ENABLED=\"1\" in $SETTINGS_TARGET"
  if [ -n "${MEMPALACE_PYTHON_BIN:-}" ]; then
    echo "  5. Set env.MEMPALACE_PYTHON=\"$MEMPALACE_PYTHON_BIN\" in $SETTINGS_TARGET"
    echo "     (so the hook script imports mempalace from the right interpreter)"
  fi
  echo ""
  CONFIRM_TRANSCRIPTS=$(echo -e "yes\nno" | fzf --height 10% --header "Apply these changes to settings.json?")
  if [ "$CONFIRM_TRANSCRIPTS" = "yes" ]; then
    [ -f "$SETTINGS_TARGET" ] || echo "{}" > "$SETTINGS_TARGET"
    mkdir -p "$CLAUDE_HOOKS_DIR"
    install_file "$HOOK_SCRIPT_SRC" "$HOOK_SCRIPT_TARGET" \
      "mempalace-transcript.sh -> ~/.claude/hooks/mempalace-transcript.sh"
    chmod +x "$HOOK_SCRIPT_TARGET" 2>/dev/null || true
    backup_file "$SETTINGS_TARGET"
    ENV_PATCH='{"MEMPALACE_TRANSCRIPT_ENABLED": "1"}'
    if [ -n "${MEMPALACE_PYTHON_BIN:-}" ]; then
      ENV_PATCH=$(jq -nc --arg py "$MEMPALACE_PYTHON_BIN" \
        '{"MEMPALACE_TRANSCRIPT_ENABLED": "1", "MEMPALACE_PYTHON": $py}')
    fi
    # Rewrite every nested command to use the installed absolute hook path
    # instead of the source-file's "$CLAUDE_PROJECT_DIR/..." token.
    HOOKS_PATCHED_TMP="$(mktemp)"
    jq --arg hook_path "$HOOK_SCRIPT_TARGET" \
      '(.. | objects | select(.type? == "command") | .command) |=
         gsub("\"\\$CLAUDE_PROJECT_DIR/hooks/mempalace-transcript.sh\""; ("\"" + $hook_path + "\""))' \
      "$HOOKS_SRC" > "$HOOKS_PATCHED_TMP"
    jq -s --argjson patch "$ENV_PATCH" \
      '.[0] * .[1] | .env = ((.env // {}) + $patch)' \
      "$SETTINGS_TARGET" "$HOOKS_PATCHED_TMP" > "${SETTINGS_TARGET}.tmp" && \
      mv "${SETTINGS_TARGET}.tmp" "$SETTINGS_TARGET"
    rm -f "$HOOKS_PATCHED_TMP"
    echo "  Transcript hooks merged into settings.json"
    echo "  Hook script installed at $HOOK_SCRIPT_TARGET (no longer depends on the repo path)"
    echo "  env patched: $ENV_PATCH"
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
echo "Active rule files:"
ls -1 "$CLAUDE_RULES"/*.md 2>/dev/null || echo "  (none)"
echo ""
echo "MCP servers (from 'claude mcp list'):"
claude mcp list 2>/dev/null | sed 's/^/  /' || echo "  (unable to list)"
echo ""
if [ "${MEMPALACE_INSTALLED:-0}" -ne 1 ]; then
  echo "Note: MemPalace MCP server was NOT installed during this run."
  echo "      Install MemPalace at the supported version, then re-run this script:"
  echo "      pipx install 'mempalace>=${MEMPALACE_MIN_VERSION},<${MEMPALACE_MAX_VERSION_EXCLUSIVE}'"
  echo ""
fi
echo "Restart any running Claude Code session to pick up the new MCP servers."
