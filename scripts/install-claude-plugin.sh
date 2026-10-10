#!/bin/bash
# install-claude-plugin.sh — forwarding shim (spec 0255 R25). The entry is
# scripts/install-claude-plugin.ts; this file remains so every caller that still runs
# `bash scripts/install-claude-plugin.sh` (the Taskfile, the CI wiring, the Bash tests and the other scripts)
# reaches the TypeScript version.
#
# It runs the Node.js floor guard (scripts/lib/node-floor-guard.js), then the TypeScript entry
# with every argument and its standard input, and returns the entry's exit status, standard
# output and standard error unchanged. It fails closed: with `node` absent it writes one
# `Error:` line and exits 1; below the floor it exits with the floor guard's status and
# diagnostic, and the entry is not run, so the filesystem is left unmodified. The `Usage:`
# lines are printed by the TypeScript entry.
#
# Original description: Install a Claude Code plugin from an extension
#
# Usage:
#   bash scripts/install-claude-plugin.sh <extension-name>
#
# Builds the Claude Code plugin into a single shared local marketplace home
# (${CLAUDE_CONFIG_DIR:-$HOME/.claude}/local-marketplace/), then registers it
# through the official marketplace mechanism:
#   1. `claude plugin marketplace add <local-marketplace-home>`
#   2. `claude plugin install <name>@<marketplace>`
#
# The shared home lives OUTSIDE the working tree so multiple extensions
# coexist in one marketplace and installs survive branch switches. The
# marketplace manifest is shared and upserts each extension by name.
#
# Claude Code does NOT auto-discover plugins under ~/.claude/plugins/.
# Plugins must be declared in a marketplace and installed via the CLI for
# Claude Code to pick them up. Use `claude --plugin-dir <path>` for dev
# mode if you want to skip the marketplace step.
#
# Prerequisites: jq, claude

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

if ! command -v node >/dev/null 2>&1; then
  echo "Error: node was not found on PATH; install-claude-plugin.sh needs Node.js 24 or later (https://nodejs.org/en/download)." >&2
  exit 1
fi

node "$DIR/lib/node-floor-guard.js" || exit $?

exec node "$DIR/install-claude-plugin.ts" "$@"
