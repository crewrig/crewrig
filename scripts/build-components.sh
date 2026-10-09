#!/bin/bash
# build-components.sh — forwarding shim (spec 0250 R22). The build is
# scripts/build-components.ts; this file remains so every caller that still runs
# `bash scripts/build-components.sh` (the setup, manage and install scripts and the
# Bash tests that have not migrated, the Taskfile before it was rewritten, and
# scripts/lib/common.sh and scripts/lib/component-resolve.sh) reaches the TypeScript
# build until their own row migrates them.
#
# It runs the Node.js floor guard (scripts/lib/node-floor-guard.js), then the
# TypeScript build with every argument and its standard input, and returns the
# build's exit status, standard output and standard error unchanged. It fails
# closed, unlike the hook shims of spec 0248: a build that cannot run must not
# report success. With `node` absent it writes one `Error:` line and exits 1; below
# the floor it exits with the floor guard's status and diagnostic, and the build is
# not run, so the filesystem is left unmodified. REPO_DIR and every other
# environment variable reach the build as set.
#
# Usage: bash scripts/build-components.sh [--target <cli>|all] [--tier <name>]
#        [--check] [--list-output-dirs] [--resolve <source> <target>]
#        [--diagnostics <path>]

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

if ! command -v node >/dev/null 2>&1; then
  echo "Error: node was not found on PATH; the component build needs Node.js 24 or later (https://nodejs.org/en/download)." >&2
  exit 1
fi

node "$DIR/lib/node-floor-guard.js" || exit $?

exec node "$DIR/build-components.ts" "$@"
