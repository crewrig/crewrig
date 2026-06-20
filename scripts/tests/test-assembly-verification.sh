#!/usr/bin/env bash
# test-assembly-verification.sh — Assert that build-components.sh produces outputs
# for both core-layer and overlay components, each at its routed destination:
# core in the committed project tree, overlay tiers in the gitignored dist/<tier>/
# staging tree (ADR-0011, spec 0019). Covers every supported CLI directory.
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
#
# Build/install scope routing (ADR-0011, spec 0019): `core` components are
# written into the committed project tree ($cli_dir/skills/...), while every
# non-`core` tier — here the `community` fixture — is written into the
# gitignored staging tree dist/<tier>/$cli_dir/skills/.... The two assertion
# families below check each tier at its routed destination.
#
# Component identity is keyed on the frontmatter `name` field, which is what
# the build uses as the output directory/file name — NOT the source fixture
# directory name. The fixture dirs are test-overlay-skill / test-overlay-agent
# but their frontmatter `name` is the value asserted below.
FAILURES=()

# Known core component (developer skill exists in artifacts/core/skills/).
CORE_SKILL="developer"
# Fixture overlay components — values are the frontmatter `name` fields.
OVERLAY_SKILL="crewrig-assembly-test-skill"
OVERLAY_AGENT="crewrig-assembly-test-agent"
# Staging root for the non-core overlay tier (the fixture is built as `community`).
OVERLAY_STAGING="$TEMP_REPO/dist/community"

for cli_dir in ".claude" ".gemini" ".github"; do
  # Core stays in the committed project tree.
  core_skills_dir="$TEMP_REPO/$cli_dir/skills"
  # Overlay routes to the per-tier staging root.
  overlay_skills_dir="$OVERLAY_STAGING/$cli_dir/skills"
  overlay_agents_dir="$OVERLAY_STAGING/$cli_dir/agents"

  # Core skill check — project-tree path <cli>/skills/<name>/SKILL.md for all CLIs.
  if [ ! -f "$core_skills_dir/$CORE_SKILL/SKILL.md" ]; then
    FAILURES+=("MISSING core skill '$CORE_SKILL' in $cli_dir/skills/")
  fi

  # Overlay skill check — staging path dist/community/<cli>/skills/<name>/SKILL.md.
  if [ ! -f "$overlay_skills_dir/$OVERLAY_SKILL/SKILL.md" ]; then
    FAILURES+=("MISSING overlay skill '$OVERLAY_SKILL' in dist/community/$cli_dir/skills/")
  fi

  # Overlay agent check — Claude uses a directory; Gemini and Copilot use flat files.
  if [ "$cli_dir" = ".claude" ]; then
    if [ ! -f "$overlay_agents_dir/$OVERLAY_AGENT/AGENT.md" ]; then
      FAILURES+=("MISSING overlay agent '$OVERLAY_AGENT' in dist/community/$cli_dir/agents/")
    fi
  else
    if [ ! -f "$overlay_agents_dir/$OVERLAY_AGENT.md" ]; then
      FAILURES+=("MISSING overlay agent '$OVERLAY_AGENT' in dist/community/$cli_dir/agents/")
    fi
  fi
done

# Antigravity CLI assertions (spec 0053).
# Core tier skill: <repo>/.agents/skills/<name>/SKILL.md
# Core tier agent: <repo>/.agents/agents/<name>/AGENT.md
# Community tier overlay skill: dist/community/.agents/skills/<name>/SKILL.md
CORE_AGENT="developer"
if [ ! -f "$TEMP_REPO/.agents/skills/$CORE_SKILL/SKILL.md" ]; then
  FAILURES+=("MISSING core skill '$CORE_SKILL' in .agents/skills/ (Antigravity)")
fi
if [ ! -f "$TEMP_REPO/.agents/agents/$CORE_AGENT/AGENT.md" ]; then
  FAILURES+=("MISSING core agent '$CORE_AGENT' in .agents/agents/ (Antigravity)")
fi
if [ ! -f "$OVERLAY_STAGING/.agents/skills/$OVERLAY_SKILL/SKILL.md" ]; then
  FAILURES+=("MISSING overlay skill '$OVERLAY_SKILL' in dist/community/.agents/skills/ (Antigravity)")
fi

if [ "${#FAILURES[@]}" -gt 0 ]; then
  echo "FAILED: assembly verification — missing components:"
  for f in "${FAILURES[@]}"; do
    echo "  $f"
  done
  exit 1
fi

echo "OK: assembly verification passed."
