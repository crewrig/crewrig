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
#   * Install mechanics are exercised by RUNNING the real TypeScript setup
#     entries (spec 0256 requirement 9, PR D2) in a sandboxed HOME with the
#     overlay tiers answered yes and no, and asserting which component
#     directories land (scripts/tests/setup-retarget-entry-behaviour.test.ts).
#     This used to extract the `install_tier_to_home` body from the shell text
#     and eval it.
#   * The opt-in *gate* (fzf-driven) is not directly callable; its invariant
#     contract is read from the TypeScript setup declaration (see the gate
#     test + the gap note at the foot of this file).
#
# Hermetic: every artifact lives under a mktemp -d work area removed on EXIT.
# After this script runs, `git status --porcelain` MUST stay empty.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
BUILD="$REPO_DIR/scripts/build-components.sh"
# The setup DECLARATION printer (resolved now: REPO_DIR is repointed to a synthetic root below).
PRINT_DECL="$REPO_DIR/scripts/tests/lib/print-setup-declarations.ts"
TS_TEST="$REPO_DIR/scripts/tests/setup-retarget-entry-behaviour.test.ts"

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

# Seed a synthetic tier with one agent under a throwaway REPO_DIR.
# Args: <repo-root> <tier> <agent-name>
seed_agent() {
  local root="$1" tier="$2" agent="$3"
  mkdir -p "$root/artifacts/$tier/agents/$agent"
  cat > "$root/artifacts/$tier/agents/$agent/AGENT.md" <<EOF
---
name: $agent
description: "Synthetic agent in tier $tier for spec 0201 tests."
---

# ${agent}

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

# run_ts_group <group name> — run one describe group of the TypeScript behaviour test and report each
# subtest by name (a group that ran no case fails: vacuity guard). The sandbox stubs of the setup
# entries target Linux (pipx layout, systemd), so elsewhere the group is skipped here and runs in CI
# and in the Linux container.
run_ts_group() {
  unset NODE_TEST_CONTEXT # a nested node --test must not see the parent runner's context
  local group="$1" log="$WORK/ts-group.log" line name n=0
  if [ "$(uname -s)" != "Linux" ] || ! command -v jq >/dev/null 2>&1; then
    echo "SKIP: '$group' needs the Linux setup sandbox and jq (runs in CI)"
    return 0
  fi
  node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --test-name-pattern="$group" "$TS_TEST" >"$log" 2>&1 || true
  while IFS= read -r line; do
    case "$line" in
      "  ✔ "*) name="${line#  ✔ }"; report "${name% (*ms)}" true; n=$((n + 1)) ;;
      "  ✖ "*) name="${line#  ✖ }"; report "${name% (*ms)}" false "see: node --test --test-name-pattern='$group' $TS_TEST"; n=$((n + 1)) ;;
    esac
  done < "$log"
  [ "$n" -gt 0 ] || report "'$group' ran no case (vacuity guard)" false "$(tail -3 "$log")"
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
# spec 0201 (R10-R13) — a synthetic org agent, so the install half below
# exercises the flat-file agent layout and the stale-directory cleanup.
seed_agent "$SCEN_ROOT" "org" "demo-org-agent"

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
# Install mechanics (Scenario 1 install half, Scenario 3 install half, spec 0201 R10-R12) — the REAL
# TypeScript entry of each CLI, run with the overlay tiers answered yes and no (the `tiers` step:
# the library tier is unconditional, each overlay tier is gated by its own question). Scenario 1:
# opted-in org (and community) land in the home, the org agent as a flat file (R10), a stale
# same-name agent directory is removed (R11), unrelated entries stay (R12). Scenario 3: with the
# answer no neither overlay tier reaches the home, and the yes run proves the installer places
# them (the failure-mode guard against a no-op installer).
# Pin against the unchanged shell while it exists: the setup-golden cells <cli>/overlay-yes and
# <cli>/overlay-no, which run the real shell setup and the TypeScript entry against the same fixtures.
# =====================================================================
run_ts_group "overlay tiers"
run_ts_group "claude install mechanics"

# =====================================================================
# Opt-in gate invariant (declaration) — the fzf-driven decision cannot be
# called headless, so we pin the contract that gates the install calls, read
# from the TypeScript setup DECLARATION (spec 0256 requirement 9, PR D1;
# scripts/tests/lib/print-setup-declarations.ts), no longer from the shell text:
#   * library is the ONLY automatic tier (`tiers.automatic=library`);
#   * community and org are the opt-in overlay tiers (`tiers.overlay`), each
#     behind a yes/no prompt (`tiers.overlay-prompts` names them, and the
#     `prompt.overlay.<tier>.options` fact is the no,yes choice).
# A regression that auto-installs community/org, or that gates library behind a
# prompt, changes one of these facts. Pin against the unchanged shell while it
# exists: the setup-golden cells <cli>/overlay-yes and <cli>/overlay-no (the
# real script run with the opt-in accepted and declined: org/community land in
# the home only in -yes). Vacuity guard: an empty declaration, or an absent
# fact, fails the case.
# =====================================================================
read_decl() { node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON "$PRINT_DECL" "$1" 2>/dev/null; }
decl_fact() { printf '%s\n' "$1" | grep "^$2=" | head -1 | cut -d= -f2-; }

# gate_shape_detail <declaration> — empty when the gate shape holds, else why not.
gate_shape_detail() {
  local decl="$1" automatic overlay prompts tier
  [ -n "$decl" ] || { echo "the setup declaration printed nothing (vacuity guard)"; return; }
  automatic="$(decl_fact "$decl" tiers.automatic)"
  overlay="$(decl_fact "$decl" tiers.overlay)"
  prompts="$(decl_fact "$decl" tiers.overlay-prompts)"
  [ -n "$automatic" ] && [ -n "$overlay" ] && [ -n "$prompts" ] \
    || { echo "a tier fact is absent (automatic='$automatic' overlay='$overlay' prompts='$prompts')"; return; }
  [ "$automatic" = "library" ] \
    || { echo "the automatic tiers are '$automatic', not library alone (R7/R8 scope violation if community/org)"; return; }
  [ "$overlay" = "community,org" ] \
    || { echo "community/org are no longer the opt-in overlay tiers (got '$overlay')"; return; }
  for tier in community org; do
    case ",$prompts," in *",overlay.$tier,"*) ;; *) echo "overlay $tier is no longer gated by an opt-in prompt"; return ;; esac
    [ "$(decl_fact "$decl" "prompt.overlay.$tier.options")" = "no,yes" ] \
      || { echo "overlay $tier prompt is not a no,yes decision"; return; }
  done
}

ok="true"; detail="$(gate_shape_detail "$(read_decl claude)")"
[ -z "$detail" ] || ok="false"
report "Opt-in gate invariant: library auto, community/org gated (claude)" "$ok" "$detail"

# Parity guard — the same gate shape is declared by the Gemini and Copilot setups,
# so the scope contract is not silently claude-only.
ok="true"; detail=""
for cli in gemini copilot; do
  d="$(gate_shape_detail "$(read_decl "$cli")")"
  [ -z "$d" ] || { ok="false"; detail="${detail}${detail:+$'\n'}$cli: $d"; }
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
