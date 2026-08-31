#!/bin/bash
set -e
# shellcheck source=scripts/lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
# shellcheck source=scripts/lib/tls-delegation.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/tls-delegation.sh"

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
    MISSING_PREREQS+=("$label is missing — run: agy -i \"$skill\" --new-project")
  fi
}

check_finalized "$REPO_DIR/config/SOUL.md"    "config/SOUL.md"    "/init-soul"
check_finalized "$REPO_DIR/config/PROFILE.md" "config/PROFILE.md" "/init-personal-profile"

if [ ${#MISSING_PREREQS[@]} -gt 0 ]; then
  echo "Cannot proceed — required identity files are missing:"
  for item in ${MISSING_PREREQS[@]+"${MISSING_PREREQS[@]}"}; do
    echo "  - $item"
  done
  echo ""
  echo "Generate them BEFORE re-running this script."
  exit 1
fi

# MemPalace version pin is single-sourced in scripts/lib/common.sh.

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

# System-context store (spec 0068) — one shared home path read on demand.
# Antigravity reads the store directly by default (PASS-default in the Step 1
# probe: `agy --print` read the store from an untrusted scratch dir with no
# flags). See docs/research/system-context-sandbox-probe.md.
install_dir "$REPO_DIR/artifacts/core/system-context" "$HOME/.crewrig/system-context" \
  "artifacts/core/system-context -> ~/.crewrig/system-context"

# Org rules (priority 66) — AGENTS.org.md fallback (spec 0020). Antigravity
# does not resolve @file imports in ANTIGRAVITY.md, so AGENTS.org.md is
# deployed as a context file. Re-run setup after editing AGENTS.org.md.
if [ -f "$REPO_DIR/AGENTS.org.md" ]; then
  install_file "$REPO_DIR/AGENTS.org.md" "$AGY_HOME/66_ORG_RULES.md" \
    "AGENTS.org.md -> 66_ORG_RULES.md"
fi

install_file "$REPO_DIR/config/SOUL.md" "$AGY_HOME/00_SOUL.md" \
  "SOUL.md -> 00_SOUL.md"

# User-gate validation backend (spec 0080) — per-user selection persisted to
# ~/.crewrig/validation.conf (outside the core layer). Read by user-validate.
configure_validation_backend
echo ""

fi  # end: SKIP_RULES_CONFIG guard for shared configuration

# --- MCP configuration (mcp_config.json) ---
echo "Configuring $AGY_MCP_CONFIG..."
mkdir -p "$(dirname "$AGY_MCP_CONFIG")"

# Custom root-CA / native-TLS delegation (spec 0084) — opt-in; runs before the
# network bootstrap so pipx / npx / git inherit trust when consented.
offer_tls_delegation
echo ""

backup_file "$AGY_MCP_CONFIG"

# Capture the operator's pre-existing MCP declarations + the backup path BEFORE
# the framework rebuilds mcp_config.json from its own base, so non-reserved
# servers can be folded back in after the write (spec 0089 R2/R4). Antigravity
# has no committed template — it builds MCP_BASE from empty — so this fold, not
# a seeded base, is what preserves an existing config (spec 0089 review).
PREEXISTING_MCP="$([ -f "$AGY_MCP_CONFIG" ] && jq -c '.mcpServers // {}' "$AGY_MCP_CONFIG" 2>/dev/null || echo '{}')"
MCP_BACKUP="$LAST_BACKUP_PATH"

# Detect MemPalace Python interpreter (used to patch mcpServers.mempalace.command)
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
    echo "         Install a supported version with: pipx install --force 'mempalace>=${MEMPALACE_MIN_VERSION},<${MEMPALACE_MAX_VERSION_EXCLUSIVE}'"
    exit 1
  fi
  echo "  Detected MemPalace interpreter: $MEMPALACE_PYTHON_BIN (mempalace $MEMPALACE_VERSION)"
fi

# Build the base mcp_config.json content (no mempalace yet).
# mcp_config.json uses the same top-level "mcpServers" key as settings.json,
# confirmed empirically (spec 0054 § Open questions).
# Start from an empty mcpServers object; MCP entries are patched in below.
MCP_BASE='{"mcpServers":{}}'

# MemPalace is detected → HTTP by default (spec 0113 delta-02 R17): the
# stdio-shaped entry is patched into MCP_BASE unconditionally and the
# shared-daemon HTTP registration after the final write replaces it. No
# opt-in prompt remains; when MemPalace is absent nothing is registered, as
# before.
INSTALL_MEMPALACE=0
if [ -n "$MEMPALACE_PYTHON_BIN" ]; then
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
       "command": "bash",
       "args": [($repo + "/scripts/lib/tls-exec.sh"), $py, ($repo + "/scripts/lib/mempalace-http-wrapper.py")]
     }')
  echo "  mempalace MCP server configured."
  INSTALL_MEMPALACE=1
fi

# Offer SequentialThinking opt-in independently.
INSTALL_SEQTHINK=$(echo -e "yes\nno" | fzf --height 10% \
  --header "Include SequentialThinking MCP server in mcp_config.json?")
if [ "$INSTALL_SEQTHINK" = "yes" ]; then
  MCP_BASE=$(echo "$MCP_BASE" | jq --arg repo "$REPO_DIR" \
    '.mcpServers.sequentialthinking = {
       "command": "bash",
       "args": [($repo + "/scripts/lib/tls-exec.sh"), "npx", "-y", "@modelcontextprotocol/server-sequential-thinking"]
     }')
  echo "  sequentialthinking MCP server configured."
fi

# Write atomically.
echo "$MCP_BASE" | jq '.' > "${AGY_MCP_CONFIG}.tmp" && mv "${AGY_MCP_CONFIG}.tmp" "$AGY_MCP_CONFIG"

# Fold the operator's pre-existing non-reserved MCP servers back over the
# framework base (spec 0089) — this is what preserves an existing Antigravity
# config despite the empty MCP_BASE. Framework reserved entries (mempalace /
# sequentialthinking) — including their spec-0084 TLS wrapping — are untouched.
merge_preexisting_mcp_servers "$PREEXISTING_MCP" "$AGY_MCP_CONFIG" "$MCP_BACKUP"

# Fold org-declared MCP servers (spec 0091) over the just-merged config, AFTER
# the 0089 operator fold, so precedence is framework-reserved > org > operator.
# Guarded on manifest presence, like the AGENTS.org.md fan-out. Both stdio and
# remote (http/sse) org servers are delivered: remote entries fold in as the
# Antigravity-native {serverUrl, headers} shape (docs/cli-matrix.md row 7h).
ORG_MCP_MANIFEST="$REPO_DIR/mcp-servers.org.json"
if [ -f "$ORG_MCP_MANIFEST" ]; then
  ORG_MCP_NATIVE="$(org_mcp_to_native antigravity "$(read_org_mcp_manifest "$ORG_MCP_MANIFEST")")"
  apply_org_mcp_servers "$ORG_MCP_NATIVE" "$AGY_MCP_CONFIG" "$PREEXISTING_MCP" "$MCP_BACKUP"
fi

# MemPalace HTTP by default (spec 0113 delta-02 R17-R20). Runs AFTER the final
# atomic MCP_BASE write above and after both folds — reserved names never
# appear in a preserved side (MCP_RESERVED_NAMES), so no fold touches this
# entry. Exit handling mirrors the Gemini setup: 0 = HTTP registered; 1 = the
# stdio entry stays (R19); 2 = the stdio entry stays with a loud lockout
# warning (R20 — no stdio convergence against a probe-verified serving daemon).
if [ "${INSTALL_MEMPALACE:-0}" -eq 1 ]; then
  ensure_mempalace_http "$REPO_DIR" antigravity
  _mempalace_rc=$?
  case "$_mempalace_rc" in
    0)
      echo "  MemPalace reaches shared memory through the HTTP daemon."
      ;;
    1)
      echo "  WARNING: mempalace stays on the stdio arrangement — no shared"
      echo "           daemon could be established. Sessions will contend for"
      echo "           the palace writer lock until the daemon is up."
      ;;
    2)
      echo "  LOCKOUT WARNING: the daemon is verified serving but registration"
      echo "           could not be completed, so the stdio entry just written"
      echo "           will be refused by the shared writer lock (MCP error"
      echo "           -32001) in every session."
      ;;
  esac
