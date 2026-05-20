#!/bin/bash
# setup-copilot-interactive.sh — Interactive GitHub Copilot CLI configuration setup.
#
# Mirrors scripts/setup-gemini-interactive.sh — the Copilot config root is split
# across .github/copilot/, .github/skills/, .github/agents/, and
# .github/copilot-instructions.md. There is no single ~/.copilot/rules tree
# analogous to ~/.claude/rules; this script focuses on workspace-level setup
# (settings.json, hook activation) and surfaces the entry-point file location.

set -e
# shellcheck source=scripts/lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

COPILOT_HOME="${HOME}/.copilot"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
INSTALL_MODE="copy"

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

# --- Transcript hooks (opt-in) ---
ENABLE_TRANSCRIPTS=$(echo -e "no\nyes" | fzf --height 10% --header "Enable automatic session recording to MemPalace? (opt-in)")
if [ "$ENABLE_TRANSCRIPTS" = "yes" ]; then
  HOOKS_SRC="$REPO_DIR/hooks/copilot-transcript-hooks.json"
  HOOK_SCRIPT_SRC="$REPO_DIR/hooks/mempalace-transcript.sh"
  COPILOT_HOOKS_DIR="$COPILOT_HOME/hooks"
  HOOK_SCRIPT_TARGET="$COPILOT_HOOKS_DIR/mempalace-transcript.sh"
  echo ""
  echo "Activating transcript hooks will:"
  echo "  1. Install the hook script to $HOOK_SCRIPT_TARGET (project-independent)"
  echo "  2. Backup $WORKSPACE_SETTINGS to ${WORKSPACE_SETTINGS}.bak.<timestamp>"
  echo "  3. Merge hooks from $HOOKS_SRC into $WORKSPACE_SETTINGS"
  echo "  4. Rewrite each hook command to point at $HOOK_SCRIPT_TARGET"
  echo ""
  CONFIRM=$(echo -e "yes\nno" | fzf --height 10% --header "Apply?")
  if [ "$CONFIRM" = "yes" ]; then
    mkdir -p "$COPILOT_HOOKS_DIR"
    install_file "$HOOK_SCRIPT_SRC" "$HOOK_SCRIPT_TARGET" \
      "mempalace-transcript.sh -> ~/.copilot/hooks/mempalace-transcript.sh"
    chmod +x "$HOOK_SCRIPT_TARGET" 2>/dev/null || true
    backup_file "$WORKSPACE_SETTINGS"
    MEMPALACE_PYTHON_BIN="$(detect_mempalace_python || true)"
    ENV_PREFIX='MEMPALACE_TRANSCRIPT_ENABLED=1'
    if [ -n "$MEMPALACE_PYTHON_BIN" ]; then
      ENV_PREFIX="MEMPALACE_TRANSCRIPT_ENABLED=1 MEMPALACE_PYTHON=$MEMPALACE_PYTHON_BIN"
    fi
    HOOKS_PATCHED_TMP="$(mktemp)"
    jq --arg envp "$ENV_PREFIX" --arg hook_path "$HOOK_SCRIPT_TARGET" \
      '(.hooks // []) |= map(.command = ($envp + " bash " + ($hook_path | tojson)))' \
      "$HOOKS_SRC" > "$HOOKS_PATCHED_TMP"
    # Merge: workspace settings's "hooks" array becomes the patched one.
    jq -s '.[0] * {"hooks": (.[1].hooks // []), "version": (.[1].version // .[0].version // "1")}' \
      "$WORKSPACE_SETTINGS" "$HOOKS_PATCHED_TMP" > "${WORKSPACE_SETTINGS}.tmp" && \
      mv "${WORKSPACE_SETTINGS}.tmp" "$WORKSPACE_SETTINGS"
    rm -f "$HOOKS_PATCHED_TMP"
    echo "  Transcript hooks merged into $WORKSPACE_SETTINGS"
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
echo "Copilot looks for skills under .github/skills/ and agents under .github/agents/."
echo "Run 'bash scripts/build-components.sh --target copilot' to (re)generate them."
echo ""
echo "Note: GitHub Copilot CLI does NOT export a \$COPILOT_PROJECT_DIR — hooks"
echo "read the workspace path from the stdin JSON payload (or fall back to \$PWD)."
