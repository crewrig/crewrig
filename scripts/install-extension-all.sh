#!/bin/bash
# install-extension-all.sh — Cross-CLI umbrella installer for extensions (spec 0177)
#
# Usage:
#   bash scripts/install-extension-all.sh <extension-name>
#
# Installs a named extension across all supported CLIs present on the system:
#   - Gemini CLI (~/.gemini/extensions/<name>)
#   - Claude Code (local-marketplace + claude plugin install)
#   - GitHub Copilot CLI (copilot plugin install)
#   - Antigravity CLI (agy plugin install)
#
# Reports status for each target explicitly: [INSTALLED], [SKIPPED], [FAILED].
# Exits non-zero if all targets are skipped or if any present installation fails.

set -u

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
EXT_NAME="${1:-}"

if [ -z "$EXT_NAME" ] || [ "$EXT_NAME" = "-h" ] || [ "$EXT_NAME" = "--help" ]; then
  echo "Usage: install-extension-all.sh <extension-name>"
  echo ""
  echo "Installs an extension across all supported CLIs present on the host machine"
  echo "(Gemini CLI, Claude Code, GitHub Copilot CLI, Antigravity CLI)."
  [ -z "$EXT_NAME" ] && exit 1 || exit 0
fi

# Resolve the bare extension name across source tiers
EXT_DIR=""
for tier in core library org; do
  if [ -d "$REPO_DIR/extensions/$tier/$EXT_NAME" ]; then
    if [ -n "$EXT_DIR" ]; then
      echo "Error: extension '$EXT_NAME' exists in multiple tiers; names must be unique." >&2
      exit 1
    fi
    EXT_DIR="$REPO_DIR/extensions/$tier/$EXT_NAME"
  fi
done

if [ -z "$EXT_DIR" ]; then
  echo "Error: Extension '$EXT_NAME' not found in extensions/ (searched core, library, org)." >&2
  exit 1
fi

echo "Installing extension '$EXT_NAME' across available CLIs..."

installed_count=0
skipped_count=0
failed_count=0

GEMINI_HOME="${GEMINI_HOME:-$HOME/.gemini}"

# 1. Gemini CLI
if [ -d "$GEMINI_HOME" ] || command -v gemini >/dev/null 2>&1; then
  if bash "$REPO_DIR/scripts/install-extension.sh" install "$EXT_NAME" >/dev/null 2>&1; then
    echo "  [INSTALLED] Gemini CLI ($GEMINI_HOME/extensions/$EXT_NAME)"
    installed_count=$((installed_count + 1))
  else
    echo "  [FAILED]    Gemini CLI (install-extension.sh failed)" >&2
    failed_count=$((failed_count + 1))
  fi
else
  echo "  [SKIPPED]   Gemini CLI (neither '$GEMINI_HOME' directory nor 'gemini' CLI binary found)"
  skipped_count=$((skipped_count + 1))
fi

# 2. Claude Code
if ! command -v jq >/dev/null 2>&1; then
  echo "  [SKIPPED]   Claude Code ('jq' dependency not found in PATH)"
  skipped_count=$((skipped_count + 1))
elif ! command -v claude >/dev/null 2>&1; then
  echo "  [SKIPPED]   Claude Code ('claude' CLI binary not found in PATH)"
  skipped_count=$((skipped_count + 1))
else
  if bash "$REPO_DIR/scripts/install-claude-plugin.sh" "$EXT_NAME" >/dev/null 2>&1; then
    echo "  [INSTALLED] Claude Code"
    installed_count=$((installed_count + 1))
  else
    echo "  [FAILED]    Claude Code (install-claude-plugin.sh failed)" >&2
    failed_count=$((failed_count + 1))
  fi
fi

# 3. GitHub Copilot CLI
if ! command -v jq >/dev/null 2>&1; then
  echo "  [SKIPPED]   GitHub Copilot CLI ('jq' dependency not found in PATH)"
  skipped_count=$((skipped_count + 1))
elif ! command -v copilot >/dev/null 2>&1; then
  echo "  [SKIPPED]   GitHub Copilot CLI ('copilot' CLI binary not found in PATH)"
  skipped_count=$((skipped_count + 1))
else
  if bash "$REPO_DIR/scripts/install-copilot-plugin.sh" "$EXT_NAME" >/dev/null 2>&1; then
    echo "  [INSTALLED] GitHub Copilot CLI"
    installed_count=$((installed_count + 1))
  else
    echo "  [FAILED]    GitHub Copilot CLI (install-copilot-plugin.sh failed)" >&2
    failed_count=$((failed_count + 1))
  fi
fi

# 4. Antigravity CLI
if ! command -v jq >/dev/null 2>&1; then
  echo "  [SKIPPED]   Antigravity CLI ('jq' dependency not found in PATH)"
  skipped_count=$((skipped_count + 1))
elif ! command -v agy >/dev/null 2>&1; then
  echo "  [SKIPPED]   Antigravity CLI ('agy' CLI binary not found in PATH)"
  skipped_count=$((skipped_count + 1))
else
  if bash "$REPO_DIR/scripts/install-antigravity-extension.sh" "$EXT_NAME" >/dev/null 2>&1; then
    echo "  [INSTALLED] Antigravity CLI"
    installed_count=$((installed_count + 1))
  else
    echo "  [FAILED]    Antigravity CLI (install-antigravity-extension.sh failed)" >&2
    failed_count=$((failed_count + 1))
  fi
fi

echo ""
if [ "$failed_count" -gt 0 ]; then
  echo "Error: Installation failed for $failed_count target(s) ($installed_count installed, $skipped_count skipped, $failed_count failed)." >&2
  exit 1
fi

if [ "$installed_count" -eq 0 ]; then
  echo "Error: No supported CLI targets were available; all $skipped_count target(s) were skipped." >&2
  exit 1
fi

echo "Summary: Successfully installed '$EXT_NAME' across $installed_count CLI target(s) ($skipped_count skipped)."
exit 0