fi
echo "  Installed: mcp_config.json"
echo ""

if [ "$SKIP_RULES_CONFIG" -ne 1 ]; then

# --- Team selection ---
echo "Select your team:"
TEAM="$(pick_catalogue_entry "$REPO_DIR/config/teams" "team")"
if [ -n "$TEAM" ]; then
  install_file "$REPO_DIR/config/teams/${TEAM}.md" "$AGY_HOME/50_USER_TEAM.md" \
    "teams/${TEAM}.md -> 50_USER_TEAM.md"
  echo "$TEAM" > "$AGY_HOME/.selected_team"
  echo "Team: $TEAM"
else
  rm -f "$AGY_HOME/.selected_team"
fi
echo ""

# --- Expertise selection ---
echo "Select your expertise:"
EXPERTISE="$(pick_catalogue_entry "$REPO_DIR/config/expertise" "expertise")"
if [ -n "$EXPERTISE" ]; then
  install_file "$REPO_DIR/config/expertise/${EXPERTISE}.md" "$AGY_HOME/40_USER_EXPERTISE.md" \
    "expertise/${EXPERTISE}.md -> 40_USER_EXPERTISE.md"
  echo "$EXPERTISE" > "$AGY_HOME/.selected_expertise"
  echo "Expertise: $EXPERTISE"
