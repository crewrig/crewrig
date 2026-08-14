#!/bin/bash
# check-figure-labels.sh — Verify figure PNG labels against sidecar prompt expectations using OCR (spec 0156 / issue #881).

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

if ! command -v tesseract >/dev/null 2>&1; then
  echo "[SKIP] tesseract is not installed. Skipping figure label OCR check."
  exit 0
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "[SKIP] python3 is not installed. Skipping figure label OCR check."
  exit 0
fi

python3 "$SCRIPT_DIR/lib/check-figure-labels.py" "$@"
