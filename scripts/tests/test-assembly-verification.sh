#!/usr/bin/env bash
# test-assembly-verification.sh — Assert that build-components.sh produces outputs
# for both core-layer and overlay components in every supported CLI directory.
set -euo pipefail

ACTUAL_REPO="$(cd "$(dirname "$0")/../.." && pwd)"
TEMP_REPO="$(mktemp -d)"

cleanup() { rm -rf "$TEMP_REPO"; }
trap cleanup EXIT

# Mirror repo structure into temp dir.
mkdir -p "$TEMP_REPO/artifacts"
ln -s "$ACTUAL_REPO/artifacts/core"    "$TEMP_REPO/artifacts/core"
ln -s "$ACTUAL_REPO/artifacts/library" "$TEMP_REPO/artifacts/library"
ln -s "$ACTUAL_REPO/crewrig.config.toml" "$TEMP_REPO/crewrig.config.toml"

# Copy fixture overlay as community zone.
cp -r "$ACTUAL_REPO/tests/fixtures/overlay/artifacts/community" \
      "$TEMP_REPO/artifacts/community"

# Run the build — must omit --check (calling --check from inside the check
# block would cause infinite recursion).
REPO_DIR="$TEMP_REPO" bash "$ACTUAL_REPO/scripts/build-components.sh"

# Assert outputs.
FAILURES=()

# Known core component (developer skill exists in artifacts/core/skills/).
CORE_SKILL="developer"
# Fixture overlay components.
OVERLAY_SKILL="crewrig-assembly-test-skill"
OVERLAY_AGENT="crewrig-assembly-test-agent"

for cli_dir in ".claude" ".gemini" ".github"; do
  skills_dir="$TEMP_REPO/$cli_dir/skills"
  agents_dir="$TEMP_REPO/$cli_dir/agents"

  # Core skill check — output path is <cli>/skills/<name>/SKILL.md for all CLIs.
  if [ ! -f "$skills_dir/$CORE_SKILL/SKILL.md" ]; then
    FAILURES+=("MISSING core skill '$CORE_SKILL' in $cli_dir/skills/")
  fi

  # Overlay skill check — same flat structure for all CLIs.
  if [ ! -f "$skills_dir/$OVERLAY_SKILL/SKILL.md" ]; then
    FAILURES+=("MISSING overlay skill '$OVERLAY_SKILL' in $cli_dir/skills/")
  fi

  # Overlay agent check — Claude uses a directory; Gemini and Copilot use flat files.
  if [ "$cli_dir" = ".claude" ]; then
    if [ ! -f "$agents_dir/$OVERLAY_AGENT/AGENT.md" ]; then
      FAILURES+=("MISSING overlay agent '$OVERLAY_AGENT' in $cli_dir/agents/")
    fi
  else
    if [ ! -f "$agents_dir/$OVERLAY_AGENT.md" ]; then
      FAILURES+=("MISSING overlay agent '$OVERLAY_AGENT' in $cli_dir/agents/")
    fi
  fi
done

if [ "${#FAILURES[@]}" -gt 0 ]; then
  echo "FAILED: assembly verification — missing components:"
  for f in "${FAILURES[@]}"; do
    echo "  $f"
  done
  exit 1
fi

echo "OK: assembly verification passed."
