#!/bin/bash
# install-copilot-plugin.sh — forwarding shim (spec 0255 R25). The entry is
# scripts/install-copilot-plugin.ts; this file remains so every caller that still runs
# `bash scripts/install-copilot-plugin.sh` (the Taskfile, the CI wiring, the Bash tests and the other scripts)
# reaches the TypeScript version.
#
# It runs the Node.js floor guard (scripts/lib/node-floor-guard.js), then the TypeScript entry
# with every argument and its standard input, and returns the entry's exit status, standard
# output and standard error unchanged. It fails closed: with `node` absent it writes one
# `Error:` line and exits 1; below the floor it exits with the floor guard's status and
# diagnostic, and the entry is not run, so the filesystem is left unmodified. The `Usage:`
# lines are printed by the TypeScript entry.
#
# Original description: Install a Copilot CLI plugin from an extension
#
# Usage:
#   bash scripts/install-copilot-plugin.sh <extension-name>
#
# Resolves the named extension by searching extensions/core/, extensions/library/,
# and extensions/org/ in that order, builds the plugin into a temporary output
# directory under dist-copilot-plugin/, and registers it with the `copilot` binary
# via `copilot plugin install`.
#
# Prerequisites: jq, copilot

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

if ! command -v node >/dev/null 2>&1; then
  echo "Error: node was not found on PATH; install-copilot-plugin.sh needs Node.js 24 or later (https://nodejs.org/en/download)." >&2
  exit 1
fi

node "$DIR/lib/node-floor-guard.js" || exit $?

exec node "$DIR/install-copilot-plugin.ts" "$@"
