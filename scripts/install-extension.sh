#!/bin/bash
# install-extension.sh — forwarding shim (spec 0255 R25). The entry is
# scripts/install-extension.ts; this file remains so every caller that still runs
# `bash scripts/install-extension.sh` (the Taskfile, the CI wiring, the Bash tests and the other scripts)
# reaches the TypeScript version.
#
# It runs the Node.js floor guard (scripts/lib/node-floor-guard.js), then the TypeScript entry
# with every argument and its standard input, and returns the entry's exit status, standard
# output and standard error unchanged. It fails closed: with `node` absent it writes one
# `Error:` line and exits 1; below the floor it exits with the floor guard's status and
# diagnostic, and the entry is not run, so the filesystem is left unmodified. The `Usage:`
# lines are printed by the TypeScript entry.
#
# Usage: bash scripts/install-extension.sh [install|link] [<extension-name>|--include-org]
#
# Installs (copies) or links extensions into the Gemini CLI home ($HOME/.gemini/extensions/<name>).
# Extensions live under extensions/<tier>/<name>/. The tier is a SOURCE-side organization concern:
# the install TARGET stays flat, the tier is never reflected in the installed extension's name.
# The "all" loop covers the upstream tiers (core + library); the adopter-owned org tier is opt-in:
# pass --include-org (or set INCLUDE_ORG=1) to fold it in.

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

if ! command -v node >/dev/null 2>&1; then
  echo "Error: node was not found on PATH; install-extension.sh needs Node.js 24 or later (https://nodejs.org/en/download)." >&2
  exit 1
fi

node "$DIR/lib/node-floor-guard.js" || exit $?

exec node "$DIR/install-extension.ts" "$@"
