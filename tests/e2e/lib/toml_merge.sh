#!/usr/bin/env bash
# tests/e2e/lib/toml_merge.sh — deep-merge a `local.toml` over a `defaults.toml`.
#
# Usage:
#   bash tests/e2e/lib/toml_merge.sh <defaults.toml> [<local.toml>]
#
# Output: merged document on stdout as JSON.
#
# Semantics (per ADR 0003 Decision 2):
#   - Tables merge recursively.
#   - Arrays APPEND  (yq `*+` operator).
#   - Scalars override.
#   - New tables are grafted in.
#
# If <local.toml> is omitted or missing, the defaults pass through verbatim.
#
# See docs/adr/0003-e2e-runner-toml.md for the empirical rationale behind the
# pipeline shape (Limitations A and B of yq v4.44.x).

set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
  printf 'usage: %s <defaults.toml> [<local.toml>]\n' "$0" >&2
  exit 2
fi

DEFAULTS="$1"
LOCAL="${2:-}"

if [[ ! -f "$DEFAULTS" ]]; then
  printf 'ERROR: defaults file not found: %s\n' "$DEFAULTS" >&2
  exit 1
fi

command -v yq >/dev/null 2>&1 \
  || { printf 'ERROR: yq is required on $PATH (mikefarah/yq >= v4.40).\n' >&2; exit 1; }

# tmp files cleaned on any exit path.
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

defaults_json="${TMP_DIR}/defaults.json"
yq -p=toml -o=json '.' "$DEFAULTS" > "$defaults_json"

if [[ -n "$LOCAL" && -f "$LOCAL" ]]; then
  local_json="${TMP_DIR}/local.json"
  yq -p=toml -o=json '.' "$LOCAL" > "$local_json"
  # Deep-merge with array-append: `*+`. `ireduce` folds the two documents.
  yq eval-all -p=json -o=json \
    '. as $item ireduce ({}; . *+ $item)' \
    "$defaults_json" "$local_json"
else
  cat "$defaults_json"
fi
