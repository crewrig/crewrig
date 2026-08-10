#!/bin/bash
# test-component-tier-resolution.sh — Regression tests for spec 0119
# (overlay-tier component resolution on the per-component install surface).
#
# Spec 0119 requirement 20 obliges automated checks that FAIL when a served tier
# becomes unreachable on either request shape, when a landing zone or resolution
# basis diverges from the assisted setup of the same CLI, when two components
# sharing an installed name in one landing zone are accepted by the build, or
# when an install command resolves such a pair without reporting it. Each case
# below names the requirement(s) it guards.
#
# ── Standing instruction this file was written under ─────────────────────────
# Every case here was authored BEFORE the fix and observed to fail against the
# unfixed code. A case that has only ever been seen to pass is evidence of
# nothing. The two cases that cannot be made to fail against the unfixed code
# are labelled GUARD and say why in place — they are over-refusal bounds, not
# regression cases, and their vacuity is stated rather than hidden.
#
# ── Strategy ────────────────────────────────────────────────────────────────
#   * Hermetic. Every case builds a throwaway repository under a `mktemp -d`
#     work area removed on EXIT, and points the command under test at a
#     throwaway HOME. Nothing touches the real repo tree, the real dist/, or
#     the developer's user home. The final case asserts the real repository's
#     `git status --porcelain` is byte-identical before and after the run.
#   * Real code paths. The throwaway repository carries a copy of the shipped
#     `scripts/` tree, so `REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"` — the
#     form all four manage scripts use, none of which honours a REPO_DIR
#     override — resolves to the throwaway root. The production scripts are
#     executed, never re-implemented.
#   * The relational requirement (R20's "same landing zone / same basis as the
#     assisted setup") is checked STRUCTURALLY, by parsing both scripts, never
#     by comparing the two routes' installed file sets: `install_tier_skills_to_home`
#     (setup-copilot-interactive.sh) copies only SKILL.md while `place_component`
#     (manage-copilot-component.sh) copies the whole directory, so a results
#     comparison would report a difference that is not the one under test.
#     A parse that matches nothing FAILS the case, on the precedent at
#     scripts/check-bash32-portability.sh ("refusing to pass vacuously").
#
# ── Traps this file is built around, each one measured ───────────────────────
#   1. `git diff-index --quiet HEAD` reports dirty from stat churn alone
#      immediately after a build, and goes clean after one `git status`, while
#      `git status --porcelain` is empty throughout. The R3 clean-checkout case
#      asserts `git status --porcelain` and never reaches for `diff-index`: a
#      case using it would fail for a reason unrelated to what it guards.
#   2. An empty-line append to a component source is normalised away by the
#      build. Every seeded fixture below carries real body content, so a case
#      cannot pass because its input never exercised the mechanism.
#   3. A throwaway REPO_DIR has no dist/ at all, so every tier is fresh by
#      construction and a naive fixture CANNOT fail on the staleness defect.
#      The stale-dist case therefore pre-seeds a stale tree: it builds first,
#      then adds a component without rebuilding.
#   4. Bash 3.2.57 is the enforced floor (ci/bash32-forbidden.txt). No
#      `declare -A`, no `mapfile`. This file runs under /bin/bash 3.2 and 5.x.
#
# Deliberately NOT `set -e`: most cases run a command that is expected to fail,
# and a harness that aborts mid-run destroys the per-case evidence this file
# exists to produce. Every invocation goes through run()/run_stdin(), which
# capture status, stdout and stderr separately.

set -uo pipefail

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(mktemp -d -t crewrig-0119.XXXXXX)"
LOGS="$WORK/logs"
mkdir -p "$LOGS"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

PASS=0
FAIL=0
FAILED_NAMES=""

report() {
  local name="$1" ok="$2" detail="${3:-}"
  if [ "$ok" = "true" ]; then
    echo "PASS: $name"
    PASS=$((PASS + 1))
  else
    echo "FAIL: $name"
    [ -n "$detail" ] && printf '%s\n' "$detail" | sed 's/^/    /'
    FAIL=$((FAIL + 1))
    FAILED_NAMES="$FAILED_NAMES  - $name"$'\n'
  fi
}

# --- Invocation capture ------------------------------------------------------
# run <tag> <cmd...>  → RUN_STATUS, RUN_OUT (stdout path), RUN_ERR (stderr path)
RUN_STATUS=0
RUN_OUT=""
RUN_ERR=""
run() {
  local tag="$1"
  shift
  RUN_OUT="$LOGS/$tag.out"
  RUN_ERR="$LOGS/$tag.err"
  "$@" >"$RUN_OUT" 2>"$RUN_ERR"
  RUN_STATUS=$?
}

# run_stdin <tag> <stdin-text> <cmd...> — for the three link-mode commands that
# prompt. Stdin handling is per script, not uniform: manage-workspace-component.sh
# has no prompt at all.
run_stdin() {
  local tag="$1" feed="$2"
  shift 2
  RUN_OUT="$LOGS/$tag.out"
  RUN_ERR="$LOGS/$tag.err"
  printf '%s' "$feed" | "$@" >"$RUN_OUT" 2>"$RUN_ERR"
  RUN_STATUS=$?
}

both() { cat "$RUN_OUT" "$RUN_ERR" 2>/dev/null; }

# Compact, self-documenting evidence for a failure detail.
evidence() {
  printf 'observed exit=%s\n  stdout: %s\n  stderr: %s' \
    "$RUN_STATUS" \
    "$(head -4 "$RUN_OUT" 2>/dev/null | tr '\n' '~' | sed 's/~/ | /g')" \
    "$(head -4 "$RUN_ERR" 2>/dev/null | tr '\n' '~' | sed 's/~/ | /g')"
}

# --- Throwaway repository ----------------------------------------------------
# Copies the shipped scripts/*.sh plus scripts/lib/ — everything the build and
# the four manage commands source. scripts/tests/ and scripts/e2e/ are excluded
# (1 MB of fixtures nothing under test reads); the only shipped caller of
# scripts/tests/ is `build-components.sh --check`, which no case here invokes.
# `/bin/cp -f`, never bare `cp`: an interactive alias silently no-ops on
# overwrite and still exits 0.
new_repo() {
  # Separate statements deliberately: Bash 3.2 does not make an earlier name
  # visible to a later initialiser in the SAME `local`, so
  # `local name="$1" root="$WORK/$name"` aborts with `name: unbound variable`.
  local name="$1"
  local root="$WORK/$name"
  local f
  mkdir -p "$root/scripts" "$root/artifacts" "$root/cli-home"
  /bin/cp -R "$REPO_DIR/scripts/lib" "$root/scripts/lib"
  for f in "$REPO_DIR"/scripts/*.sh; do
    /bin/cp -f "$f" "$root/scripts/"
  done
  /bin/cp -f "$REPO_DIR/Taskfile.yml" "$root/Taskfile.yml"
  [ -f "$REPO_DIR/crewrig.config.toml" ] && /bin/cp -f "$REPO_DIR/crewrig.config.toml" "$root/"
  # dist/ is gitignored upstream (.gitignore:16); the R3 case depends on that
  # being true of the fixture too, because the fix rebuilds overlay tiers there.
  printf 'dist/\ncli-home*/\n' > "$root/.gitignore"
  printf '%s' "$root"
}

# --- Component seeding -------------------------------------------------------
# Every seed carries real body content (trap 2).
seed_skill() {
  local root="$1" tier="$2" name="$3"
  mkdir -p "$root/artifacts/$tier/skills/$name"
  cat > "$root/artifacts/$tier/skills/$name/SKILL.md" <<EOF
---
name: $name
description: "Synthetic $tier skill '$name' for the spec 0119 regression tests."
---

# $name

Body content for $name, seeded in tier $tier. This paragraph exists so the
build has something to normalise that is not whitespace.
EOF
}

