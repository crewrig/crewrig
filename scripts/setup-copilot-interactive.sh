#!/bin/bash
# setup-copilot-interactive.sh — Interactive GitHub Copilot CLI configuration setup.
#
# Mirrors scripts/setup-gemini-interactive.sh and setup-claude-interactive.sh —
# the Copilot config root is split across .github/copilot/, .github/skills/,
# .github/agents/, and .github/copilot-instructions.md at the workspace level.
# User-level layered context is deployed to ~/.copilot/instructions/*.instructions.md
# (the documented analogue of ~/.claude/rules/ and ~/.gemini/).
# Reference:
# https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference

set -e
# shellcheck source=scripts/lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

COPILOT_HOME="${HOME}/.copilot"
COPILOT_INSTRUCTIONS="${COPILOT_HOME}/instructions"
COPILOT_SKILLS="${COPILOT_HOME}/skills"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
INSTALL_MODE="copy"
MEMPALACE_MIN_VERSION="3.3.3"
MEMPALACE_MAX_VERSION_EXCLUSIVE="3.4"

# --- Parse arguments ---
while [[ $# -gt 0 ]]; do
  case "$1" in
    --link) INSTALL_MODE="link"; shift ;;
    *)      shift ;;
  esac
done

echo "===================================="
echo "  GitHub Copilot CLI Setup"
echo "===================================="
echo ""

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
if ! gh copilot --help >/dev/null 2>&1 && ! command -v copilot >/dev/null 2>&1; then
  echo "Warning: GitHub Copilot CLI not detected."
  echo "  Install with: gh extension install github/gh-copilot"
  echo "  or follow: https://docs.github.com/copilot/github-copilot-in-the-cli"
  echo "  Proceeding anyway — settings files will be written to the repo."
  echo ""
fi

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
    MISSING_PREREQS+=("$label is missing — run: $skill")
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

# --- Workspace settings file ---
WORKSPACE_SETTINGS="$REPO_DIR/.github/copilot/settings.json"
TEMPLATE="$REPO_DIR/config/copilot/settings.json.template"

if [ ! -f "$WORKSPACE_SETTINGS" ]; then
  mkdir -p "$(dirname "$WORKSPACE_SETTINGS")"
  cp "$TEMPLATE" "$WORKSPACE_SETTINGS"
  echo "  Installed: $WORKSPACE_SETTINGS (from template)"
else
  echo "  $WORKSPACE_SETTINGS already exists, leaving untouched."
fi
echo ""

# --- Entry-point file check ---
ENTRY="$REPO_DIR/.github/copilot-instructions.md"
if [ -f "$ENTRY" ]; then
  echo "  Entry point: $ENTRY"
else
  echo "  WARN: $ENTRY is missing — Copilot will not load AGENTS.md without it."
fi
echo ""

# --- User-level layered context (~/.copilot/instructions/) ---
# Copilot CLI loads every *.instructions.md file under ~/.copilot/instructions/
# automatically at session start. This is the direct equivalent of
# ~/.claude/rules/ and ~/.gemini/ for the priority-prefixed context files.
# Reference:
# https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference
SKIP_INSTRUCTIONS_CONFIG=0
mkdir -p "$COPILOT_INSTRUCTIONS"
EXISTING_INSTR=$(find "$COPILOT_INSTRUCTIONS" -maxdepth 1 \( -type f -o -type l \) -name "*.instructions.md" 2>/dev/null)
if [ -n "$EXISTING_INSTR" ]; then
  echo "Existing instruction files found in $COPILOT_INSTRUCTIONS:"
  echo "$EXISTING_INSTR" | sed "s|^$COPILOT_INSTRUCTIONS/|   - |"
  echo ""
  INSTR_ACTION=$(echo -e "keep\nrefresh" | fzf --height 15% \
    --header "Existing instructions detected — keep them (skip selection) or refresh from scratch?")
  if [ "$INSTR_ACTION" = "keep" ]; then
    SKIP_INSTRUCTIONS_CONFIG=1
    echo "Keeping existing instructions. Team / expertise / level selection will be skipped."
    echo ""
  elif [ "$INSTR_ACTION" = "refresh" ]; then
    find "$COPILOT_INSTRUCTIONS" -maxdepth 1 \( -type f -o -type l \) -name "*.instructions.md" -delete
    echo "Existing instructions removed. Full selection flow will run."
    echo ""
  else
    echo "No choice made. Aborting."
    exit 1
  fi
