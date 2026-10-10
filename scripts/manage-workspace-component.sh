#!/bin/bash
# manage-workspace-component.sh — forwarding shim (spec 0255 R25). The entry is
# scripts/manage-workspace-component.ts; this file remains so every caller that still runs
# `bash scripts/manage-workspace-component.sh` (the Taskfile, the CI wiring, the Bash tests and the other scripts)
# reaches the TypeScript version.
#
# It runs the Node.js floor guard (scripts/lib/node-floor-guard.js), then the TypeScript entry
# with every argument and its standard input, and returns the entry's exit status, standard
# output and standard error unchanged. It fails closed: with `node` absent it writes one
# `Error:` line and exits 1; below the floor it exits with the floor guard's status and
# diagnostic, and the entry is not run, so the filesystem is left unmodified. The `Usage:`
# lines are printed by the TypeScript entry.
#
# Original description: Install or link Gemini CLI overlay-tier components
#
# Usage:
#   bash scripts/manage-workspace-component.sh <install|link> <type> [name]
#
# Types: commands, skills, hooks, agents, policies, mcp-servers, themes
# Default mode: install (copy). Link mode shows a security disclaimer but does
# NOT prompt — scripts/install-workspace.sh drives this script seven times in
# one run, so a per-type confirmation would fire seven times for one
# `task link-workspace`. The asymmetry with the other three commands is recorded
# in docs/cli-matrix.md row 12 with that reason.
#
# Every type resolves over the served overlay tiers — library, community, org —
# and never over `core` (spec 0119 R5/R6). `skills` and `agents` resolve from
# the compiled staging tree because the assisted setup does
# (setup-gemini-interactive.sh installs both from dist/<tier>/.gemini, R2); the
# other five resolve from the authoring sources, which is also what the setup
# reads wherever it touches the same landing zone.

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

if ! command -v node >/dev/null 2>&1; then
  echo "Error: node was not found on PATH; manage-workspace-component.sh needs Node.js 24 or later (https://nodejs.org/en/download)." >&2
  exit 1
fi

node "$DIR/lib/node-floor-guard.js" || exit $?

exec node "$DIR/manage-workspace-component.ts" "$@"