seed_agent() {
  local root="$1" tier="$2" name="$3"
  mkdir -p "$root/artifacts/$tier/agents/$name"
  cat > "$root/artifacts/$tier/agents/$name/AGENT.md" <<EOF
---
name: $name
description: "Synthetic $tier agent '$name' for the spec 0119 regression tests."
---

# $name

Body content for agent $name, seeded in tier $tier.
EOF
}

# seed_command <root> <tier> <name> — the build keys a command's output on the
# frontmatter `name`, not the filename, so both are set to <name>.
seed_command() {
  local root="$1" tier="$2" name="$3"
  mkdir -p "$root/artifacts/$tier/commands"
  cat > "$root/artifacts/$tier/commands/$name.md" <<EOF
---
name: $name
description: "Synthetic $tier command '$name' for the spec 0119 regression tests."
type: command
---

Body content for command $name, seeded in tier $tier.
EOF
}

seed_policy() {
  local root="$1" tier="$2" name="$3"
  mkdir -p "$root/artifacts/$tier/policies"
  cat > "$root/artifacts/$tier/policies/$name.md" <<EOF
# $name

Policy body content, seeded in tier $tier for the spec 0119 regression tests.
EOF
}

seed_hook() {
  local root="$1" tier="$2" name="$3"
  mkdir -p "$root/artifacts/$tier/hooks"
  cat > "$root/artifacts/$tier/hooks/$name.sh" <<EOF
#!/bin/bash
# Synthetic $tier hook '$name' for the spec 0119 regression tests.
echo "$name ran"
EOF
  chmod +x "$root/artifacts/$tier/hooks/$name.sh"
}

# seed_json <root> <tier> <type> <name> — mcp-servers and themes fragments.
seed_json() {
  local root="$1" tier="$2" type="$3" name="$4"
  mkdir -p "$root/artifacts/$tier/$type"
  printf '{"command":"/bin/echo","args":["%s"]}\n' "$name" \
    > "$root/artifacts/$tier/$type/$name.json"
}

# Mark a type directory present-but-empty, the R8 "present while holding no
# component of the requested type" state.
seed_empty_type() {
  local root="$1" tier="$2" type="$3"
  mkdir -p "$root/artifacts/$tier/$type"
  : > "$root/artifacts/$tier/$type/.gitkeep"
}

build_repo() {
  local root="$1" target="$2" tag="$3"
  run "$tag" bash "$root/scripts/build-components.sh" --target "$target"
}

CLAUDE_CMD="scripts/manage-claude-component.sh"
GEMINI_CMD="scripts/manage-workspace-component.sh"
COPILOT_CMD="scripts/manage-copilot-component.sh"
AGY_CMD="scripts/manage-antigravity-component.sh"

# Snapshot the real repository before any case runs (hygiene case at the foot).
PORCELAIN_BEFORE="$(git -C "$REPO_DIR" status --porcelain 2>/dev/null)"

echo "==========================================="
echo "  spec 0119 — component tier resolution"
echo "  bash: $BASH_VERSION"
echo "==========================================="
echo ""

# =====================================================================
# Case 1 — R7: a component added after the last build resolves by name.
#
# The staleness defect. `ensure_tier_built` (scripts/lib/common.sh) returns 0
# the moment the staging directory exists: it detects absence, never staleness.
# The fixture builds FIRST and adds the component AFTER, so dist/ is present
# and stale — the state a throwaway repo does not reach by construction.
# =====================================================================
R1_ROOT="$(new_repo stale-dist)"
seed_skill "$R1_ROOT" community com-skill
build_repo "$R1_ROOT" claude build-stale >/dev/null
# Added after the build, never compiled. Real body content, not whitespace.
seed_skill "$R1_ROOT" library late-skill

run c1 env HOME="$R1_ROOT/cli-home" bash "$R1_ROOT/$CLAUDE_CMD" install claude-skills late-skill
ok="true"; detail=""
[ "$RUN_STATUS" -eq 0 ] || { ok="false"; detail="command exited non-zero; $(evidence)"; }
[ -f "$R1_ROOT/cli-home/.claude/skills/late-skill/SKILL.md" ] \
  || { ok="false"; detail="late-skill absent from the landing zone; $(evidence)"; }
report "R7: a library component added after the last build installs by name (stale dist/)" "$ok" "$detail"

# =====================================================================
# Case 2 — R9: a component removed from artifacts/ stops being installed.
#
# The build adds and never prunes (`grep -n 'rm -rf' build-components.sh`
# returns one hit, the check-mode staging root), so a deleted component leaves
# its compiled copy behind and an unnamed request installs a component no
# served tier holds. Asserted alongside "no phantom collision", because build
# residue sharing a name with a live component would otherwise make R15 refuse
# that name permanently against a source that is only residue.
# =====================================================================
R2_ROOT="$(new_repo residual-dist)"
seed_skill "$R2_ROOT" community keeper-skill
seed_skill "$R2_ROOT" community doomed-skill
build_repo "$R2_ROOT" claude build-residual >/dev/null
rm -rf "$R2_ROOT/artifacts/community/skills/doomed-skill"

run c2 env HOME="$R2_ROOT/cli-home" bash "$R2_ROOT/$CLAUDE_CMD" install claude-skills
ok="true"; detail=""
[ -e "$R2_ROOT/cli-home/.claude/skills/doomed-skill" ] \
  && { ok="false"; detail="a component absent from every served tier was installed from build residue; $(evidence)"; }
[ -f "$R2_ROOT/cli-home/.claude/skills/keeper-skill/SKILL.md" ] \
  || { ok="false"; detail="${detail}${detail:+$'\n'}the surviving component was not installed; $(evidence)"; }
if grep -qiE 'collision|colliding|ambiguous' "$RUN_OUT" "$RUN_ERR" 2>/dev/null; then
  ok="false"; detail="${detail}${detail:+$'\n'}a phantom collision was reported against build residue; $(evidence)"
fi
report "R9: a component removed from artifacts/ is not installed from build residue" "$ok" "$detail"

# =====================================================================
# Cases 3 and 4 — R7/R8 (named) and R9/R10 (unnamed) over three overlay tiers.
#
# Spec 0119 scenario 1 verbatim: an org component must install while the
# community tier is populated. Today the resolution takes the first existing
# staging root and stops, so a populated community tier hides org entirely.
# =====================================================================
R34_ROOT="$(new_repo three-tiers)"
seed_skill "$R34_ROOT" library lib-skill
seed_skill "$R34_ROOT" community com-skill
seed_skill "$R34_ROOT" org org-skill
build_repo "$R34_ROOT" claude build-three >/dev/null
mkdir -p "$R34_ROOT/cli-home-named" "$R34_ROOT/cli-home-unnamed"

run c3 env HOME="$R34_ROOT/cli-home-named" bash "$R34_ROOT/$CLAUDE_CMD" install claude-skills org-skill
ok="true"; detail=""
[ "$RUN_STATUS" -eq 0 ] || { ok="false"; detail="command exited non-zero; $(evidence)"; }
[ -f "$R34_ROOT/cli-home-named/.claude/skills/org-skill/SKILL.md" ] \
  || { ok="false"; detail="the org component was not installed while community was populated; $(evidence)"; }
report "R7: a named org component installs while the community tier is populated" "$ok" "$detail"

