#!/bin/bash
# install-extension-all.sh — forwarding shim (spec 0255 R25). The entry is
# scripts/install-extension-all.ts; this file remains so every caller that still runs
# `bash scripts/install-extension-all.sh` (the Taskfile, the CI wiring, the Bash tests and the other scripts)
# reaches the TypeScript version.
#
# It runs the Node.js floor guard (scripts/lib/node-floor-guard.js), then the TypeScript entry
# with every argument and its standard input, and returns the entry's exit status, standard
# output and standard error unchanged. It fails closed: with `node` absent it writes one
# `Error:` line and exits 1; below the floor it exits with the floor guard's status and
# diagnostic, and the entry is not run, so the filesystem is left unmodified. The `Usage:`
# lines are printed by the TypeScript entry.
#
# Original description: Cross-CLI umbrella installer for extensions (spec 0177)
#
# Usage:
#   bash scripts/install-extension-all.sh <extension-name>
#
# Installs a named extension across all supported CLIs present on the system:
#   - Gemini CLI (~/.gemini/extensions/<name>)
#   - Claude Code (local-marketplace + claude plugin install)
#   - GitHub Copilot CLI (copilot plugin install)
#   - Antigravity CLI (agy plugin install)
#
# Reports status for each target explicitly: [INSTALLED], [SKIPPED], [FAILED].
# Exits non-zero if all targets are skipped or if any present installation fails.

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

if ! command -v node >/dev/null 2>&1; then
  echo "Error: node was not found on PATH; install-extension-all.sh needs Node.js 24 or later (https://nodejs.org/en/download)." >&2
  exit 1
fi

node "$DIR/lib/node-floor-guard.js" || exit $?

exec node "$DIR/install-extension-all.ts" "$@"