else
  rm -f "$AGY_HOME/.selected_expertise"
fi
echo ""

# --- Level selection ---
echo "Select your experience level:"
LEVEL="$(pick_catalogue_entry "$REPO_DIR/config/level" "level")"
if [ -n "$LEVEL" ]; then
  install_file "$REPO_DIR/config/level/${LEVEL}.md" "$AGY_HOME/10_USER_LEVEL.md" \
    "level/${LEVEL}.md -> 10_USER_LEVEL.md"
  echo "$LEVEL" > "$AGY_HOME/.selected_level"
  echo "Level: $LEVEL"
else
  rm -f "$AGY_HOME/.selected_level"
fi
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
#
# THE INSTALL TARGET IS THE DOCUMENTED CUSTOMIZATION ROOT, NOT `$AGY_HOME`
# (spec 0123 R1/R2). `~/.gemini/antigravity-cli/` is Antigravity's application
# data directory; the vendor never documents it as a customization root and the
# assistant does not discover components from it. Measured 2026-08-11 on `agy`
# 1.1.11, twice: a sentinel skill and a sentinel agent under
# `~/.gemini/config/` are found, while the same sentinels under
# `~/.gemini/antigravity-cli/` and under the Gemini CLI roots are not. Full
# matrix and method: docs/runbooks/antigravity-discovery-probe.md.
#
# `$AGY_HOME` itself is deliberately unchanged: the priority-ordered context
# files (spec 0061) and the hooks directory (spec 0116) are not customizations
# discovered from a root, and they stay where they are.
AGY_SKILLS_HOME="${HOME}/.gemini/config/skills"
AGY_AGENTS_HOME="${HOME}/.gemini/config/agents"

# The superseded placement every existing machine still carries. Migrated below.
AGY_SUPERSEDED_ROOT="$AGY_HOME"

echo ""
echo "Installing library components to $AGY_SKILLS_HOME (automatic)..."
ensure_tier_built "$REPO_DIR" antigravity "$REPO_DIR/dist/library/.agents" || exit 1
install_antigravity_tier_to_home "$REPO_DIR" library "$AGY_SKILLS_HOME" "$AGY_AGENTS_HOME" || exit 1
echo ""

