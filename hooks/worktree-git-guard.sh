#!/bin/bash
# worktree-git-guard.sh — forwarding shim (spec 0248 R13). The hook is
# hooks/worktree-git-guard.ts; this file remains only so an installation whose
# wired command line still names this `.sh` path keeps its guard until setup
# rewrites it to the direct `node` form.
#
# It fails OPEN on a toolchain that cannot start the guard (no `node`, or a
# `node` below the Node.js 24 floor): exit 0 with one diagnostic line, never a
# non-zero status, which a fail-closed Copilot CLI `preToolUse` would turn into
# a refusal of every tool call. Once the floor holds, `exec` hands the process
# to the TypeScript entry so its status, standard output and standard error
# reach the CLI unchanged, standard input untouched.
#
# Usage: bash hooks/worktree-git-guard.sh [command]   (payload on stdin)

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

if ! command -v node >/dev/null 2>&1; then
  echo "worktree-git-guard: node not found on PATH; the worktree git guard requires Node.js >= 24 and is not enforcing." >&2
  exit 0
fi

# The floor guard prints its own diagnostic below the floor; standard input is
# left for the entry, so it is not forwarded to this probe.
if ! node "$DIR/../scripts/lib/node-floor-guard.js" </dev/null; then
  exit 0
fi

exec node "$DIR/worktree-git-guard.ts" "$@"