fi

if [ "$SKIP_INSTRUCTIONS_CONFIG" -ne 1 ]; then
  echo "Installing shared layered context to $COPILOT_INSTRUCTIONS ..."

  install_file "$REPO_DIR/config/SOUL.md" "$COPILOT_INSTRUCTIONS/00-soul.instructions.md" \
    "SOUL.md -> instructions/00-soul.instructions.md"
  install_file "$REPO_DIR/config/ORGANIZATION.md" "$COPILOT_INSTRUCTIONS/20-organization.instructions.md" \
    "ORGANIZATION.md -> instructions/20-organization.instructions.md"
  install_file "$REPO_DIR/config/PROFILE.md" "$COPILOT_INSTRUCTIONS/30-profile.instructions.md" \
    "PROFILE.md -> instructions/30-profile.instructions.md"
  install_file "$REPO_DIR/config/TOOLS.md" "$COPILOT_INSTRUCTIONS/60-tools.instructions.md" \
    "TOOLS.md -> instructions/60-tools.instructions.md"
  echo ""

  # Level
  echo "Select your experience level:"
  LEVEL=$(for f in "$REPO_DIR"/config/level/*.md; do basename "$f" .md; done \
    | fzf --height 40% --preview "head -20 $REPO_DIR/config/level/{}.md")
  if [ -z "$LEVEL" ]; then
    echo "No level selected. Aborting."
    exit 1
  fi
  install_file "$REPO_DIR/config/level/${LEVEL}.md" "$COPILOT_INSTRUCTIONS/10-level.instructions.md" \
    "level/${LEVEL}.md -> instructions/10-level.instructions.md"
  echo "$LEVEL" > "$COPILOT_HOME/.selected_level"
  echo "Level: $LEVEL"
  echo ""

  # Expertise
  echo "Select your expertise:"
  EXPERTISE=$(for f in "$REPO_DIR"/config/expertise/*.md; do basename "$f" .md; done \
    | fzf --height 40% --preview "head -20 $REPO_DIR/config/expertise/{}.md")
  if [ -z "$EXPERTISE" ]; then
    echo "No expertise selected. Aborting."
    exit 1
  fi
  install_file "$REPO_DIR/config/expertise/${EXPERTISE}.md" "$COPILOT_INSTRUCTIONS/40-expertise.instructions.md" \
    "expertise/${EXPERTISE}.md -> instructions/40-expertise.instructions.md"
  echo "$EXPERTISE" > "$COPILOT_HOME/.selected_expertise"
  echo "Expertise: $EXPERTISE"
  echo ""

  # Team
  echo "Select your team:"
  TEAM=$(for f in "$REPO_DIR"/config/teams/*.md; do basename "$f" .md; done \
    | fzf --height 40% --preview "head -20 $REPO_DIR/config/teams/{}.md")
  if [ -z "$TEAM" ]; then
    echo "No team selected. Aborting."
    exit 1
  fi
  install_file "$REPO_DIR/config/teams/${TEAM}.md" "$COPILOT_INSTRUCTIONS/50-team.instructions.md" \
    "teams/${TEAM}.md -> instructions/50-team.instructions.md"
  echo "$TEAM" > "$COPILOT_HOME/.selected_team"
  echo "Team: $TEAM"
  echo ""
fi

# --- MCP server configuration (~/.copilot/mcp-config.json) ---
echo "Configuring ~/.copilot/mcp-config.json..."
MCP_CONFIG_TARGET="$COPILOT_HOME/mcp-config.json"
MCP_CONFIG_SRC="$REPO_DIR/config/copilot/mcp-config.json.template"

backup_file "$MCP_CONFIG_TARGET"

# Detect MemPalace Python interpreter
MEMPALACE_PYTHON_BIN="$(detect_mempalace_python || true)"
if [ -z "$MEMPALACE_PYTHON_BIN" ]; then
  echo "  MemPalace not found."
  offer_mempalace_install || true
  MEMPALACE_PYTHON_BIN="$(detect_mempalace_python || true)"
fi

INSTALL_MEMPALACE_COPILOT=no
if [ -n "$MEMPALACE_PYTHON_BIN" ]; then
  MEMPALACE_VERSION="$(mempalace_installed_version "$MEMPALACE_PYTHON_BIN")"
  if ! mempalace_version_in_range "$MEMPALACE_PYTHON_BIN"; then
    echo "  ERROR: MemPalace ${MEMPALACE_VERSION:-(unknown)} is outside the supported range >=${MEMPALACE_MIN_VERSION},<${MEMPALACE_MAX_VERSION_EXCLUSIVE}."
    echo "         Upgrade with: pipx install --force 'mempalace>=${MEMPALACE_MIN_VERSION},<${MEMPALACE_MAX_VERSION_EXCLUSIVE}'"
    exit 1
  fi
  echo "  Detected MemPalace interpreter: $MEMPALACE_PYTHON_BIN (mempalace $MEMPALACE_VERSION)"
  INSTALL_MEMPALACE_COPILOT=$(echo -e "yes\nno" | fzf --height 10% \
    --header "Include MemPalace MCP server in mcp-config.json?")
fi

if [ "$INSTALL_MEMPALACE_COPILOT" = "yes" ]; then
  # Install the shared ChromaDB HTTP daemon supervisor (issue #98) before
  # writing the wrapper into mcp-config.json — first-launch ordering matters.
  install_chroma_daemon "$REPO_DIR"

  # Copy template, patch mcpServers.mempalace.command with the detected
  # python, and substitute __CREWRIG_REPO_DIR__ in args so the
  # http-wrapper resolves to an absolute path (mirrors Gemini setup).
  jq --arg py "$MEMPALACE_PYTHON_BIN" --arg repo "$REPO_DIR" \
    '.mcpServers.mempalace.command = $py
     | .mcpServers.mempalace.args = (.mcpServers.mempalace.args
         | map(gsub("__CREWRIG_REPO_DIR__"; $repo)))' \
    "$MCP_CONFIG_SRC" > "${MCP_CONFIG_TARGET}.tmp" && mv "${MCP_CONFIG_TARGET}.tmp" "$MCP_CONFIG_TARGET"
  echo "  Installed: mcp-config.json (mempalace patched with detected Python + wrapper path)"
else
  jq 'del(.mcpServers.mempalace)' \
    "$MCP_CONFIG_SRC" > "${MCP_CONFIG_TARGET}.tmp" && mv "${MCP_CONFIG_TARGET}.tmp" "$MCP_CONFIG_TARGET"
  echo "  Installed: mcp-config.json (mempalace omitted from mcpServers)"
fi
echo ""

# --- User-level skills (~/.copilot/skills/) — opt-in ---
# Mirrors the workspace-level .github/skills/ output to the user-level
# directory so skills are usable from any Copilot CLI session, regardless
# of the active workspace. Agents are intentionally skipped in v1: the
# `~/.copilot/agents/<name>.agent.md` naming convention is unverified
# (see docs/adr/0001 — [GAP-confirmation]).
WORKSPACE_SKILLS_DIR="$REPO_DIR/.github/skills"
if [ -d "$WORKSPACE_SKILLS_DIR" ] && [ -n "$(ls -A "$WORKSPACE_SKILLS_DIR" 2>/dev/null)" ]; then
  INSTALL_USER_SKILLS=$(echo -e "no\nyes" | fzf --height 10% \
    --header "Install user-level skills to $COPILOT_SKILLS? (opt-in)")
  if [ "$INSTALL_USER_SKILLS" = "yes" ]; then
    mkdir -p "$COPILOT_SKILLS"
    for skill_dir in "$WORKSPACE_SKILLS_DIR"/*/; do
      [ -d "$skill_dir" ] || continue
      skill_name="$(basename "$skill_dir")"
      target_dir="$COPILOT_SKILLS/$skill_name"
      mkdir -p "$target_dir"
      install_file "$skill_dir/SKILL.md" "$target_dir/SKILL.md" \
        "skills/$skill_name/SKILL.md -> ~/.copilot/skills/$skill_name/SKILL.md"
    done
    echo ""
  else
    echo "  User-level skills install skipped."
    echo ""
  fi
else
  echo "  No built skills found at $WORKSPACE_SKILLS_DIR — run 'bash scripts/build-components.sh --target copilot' first."
  echo ""
fi

# --- Transcript hooks (opt-in) ---
ENABLE_TRANSCRIPTS=$(echo -e "no\nyes" | fzf --height 10% --header "Enable automatic session recording to MemPalace? (opt-in)")
if [ "$ENABLE_TRANSCRIPTS" = "yes" ]; then
  HOOKS_SRC="$REPO_DIR/hooks/copilot-transcript-hooks.json"
  HOOK_SCRIPT_SRC="$REPO_DIR/hooks/mempalace-transcript.sh"
  COPILOT_HOOKS_DIR="$COPILOT_HOME/hooks"
  HOOK_SCRIPT_TARGET="$COPILOT_HOOKS_DIR/mempalace-transcript.sh"
  echo ""
  USER_HOOKS_JSON="$COPILOT_HOOKS_DIR/copilot-transcript-hooks.json"
  echo "Activating transcript hooks will:"
  echo "  1. Install the hook script to $HOOK_SCRIPT_TARGET (project-independent)"
  echo "  2. Deploy user-level hooks to $USER_HOOKS_JSON (fires for ALL projects)"
  echo "  3. Backup $WORKSPACE_SETTINGS to ${WORKSPACE_SETTINGS}.bak.<timestamp>"
  echo "  4. Merge hooks into $WORKSPACE_SETTINGS (crewrig workspace)"
  echo ""
  CONFIRM=$(echo -e "yes\nno" | fzf --height 10% --header "Apply?")
  if [ "$CONFIRM" = "yes" ]; then
    mkdir -p "$COPILOT_HOOKS_DIR"
    install_file "$HOOK_SCRIPT_SRC" "$HOOK_SCRIPT_TARGET" \
      "mempalace-transcript.sh -> ~/.copilot/hooks/mempalace-transcript.sh"
    chmod +x "$HOOK_SCRIPT_TARGET" 2>/dev/null || true
    MEMPALACE_PYTHON_BIN="$(detect_mempalace_python || true)"
    ENV_PREFIX='MEMPALACE_TRANSCRIPT_ENABLED=1'
    if [ -n "$MEMPALACE_PYTHON_BIN" ]; then
      ENV_PREFIX="MEMPALACE_TRANSCRIPT_ENABLED=1 MEMPALACE_PYTHON=$MEMPALACE_PYTHON_BIN"
    fi
    HOOKS_PATCHED_TMP="$(mktemp)"
    jq --arg envp "$ENV_PREFIX" --arg hook_path "$HOOK_SCRIPT_TARGET" \
      '(.hooks // []) |= map(.command = ($envp + " bash " + ($hook_path | tojson)))' \
      "$HOOKS_SRC" > "$HOOKS_PATCHED_TMP"
    # User-level hooks: loaded by Copilot for every project (not just crewrig).
    cp "$HOOKS_PATCHED_TMP" "$USER_HOOKS_JSON"
    echo "  User-level transcript hooks deployed to $USER_HOOKS_JSON"
    # Workspace hooks: merge into .github/copilot/settings.json for crewrig sessions.
    backup_file "$WORKSPACE_SETTINGS"
    jq -s '.[0] * {"hooks": (.[1].hooks // []), "version": (.[1].version // .[0].version // "1")}' \
      "$WORKSPACE_SETTINGS" "$HOOKS_PATCHED_TMP" > "${WORKSPACE_SETTINGS}.tmp" && \
      mv "${WORKSPACE_SETTINGS}.tmp" "$WORKSPACE_SETTINGS"
    rm -f "$HOOKS_PATCHED_TMP"
    echo "  Workspace transcript hooks merged into $WORKSPACE_SETTINGS"
  else
    echo "  Transcript activation cancelled."
  fi
else
  echo "  Session recording disabled (re-run this script to enable)."
fi

echo ""
echo "===================================="
echo "  Setup complete"
echo "===================================="
echo ""
echo "Install mode: $INSTALL_MODE"
echo ""
echo "Active user-level instruction files:"
ls -1 "$COPILOT_INSTRUCTIONS"/*.instructions.md 2>/dev/null || echo "  (none)"
echo ""
echo "MCP servers (from mcp-config.json):"
jq -r '.mcpServers // {} | keys[]' "$MCP_CONFIG_TARGET" 2>/dev/null | sed 's|^|  - |' || echo "  (none)"
echo ""
echo "Copilot looks for skills under .github/skills/ and agents under .github/agents/."
echo "Run 'bash scripts/build-components.sh --target copilot' to (re)generate them."
echo ""
echo "Transcript hooks are installed at two levels:"
echo "  - User-level (~/.copilot/hooks/copilot-transcript-hooks.json): fires for ALL projects."
echo "  - Workspace-level (.github/copilot/settings.json): fires for this repo only."
echo ""
echo "Note: GitHub Copilot CLI does NOT export a \$COPILOT_PROJECT_DIR — hooks"
echo "read the workspace path from the stdin JSON payload (or fall back to \$PWD)."