# Overlay tiers — each gated behind its own opt-in prompt.
for overlay_tier in community org; do
  if [ -d "$REPO_DIR/dist/$overlay_tier/.agents" ]; then
    INSTALL_OVERLAY=$(echo -e "no\nyes" | fzf --height 10% \
      --header "Install '$overlay_tier' components to ~/.gemini/config/skills? (opt-in)")
    if [ "$INSTALL_OVERLAY" = "yes" ]; then
      install_antigravity_tier_to_home "$REPO_DIR" "$overlay_tier" \
        "$AGY_SKILLS_HOME" "$AGY_AGENTS_HOME" || exit 1
    else
      echo "  '$overlay_tier' install skipped."
    fi
    echo ""
  fi
done

# --- Migrate the superseded placement (spec 0123 R8/R9) ---
#
# OUTSIDE the overlay opt-in branch, and unconditional on which tiers this run
# installs. R8 carries no tier qualifier: an adopter who once opted into `org`
# and declines it today must still have those components removed rather than
# orphaned. The overlay prompt above is itself gated on `dist/<tier>/.agents`
# existing, so scoping the sweep to the installed tiers would re-introduce the
# dependency on a stale, gitignored staging tree that this migration was
# rewritten to escape.
echo "Migrating components left at the superseded placement..."
migrate_antigravity_superseded_components \
  "$AGY_SUPERSEDED_ROOT" "$REPO_DIR/artifacts" all || exit 1
echo ""

# --- Transcript hooks (opt-in) --- (spec 0116)
# The three sibling setups have offered this since spec 0056; Antigravity did
# not, and the manifest it would have deployed registered four lifecycle events
# the CLI does not have. Both are fixed here.
#
# The deployment target is the GLOBAL customization root, `~/.gemini/config/` —
# the same root `$AGY_MCP_CONFIG` already uses. That root is the one confirmed
# to fire; the per-workspace `.agents/hooks.json` the vendor also documents was
# not observed to, and is recorded as a gap in docs/cli-matrix.md rather than
# shipped on trust.
ENABLE_TRANSCRIPTS=$(echo -e "no\nyes" | fzf --height 10% --header "Enable automatic session recording to MemPalace? (opt-in)")
if [ "$ENABLE_TRANSCRIPTS" = "yes" ]; then
  HOOKS_SRC="$REPO_DIR/hooks/antigravity-transcript-hooks.json"
  HOOK_SCRIPT_SRC="$REPO_DIR/hooks/mempalace-transcript.sh"
  AGY_HOOKS_DIR="$AGY_HOME/hooks"
  AGY_HOOKS_JSON="${HOME}/.gemini/config/hooks.json"
  echo ""
  echo "Activating transcript hooks will:"
  echo "  1. Install the hook script to $AGY_HOOKS_DIR/mempalace-transcript.sh (project-independent)"
  echo "  2. Deploy hooks to $AGY_HOOKS_JSON (fires for ALL projects)"
  if [ -f "$AGY_HOOKS_JSON" ]; then
    echo "  3. Backup $AGY_HOOKS_JSON to ${AGY_HOOKS_JSON}.bak.<timestamp>, then merge"
    echo "     the crewrig hook in — any hook you already declare is preserved"
  else
    echo "  3. Create $AGY_HOOKS_JSON (none exists today)"
  fi
  echo "  4. Record ONE entry each time the agent's execution loop ends — in"
  echo "     normal use, once per turn. No other event is"
  echo "     registered: the CLI's other four all fire once per model call or"
  echo "     once per tool step, many times in a single turn, and each hook run"
  echo "     blocks the agent loop"
  echo ""
  CONFIRM=$(echo -e "yes\nno" | fzf --height 10% --header "Apply?")
  if [ "$CONFIRM" = "yes" ]; then
    MEMPALACE_PYTHON_BIN="$(detect_mempalace_python || true)"
    ENV_PREFIX='MEMPALACE_TRANSCRIPT_ENABLED=1'
    if [ -n "$MEMPALACE_PYTHON_BIN" ]; then
      ENV_PREFIX="MEMPALACE_TRANSCRIPT_ENABLED=1 MEMPALACE_PYTHON=$MEMPALACE_PYTHON_BIN"
    fi
    # Guarded so a refused merge reports and lets the rest of setup finish,
    # rather than aborting the whole run under `set -e`. The helper leaves the
    # operator's file untouched on that path.
    if ! deploy_antigravity_transcript_hooks \
           "$HOOKS_SRC" "$HOOK_SCRIPT_SRC" "$AGY_HOOKS_DIR" "$AGY_HOOKS_JSON" "$ENV_PREFIX" \
           "$(dirname "$HOOKS_SRC")/worktree-git-guard.sh"; then
      echo "  Transcript activation FAILED — setup continues without it." >&2
    fi
  else
    echo "  Transcript activation canceled."
  fi
