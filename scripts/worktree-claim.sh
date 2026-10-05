#!/bin/bash
# worktree-claim.sh — forwarding shim (spec 0248 R26). The tool is
# scripts/worktree-claim.ts; this file remains so the Bash oracle
# (scripts/tests/test-worktree-claim.sh), the nested invocations its tests make
# and any documentation not yet re-read keep working until the shims retire.
#
# It runs the Node.js floor guard (scripts/lib/node-floor-guard.js), then the
# TypeScript tool with every argument and its standard input, and returns the
# tool's exit status, standard output and standard error unchanged. It fails
# closed: with `node` absent it writes one `Error:` line and exits 1; below the
# floor it exits with the floor guard's status and diagnostic, and the tool is
# not run, so the filesystem is left unmodified.
#
# Usage: bash scripts/worktree-claim.sh <subcommand> [options]   (see --help)

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

if ! command -v node >/dev/null 2>&1; then
  echo "Error: node was not found on PATH; worktree-claim needs Node.js 24 or later (https://nodejs.org/en/download)." >&2
  exit 1
fi

node "$DIR/lib/node-floor-guard.js" || exit $?

exec node "$DIR/worktree-claim.ts" "$@"
