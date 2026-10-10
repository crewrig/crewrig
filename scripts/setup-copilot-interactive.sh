#!/bin/bash
# setup-copilot-interactive.sh — forwarding shim (spec 0256 R33). The entry is
# scripts/setup-copilot-interactive.ts; this file remains so every caller that still runs
# `bash scripts/setup-copilot-interactive.sh` (the Taskfile, the Bash tests and the other scripts)
# reaches the TypeScript version.
#
# It runs the Node.js floor guard (scripts/lib/node-floor-guard.js), then the TypeScript entry
# with every argument (`--link`, `--answer <id>=<value>`) and its standard input, and returns the
# entry's exit status, standard output and standard error unchanged. It fails closed: with `node`
# absent it writes one `Error:` line and exits 1; below the floor it exits with the floor guard's
# status and diagnostic, and the entry is not run, so the filesystem is left unmodified. The usage
# lines are printed by the TypeScript entry.
#
# Original description: Interactive GitHub Copilot CLI configuration setup. Mirrors the Gemini and Claude
# setups — the Copilot config root is split across .github/copilot/, .github/skills/,
# .github/agents/, and .github/copilot-instructions.md at the workspace level.
# User-level layered context is deployed to ~/.copilot/instructions/*.instructions.md
# (the documented analog of ~/.claude/rules/ and ~/.gemini/).
# Reference:
# https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

if ! command -v node >/dev/null 2>&1; then
  echo "Error: node was not found on PATH; setup-copilot-interactive.sh needs Node.js 24 or later (https://nodejs.org/en/download)." >&2
  exit 1
fi

node "$DIR/lib/node-floor-guard.js" || exit $?

exec node "$DIR/setup-copilot-interactive.ts" "$@"