run c4 env HOME="$R34_ROOT/cli-home-unnamed" bash "$R34_ROOT/$CLAUDE_CMD" install claude-skills
ok="true"; detail=""
[ "$RUN_STATUS" -eq 0 ] || { ok="false"; detail="command exited non-zero; $(evidence)"; }
for s in lib-skill com-skill org-skill; do
  [ -f "$R34_ROOT/cli-home-unnamed/.claude/skills/$s/SKILL.md" ] \
    || { ok="false"; detail="${detail}${detail:+$'\n'}$s (unnamed request) was not installed"; }
done
[ "$ok" = "false" ] && detail="${detail}"$'\n'"$(evidence)"
report "R9+R10: an unnamed request installs from all three overlay tiers" "$ok" "$detail"

# =====================================================================
# Case 4b — R9: an unnamed request installs each component UNDER ITS OWN NAME.
#
# Pinned separately from case 4 because the cause is different and neither case
# 4 nor spec 0119's tier reading would name it. `for item in "$SRC_DIR"/*/`
# (manage-claude-component.sh:131, manage-copilot-component.sh:124,
# manage-antigravity-component.sh:111) yields paths with a TRAILING SLASH, and
# BSD `cp -rf src/foo/ dest/` copies the CONTENTS of foo into dest rather than
# foo itself. Measured on this machine: two community skills through
# `task install-claude-workspace` produce a single ~/.claude/skills/SKILL.md and
# the command prints "Copied: alpha", "Copied: beta" and exits 0. Nothing is
# installed as a component, which is R9 unsatisfied however many tiers are
# reached. manage-workspace-component.sh:105 globs without the slash and is
# unaffected — so this is also the silent asymmetry AGENTS.md pillar 5 forbids.
# =====================================================================
R4B_ROOT="$(new_repo unnamed-per-name)"
seed_skill "$R4B_ROOT" community alpha-skill
seed_skill "$R4B_ROOT" community beta-skill
build_repo "$R4B_ROOT" all build-per-name >/dev/null

ok="true"; detail=""
run c4b-claude env HOME="$R4B_ROOT/cli-home-claude" bash "$R4B_ROOT/$CLAUDE_CMD" install claude-skills
for s in alpha-skill beta-skill; do
  [ -f "$R4B_ROOT/cli-home-claude/.claude/skills/$s/SKILL.md" ] \
    || { ok="false"; detail="${detail}${detail:+$'\n'}claude: $s is not installed under its own name"; }
done
[ -f "$R4B_ROOT/cli-home-claude/.claude/skills/SKILL.md" ] \
  && { ok="false"; detail="${detail}${detail:+$'\n'}claude: a skill body was flattened into the landing-zone root"; }

run c4b-agy env HOME="$R4B_ROOT/cli-home-agy" bash "$R4B_ROOT/$AGY_CMD" install antigravity-skills
for s in alpha-skill beta-skill; do
  [ -f "$R4B_ROOT/cli-home-agy/.gemini/antigravity-cli/skills/$s/SKILL.md" ] \
    || { ok="false"; detail="${detail}${detail:+$'\n'}antigravity: $s is not installed under its own name"; }
done

report "R9: an unnamed request installs every component under its own name" "$ok" "$detail"

# =====================================================================
# Case 5 — R8: a served tier present but holding no component of the requested
# type does not mask another tier.
#
# Routed through the Gemini command, the one place the state is reachable:
# `SRC_DIR="$REPO_DIR/artifacts/community/$TYPE"` is used whenever that
# directory EXISTS, and the org fallback is conditioned on its absence — so a
# community tier holding only .gitkeep blocks org while being empty.
# =====================================================================
R5_ROOT="$(new_repo empty-tier)"
seed_empty_type "$R5_ROOT" library skills
seed_empty_type "$R5_ROOT" community skills
seed_skill "$R5_ROOT" org acme-review
build_repo "$R5_ROOT" gemini build-empty >/dev/null

run c5 env HOME="$R5_ROOT/cli-home" bash "$R5_ROOT/$GEMINI_CMD" install skills acme-review
ok="true"; detail=""
[ "$RUN_STATUS" -eq 0 ] || { ok="false"; detail="command exited non-zero; $(evidence)"; }
[ -e "$R5_ROOT/cli-home/.gemini/skills/acme-review" ] \
  || { ok="false"; detail="an empty-but-present served tier masked the org tier; $(evidence)"; }
report "R8: a served tier present but empty of the type does not mask another tier" "$ok" "$detail"

# =====================================================================
# Case 6 — R13: the build refuses two overlay tiers claiming one installed
# target, and the report names the name and every declaring tier.
#
# The exit status alone is not enough: the report content is a requirement
# ("the failure report SHALL name the colliding name and every tier declaring
# it"). The `--- Tier:` banner assertion is what keeps the tier-name checks
# honest — the build's own progress log prints every tier name, so without it
# `library`/`org` would match the progress output rather than the report.
# =====================================================================
R6_ROOT="$(new_repo build-collision-overlay)"
seed_skill "$R6_ROOT" library acme-review
seed_skill "$R6_ROOT" org acme-review
build_repo "$R6_ROOT" all c6
ok="true"; detail=""
[ "$RUN_STATUS" -ne 0 ] || { ok="false"; detail="the build accepted two overlay tiers claiming one installed target; $(evidence)"; }
if grep -q -- '--- Tier:' "$RUN_OUT" 2>/dev/null; then
  ok="false"
  detail="${detail}${detail:+$'\n'}the build entered its tier loop, so it did not refuse before writing; $(evidence)"
fi
both > "$LOGS/c6.both"
grep -Fq 'acme-review' "$LOGS/c6.both" || { ok="false"; detail="${detail}${detail:+$'\n'}the report does not name the colliding name"; }
grep -Fq 'library'     "$LOGS/c6.both" || { ok="false"; detail="${detail}${detail:+$'\n'}the report does not name the library tier"; }
grep -Fq 'org'         "$LOGS/c6.both" || { ok="false"; detail="${detail}${detail:+$'\n'}the report does not name the org tier"; }
report "R13: the build refuses two overlay tiers claiming one installed target" "$ok" "$detail"

# =====================================================================
# Case 7 — R12 (GUARD, not a regression case).
#
# A shared name across DIFFERING landing zones is accepted. This case CANNOT be
# made to fail against the unfixed code — the unfixed build has no collision
# logic at all, so every "accepts" assertion passes vacuously today. It is kept
# as the over-refusal bound on case 6: it fails against the name-only collision
# key the plan rejected (172 installed targets, zero duplicates keyed on
# (tier-class, install-target), nine keyed on name alone). The routing assertion
# below is what stops it degenerating: if both components landed in one root the
# fixture would not discriminate at all.
# =====================================================================
R7_ROOT="$(new_repo build-accept-core-org)"
seed_skill "$R7_ROOT" core developer
seed_skill "$R7_ROOT" org developer
build_repo "$R7_ROOT" all c7
ok="true"; detail=""
[ "$RUN_STATUS" -eq 0 ] || { ok="false"; detail="the build refused a name shared across differing landing zones; $(evidence)"; }
[ -f "$R7_ROOT/.claude/skills/developer/SKILL.md" ] \
  || { ok="false"; detail="${detail}${detail:+$'\n'}fixture does not discriminate: core did not route to the project tree"; }
[ -f "$R7_ROOT/dist/org/.claude/skills/developer/SKILL.md" ] \
  || { ok="false"; detail="${detail}${detail:+$'\n'}fixture does not discriminate: org did not route to dist/"; }
report "R12 (GUARD): the build accepts core+org sharing a name across differing landing zones" "$ok" "$detail"

