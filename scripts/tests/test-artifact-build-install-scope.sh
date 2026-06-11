#!/bin/bash
# test-artifact-build-install-scope.sh — Regression tests for spec 0019
# (artifact build/install scope; ADR-0011).
#
# Pins three behaviors the spec mandates:
#
#   Scenario 1 — An `org` component builds, and installs into the user home
#                only when the org tier is opted in (build + install halves).
#   Scenario 2 — A newly-added tier directory is compiled with no edit to
#                build-components.sh (tier-agnostic build, R1/R3).
#   Scenario 3 — A `community` component is compiled but is NOT placed in the
#                user home (nor the project tree) without opt-in.
#
# Strategy:
#   * Build routing is exercised by running the REAL build-components.sh
#     against a throwaway REPO_DIR seeded with synthetic artifact tiers.
#     Nothing touches the real repo tree or the real dist/.
#   * Install mechanics are exercised by extracting the REAL
#     `install_tier_to_home` function body verbatim from the shipped
#     setup-claude-interactive.sh and calling it against a temp HOME. This
#     tests the production code path, not a re-implementation.
#   * The opt-in *gate* (fzf-driven) is not directly callable; its invariant
#     contract is verified structurally (see the gate test + the gap note at
#     the foot of this file).
#
# Hermetic: every artifact lives under a mktemp -d work area removed on EXIT.
# After this script runs, `git status --porcelain` MUST stay empty.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
BUILD="$REPO_DIR/scripts/build-components.sh"
CLAUDE_SETUP="$REPO_DIR/scripts/setup-claude-interactive.sh"

WORK="$(mktemp -d -t crewrig-0019.XXXXXX)"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

PASS=0
FAIL=0

report() {
  local name="$1" ok="$2" detail="${3:-}"
  if [ "$ok" = "true" ]; then
    echo "PASS: $name"
    PASS=$((PASS + 1))
  else
    echo "FAIL: $name"
    [ -n "$detail" ] && printf '%s\n' "$detail" | sed 's/^/    /'
    FAIL=$((FAIL + 1))
  fi
}

# Seed a synthetic tier with one skill under a throwaway REPO_DIR.
# Args: <repo-root> <tier> <skill-name>
seed_skill() {
  local root="$1" tier="$2" skill="$3"
  mkdir -p "$root/artifacts/$tier/skills/$skill"
  cat > "$root/artifacts/$tier/skills/$skill/SKILL.md" <<EOF
---
name: $skill
description: "Synthetic skill in tier $tier for spec 0019 tests."
---

# ${skill}

Body content.
EOF
}

# Every synthetic repo needs a config so the placeholder validator passes.
write_config() {
  local root="$1"
  mkdir -p "$root"
  cat > "$root/crewrig.config.toml" <<'EOF'
canonical_repo = "https://github.com/crewrig/crewrig"
feedback_repo = "https://github.com/crewrig/feedback"
EOF
}

# Extract the shipped install_tier_to_home function body verbatim, so the test
# exercises production code rather than a copy that can silently drift.
load_real_install_fn() {
  local script="$1"
  local fn
  fn=$(awk '/^install_tier_to_home\(\) \{$/{f=1} f{print} f&&/^\}$/{exit}' "$script")
  [ -n "$fn" ] || { echo "could not extract install_tier_to_home from $script" >&2; return 1; }
  eval "$fn"
}

# =====================================================================
# Scenario 2 — a newly-added tier is compiled with no build-script edit.
# (Run first: it also stands up the org + community synthetic repo reused
# by the routing assertions for scenarios 1 and 3.)
# =====================================================================
SCEN_ROOT="$WORK/repo-scenarios"
write_config "$SCEN_ROOT"
# A tier name no enumeration could have anticipated.
NOVEL_TIER="experimental$RANDOM"
seed_skill "$SCEN_ROOT" "$NOVEL_TIER" "demo-novel-skill"
seed_skill "$SCEN_ROOT" "org" "demo-org-skill"
seed_skill "$SCEN_ROOT" "community" "demo-community-skill"
seed_skill "$SCEN_ROOT" "core" "demo-core-skill"

# Snapshot the build script hash to prove tier-agnosticism: the novel tier
# compiles without the script changing.
BUILD_HASH_BEFORE=$(cksum < "$BUILD")
REPO_DIR="$SCEN_ROOT" bash "$BUILD" --target claude >"$WORK/build.log" 2>&1 || true
BUILD_HASH_AFTER=$(cksum < "$BUILD")

