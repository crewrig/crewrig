#!/bin/bash
# merge-spec-pr.sh — forwarding shim (spec 0262 requirement 16). The check is
# scripts/merge-spec-pr.ts; this file remains so every caller that still runs
# `bash scripts/merge-spec-pr.sh` reaches the TypeScript version until the shell files are retired.
#
# It runs the Node.js floor guard (scripts/lib/node-floor-guard.js), then the TypeScript entry
# with every argument and its standard input, and returns the entry's exit status, standard
# output and standard error unchanged. It fails closed: with `node` absent it writes one
# `Error:` line and exits 1; below the floor it exits with the floor guard's status and
# diagnostic, and the entry is not run.
#
# Usage: bash scripts/merge-spec-pr.sh [<arguments of scripts/merge-spec-pr.ts> ...]

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

if ! command -v node >/dev/null 2>&1; then
  echo "Error: node was not found on PATH; merge-spec-pr needs Node.js 24 or later (https://nodejs.org/en/download)." >&2
  exit 1
fi

node "$DIR/lib/node-floor-guard.js" || exit $?

exec node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON "$DIR/merge-spec-pr.ts" "$@"