# =====================================================================
# Case 8 — R12/R13: a command and a skill sharing one name collide, because
# three of four CLIs compile commands into the skills namespace
# (.claude/skills/<n>, .github/skills/<n>, .agents/skills/<n>).
# =====================================================================
R8_ROOT="$(new_repo build-collision-command-skill)"
seed_command "$R8_ROOT" library acme-review
seed_skill   "$R8_ROOT" org     acme-review
build_repo "$R8_ROOT" all c8
ok="true"; detail=""
[ "$RUN_STATUS" -ne 0 ] || { ok="false"; detail="the build accepted a command and a skill sharing one installed name; $(evidence)"; }
if grep -q -- '--- Tier:' "$RUN_OUT" 2>/dev/null; then
  ok="false"; detail="${detail}${detail:+$'\n'}the build entered its tier loop, so it did not refuse before writing"
fi
both > "$LOGS/c8.both"
grep -Fq 'acme-review' "$LOGS/c8.both" || { ok="false"; detail="${detail}${detail:+$'\n'}the report does not name the colliding name"; }
report "R13: the build refuses a command and a skill sharing one installed name" "$ok" "$detail"

# =====================================================================
# Case 9 — R13 on the never-compiled arm. policies, hooks, themes and
# mcp-servers are never compiled, so a guard scoped to build output cannot
# reach them and R15 would be a permanent dead end for those types.
# =====================================================================
R9_ROOT="$(new_repo build-collision-policies)"
seed_policy "$R9_ROOT" library   acme-rules
seed_policy "$R9_ROOT" community acme-rules
build_repo "$R9_ROOT" all c9
ok="true"; detail=""
[ "$RUN_STATUS" -ne 0 ] || { ok="false"; detail="the build accepted two tiers declaring one policies name; $(evidence)"; }
if grep -q -- '--- Tier:' "$RUN_OUT" 2>/dev/null; then
  ok="false"; detail="${detail}${detail:+$'\n'}the build entered its tier loop, so it did not refuse before writing"
fi
both > "$LOGS/c9.both"
grep -Fq 'acme-rules' "$LOGS/c9.both" || { ok="false"; detail="${detail}${detail:+$'\n'}the report does not name the colliding policies name"; }
report "R13: the build refuses two tiers declaring one policies name (never-compiled arm)" "$ok" "$detail"

# =====================================================================
# Case 10 — R15, named shape: an install command refuses an ambiguous name in a
# pre-existing compiled tree instead of picking one.
#
# Spec 0119 scenario "An install command refuses an ambiguous name" is Given a
# compiled tree produced BEFORE the build refused colliding names — the ordinary
# state at rollout. The fixture reproduces exactly that: artifacts/ declares the
# name in ONE tier (so the build accepts it), and dist/org carries a second copy
# as residue. The named request must resolve to two candidates and refuse.
#
# NOTE — this case pins the plan's design that a NAMED request rebuilds only on
# a miss. An implementation that prunes and rebuilds unconditionally on the named
# path would erase the residue before resolving, and R15 would become
# unobservable through this surface. spec 0119 → Out of scope explicitly declines
# to require any command to regenerate or prune such a tree.
# =====================================================================
R10_ROOT="$(new_repo ambiguous-named)"
seed_skill "$R10_ROOT" library acme-review
build_repo "$R10_ROOT" claude build-ambiguous >/dev/null
# Residue from a build that predates the R13 guard: a second copy under org.
mkdir -p "$R10_ROOT/dist/org/.claude/skills/acme-review"
/bin/cp -f "$R10_ROOT/dist/library/.claude/skills/acme-review/SKILL.md" \
           "$R10_ROOT/dist/org/.claude/skills/acme-review/SKILL.md"
diff -q "$R10_ROOT/dist/library/.claude/skills/acme-review/SKILL.md" \
        "$R10_ROOT/dist/org/.claude/skills/acme-review/SKILL.md" >/dev/null \
  || { echo "FATAL: residue seeding failed (cp is aliased?)" >&2; exit 2; }

run c10 env HOME="$R10_ROOT/cli-home" bash "$R10_ROOT/$CLAUDE_CMD" install claude-skills acme-review
ok="true"; detail=""
[ "$RUN_STATUS" -ne 0 ] || { ok="false"; detail="the command resolved an ambiguous name and exited zero; $(evidence)"; }
[ -e "$R10_ROOT/cli-home/.claude/skills/acme-review" ] \
  && { ok="false"; detail="${detail}${detail:+$'\n'}a component was installed under the colliding name; $(evidence)"; }
both > "$LOGS/c10.both"
grep -Fq 'acme-review' "$LOGS/c10.both" || { ok="false"; detail="${detail}${detail:+$'\n'}the report does not name the colliding name"; }
grep -Fq 'library'     "$LOGS/c10.both" || { ok="false"; detail="${detail}${detail:+$'\n'}the report does not name the library source"; }
grep -Fq 'org'         "$LOGS/c10.both" || { ok="false"; detail="${detail}${detail:+$'\n'}the report does not name the org source"; }
report "R15: a named request refuses an ambiguous name in a pre-existing compiled tree" "$ok" "$detail"

# =====================================================================
# Case 11 — R9 + R15 together, unnamed shape: every non-colliding component
# still installs while the colliding name installs nothing.
#
# R15's waiver is "Notwithstanding requirement 7" and names no other
# requirement, and its object is "any component under THAT name" — so an
# all-or-nothing refusal would fail R9 for every sibling it skipped.
#
# Routed through the Gemini `policies` type deliberately. `policies` resolves
# from artifacts/, not from compiled output, so the collision is reachable in
# the unnamed shape: on the compiled types an unnamed request prunes and
# rebuilds before enumerating, and a dist collision after that rebuild would
# require an artifacts collision, which the R13 pre-pass refuses first.
# =====================================================================
R11_ROOT="$(new_repo unnamed-siblings)"
seed_policy "$R11_ROOT" library   acme-rules
seed_policy "$R11_ROOT" community acme-rules
seed_policy "$R11_ROOT" library   solo-rules

run c11 env HOME="$R11_ROOT/cli-home" bash "$R11_ROOT/$GEMINI_CMD" install policies
ok="true"; detail=""
[ "$RUN_STATUS" -ne 0 ] || { ok="false"; detail="the unnamed request exited zero despite a collision; $(evidence)"; }
[ -e "$R11_ROOT/cli-home/.gemini/policies/acme-rules.md" ] \
  && { ok="false"; detail="${detail}${detail:+$'\n'}a component was installed under the colliding name; $(evidence)"; }
[ -f "$R11_ROOT/cli-home/.gemini/policies/solo-rules.md" ] \
  || { ok="false"; detail="${detail}${detail:+$'\n'}a non-colliding sibling was not installed (R9); $(evidence)"; }
both > "$LOGS/c11.both"
grep -Fq 'acme-rules' "$LOGS/c11.both" || { ok="false"; detail="${detail}${detail:+$'\n'}the report does not name the colliding name"; }
report "R9+R15: an unnamed request installs non-colliding siblings and refuses the colliding name" "$ok" "$detail"

