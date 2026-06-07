#!/bin/bash
set -e

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MODE="${1:-install}"

echo "Installing artifacts components (mode: $MODE)..."

for TYPE in commands skills hooks agents policies mcp-servers themes; do
  bash "$REPO_DIR/scripts/manage-workspace-component.sh" "$MODE" "$TYPE"
done

echo "Artifacts installation complete."