else
  echo "  Session recording disabled (re-run this script to enable)."
fi

echo ""

# --- Generate ~/.gemini/config/AGENTS.md from deployed context files (spec 0061) ---
# Antigravity CLI reads a single ~/.gemini/config/AGENTS.md as its system context.
# Concatenate every deployed priority-ordered context file into that single
# file so the layered configuration is active at runtime.
GEMINI_MD_TARGET="${HOME}/.gemini/config/AGENTS.md"
GEMINI_MD_LINES=0

echo "Generating $GEMINI_MD_TARGET..."
CONTEXT_FILES=$(find "$AGY_HOME" -maxdepth 1 \( -type f -o -type l \) -name "[0-9][0-9]_*.md" 2>/dev/null | sort)
if [ -n "$CONTEXT_FILES" ]; then
  mkdir -p "$(dirname "$GEMINI_MD_TARGET")"
  {
    while IFS= read -r ctx_file; do
      printf '<!-- crewrig-section: %s -->\n\n' "$(basename "$ctx_file")"
      cat "$ctx_file"
      printf '\n'
    done <<< "$CONTEXT_FILES"
  } > "${GEMINI_MD_TARGET}.tmp" && mv "${GEMINI_MD_TARGET}.tmp" "$GEMINI_MD_TARGET"
  GEMINI_MD_LINES=$(wc -l < "$GEMINI_MD_TARGET")
  echo "  Generated: $GEMINI_MD_TARGET ($GEMINI_MD_LINES lines)"
else
  echo "  No context files found in $AGY_HOME — $GEMINI_MD_TARGET not written."
fi
echo ""

# Clean up superseded ~/.gemini/GEMINI.md context file (spec 0061 delta-02, issue #1082)
# An earlier version of this setup generated ~/.gemini/GEMINI.md. If left behind,
# Antigravity CLI discovers it and loads duplicate stale rules alongside ~/.gemini/config/AGENTS.md.
LEGACY_GEMINI_MD="${HOME}/.gemini/GEMINI.md"
if [ -f "$LEGACY_GEMINI_MD" ] && grep -q '<!-- crewrig-section:' "$LEGACY_GEMINI_MD" 2>/dev/null; then
  rm -f "$LEGACY_GEMINI_MD"
  echo "  Removed superseded context file: $LEGACY_GEMINI_MD"
  echo ""
fi

echo "===================================="
echo "  Setup complete"
echo "===================================="
echo ""
echo "Install mode: $INSTALL_MODE"
echo ""
echo "Active context files:"
ls -1 "$AGY_HOME"/[0-9][0-9]_*.md 2>/dev/null | sed 's|^|  |' || echo "  (none)"
echo ""
echo "System context file (Antigravity runtime):"
if [ "$GEMINI_MD_LINES" -gt 0 ]; then
  echo "  $GEMINI_MD_TARGET ($GEMINI_MD_LINES lines)"
else
  echo "  (not generated)"
fi
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