# =====================================================================
# Case 12 — R19: install-workspace.sh runs every type, whatever one type does.
#
# Its seven-type loop (commands skills hooks agents policies mcp-servers themes)
# runs under `set -e`, so any non-zero from one type aborts the rest. Two
# independent causes are seeded at once:
#   * `hooks` — artifacts/community/hooks is ABSENT while artifacts/library/hooks
#     holds a component. Today that is a hard error at loop position 3, which
#     truncates the four types after it. After the fix, library serves it.
#   * `skills` — community and org both declare `acme-review`, a legitimate
#     cause for one type to fail once the refusal exists.
#
# `agents` is deliberately NOT asserted: it resolves from compiled output, so
# the same skills collision refuses the rebuild it needs. That is a correction
# to PLAN v4 step 11, which lists five types surviving a colliding `skills`
# name; only the four never-compiled ones can.
# =====================================================================
R12_ROOT="$(new_repo workspace-truncation)"
seed_skill  "$R12_ROOT" library   lib-skill
seed_skill  "$R12_ROOT" community keeper-skill
seed_skill  "$R12_ROOT" community acme-review
seed_skill  "$R12_ROOT" org       acme-review
seed_agent  "$R12_ROOT" community com-agent
seed_command "$R12_ROOT" community com-command
seed_hook   "$R12_ROOT" library   lib-hook
seed_policy "$R12_ROOT" community com-policy
seed_json   "$R12_ROOT" community mcp-servers acme-mcp
seed_json   "$R12_ROOT" community themes      acme-theme

run c12 env HOME="$R12_ROOT/cli-home" bash "$R12_ROOT/scripts/install-workspace.sh" install
H12="$R12_ROOT/cli-home"
ok="true"; detail=""
[ "$RUN_STATUS" -ne 0 ] || { ok="false"; detail="the wrapper exited zero although a type failed; $(evidence)"; }
[ -e "$H12/.gemini/skills/acme-review" ] \
  && { ok="false"; detail="${detail}${detail:+$'\n'}the colliding skills name was installed"; }
[ -f "$H12/.gemini/hooks/lib-hook.sh" ] \
  || { ok="false"; detail="${detail}${detail:+$'\n'}hooks (loop position 3) did not install from the library tier"; }
[ -f "$H12/.gemini/policies/com-policy.md" ] \
  || { ok="false"; detail="${detail}${detail:+$'\n'}policies (after the failing type) never ran"; }
if [ -f "$H12/.gemini/settings.json" ]; then
  jq -e '.mcpServers["acme-mcp"]' "$H12/.gemini/settings.json" >/dev/null 2>&1 \
    || { ok="false"; detail="${detail}${detail:+$'\n'}mcp-servers (after the failing type) never ran"; }
  jq -e '.themes["acme-theme"]' "$H12/.gemini/settings.json" >/dev/null 2>&1 \
    || { ok="false"; detail="${detail}${detail:+$'\n'}themes (last in the loop) never ran"; }
else
  ok="false"; detail="${detail}${detail:+$'\n'}no ~/.gemini/settings.json: mcp-servers and themes never ran"
fi
[ "$ok" = "false" ] && detail="${detail}"$'\n'"$(evidence)"
report "R19: install-workspace.sh runs every type and reports failure without truncating" "$ok" "$detail"

# =====================================================================
# Case 13 — a refused rebuild is reported as a refused rebuild, never as an
# unresolved name.
#
# After the R13 pre-pass the build carries a refusal whose whole purpose is to
# exit non-zero on a collision. Emitting "not found, searched N roots" when the
# established cause is a refused build would name a cause that was not
# established, which R17 forbids.
# =====================================================================
R13_ROOT="$(new_repo failed-rebuild)"
seed_skill "$R13_ROOT" library acme-review
seed_skill "$R13_ROOT" org     acme-review

run c13 env HOME="$R13_ROOT/cli-home" bash "$R13_ROOT/$CLAUDE_CMD" install claude-skills zz-absent
ok="true"; detail=""
[ "$RUN_STATUS" -ne 0 ] || { ok="false"; detail="the command exited zero although the rebuild it needs is refused; $(evidence)"; }
both > "$LOGS/c13.both"
grep -Fq 'acme-review' "$LOGS/c13.both" \
  || { ok="false"; detail="${detail}${detail:+$'\n'}the build's own refusal was not surfaced (the colliding name is absent from the report)"; }
if grep -qiE 'not found|unresolved|searched' "$LOGS/c13.both"; then
  ok="false"
  detail="${detail}${detail:+$'\n'}a refused rebuild was reported as an unresolved name"
fi
[ "$ok" = "false" ] && detail="${detail}"$'\n'"$(evidence)"
report "step 3 exit contract: a refused rebuild is reported as itself, not as an unresolved name" "$ok" "$detail"

# =====================================================================
# Case 14 — R3: a non-core component never reaches the committed project tree.
#
# Asserted with `git status --porcelain`, NEVER `git diff-index --quiet HEAD`:
# measured in a throwaway clone, diff-index returns 1 immediately after a build
# and on every repeat, purely from stat churn on byte-identical content, and only
# returns 0 once some `git status` has refreshed the index — while
# `git status --porcelain` is empty throughout. The two in-repo precedents
# (sync-from-upstream.sh, worktree-claim.sh) both use `git status --porcelain`.
#
# The landing-zone assertion is the non-vacuity guard: without it, a command that
# installs nothing at all would pass this case.
# =====================================================================
R14_ROOT="$(new_repo r3-clean-checkout)"
seed_skill "$R14_ROOT" community acme-review
GIT="git -C $R14_ROOT -c user.name=crewrig-test -c user.email=test@example.invalid -c commit.gpgsign=false -c init.defaultBranch=main"
$GIT init >/dev/null 2>&1
# Explicit paths only — never `git add -A`.
$GIT add scripts Taskfile.yml .gitignore artifacts >/dev/null 2>&1
[ -f "$R14_ROOT/crewrig.config.toml" ] && $GIT add crewrig.config.toml >/dev/null 2>&1
$GIT commit -m "fixture" >/dev/null 2>&1
build_repo "$R14_ROOT" copilot build-r3 >/dev/null

run c14 env HOME="$R14_ROOT/cli-home" bash "$R14_ROOT/$COPILOT_CMD" install skills acme-review
PORC="$($GIT status --porcelain 2>&1)"
ok="true"; detail=""
if [ -n "$PORC" ]; then
  ok="false"
  detail="a non-core install modified the committed project tree. git status --porcelain:
$PORC
$(evidence)"
fi
[ -e "$R14_ROOT/cli-home/.copilot/skills/acme-review" ] \
  || { ok="false"; detail="${detail}${detail:+$'\n'}nothing was delivered to the command's landing zone (the case would otherwise pass vacuously); $(evidence)"; }
report "R3: a non-core per-component install leaves the committed checkout clean" "$ok" "$detail"

# =====================================================================
# Case 15 — R6: the core tier is unreachable from every per-component command,
# whose landing zone is the committed project tree and whose delivery is not an
# install.
#
# Only --target claude is built, so .github/skills does not exist before the
# run: that makes the Copilot arm decisive. Asserting its exit status alone
# would NOT — today the Copilot command exits 1 even on a successful install,
# because the status is the trailing `[ -d ]` test of its root loop rather than
# a decision.
# =====================================================================
R15_ROOT="$(new_repo core-unreachable)"
seed_skill "$R15_ROOT" core      core-only
seed_skill "$R15_ROOT" community com-skill
build_repo "$R15_ROOT" claude build-core >/dev/null
H15="$R15_ROOT/cli-home"
ok="true"; detail=""

run c15-claude env HOME="$H15" bash "$R15_ROOT/$CLAUDE_CMD" install claude-skills core-only
[ "$RUN_STATUS" -ne 0 ] || { ok="false"; detail="${detail}${detail:+$'\n'}claude: exited zero for a core-only component"; }
[ -e "$H15/.claude/skills/core-only" ] && { ok="false"; detail="${detail}${detail:+$'\n'}claude: installed a core component"; }

