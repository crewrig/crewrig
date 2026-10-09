#!/bin/bash
# build-extension.sh — forwarding shim (spec 0254 R24). The extension render and its --check is
# scripts/build-extension.ts; this file remains so every caller that still runs
# `bash scripts/build-extension.sh` (the install scripts, the release and scaffolding scripts, the Bash
# tests that have not migrated and the CI wiring before it is rewritten) reaches the TypeScript
# version until its own row migrates it.
#
# It runs the Node.js floor guard (scripts/lib/node-floor-guard.js), then the TypeScript entry
# with every argument and its standard input, and returns the entry's exit status, standard
# output and standard error unchanged. It fails closed: with `node` absent it writes one
# `Error:` line and exits 1; below the floor it exits with the floor guard's status and
# diagnostic, and the entry is not run, so the filesystem is left unmodified.
#
# Usage: bash scripts/build-extension.sh [--check] [--target gemini|claude|copilot|antigravity|all] [<extension-dir-or-name> ...]

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

if ! command -v node >/dev/null 2>&1; then
  echo "Error: node was not found on PATH; the extension build needs Node.js 24 or later (https://nodejs.org/en/download)." >&2
  exit 1
fi

node "$DIR/lib/node-floor-guard.js" || exit $?

exec node "$DIR/build-extension.ts" "$@"
