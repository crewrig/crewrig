#!/usr/bin/env bash
# ci-cache-guard.sh — Portable script-level cache guard (spec 0147 R6/R7).
#
# Wraps a single hermetic CI command so that a cache hit skips re-execution
# (R6) and a changed input re-executes (R7). The cache key is content-addressed
# from the DECLARED impacted files (their sha256) plus the values of the
# declared env vars, so any change to an input yields a different key and the
# command runs again.
#
# The guard is engine-agnostic: it is invoked identically from the GitLab
# pipeline (emitted by scripts/build-ci.sh) and the GitHub Actions workflow
# (hand-authored in .github/workflows/build.yml). It is the real correctness
# gate — even if the engine's own cache restores a stale .ci-cache/ directory,
# the guard recomputes the key, finds no marker, and re-executes.
#
# Usage:
#   bash scripts/ci-cache-guard.sh \
#     --cache-dir <dir> \
#     --key-files <f1,f2,...> \
#     --key-env <V1,V2,...> \
#     -- <command...>
#
# On a cache hit the guard exits 0 WITHOUT running <command>. On a miss it runs
# <command> and, only if it succeeds, writes the marker so a later run hits.
#
# Prerequisites: sha256sum (Linux) or shasum -a 256 (macOS).

set -euo pipefail

CACHE_DIR=".ci-cache"
KEY_FILES=""
KEY_ENV=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --cache-dir) CACHE_DIR="$2"; shift 2 ;;
    --key-files) KEY_FILES="$2"; shift 2 ;;
    --key-env)   KEY_ENV="$2";   shift 2 ;;
    --) shift; break ;;
    *) echo "Error: unknown option '$1'" >&2; exit 2 ;;
  esac
done

if [ $# -eq 0 ]; then
  echo "Error: no command given after '--'" >&2
  exit 2
fi

# --- sha256 helper (portable across Linux/macOS) ----------------------------

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$@"
  else
    shasum -a 256 "$@"
  fi
}

# --- Key derivation ---------------------------------------------------------
# The key is the sha256 of the concatenated hashes of every declared file
# (globs expanded) plus the values of every declared env var. This is the
# content-addressed form of the reference's `cache:` need declaration.

key_input=""
if [ -n "$KEY_FILES" ]; then
  # Enable globstar so `artifacts/**` expands recursively; nullglob so a
  # pattern matching nothing contributes nothing rather than the literal text.
  shopt -s globstar nullglob
  IFS=',' read -r -a files <<< "$KEY_FILES"
  for f in "${files[@]}"; do
    [ -z "$f" ] && continue
    for expanded in $f; do
      [ -f "$expanded" ] || continue
      key_input="${key_input}$(sha256 "$expanded" | awk '{print $1}')"
    done
  done
fi
if [ -n "$KEY_ENV" ]; then
  IFS=',' read -r -a envs <<< "$KEY_ENV"
  for e in "${envs[@]}"; do
    [ -z "$e" ] && continue
    key_input="${key_input}${e}=${!e:-}"
  done
fi

# The command itself is part of the key so two different commands sharing a
# cache dir never collide on the same marker.
key_input="${key_input}${*}"
key="$(printf '%s' "$key_input" | sha256 | awk '{print $1}')"

cmd_hash="$(printf '%s' "$*" | sha256 | awk '{print $1}')"
marker="$CACHE_DIR/$key/$cmd_hash.marker"

# --- Cache hit? -------------------------------------------------------------
if [ -f "$marker" ]; then
  echo "ci-cache-guard: cache hit for: $*"
  exit 0
fi

# --- Cache miss: run the command, then write the marker ---------------------
echo "ci-cache-guard: cache miss, running: $*"
"$@"
mkdir -p "$(dirname "$marker")"
: > "$marker"
echo "ci-cache-guard: wrote marker $marker"