run c15-gemini env HOME="$H15" bash "$R15_ROOT/$GEMINI_CMD" install skills core-only
[ "$RUN_STATUS" -ne 0 ] || { ok="false"; detail="${detail}${detail:+$'\n'}gemini: exited zero for a core-only component"; }
[ -e "$H15/.gemini/skills/core-only" ] && { ok="false"; detail="${detail}${detail:+$'\n'}gemini: installed a core component"; }

run c15-agy env HOME="$H15" bash "$R15_ROOT/$AGY_CMD" install antigravity-skills core-only
[ "$RUN_STATUS" -ne 0 ] || { ok="false"; detail="${detail}${detail:+$'\n'}antigravity: exited zero for a core-only component"; }
[ -e "$H15/.gemini/antigravity-cli/skills/core-only" ] && { ok="false"; detail="${detail}${detail:+$'\n'}antigravity: installed a core component"; }

run c15-copilot env HOME="$H15" bash "$R15_ROOT/$COPILOT_CMD" install skills core-only
# The decisive assertion: the project tree must be untouched. The overlay
# rebuild the fix performs writes only under dist/, so .github/skills stays
# absent unless the command resolved core.
[ -e "$R15_ROOT/.github/skills/core-only" ] \
  && { ok="false"; detail="${detail}${detail:+$'\n'}copilot: resolved the core tier and wrote it into the project tree at .github/skills/core-only"; }
[ -e "$H15/.copilot/skills/core-only" ] && { ok="false"; detail="${detail}${detail:+$'\n'}copilot: installed a core component into the user home"; }
report "R6: the core tier is unreachable from all four per-component commands" "$ok" "$detail"

# =====================================================================
# Cases 16 and 17 — R16/R17/R18: an unresolvable name fails, names every tier
# searched, and does not blame a missing build step.
#
# Asserted over stderr PLUS stdout with the build's own progress lines filtered
# out. Both halves of that matter. Not stderr alone: which stream carries the
# report is a design choice, not a spec requirement, and a correct fix that
# prints to stdout must not fail here. Not the raw combined output either: the
# rebuild performed on a miss prints `--- Tier: library …` for every tier, so an
# unfiltered grep for `library` would match progress noise and the tier-name
# assertions would pass whatever the report said.
# =====================================================================
# report_view <stdout> <stderr> — everything the operator sees that is not build
# progress. Keep in step with build-components.sh's own banner lines.
report_view() {
  cat "$2" 2>/dev/null
  sed -E '/^--- Tier:/d; /^Building (skill|command|agent):/d; /^=+$/d; /^ +(Target|Mode):/d; /^ +Community Component Builder$/d; /^Done\.$/d; /^$/d' "$1" 2>/dev/null
}
R16_ROOT="$(new_repo unresolvable-name)"
seed_skill "$R16_ROOT" library   lib-skill
seed_skill "$R16_ROOT" community com-skill
seed_skill "$R16_ROOT" org       org-skill
build_repo "$R16_ROOT" all build-unresolvable >/dev/null

ASSERT_OK="true"
ASSERT_DETAIL=""
assert_unresolved_report() {
  local label="$1"
  local view="$2"
  local o="true"
  local d=""
  local t
  [ -s "$view" ] || { o="false"; d="$label: the report is empty (the miss is silent)"; }
  grep -Fq 'no-such-component' "$view" 2>/dev/null \
    || { o="false"; d="${d}${d:+$'\n'}$label: the report does not identify the requested name as the unresolved subject"; }
  for t in library community org; do
    grep -Fq "$t" "$view" 2>/dev/null \
      || { o="false"; d="${d}${d:+$'\n'}$label: the report does not name the $t tier among those searched"; }
  done
  if grep -qE 'build-components\.sh|run a build|missing build' "$view" 2>/dev/null; then
    o="false"; d="${d}${d:+$'\n'}$label: the report attributes the miss to a missing build step although served tiers were available"
  fi
  ASSERT_OK="$o"; ASSERT_DETAIL="$d"
}

run c16 env HOME="$R16_ROOT/cli-home" bash "$R16_ROOT/$COPILOT_CMD" install skills no-such-component
ok="true"; detail=""
[ "$RUN_STATUS" -ne 0 ] || { ok="false"; detail="the command exited zero on an unresolvable name"; }
report_view "$RUN_OUT" "$RUN_ERR" > "$LOGS/c16.view"
assert_unresolved_report copilot "$LOGS/c16.view"
[ "$ASSERT_OK" = "true" ] || { ok="false"; detail="${detail}${detail:+$'\n'}$ASSERT_DETAIL"; }
[ "$ok" = "false" ] && detail="${detail}"$'\n'"$(evidence)"
report "R16-R18: the Copilot command reports an unresolvable name and names every searched tier" "$ok" "$detail"

run c17 env HOME="$R16_ROOT/cli-home" bash "$R16_ROOT/$CLAUDE_CMD" install claude-skills no-such-component
ok="true"; detail=""
[ "$RUN_STATUS" -ne 0 ] || { ok="false"; detail="the command exited zero on an unresolvable name"; }
report_view "$RUN_OUT" "$RUN_ERR" > "$LOGS/c17.view"
assert_unresolved_report claude "$LOGS/c17.view"
[ "$ASSERT_OK" = "true" ] || { ok="false"; detail="${detail}${detail:+$'\n'}$ASSERT_DETAIL"; }
[ "$ok" = "false" ] && detail="${detail}"$'\n'"$(evidence)"
report "R16-R18: the Claude command reports an unresolvable name and names every searched tier" "$ok" "$detail"

# =====================================================================
# Cases 18 and 19 — R20's relational arm, derived structurally.
#
# For each CLI, the setup script's declared landing zone and staging root and
# the command's are parsed and compared. A results comparison would be actively
# harmful: install_tier_skills_to_home (setup-copilot-interactive.sh) copies only
# SKILL.md while place_component (manage-copilot-component.sh) copies the whole
# directory, so the two routes' file sets differ for a reason R1/R2 do not bind.
#
# A parse that matches nothing FAILS the case rather than passing vacuously,
# following scripts/check-bash32-portability.sh. HOME and REPO_DIR resolve to the
# sentinels <HOME> and <REPO> so the comparison is over declared intent, not over
# one machine's paths.
# =====================================================================
strip_q() { printf '%s' "$1" | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'\$//"; }

# var_last <script> <VAR> — the last assignment of VAR, for substitution.
var_last() {
  local script="$1" var="$2" line
  line=$(grep -E "^[[:space:]]*(local[[:space:]]+)?${var}=" "$script" 2>/dev/null | tail -1)
  [ -n "$line" ] || return 1
  strip_q "$(printf '%s' "$line" | sed 's/^[^=]*=//')"
}

# resolve_expr <script> <expr> — expand $VAR/${VAR} from the script's own
# assignments. HOME, REPO_DIR, tier and TYPE become stable sentinels. Bash
# substitution, not sed: a substituted value containing the sed delimiter
# ("s|${MCP_BASE}|$(echo …" in setup-antigravity-interactive.sh) breaks sed.
resolve_expr() {
  local script="$1" val="$2" pass name sub
  for pass in 1 2 3 4 5 6; do
    val=$(printf '%s' "$val" | sed \
      -e 's/\${HOME}/<HOME>/g' -e 's/\$HOME/<HOME>/g' \
      -e 's/\${REPO_DIR}/<REPO>/g' -e 's/\$REPO_DIR/<REPO>/g' \
      -e 's/\${tier}/<TIER>/g' -e 's/\$tier/<TIER>/g' \
      -e 's/\${TYPE}/skills/g' -e 's/\$TYPE/skills/g')
    case "$val" in *'$'*) ;; *) break ;; esac
    name=$(printf '%s' "$val" | sed -n 's/.*\$[{]\{0,1\}\([A-Za-z_][A-Za-z0-9_]*\).*/\1/p' | head -1)
    [ -n "$name" ] || break
    sub=$(var_last "$script" "$name") || break
    [ -n "$sub" ] || break
    val="${val//"\${$name}"/$sub}"
    val="${val//"\$$name"/$sub}"
  done
  printf '%s' "$val"
}

