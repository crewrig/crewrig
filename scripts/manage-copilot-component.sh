#!/bin/bash
# manage-copilot-component.sh — forwarding shim (spec 0255 R25). The entry is
# scripts/manage-copilot-component.ts; this file remains so every caller that still runs
# `bash scripts/manage-copilot-component.sh` (the Taskfile, the CI wiring, the Bash tests and the other scripts)
# reaches the TypeScript version.
#
# It runs the Node.js floor guard (scripts/lib/node-floor-guard.js), then the TypeScript entry
# with every argument and its standard input, and returns the entry's exit status, standard
# output and standard error unchanged. It fails closed: with `node` absent it writes one
# `Error:` line and exits 1; below the floor it exits with the floor guard's status and
# diagnostic, and the entry is not run, so the filesystem is left unmodified. The `Usage:`
# lines are printed by the TypeScript entry.
#
# Original description: Install or link Copilot CLI overlay-tier components
#
# Usage:
#   bash scripts/manage-copilot-component.sh <install|link> <type> [name]
#
# Types: skills, commands (compiled as skills), mcp-servers
# Default mode: install (copy). Link mode shows security disclaimer.
#
# Skills land in ~/.copilot/skills — the same landing zone the assisted setup
# uses (COPILOT_SKILLS in setup-copilot-interactive.sh), read from the same
# basis, dist/<tier>/.github/skills (spec 0119 R1/R2). This command previously
# wrote into the repository's own .github/skills, which spec 0119 R3 forbids for
# a non-`core` tier and which silently dirtied the committed checkout.
#
# MCP servers are merged into ~/.copilot/mcp-config.json (user-level).
# `agents` is refused; see the dispatch arm for why.

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

if ! command -v node >/dev/null 2>&1; then
  echo "Error: node was not found on PATH; manage-copilot-component.sh needs Node.js 24 or later (https://nodejs.org/en/download)." >&2
  exit 1
fi

node "$DIR/lib/node-floor-guard.js" || exit $?

exec node "$DIR/manage-copilot-component.ts" "$@"
