#!/bin/bash
# manage-antigravity-component.sh — forwarding shim (spec 0255 R25). The entry is
# scripts/manage-antigravity-component.ts; this file remains so every caller that still runs
# `bash scripts/manage-antigravity-component.sh` (the Taskfile, the CI wiring, the Bash tests and the other scripts)
# reaches the TypeScript version.
#
# It runs the Node.js floor guard (scripts/lib/node-floor-guard.js), then the TypeScript entry
# with every argument and its standard input, and returns the entry's exit status, standard
# output and standard error unchanged. It fails closed: with `node` absent it writes one
# `Error:` line and exits 1; below the floor it exits with the floor guard's status and
# diagnostic, and the entry is not run, so the filesystem is left unmodified. The `Usage:`
# lines are printed by the TypeScript entry.
#
# Original description: Install or link Antigravity CLI overlay-tier components
#
# Usage:
#   bash scripts/manage-antigravity-component.sh <install|link> <type> [name]
#
# Types: antigravity-skills, policies, mcp-servers
# Default mode: install (copy). Link mode shows security disclaimer.
#
# Skills are installed into the documented machine-local customization root
# (~/.gemini/config/skills/) — the same location a full setup run uses, per
# spec 0123 R7. Policies still land in ~/.gemini/antigravity-cli/rules and MCP
# servers are still merged into ~/.gemini/antigravity-cli/settings.json: no
# observation covers those two kinds, and asserting a defect there would rest on
# exactly the documentation-only reasoning spec 0123 exists to correct. They
# warrant their own ticket, opened with a probe of their own.
#
# Every type resolves over the served overlay tiers — library, community, org —
# and never over `core` (spec 0119 R5/R6). Skills resolve from the compiled
# staging tree dist/<tier>/.agents/skills, the same basis the assisted setup
# reads (R2); policies and mcp-servers resolve from the authoring sources, which
# before this change were hardcoded to the community tier alone.

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

if ! command -v node >/dev/null 2>&1; then
  echo "Error: node was not found on PATH; manage-antigravity-component.sh needs Node.js 24 or later (https://nodejs.org/en/download)." >&2
  exit 1
fi

node "$DIR/lib/node-floor-guard.js" || exit $?

exec node "$DIR/manage-antigravity-component.ts" "$@"