# resolved_by_name <script> <name-ERE> — resolved value of EVERY assignment whose
# variable name matches. Every line, not just the last: manage-claude-component.sh
# assigns DEST twice (skills, then rules) and the second would hide the first.
resolved_by_name() {
  local script="$1" name_re="$2" line val
  while IFS= read -r line; do
    val=$(resolve_expr "$script" "$(strip_q "$(printf '%s' "$line" | sed 's/^[^=]*=//')")")
    [ -n "$val" ] && printf '%s\n' "$val"
  done < <(grep -E "^[[:space:]]*(local[[:space:]]+)?${name_re}=" "$script" 2>/dev/null)
}

# The four CLIs: <cli> <setup-script> <command-script>
CLI_ROWS="claude:setup-claude-interactive.sh:manage-claude-component.sh
gemini:setup-gemini-interactive.sh:manage-workspace-component.sh
copilot:setup-copilot-interactive.sh:manage-copilot-component.sh
antigravity:setup-antigravity-interactive.sh:manage-antigravity-component.sh"

# scan_set <command-script> — the command plus every scripts/lib file it sources,
# so a tier list or staging root that moved into the shared resolver still counts.
scan_set() {
  local cmd="$1" libname
  printf '%s\n' "$cmd"
  while IFS= read -r libname; do
    [ -f "$REPO_DIR/scripts/$libname" ] && printf '%s\n' "$REPO_DIR/scripts/$libname"
  done < <(grep -oE '(lib/[A-Za-z0-9_-]+\.sh)' "$cmd" 2>/dev/null | sort -u)
}

ok="true"; detail=""
while IFS= read -r row; do
  cli="${row%%:*}"
  rest="${row#*:}"
  setup="$REPO_DIR/scripts/${rest%%:*}"
  cmd="$REPO_DIR/scripts/${rest##*:}"

  setup_zone="$(resolved_by_name "$setup" '[A-Za-z_][A-Za-z0-9_]*' | grep -E '^<HOME>.*/skills$' | sort -u)"
  cmd_zone="$(resolved_by_name "$cmd" '[A-Za-z0-9_]*DEST[A-Za-z0-9_]*' | grep -E '/skills$' | sort -u)"

  # Vacuity guards first: an unparseable side fails the case, never passes it.
  if [ -z "$setup_zone" ] || [ "$(printf '%s\n' "$setup_zone" | wc -l | tr -d ' ')" != "1" ]; then
    ok="false"
    detail="${detail}${detail:+$'\n'}$cli: could not parse exactly one user-home skills landing zone from $(basename "$setup") (got: $(printf '%s' "$setup_zone" | tr '\n' ' '))"
    continue
  fi
  if [ -z "$cmd_zone" ] || [ "$(printf '%s\n' "$cmd_zone" | wc -l | tr -d ' ')" != "1" ]; then
    ok="false"
    detail="${detail}${detail:+$'\n'}$cli: could not parse exactly one skills landing zone from $(basename "$cmd") (got: $(printf '%s' "$cmd_zone" | tr '\n' ' '))"
    continue
  fi
  if [ "$setup_zone" != "$cmd_zone" ]; then
    ok="false"
    detail="${detail}${detail:+$'\n'}$cli: landing zones diverge — setup declares '$setup_zone', command declares '$cmd_zone'"
  fi
done <<EOF
$CLI_ROWS
EOF
report "R20/R1: every command's skills landing zone equals its assisted setup's" "$ok" "$detail"

ok="true"; detail=""
while IFS= read -r row; do
  cli="${row%%:*}"
  rest="${row#*:}"
  setup="$REPO_DIR/scripts/${rest%%:*}"
  cmd="$REPO_DIR/scripts/${rest##*:}"

  # The CLI root the assisted setup reads under dist/<tier>/.
  setup_root="$(grep -oE 'dist/\$\{?tier\}?/\.[A-Za-z]+' "$setup" 2>/dev/null | sed 's|.*/||' | sort -u)"
  if [ -z "$setup_root" ] || [ "$(printf '%s\n' "$setup_root" | wc -l | tr -d ' ')" != "1" ]; then
    ok="false"
    detail="${detail}${detail:+$'\n'}$cli: could not parse exactly one dist/<tier>/<root> staging root from $(basename "$setup") (got: $(printf '%s' "$setup_root" | tr '\n' ' '))"
    continue
  fi

  scan="$(scan_set "$cmd")"
  # Basis: the command must resolve skills from the same staging root.
  if ! printf '%s\n' "$scan" | xargs grep -l -- "dist/" >/dev/null 2>&1; then
    ok="false"
    detail="${detail}${detail:+$'\n'}$cli: the command reads no compiled output at all (no dist/ reference), while its setup reads dist/<tier>/$setup_root"
  elif ! printf '%s\n' "$scan" | xargs grep -q -- "$setup_root/skills" 2>/dev/null; then
    ok="false"
    detail="${detail}${detail:+$'\n'}$cli: the command does not resolve skills from the setup's staging root ($setup_root/skills)"
  fi
  # Tier set: all three overlay tiers must be reachable.
  for t in library community org; do
    printf '%s\n' "$scan" | xargs grep -qw -- "$t" 2>/dev/null \
      || { ok="false"; detail="${detail}${detail:+$'\n'}$cli: the command never references the $t tier"; }
  done
done <<EOF
$CLI_ROWS
EOF
report "R20/R2+R5: every command resolves skills from its setup's staging root, over all three overlay tiers" "$ok" "$detail"

# =====================================================================
# Case 20 — R19: the twelve documented task entry points, plus
# scripts/install-workspace.sh reached directly.
#
# Taskfile.yml:85,89,93,97,105,109,179,183,187,191,203,207. Stdin handling is
# per script, not uniform: the Claude, Copilot and Antigravity commands prompt
# in link mode; manage-workspace-component.sh has no prompt, so `link-component`
# and `link-workspace` must NOT be fed one. install-claude-workspace and
# link-claude-workspace drive manage-claude-component.sh, so the second prompts
# too — a detail PLAN v4 step 11 omits from its stdin list.
#
# Two drivers, same assertions. The go-task runner is used when present; where it
# is not, each entry's own `cmd:` is extracted from Taskfile.yml and run with the
# template variables substituted. The fallback is not a cosmetic stand-in: it
# composes the same command line the runner would, so the case keeps its teeth in
# an environment without the binary — which is the CI condition, since the
# check-components job this test is wired into declares `tools: [yq]` and nothing
# installs go-task. Skipping there would leave R19 asserted only on a developer
# machine, and a case that cannot fail in CI is not a regression check.
# =====================================================================
TASK_PROBE="$(command -v task 2>&1)"
TASK_PROBE_STATUS=$?
if [ "$TASK_PROBE_STATUS" -eq 0 ]; then
  TASK_DRIVER="go-task runner ($TASK_PROBE)"
else
  TASK_DRIVER="extracted Taskfile cmd (probe \`command -v task\` -> exit=$TASK_PROBE_STATUS, no output)"