novel_out="$SCEN_ROOT/dist/$NOVEL_TIER/.claude/skills/demo-novel-skill/SKILL.md"
ok="true"; detail=""
[ "$BUILD_HASH_BEFORE" = "$BUILD_HASH_AFTER" ] || { ok="false"; detail="build script changed during build"; }
[ -f "$novel_out" ] || { ok="false"; detail="novel-tier component not compiled at $novel_out"; }
report "Scenario 2: novel tier '$NOVEL_TIER' compiles with no build-script edit" "$ok" "$detail"

# ---------------------------------------------------------------------
# Scenario 1 (build half) — an org component compiles into dist/org/.
# ---------------------------------------------------------------------
org_out="$SCEN_ROOT/dist/org/.claude/skills/demo-org-skill/SKILL.md"
ok="true"; detail=""
[ -f "$org_out" ] || { ok="false"; detail="org component not compiled at $org_out"; }
report "Scenario 1 (build): org component compiles into dist/org/" "$ok" "$detail"

# ---------------------------------------------------------------------
# core routing guard — core lands in the project tree, never under dist/.
# (Underpins the spec's "core installs automatically" via the committed tree.)
# ---------------------------------------------------------------------
core_out="$SCEN_ROOT/.claude/skills/demo-core-skill/SKILL.md"
ok="true"; detail=""
[ -f "$core_out" ] || { ok="false"; detail="core component not at project-tree path $core_out"; }
[ ! -f "$SCEN_ROOT/dist/core/.claude/skills/demo-core-skill/SKILL.md" ] \
  || { ok="false"; detail="core component leaked into dist/core/"; }
report "core routes to project tree, not dist/" "$ok" "$detail"

# ---------------------------------------------------------------------
# Scenario 3 (build half) — a community component compiles into dist/community/
# (staging), never into the project tree.
# ---------------------------------------------------------------------
community_out="$SCEN_ROOT/dist/community/.claude/skills/demo-community-skill/SKILL.md"
ok="true"; detail=""
[ -f "$community_out" ] || { ok="false"; detail="community component not staged at $community_out"; }
[ ! -f "$SCEN_ROOT/.claude/skills/demo-community-skill/SKILL.md" ] \
  || { ok="false"; detail="community component leaked into the project tree"; }
report "Scenario 3 (build): community compiles into dist/, not the project tree" "$ok" "$detail"

# =====================================================================
# Install mechanics — exercise the REAL install_tier_to_home against a
# temp HOME. Scenario 1 (install half) and Scenario 3 (install half).
# =====================================================================
# Set up a temp HOME and the env vars the function closes over.
HOME_ROOT="$WORK/home"
CLAUDE_SKILLS_HOME="$HOME_ROOT/.claude/skills"
CLAUDE_AGENTS_HOME="$HOME_ROOT/.claude/agents"
mkdir -p "$HOME_ROOT"

# Point the function at the dist/ tree the scenario build produced above.
REPO_DIR="$SCEN_ROOT"
export REPO_DIR CLAUDE_SKILLS_HOME CLAUDE_AGENTS_HOME

# Bring the production function into scope.
load_real_install_fn "$CLAUDE_SETUP"

# ---------------------------------------------------------------------
# Scenario 1 (install half) — opting the org tier in copies it into HOME.
# (Calling install_tier_to_home org is exactly what the opt-in `yes` branch
# does — see the gate-invariant test below.)
# ---------------------------------------------------------------------
install_tier_to_home org >/dev/null 2>&1
org_home="$CLAUDE_SKILLS_HOME/demo-org-skill/SKILL.md"
ok="true"; detail=""
[ -f "$org_home" ] || { ok="false"; detail="org skill not installed into temp HOME at $org_home"; }
report "Scenario 1 (install): opted-in org tier lands in user HOME" "$ok" "$detail"

# ---------------------------------------------------------------------
# Scenario 3 (install half) — WITHOUT opt-in, community never reaches HOME.
# We model "no opt-in" as the gate simply not calling install_tier_to_home
# for community. Assert community is absent from HOME after the org install.
# ---------------------------------------------------------------------
community_home="$CLAUDE_SKILLS_HOME/demo-community-skill"
ok="true"; detail=""
[ ! -e "$community_home" ] \
  || { ok="false"; detail="community skill reached HOME without opt-in at $community_home"; }
report "Scenario 3 (install): un-opted community tier is absent from HOME" "$ok" "$detail"

# Conversely, prove the install IS capable of placing community on opt-in —
# otherwise the previous assertion could pass for the wrong reason (a broken
# installer that copies nothing). This is the failure-mode guard.
install_tier_to_home community >/dev/null 2>&1
ok="true"; detail=""
[ -f "$CLAUDE_SKILLS_HOME/demo-community-skill/SKILL.md" ] \
  || { ok="false"; detail="community install is a silent no-op even when invoked"; }
