#!/bin/bash
# sync-from-upstream.sh — Pull core-layer files from the canonical upstream.
#
# Usage:
#   bash scripts/sync-from-upstream.sh
#
# Reads the upstream URL from crewrig.config.toml (canonical_repo field).
# Refuses to proceed if any core-layer path has local modifications relative
# to FETCH_HEAD — the adopting organisation must revert or promote those
# changes to overlay overrides before syncing.
#
# On success, restores each core-layer path from FETCH_HEAD into the working
# tree without staging or committing anything. Review the diff with
# 'git diff' before deciding what to commit.

set -e

# CREWRIG_REPO_DIR may be set by tests to override the default discovery.
REPO_DIR="${CREWRIG_REPO_DIR:-"$(cd "$(dirname "$0")/.." && pwd)"}"
CONFIG="$REPO_DIR/crewrig.config.toml"
MANIFEST="$REPO_DIR/.crewrig/core-paths.txt"

# ---------------------------------------------------------------------------
# Read canonical_repo — strip surrounding quotes, reject empty/absent value.
# ---------------------------------------------------------------------------
CANONICAL_REPO=$(grep '^canonical_repo' "$CONFIG" 2>/dev/null | sed 's/.*= *"\(.*\)".*/\1/')

if [ -z "$CANONICAL_REPO" ]; then
  echo "Error: canonical_repo is not set in crewrig.config.toml" >&2
  echo "Set canonical_repo to the upstream repository URL before running sync." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Fetch upstream.
# ---------------------------------------------------------------------------
echo "Fetching $CANONICAL_REPO ..."
git fetch "$CANONICAL_REPO"

# ---------------------------------------------------------------------------
# Dirty-core detection: compare each core path against FETCH_HEAD.
# ---------------------------------------------------------------------------
DIRTY=()
while IFS= read -r path; do
  # Skip blank lines and comments.
  [[ -z "$path" || "$path" == \#* ]] && continue
  if ! git diff --quiet FETCH_HEAD -- "$path" 2>/dev/null; then
    DIRTY+=("$path")
  fi
done < "$MANIFEST"

if [ ${#DIRTY[@]} -gt 0 ]; then
  echo "Error: the following core-layer paths have local modifications:" >&2
  for p in "${DIRTY[@]}"; do
    echo "  $p" >&2
  done
  echo "Revert these changes before running sync, or promote them to overlay overrides." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Apply: restore each core path from FETCH_HEAD into the working tree.
# git restore --source=FETCH_HEAD --worktree does NOT stage or commit.
# ---------------------------------------------------------------------------
while IFS= read -r path; do
  [[ -z "$path" || "$path" == \#* ]] && continue
  git restore --source=FETCH_HEAD --worktree -- "$path"
done < "$MANIFEST"

echo "Sync complete. Review the changes with 'git diff' before committing."