fi

# taskfile_cmd <taskfile> <task-name> — the `cmd:` of one task entry, verbatim.
taskfile_cmd() {
  awk -v want="  $2:" '
    $0 == want { inblk = 1; next }
    inblk && /^  [A-Za-z]/ { exit }
    inblk && /^[[:space:]]*cmd:/ {
      sub(/^[[:space:]]*cmd:[[:space:]]*/, "")
      print
      exit
    }
  ' "$1"
}

if true; then
  R20_ROOT="$(new_repo task-entry-points)"
  seed_skill  "$R20_ROOT" library   lib-skill
  seed_skill  "$R20_ROOT" community com-skill
  seed_skill  "$R20_ROOT" org       org-skill
  seed_agent  "$R20_ROOT" community com-agent
  seed_command "$R20_ROOT" community com-command
  seed_hook   "$R20_ROOT" community com-hook
  seed_policy "$R20_ROOT" community com-policy
  seed_json   "$R20_ROOT" community mcp-servers acme-mcp
  seed_json   "$R20_ROOT" community themes      acme-theme
  build_repo "$R20_ROOT" all build-task >/dev/null
  H20="$R20_ROOT/cli-home"

  ok="true"; detail=""

  # tsk <tag> <stdin-or-empty> <task-name> <expected-script> [TYPE] [NAME]
  tsk() {
    local tag="$1"
    local feed="$2"
    local tname="$3"
    local expect_script="$4"
    local type="${5:-}"
    local name="${6:-}"
    local raw cmdline

    # Structural arm, both drivers: the entry point must exist and must still
    # drive the script this case believes it drives.
    raw="$(taskfile_cmd "$R20_ROOT/Taskfile.yml" "$tname")"
    if [ -z "$raw" ]; then
      ok="false"
      detail="${detail}${detail:+$'\n'}$tname: no such entry point in Taskfile.yml (or it declares no cmd)"
      RUN_STATUS=127
      RUN_OUT="/dev/null"
      RUN_ERR="/dev/null"
      return
    fi
    case "$raw" in
      *"$expect_script"*) ;;
      *) ok="false"
         detail="${detail}${detail:+$'\n'}$tname: no longer drives $expect_script (cmd: $raw)" ;;
    esac

    if [ "$TASK_PROBE_STATUS" -eq 0 ]; then
      set -- env HOME="$H20" task -d "$R20_ROOT" "REPO_DIR=$R20_ROOT" "$tname"
      [ -n "$type" ] && set -- "$@" "TYPE=$type"
      [ -n "$name" ] && set -- "$@" "NAME=$name"
    else
      cmdline="$(printf '%s' "$raw" \
        | sed -e "s|{{\.REPO_DIR}}|$R20_ROOT|g" \
              -e "s|{{\.TYPE}}|$type|g" \
              -e "s|{{\.NAME}}|$name|g")"
      set -- env HOME="$H20" bash -c "$cmdline"
    fi

    if [ -n "$feed" ]; then
      run_stdin "$tag" "$feed" "$@"
    else
      run "$tag" "$@"
    fi
  }
  entry() {
    local label="$1" expect="$2"
    if [ "$RUN_STATUS" -ne 0 ]; then
      ok="false"; detail="${detail}${detail:+$'\n'}$label: exited $RUN_STATUS — $(head -3 "$RUN_ERR" 2>/dev/null | tr '\n' ' ')"
    elif [ ! -e "$expect" ]; then
      ok="false"; detail="${detail}${detail:+$'\n'}$label: exited 0 but did not deliver $(printf '%s' "$expect" | sed "s|$R20_ROOT|<repo>|")"
    fi
  }

  tsk t85  ''  install-workspace              install-workspace.sh
  entry "Taskfile:85 install-workspace" "$H20/.gemini/skills/com-skill"

  tsk t93  ''  install-component              manage-workspace-component.sh skills org-skill
  entry "Taskfile:93 install-component (org tier)" "$H20/.gemini/skills/org-skill"

  tsk t97  ''  link-component                 manage-workspace-component.sh skills org-skill
  entry "Taskfile:97 link-component (org tier, no prompt)" "$H20/.gemini/skills/org-skill"

  tsk t89  ''  link-workspace                 install-workspace.sh
  entry "Taskfile:89 link-workspace (no prompt)" "$H20/.gemini/skills/com-skill"

  tsk t105 ''  install-copilot-component      manage-copilot-component.sh skills org-skill
  entry "Taskfile:105 install-copilot-component (org tier)" "$H20/.copilot/skills/org-skill"

  tsk t109 'y' link-copilot-component         manage-copilot-component.sh skills org-skill
  entry "Taskfile:109 link-copilot-component (org tier)" "$H20/.copilot/skills/org-skill"

  tsk t179 ''  install-claude-workspace       manage-claude-component.sh
  entry "Taskfile:179 install-claude-workspace (library tier)" "$H20/.claude/skills/lib-skill"
  entry "Taskfile:179 install-claude-workspace (org tier)" "$H20/.claude/skills/org-skill"

  tsk t183 'y' link-claude-workspace          manage-claude-component.sh
  entry "Taskfile:183 link-claude-workspace" "$H20/.claude/skills/com-skill"

  tsk t187 ''  install-claude-component       manage-claude-component.sh claude-skills org-skill
  entry "Taskfile:187 install-claude-component (org tier)" "$H20/.claude/skills/org-skill"

  tsk t191 'y' link-claude-component          manage-claude-component.sh claude-skills org-skill
  entry "Taskfile:191 link-claude-component (org tier)" "$H20/.claude/skills/org-skill"

  tsk t203 ''  install-antigravity-component  manage-antigravity-component.sh antigravity-skills org-skill
  entry "Taskfile:203 install-antigravity-component (org tier)" "$H20/.gemini/antigravity-cli/skills/org-skill"

  tsk t207 'y' link-antigravity-component     manage-antigravity-component.sh antigravity-skills org-skill
  entry "Taskfile:207 link-antigravity-component (org tier)" "$H20/.gemini/antigravity-cli/skills/org-skill"

  run t-direct env HOME="$H20" bash "$R20_ROOT/scripts/install-workspace.sh" install
  entry "scripts/install-workspace.sh (reached directly)" "$H20/.gemini/policies/com-policy.md"

  [ "$ok" = "false" ] && detail="${detail}"$'\n'"driver: $TASK_DRIVER"
  report "R19: all twelve documented task entry points and install-workspace.sh honour R1-R18" "$ok" "$detail"
fi

# =====================================================================
# Hygiene — this test must leave the real repository byte-identical. Compared
# against a snapshot rather than asserted empty, so the check is meaningful on a
# working branch that is legitimately dirty.
# =====================================================================
PORCELAIN_AFTER="$(git -C "$REPO_DIR" status --porcelain 2>/dev/null)"
ok="true"; detail=""
if [ "$PORCELAIN_BEFORE" != "$PORCELAIN_AFTER" ]; then
  ok="false"
  detail="the test changed the real repository. diff of git status --porcelain:
$(diff <(printf '%s\n' "$PORCELAIN_BEFORE") <(printf '%s\n' "$PORCELAIN_AFTER") | head -20)"
fi
report "hygiene: the test leaves the real repository unchanged" "$ok" "$detail"

echo ""
echo "==========================================="
echo "  Result: $PASS passed, $FAIL failed"
echo "==========================================="
if [ "$FAIL" -ne 0 ]; then
  printf 'Failing cases:\n%s' "$FAILED_NAMES"
  exit 1
fi