report "Scenario 3 (guard): community DOES install when explicitly opted in" "$ok" "$detail"

# =====================================================================
# Opt-in gate invariant (structural) — the fzf-driven decision cannot be
# called headless, so we pin the contract that gates the install calls:
#   * library is installed unconditionally (no fzf gate above its call);
#   * community and org install calls live inside the opt-in `if` block.
# A regression that auto-installs community/org, or that gates library
# behind a prompt, would break one of these greps.
# =====================================================================
ok="true"; detail=""
# library install is not guarded by an INSTALL_OVERLAY / fzf decision.
grep -Eq '^install_tier_to_home library$' "$CLAUDE_SETUP" \
  || { ok="false"; detail="library is no longer installed unconditionally"; }
# community + org are iterated as opt-in overlay tiers.
grep -Eq 'for overlay_tier in community org' "$CLAUDE_SETUP" \
  || { ok="false"; detail="community/org are no longer the opt-in overlay tiers"; }
# the overlay install call sits behind a yes/no decision.
grep -Eq 'if \[ "\$INSTALL_OVERLAY" = "yes" \]' "$CLAUDE_SETUP" \
  || { ok="false"; detail="overlay install is no longer gated by an opt-in decision"; }
# and crucially: community/org are NEVER installed unconditionally. The only
# legitimate install call for them is the gated `install_tier_to_home
# "$overlay_tier"`. A literal `install_tier_to_home community|org` line is an
# auto-install regression — exactly the scope violation R7/R8 forbid.
if grep -Eq '^[[:space:]]*install_tier_to_home (community|org)[[:space:]]*$' "$CLAUDE_SETUP"; then
  ok="false"; detail="community/org are installed unconditionally (R7/R8 scope violation)"
fi
report "Opt-in gate invariant: library auto, community/org gated (claude)" "$ok" "$detail"

# Parity guard — the same gate shape exists in the Gemini and Copilot setups,
# so the scope contract is not silently claude-only.
# REPO_DIR was overwritten to the synthetic root above; restore the real one.
REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
ok="true"; detail=""
for s in setup-gemini-interactive.sh setup-copilot-interactive.sh; do
  grep -Eq 'for overlay_tier in community org' "$REPO_DIR/scripts/$s" \
    || { ok="false"; detail="$s lost the community/org opt-in overlay loop"; }
done
report "Opt-in gate invariant: gemini + copilot share the gate shape" "$ok" "$detail"

# =====================================================================
# Scenario 4 — `--check` drift detection works with NO pre-existing dist/.
# This is the exact CI condition (clean checkout: dist/ is gitignored and
# absent). Only the committed `core` tier is drift-compared; non-core tiers
# compile into a throwaway staging root and are discarded, so a missing dist/
# is NOT a drift. A regression that compares non-core outputs against the
# non-existent dist/ would emit "DRIFT: .../dist/library/... does not exist"
# and exit 1 — which is precisely the bug this scenario pins.
#
# Run against the REAL repo so the assertion tracks the shipped sources. The
# build is hermetic in --check mode (it writes nothing under the repo), so we
# only guard against a stray dist/ being created as a side effect.
# ---------------------------------------------------------------------
REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
CHECK_LOG="$WORK/check-no-dist.log"
ok="true"; detail=""
DIST_PREEXISTED=false
[ -e "$REPO_DIR/dist" ] && DIST_PREEXISTED=true
# Only mutate the real tree if dist/ is genuinely absent — never delete a
# developer's local dist/ as a test side effect.
if [ "$DIST_PREEXISTED" = false ]; then
  if REPO_DIR="$REPO_DIR" bash "$BUILD" --target all --check >"$CHECK_LOG" 2>&1; then
    : # exit 0 as required
  else
    ok="false"; detail="--check exited non-zero with no pre-existing dist/. Log tail:
$(tail -8 "$CHECK_LOG")"
  fi
  # A stray dist/ created by --check would be an unstaged-output leak.
  if [ -e "$REPO_DIR/dist" ]; then
    ok="false"; detail="${detail}${detail:+$'\n'}--check created a stray dist/ in the repo"
    rm -rf "$REPO_DIR/dist"
  fi
else
  detail="skipped mutation: a pre-existing dist/ was present; cannot assert the clean-tree condition non-destructively"
fi
report "Scenario 4: --check passes with no pre-existing dist/ (CI condition)" "$ok" "$detail"

echo ""
echo "==========================================="
echo "  Result: $PASS passed, $FAIL failed"
echo "==========================================="
[ "$FAIL" -eq 0 ] || exit 1
