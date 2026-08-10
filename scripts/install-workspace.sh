#!/bin/bash
# install-workspace.sh — Install (or link) every artifacts component type for
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

set -e

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MODE="${1:-install}"

echo "Installing artifacts components (mode: $MODE)..."

FAILED=""
for TYPE in commands skills hooks agents policies mcp-servers themes; do
  # `if !` keeps errexit out of the loop: the status is collected, never fatal.
  if ! bash "$REPO_DIR/scripts/manage-workspace-component.sh" "$MODE" "$TYPE"; then
    FAILED="$FAILED $TYPE"
  fi
done

if [ -n "$FAILED" ]; then
  echo "" >&2
  echo "Artifacts installation finished with failures in:$FAILED" >&2
  echo "Every other type was processed; only the types named above did not" >&2
  echo "complete. Their own reports appear above." >&2
  exit 1
fi

echo "Artifacts installation complete."
