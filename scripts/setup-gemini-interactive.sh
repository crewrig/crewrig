#!/bin/bash
# setup-gemini-interactive.sh — forwarding shim (spec 0256 R33). The entry is
# scripts/setup-gemini-interactive.ts; this file remains so every caller that still runs
# `bash scripts/setup-gemini-interactive.sh` (the Taskfile, the Bash tests and the other scripts)
# reaches the TypeScript version.
#
# It runs the Node.js floor guard (scripts/lib/node-floor-guard.js), then the TypeScript entry
# with every argument (`--link`, `--answer <id>=<value>`) and its standard input, and returns the
# entry's exit status, standard output and standard error unchanged. It fails closed: with `node`
# absent it writes one `Error:` line and exits 1; below the floor it exits with the floor guard's
# status and diagnostic, and the entry is not run, so the filesystem is left unmodified. The usage
# lines are printed by the TypeScript entry.
#
# Original description: Interactive Gemini CLI configuration setup: deploys the layered context files to
# ~/.gemini/, installs the framework components, merges the settings and MCP
# servers, and offers the optional steps (TLS delegation, usage capture, MemPalace).

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

if ! command -v node >/dev/null 2>&1; then
  echo "Error: node was not found on PATH; setup-gemini-interactive.sh needs Node.js 24 or later (https://nodejs.org/en/download)." >&2
  exit 1
fi

node "$DIR/lib/node-floor-guard.js" || exit $?

exec node "$DIR/setup-gemini-interactive.ts" "$@"
