#!/bin/bash
# stop-chroma-server.sh — forwarding shim (spec 0252 requirement 13). The tool is
# scripts/stop-chroma-server.ts (stop the shared ChromaDB HTTP daemon); this file remains so every caller that still
# runs `bash scripts/stop-chroma-server.sh` reaches it.
#
# It runs the Node.js floor guard (scripts/lib/node-floor-guard.js), then the
# TypeScript tool with every argument and its standard input, and returns the
# tool's exit status, standard output and standard error unchanged. It fails
# closed: with `node` absent it writes one `Error:` line and exits 1; below the
# floor it exits with the floor guard's status and diagnostic and the tool is not
# run. The environment reaches the tool as set.

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

if ! command -v node >/dev/null 2>&1; then
  echo "Error: node was not found on PATH; the ChromaDB daemon tool needs Node.js 24 or later (https://nodejs.org/en/download)." >&2
  exit 1
fi

node "$DIR/lib/node-floor-guard.js" || exit $?

exec node "$DIR/stop-chroma-server.ts" "$@"
