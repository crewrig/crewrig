#!/bin/bash
# setup-antigravity-interactive.sh — forwarding shim (spec 0256 R33). The entry is
# scripts/setup-antigravity-interactive.ts; this file remains so every caller that still runs
# `bash scripts/setup-antigravity-interactive.sh` (the Taskfile, the Bash tests and the other scripts)
# reaches the TypeScript version.
#
# It runs the Node.js floor guard (scripts/lib/node-floor-guard.js), then the TypeScript entry
# with every argument (`--link`, `--answer <id>=<value>`) and its standard input, and returns the
# entry's exit status, standard output and standard error unchanged. It fails closed: with `node`
# absent it writes one `Error:` line and exits 1; below the floor it exits with the floor guard's
# status and diagnostic, and the entry is not run, so the filesystem is left unmodified. The usage
# lines are printed by the TypeScript entry.
#
# Original description: Interactive Antigravity CLI configuration setup: requires the `agy` binary, deploys
# the layered context files under ~/.gemini/antigravity-cli/, installs the framework
# components and wires the MCP servers in ~/.gemini/config/mcp_config.json.

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

if ! command -v node >/dev/null 2>&1; then
  echo "Error: node was not found on PATH; setup-antigravity-interactive.sh needs Node.js 24 or later (https://nodejs.org/en/download)." >&2
  exit 1
fi

node "$DIR/lib/node-floor-guard.js" || exit $?

exec node "$DIR/setup-antigravity-interactive.ts" "$@"
