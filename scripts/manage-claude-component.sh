#!/bin/bash
# manage-claude-component.sh — forwarding shim (spec 0255 R25). The entry is
# scripts/manage-claude-component.ts; this file remains so every caller that still runs
# `bash scripts/manage-claude-component.sh` (the Taskfile, the CI wiring, the Bash tests and the other scripts)
# reaches the TypeScript version.
#
# It runs the Node.js floor guard (scripts/lib/node-floor-guard.js), then the TypeScript entry
# with every argument and its standard input, and returns the entry's exit status, standard
# output and standard error unchanged. It fails closed: with `node` absent it writes one
# `Error:` line and exits 1; below the floor it exits with the floor guard's status and
# diagnostic, and the entry is not run, so the filesystem is left unmodified. The `Usage:`
# lines are printed by the TypeScript entry.
#
# Original description: Install or link Claude Code overlay-tier components
#
# Usage:
#   bash scripts/manage-claude-component.sh <install|link> <type> [name]
#
# Types: claude-skills, policies, mcp-servers
# Default mode: install (copy). Link mode shows security disclaimer.
#
# Every type resolves over the served overlay tiers — library, community, org —
# and never over `core`, whose landing zone is the committed project tree and
# whose delivery is the build rather than an install (spec 0119 R5/R6). Which
# tiers happen to be populated no longer decides which tiers are reachable.

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

if ! command -v node >/dev/null 2>&1; then
  echo "Error: node was not found on PATH; manage-claude-component.sh needs Node.js 24 or later (https://nodejs.org/en/download)." >&2
  exit 1
fi

node "$DIR/lib/node-floor-guard.js" || exit $?

exec node "$DIR/manage-claude-component.ts" "$@"
