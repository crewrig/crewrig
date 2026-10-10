#!/bin/bash
# install-workspace.sh — forwarding shim (spec 0255 R25). The entry is
# scripts/install-workspace.ts; this file remains so every caller that still runs
# `bash scripts/install-workspace.sh` (the Taskfile, the CI wiring, the Bash tests and the other scripts)
# reaches the TypeScript version.
#
# It runs the Node.js floor guard (scripts/lib/node-floor-guard.js), then the TypeScript entry
# with every argument and its standard input, and returns the entry's exit status, standard
# output and standard error unchanged. It fails closed: with `node` absent it writes one
# `Error:` line and exits 1; below the floor it exits with the floor guard's status and
# diagnostic, and the entry is not run, so the filesystem is left unmodified. The `Usage:`
# lines are printed by the TypeScript entry.
#
# Original description: Install (or link) every artifacts component type for
# Gemini CLI in one run.
#
# Every type runs, whatever any other type does. Before spec 0119 the loop body
# ran bare under `set -e`, so a single non-zero status truncated the run: with a
# stub exiting 3 on `hooks`, `commands`, `skills` and `hooks` ran, the wrapper
# exited 3, and `agents`, `policies`, `mcp-servers` and `themes` never ran at
# all. spec 0119 R15 gives that abort a legitimate cause to fire on — one
# colliding name in one type — so leaving it would have silently dropped four
# later types, failing R9 through `task install-workspace` and
# `task link-workspace`, which R19 binds.

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

if ! command -v node >/dev/null 2>&1; then
  echo "Error: node was not found on PATH; install-workspace.sh needs Node.js 24 or later (https://nodejs.org/en/download)." >&2
  exit 1
fi

node "$DIR/lib/node-floor-guard.js" || exit $?

exec node "$DIR/install-workspace.ts" "$@"
