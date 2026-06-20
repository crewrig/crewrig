#!/bin/bash
set -e
# shellcheck source=scripts/lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

AGY_HOME="${HOME}/.gemini/antigravity-cli"
AGY_MCP_CONFIG="${HOME}/.gemini/config/mcp_config.json"
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
echo "  Antigravity CLI Configuration Setup"
echo "===================================="
echo ""

# --- R2: agy binary guard ---
command -v agy >/dev/null 2>&1 || {
  echo "Error: 'agy' binary not found in PATH."
  echo "Install Antigravity CLI: https://docs.antigravity.ai/install"
  exit 1
}

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

mkdir -p "$AGY_HOME"

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
# SOUL.md and PROFILE.md must exist BEFORE running this setup.
# Customization is optional: accepting all defaults in /init-soul and
# /init-personal-profile is a valid outcome, so a presence check is the
# contract — not a byte-diff against the template.
MISSING_PREREQS=()

check_finalized() {
  local file="$1" label="$2" skill="$3"
  if [ ! -f "$file" ]; then
    MISSING_PREREQS+=("$label is missing — run: agy $skill")
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

# --- MemPalace version pin ---
# The framework targets the v3.3.x line (see issue #30, Phase 0.1).
# v3.3.3 introduces the `wing` parameter on diary tools, BM25 hybrid search,
# and Halls — all relied upon by the cross-tool continuity protocol.
MEMPALACE_MIN_VERSION="3.3.3"
MEMPALACE_MAX_VERSION_EXCLUSIVE="3.4"

# --- Existing context files: keep or refresh? ---
SKIP_RULES_CONFIG=0
EXISTING=$(find "$AGY_HOME" -maxdepth 1 \( -type f -o -type l \) -name "[0-9][0-9]_*.md" 2>/dev/null)
if [ -n "$EXISTING" ]; then
  echo "Existing context files found in $AGY_HOME:"
  echo "$EXISTING" | sed "s|^$AGY_HOME/|   - |"
  echo ""
  RULES_ACTION=$(echo -e "keep\nrefresh" | fzf --height 15% \
    --header "Existing context files detected — keep them (skip selection) or refresh from scratch?")
  if [ "$RULES_ACTION" = "keep" ]; then
    SKIP_RULES_CONFIG=1
    echo "Keeping existing context files. Team / expertise / level / profile selection will be skipped."
    echo ""
  elif [ "$RULES_ACTION" = "refresh" ]; then
    find "$AGY_HOME" -maxdepth 1 \( -type f -o -type l \) -name "[0-9][0-9]_*.md" -delete
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

install_file "$REPO_DIR/config/ORGANIZATION.md" "$AGY_HOME/20_ORGANIZATION.md" \
  "ORGANIZATION.md -> 20_ORGANIZATION.md"

# Core framework tools (priority 60) — framework-critical instructions
install_file "$REPO_DIR/artifacts/core/rules/60-tools.md" "$AGY_HOME/60_TOOLS.md" \
  "artifacts/core/rules/60-tools.md -> 60_TOOLS.md"

# Org-specific tools (priority 65) — organization-specific additions
install_file "$REPO_DIR/config/TOOLS.md" "$AGY_HOME/65_TOOLS.md" \
  "TOOLS.md -> 65_TOOLS.md"

# Org rules (priority 66) — AGENTS.org.md fallback (spec 0020). Antigravity
# does not resolve @file imports in ANTIGRAVITY.md, so AGENTS.org.md is
# deployed as a context file. Re-run setup after editing AGENTS.org.md.
if [ -f "$REPO_DIR/AGENTS.org.md" ]; then
  install_file "$REPO_DIR/AGENTS.org.md" "$AGY_HOME/66_ORG_RULES.md" \
    "AGENTS.org.md -> 66_ORG_RULES.md"
fi

install_file "$REPO_DIR/config/SOUL.md" "$AGY_HOME/00_SOUL.md" \
  "SOUL.md -> 00_SOUL.md"
echo ""

fi  # end: SKIP_RULES_CONFIG guard for shared configuration

# --- MCP configuration (mcp_config.json) ---
echo "Configuring $AGY_MCP_CONFIG..."
mkdir -p "$(dirname "$AGY_MCP_CONFIG")"

backup_file "$AGY_MCP_CONFIG"

# Detect MemPalace Python interpreter (used to patch mcpServers.mempalace.command)
MEMPALACE_PYTHON_BIN="$(detect_mempalace_python || true)"
if [ -z "$MEMPALACE_PYTHON_BIN" ]; then
  echo "  MemPalace not found."
  offer_mempalace_install || true
  MEMPALACE_PYTHON_BIN="$(detect_mempalace_python || true)"
fi

INSTALL_MEMPALACE_AGY=no
if [ -n "$MEMPALACE_PYTHON_BIN" ]; then
  MEMPALACE_VERSION="$(mempalace_installed_version "$MEMPALACE_PYTHON_BIN")"
  if ! mempalace_version_in_range "$MEMPALACE_PYTHON_BIN"; then
    echo "  ERROR: MemPalace ${MEMPALACE_VERSION:-(unknown)} is outside the supported range >=${MEMPALACE_MIN_VERSION},<${MEMPALACE_MAX_VERSION_EXCLUSIVE}."
    echo "         Upgrade with: pipx install --force 'mempalace>=${MEMPALACE_MIN_VERSION},<${MEMPALACE_MAX_VERSION_EXCLUSIVE}'"
    exit 1
  fi
  echo "  Detected MemPalace interpreter: $MEMPALACE_PYTHON_BIN (mempalace $MEMPALACE_VERSION)"
  INSTALL_MEMPALACE_AGY=$(echo -e "yes\nno" | fzf --height 10% \
    --header "Include MemPalace MCP server in mcp_config.json?")
fi

# Build the base mcp_config.json content (no mempalace yet).
# mcp_config.json uses the same top-level "mcpServers" key as settings.json,
# confirmed empirically (spec 0054 § Open questions).
# Start from an empty mcpServers object; MCP entries are patched in below.
MCP_BASE='{"mcpServers":{}}'

INSTALL_MEMPALACE=0
if [ "$INSTALL_MEMPALACE_AGY" = "yes" ]; then
  # Install the shared ChromaDB HTTP daemon supervisor (issue #98) before
  # writing the wrapper into mcp_config.json — first-launch ordering matters.
  install_chroma_daemon "$REPO_DIR"

  # Patch mcpServers.mempalace with the detected python and substitute the
  # __CREWRIG_REPO_DIR__ placeholder in args with the repo root so the
  # http-wrapper resolves to an absolute path.
  MCP_BASE=$(echo "$MCP_BASE" | jq \
    --arg py "$MEMPALACE_PYTHON_BIN" \
    --arg repo "$REPO_DIR" \
    '.mcpServers.mempalace = {
       "command": $py,
       "args": [($repo + "/scripts/lib/mempalace-http-wrapper.py")]
     }')
  echo "  mempalace MCP server configured."
  INSTALL_MEMPALACE=1
fi

# Offer SequentialThinking opt-in independently.
INSTALL_SEQTHINK=$(echo -e "yes\nno" | fzf --height 10% \
  --header "Include SequentialThinking MCP server in mcp_config.json?")
if [ "$INSTALL_SEQTHINK" = "yes" ]; then
  MCP_BASE=$(echo "$MCP_BASE" | jq \
    '.mcpServers.sequentialthinking = {
       "command": "npx",
       "args": ["-y", "@modelcontextprotocol/server-sequential-thinking"]
     }')
  echo "  sequentialthinking MCP server configured."
fi

# Write atomically.
echo "$MCP_BASE" | jq '.' > "${AGY_MCP_CONFIG}.tmp" && mv "${AGY_MCP_CONFIG}.tmp" "$AGY_MCP_CONFIG"
echo "  Installed: mcp_config.json"
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
install_file "$REPO_DIR/config/teams/${TEAM}.md" "$AGY_HOME/50_USER_TEAM.md" \
  "teams/${TEAM}.md -> 50_USER_TEAM.md"
echo "$TEAM" > "$AGY_HOME/.selected_team"
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
install_file "$REPO_DIR/config/expertise/${EXPERTISE}.md" "$AGY_HOME/40_USER_EXPERTISE.md" \
  "expertise/${EXPERTISE}.md -> 40_USER_EXPERTISE.md"
echo "$EXPERTISE" > "$AGY_HOME/.selected_expertise"
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
install_file "$REPO_DIR/config/level/${LEVEL}.md" "$AGY_HOME/10_USER_LEVEL.md" \
  "level/${LEVEL}.md -> 10_USER_LEVEL.md"
echo "$LEVEL" > "$AGY_HOME/.selected_level"
echo "Level: $LEVEL"
echo ""

# --- Profile handling ---
TARGET="$AGY_HOME/30_USER_PROFILE.md"
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

# --- Artifact install to user home (ADR-0011, spec 0019) ---
# The build (scripts/build-components.sh) compiles each non-core tier into the
# gitignored staging tree dist/<tier>/.agents/skills/ and .../agents/. This
# phase installs them to the user home by tier scope:
#   library   — installed automatically (harness machinery, useful everywhere).
#   community — installed only on explicit opt-in (experimental sandbox).
#   org       — installed only on explicit opt-in (validated org components).
# `core` is never installed here: it ships in the project tree.
AGY_SKILLS_HOME="$AGY_HOME/skills"
AGY_AGENTS_HOME="$AGY_HOME/agents"

# install_tier_to_home <tier> — copy a staged tier's Antigravity skills and
# agents into the user home. Skills land in ~/.gemini/antigravity-cli/skills/<name>/,
# agents as flat ~/.gemini/antigravity-cli/agents/<name>.md files.
# Reads from dist/<tier>/.agents/ (Antigravity build output per spec 0053 R2/R3).
# No-op if the tier was not built.
install_tier_to_home() {
  local tier="$1"
  local staging="$REPO_DIR/dist/$tier/.agents"
  if [ ! -d "$staging" ]; then
    echo "  Tier '$tier' not built (no $staging) — run 'bash scripts/build-components.sh' first."
    return 0
  fi
  if [ -d "$staging/skills" ]; then
    mkdir -p "$AGY_SKILLS_HOME"
    for skill_dir in "$staging/skills"/*/; do
      [ -d "$skill_dir" ] || continue
      local skill_name
      skill_name="$(basename "$skill_dir")"
      rm -rf "${AGY_SKILLS_HOME:?}/$skill_name"
      cp -R "$skill_dir" "$AGY_SKILLS_HOME/$skill_name"
      echo "  Installed skill: $tier/$skill_name -> ~/.gemini/antigravity-cli/skills/$skill_name"
    done
  fi
  if [ -d "$staging/agents" ]; then
    mkdir -p "$AGY_AGENTS_HOME"
    for agent_file in "$staging/agents"/*.md; do
      [ -f "$agent_file" ] || continue
      local agent_base
      agent_base="$(basename "$agent_file")"
      cp "$agent_file" "$AGY_AGENTS_HOME/$agent_base"
      echo "  Installed agent: $tier/$agent_base -> ~/.gemini/antigravity-cli/agents/$agent_base"
    done
  fi
}

echo ""
echo "Installing library components to $AGY_SKILLS_HOME (automatic)..."
install_tier_to_home library
echo ""

# Overlay tiers — each gated behind its own opt-in prompt.
for overlay_tier in community org; do
  if [ -d "$REPO_DIR/dist/$overlay_tier/.agents" ]; then
    INSTALL_OVERLAY=$(echo -e "no\nyes" | fzf --height 10% \
      --header "Install '$overlay_tier' components to ~/.gemini/antigravity-cli/skills? (opt-in)")
    if [ "$INSTALL_OVERLAY" = "yes" ]; then
      install_tier_to_home "$overlay_tier"
    else
      echo "  '$overlay_tier' install skipped."
    fi
    echo ""
  fi
done

echo ""
echo "===================================="
echo "  Setup complete"
echo "===================================="
echo ""
echo "Install mode: $INSTALL_MODE"
echo ""
echo "Active context files:"
ls -1 "$AGY_HOME"/[0-9][0-9]_*.md 2>/dev/null | sed 's|^|  |' || echo "  (none)"
echo ""
echo "MCP servers (from mcp_config.json):"
jq -r '.mcpServers // {} | keys[]' "$AGY_MCP_CONFIG" 2>/dev/null | sed 's|^|  - |' || echo "  (none)"
echo ""
if [ "${INSTALL_MEMPALACE:-0}" -ne 1 ]; then
  echo "Note: MemPalace MCP server is NOT installed in mcp_config.json."
  echo "      Install MemPalace at the supported version, then re-run this script:"
  echo "      pipx install 'mempalace>=${MEMPALACE_MIN_VERSION},<${MEMPALACE_MAX_VERSION_EXCLUSIVE}'"
  echo ""
fi
echo "Restart any running Antigravity CLI session to pick up the new configuration."
